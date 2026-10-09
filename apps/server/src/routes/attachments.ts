import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
/** Smallest possible encrypted attachment: IV + one AES block + MAC. */
const MIN_BLOB = 16 + 16 + 32;

/**
 * Encrypted attachment blobs. The server sees only ciphertext (padded to size
 * buckets); keys, names and types travel inside end-to-end encrypted messages.
 */
export async function registerAttachmentRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; database: RiverDatabase; now: () => Date },
): Promise<void> {
  const { db } = deps.database;
  const dir = resolve(deps.config.attachmentDir);
  await mkdir(dir, { recursive: true });
  const fileOf = (id: string): string => join(dir, id);

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: deps.config.maxAttachmentBytes },
    (_req, body, done) => done(null, body),
  );

  const requireSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await authenticate(db, token, deps.now()) : null;
    if (!session) {
      await reply.code(401).send({ error: { code: 'unauthorized', message: 'A valid session is required' } });
      return;
    }
    request.session = session;
  };

  app.post<{ Querystring: { retain?: string } }>(
    `${API_PREFIX}/attachments`,
    {
      preHandler: requireSession,
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
      const used = await db
        .selectFrom('attachments')
        .select((eb) => eb.fn.sum<number>('size').as('total'))
        .where('uploader', '=', request.session!.riverId)
        .executeTakeFirst();
      if (Number(used?.total ?? 0) + body.length > deps.config.attachmentQuotaBytes) {
        throw new HttpError(413, 'quota_exceeded', 'You have reached your storage limit on this server');
      }
      const id = randomBytes(16).toString('base64url');
      const tmp = `${fileOf(id)}.part`;
      await writeFile(tmp, body, { flag: 'wx' });
      await rename(tmp, fileOf(id));
      await db
        .insertInto('attachments')
        .values({
          id,
          uploader: request.session!.riverId,
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
