import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { API_PREFIX, attachmentIdSchema } from '@river/protocol';
import { authenticate } from '../accounts/auth-store.ts';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';
import type { Database } from '../db/schema.ts';
import { HttpError } from '../http-error.ts';

/** Uploads not attached to a message within this time are deleted. */
const UNLINKED_TTL_MS = 24 * 60 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 60 * 1000;
const DM_RETAIN_MS = 31 * 24 * 60 * 60 * 1000;
/** Default for RIVER_MIN_FREE_DISK_MB: uploads leave at least this much free on the disk (2.20). */
const MIN_FREE_DISK = 1024 * 1024 * 1024;
/** Smallest possible encrypted attachment: IV + one AES block + MAC. */
const MIN_BLOB = 16 + 16 + 32;

/**
 * Encrypted attachment blobs. The server sees only ciphertext (padded to size
 * buckets); keys, names and types travel inside end-to-end encrypted messages.
 */
export async function registerAttachmentRoutes(
  app: FastifyInstance,
  deps: {
    config: ServerConfig;
    database: RiverDatabase;
    now: () => Date;
    /** Free bytes on the attachment folder's disk (tests replace it). */
    diskFree?: (dir: string) => Promise<number>;
  },
): Promise<void> {
  const { db } = deps.database;
  const dir = resolve(deps.config.attachmentDir);
  await mkdir(dir, { recursive: true });
  const fileOf = (id: string): string => join(dir, id);
  /** Free space for uploads; null when the system cannot say (then only the totals apply). */
  const diskFree = async (): Promise<number | null> => {
    try {
      if (deps.diskFree) return await deps.diskFree(dir);
      const s = await statfs(dir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return null;
    }
  };
  const outOfSpace = (): HttpError =>
    // quota_exceeded: apps since 1.0 show its message as it is.
    new HttpError(
      507,
      'quota_exceeded',
      'This River server is out of space for files right now. Ask whoever runs it to free some up.',
    );

  // The parser serves every route, so it keeps the server's small default limit (2.18): only the
  // upload route below allows attachment-sized bodies, and only after the session checked out.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  const requireSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await authenticate(db, token, deps.now()) : null;
    if (!session) {
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'A valid session is required' } });
    }
    request.session = session;
  };

  app.post<{ Querystring: { retain?: string } }>(
    `${API_PREFIX}/attachments`,
    {
      // Before the body is read: nobody without a session makes the server take in 25 MB.
      onRequest: requireSession,
      bodyLimit: deps.config.maxAttachmentBytes,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body))
        throw new HttpError(415, 'unsupported_media_type', 'Send application/octet-stream');
      if (body.length < MIN_BLOB || (body.length - 48) % 16 !== 0) {
        throw new HttpError(400, 'bad_request', 'That is not an encrypted River attachment');
      }
      const uploader = request.session!.riverId;
      // A full disk would take the database (and every message) down with it (2.20).
      const free = await diskFree();
      if (free !== null && free - body.length < (deps.config.minFreeDiskBytes ?? MIN_FREE_DISK))
        throw outOfSpace();
      const id = randomBytes(16).toString('base64url');
      const tmp = `${fileOf(id)}.part`;
      await writeFile(tmp, body, { flag: 'wx' });
      // The quota check and the insert happen in one transaction. On PostgreSQL the uploader's
      // account row is locked first, so parallel uploads by one person are counted one after
      // another; SQLite runs one write transaction at a time. The sum uses attachments_by_uploader.
      let fits: boolean | 'server' = false;
      try {
        fits = await db.transaction().execute(async (trx): Promise<boolean | 'server'> => {
          if (deps.database.dialect === 'postgres') {
            await trx
              .selectFrom('accounts')
              .select('river_id')
              .where('river_id', '=', uploader)
              .forUpdate()
              .execute();
          }
          const used = await trx
            .selectFrom('attachments')
            .select((eb) => eb.fn.sum<number>('size').as('total'))
            .where('uploader', '=', uploader)
            .executeTakeFirst();
          if (Number(used?.total ?? 0) + body.length > deps.config.attachmentQuotaBytes) return false;
          // Every file on the server together, when the operator set a total (2.20).
          const total = deps.config.attachmentTotalBytes ?? 0;
          if (total > 0) {
            const all = await trx
              .selectFrom('attachments')
              .select((eb) => eb.fn.sum<number>('size').as('total'))
              .executeTakeFirst();
            if (Number(all?.total ?? 0) + body.length > total) return 'server' as const;
          }
          await trx
            .insertInto('attachments')
            .values({
              id,
              uploader,
              size: body.length,
              created_at: deps.now().toISOString(),
              message_id: null,
              // Direct-message files: the recipient may be offline as long as the mailbox keeps mail.
              retain_until:
                request.query.retain === 'dm'
                  ? new Date(deps.now().getTime() + DM_RETAIN_MS).toISOString()
                  : null,
            })
            .execute();
          return true;
        });
        if (fits === true) await rename(tmp, fileOf(id));
      } finally {
        if (fits !== true) await rm(tmp, { force: true });
      }
      if (fits === 'server') throw outOfSpace();
      if (!fits) {
        throw new HttpError(413, 'quota_exceeded', 'You have reached your storage limit on this server');
      }
      return reply.code(201).send({ id });
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/attachments/:id`,
    { preHandler: requireSession },
    async (request, reply) => {
      const parsed = attachmentIdSchema.safeParse(request.params.id);
      if (!parsed.success) throw new HttpError(404, 'not_found', 'Not found');
      const row = await db
        .selectFrom('attachments')
        .select(['id', 'size'])
        .where('id', '=', parsed.data)
        .executeTakeFirst();
      if (!row) throw new HttpError(404, 'not_found', 'Not found');
      // The file must be there (and whole) before any header goes out: a missing blob (a disk that
      // was restored without its attachments folder) is "not found", never a stream that fails
      // after a binary content type was set, which Fastify then answers with its own error text.
      const info = await stat(fileOf(row.id)).catch(() => null);
      if (!info?.isFile() || info.size !== row.size) throw new HttpError(404, 'not_found', 'Not found');
      reply.header('content-type', 'application/octet-stream');
      reply.header('content-length', String(row.size));
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      return reply.send(createReadStream(fileOf(row.id)));
    },
  );

  /** Deletes unlinked uploads past their TTL and files whose row is gone (message deleted). */
  const collect = async (): Promise<void> => {
    const cutoff = new Date(deps.now().getTime() - UNLINKED_TTL_MS).toISOString();
    await db
      .deleteFrom('attachments')
      .where('message_id', 'is', null)
      .where((eb) =>
        eb.or([
          eb.and([eb('retain_until', 'is', null), eb('created_at', '<', cutoff)]),
          eb('retain_until', '<', deps.now().toISOString()),
        ]),
      )
      .execute();
    const known = new Set((await db.selectFrom('attachments').select('id').execute()).map((r) => r.id));
    for (const name of await readdir(dir)) {
      const id = name.replace(/\.part$/, '');
      if (known.has(id) && !name.endsWith('.part')) continue;
      // Never race an upload that is still being written.
      const info = await stat(join(dir, name)).catch(() => null);
      if (!info || Date.now() - info.mtimeMs < 60_000) continue;
      await rm(join(dir, name), { force: true });
    }
  };
  const timer = setInterval(() => void collect().catch(() => undefined), GC_INTERVAL_MS);
  timer.unref();
  app.addHook('onReady', async () => {
    await collect().catch(() => undefined);
  });
  app.addHook('onClose', async () => clearInterval(timer));
  app.decorate('collectAttachments', collect);
}

/**
 * Attaches uploaded blobs to a new message. Only the uploader's own,
 * not-yet-used blobs can be attached.
 */
export async function linkAttachments(
  trx: Transaction<Database> | Kysely<Database>,
  ids: string[],
  uploader: string,
  messageId: string,
): Promise<void> {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const rows = await trx
    .selectFrom('attachments')
    .select('id')
    .where('id', 'in', unique)
    .where('uploader', '=', uploader)
    .where('message_id', 'is', null)
    .where('retain_until', 'is', null)
    .execute();
  if (rows.length !== unique.length)
    throw new HttpError(400, 'bad_request', 'Unknown or already used attachment');
  await trx.updateTable('attachments').set({ message_id: messageId }).where('id', 'in', unique).execute();
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Runs attachment garbage collection now (used by tests). */
    collectAttachments: () => Promise<void>;
  }
}
