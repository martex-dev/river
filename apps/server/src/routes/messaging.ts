import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verify } from '@river/crypto';
import {
  API_PREFIX,
  MAX_ONE_TIME_PREKEYS,
  ackRequestSchema,
  preKeyUploadSchema,
  riverIdSchema,
  sendDirectRequestSchema,
  type EnvelopeWire,
} from '@river/protocol';
import { authenticate } from '../accounts/auth-store.ts';
import type { Hub } from '../communities/hub.ts';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';
import { HttpError } from '../http-error.ts';

/** Undelivered envelopes are kept this long, then deleted. */
const MAILBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE = 100;

const b = (s: string): Buffer => Buffer.from(s, 'base64');
const bad = (msg = 'Bad request'): HttpError => new HttpError(400, 'bad_request', msg);

function parse<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const r = schema.safeParse(value);
  if (!r.success) throw bad();
  return r.data;
}

/**
 * Direct messages: public prekeys, a mailbox of end-to-end encrypted envelopes
 * and blocks. The server never sees message content.
 */
export function registerMessagingRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; database: RiverDatabase; now: () => Date; hub: Hub },
): void {
  const { db } = deps.database;
  const { hub } = deps;

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
  const authed = { preHandler: requireSession };

  // ---- prekeys ---------------------------------------------------------------------------------

  app.put(
    `${API_PREFIX}/keys`,
    // 100 Kyber prekeys are about 230 KB of JSON, close to the default body limit.
    { ...authed, bodyLimit: 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const { riverId, deviceId } = request.session!;
      const req = parse(preKeyUploadSchema, request.body);
      const account = await db
        .selectFrom('accounts')
        .select('identity_key')
        .where('river_id', '=', riverId)
        .executeTakeFirst();
      if (!account) throw new HttpError(404, 'not_found', 'Not found');
      const identityKey = b(account.identity_key);
      // Only keys signed by the account's identity key are accepted.
      const signed = [req.signedPreKey, req.kyberLastResort, ...req.kyberPreKeys];
      for (const k of signed) {
        if (!verify(identityKey, b(k.publicKey), b(k.signature))) throw bad('A prekey signature is invalid');
      }
      const counts = await db
        .selectFrom('prekeys')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('river_id', '=', riverId)
        .where('device_id', '=', deviceId)
        .executeTakeFirst();
      if (Number(counts?.n ?? 0) + req.preKeys.length > MAX_ONE_TIME_PREKEYS) throw bad('Too many prekeys');
      await db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('signed_prekeys')
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .execute();
        await trx
          .insertInto('signed_prekeys')
          .values({
            river_id: riverId,
            device_id: deviceId,
            key_id: req.signedPreKey.id,
            public_key: req.signedPreKey.publicKey,
            signature: req.signedPreKey.signature,
          })
          .execute();
        await trx
          .deleteFrom('kyber_prekeys')
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .where('last_resort', '=', 1)
          .execute();
        const kyber = [
          { ...req.kyberLastResort, last: 1 },
          ...req.kyberPreKeys.map((k) => ({ ...k, last: 0 })),
        ];
        for (const k of kyber) {
          await trx
            .insertInto('kyber_prekeys')
            .values({
              river_id: riverId,
              device_id: deviceId,
              key_id: k.id,
              public_key: k.publicKey,
              signature: k.signature,
              last_resort: k.last,
            })
            .onConflict((oc) => oc.columns(['river_id', 'device_id', 'key_id']).doNothing())
            .execute();
        }
        for (const k of req.preKeys) {
          await trx
            .insertInto('prekeys')
            .values({ river_id: riverId, device_id: deviceId, key_id: k.id, public_key: k.publicKey })
            .onConflict((oc) => oc.columns(['river_id', 'device_id', 'key_id']).doNothing())
            .execute();
        }
      });
      return { ok: true };
    },
  );

  app.get(`${API_PREFIX}/keys`, authed, async (request) => {
    const { riverId, deviceId } = request.session!;
    const count = async (table: 'prekeys' | 'kyber_prekeys'): Promise<number> => {
      let q = db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .where('river_id', '=', riverId)
        .where('device_id', '=', deviceId);
      if (table === 'kyber_prekeys') q = q.where('last_resort', '=', 0);
      return Number((await q.executeTakeFirst())?.n ?? 0);
    };
    return { preKeys: await count('prekeys'), kyberPreKeys: await count('kyber_prekeys') };
  });

  const isBlocked = async (owner: string, other: string): Promise<boolean> =>
    !!(await db
      .selectFrom('blocks')
      .select('blocked')
      .where('river_id', '=', owner)
      .where('blocked', '=', other)
      .executeTakeFirst());

  app.get<{ Params: { riverId: string } }>(
    `${API_PREFIX}/keys/:riverId`,
    { ...authed, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const target = parse(riverIdSchema, request.params.riverId);
      const notFound = new HttpError(404, 'not_found', 'No River account with that ID on this server');
      const account = await db
        .selectFrom('accounts')
        .selectAll()
        .where('river_id', '=', target)
        .executeTakeFirst();
      // A blocked sender cannot learn that they were blocked: they see "not found".
      if (!account || (await isBlocked(target, request.session!.riverId))) throw notFound;
      const devices = await db
        .selectFrom('devices')
        .selectAll()
        .where('river_id', '=', target)
        .orderBy('device_id')
        .execute();
      const bundles = [];
      for (const d of devices) {
        if (target === request.session!.riverId && d.device_id === request.session!.deviceId) continue;
        const bundle = await db.transaction().execute(async (trx) => {
          const signed = await trx
            .selectFrom('signed_prekeys')
            .selectAll()
            .where('river_id', '=', target)
            .where('device_id', '=', d.device_id)
            .executeTakeFirst();
          if (!signed) return null;
          const pre = await trx
            .selectFrom('prekeys')
            .selectAll()
            .where('river_id', '=', target)
            .where('device_id', '=', d.device_id)
            .orderBy('key_id')
            .limit(1)
            .executeTakeFirst();
          if (pre) {
            await trx
              .deleteFrom('prekeys')
              .where('river_id', '=', target)
              .where('device_id', '=', d.device_id)
              .where('key_id', '=', pre.key_id)
              .execute();
          }
          const kyber =
            (await trx
              .selectFrom('kyber_prekeys')
              .selectAll()
              .where('river_id', '=', target)
              .where('device_id', '=', d.device_id)
              .where('last_resort', '=', 0)
              .orderBy('key_id')
              .limit(1)
              .executeTakeFirst()) ??
            (await trx
              .selectFrom('kyber_prekeys')
              .selectAll()
              .where('river_id', '=', target)
              .where('device_id', '=', d.device_id)
              .where('last_resort', '=', 1)
              .executeTakeFirst());
          if (!kyber) return null;
          if (kyber.last_resort === 0) {
            await trx
              .deleteFrom('kyber_prekeys')
              .where('river_id', '=', target)
              .where('device_id', '=', d.device_id)
              .where('key_id', '=', kyber.key_id)
              .execute();
          }
          return {
            deviceId: d.device_id,
            registrationId: d.registration_id,
            signedPreKey: { id: signed.key_id, publicKey: signed.public_key, signature: signed.signature },
            preKey: pre ? { id: pre.key_id, publicKey: pre.public_key } : null,
            kyberPreKey: { id: kyber.key_id, publicKey: kyber.public_key, signature: kyber.signature },
          };
        });
        if (bundle) bundles.push(bundle);
      }
      if (!bundles.length && target !== request.session!.riverId) throw notFound;
      return {
        riverId: target,
        identityKey: account.identity_key,
        deviceList: account.device_list,
        deviceListSignature: account.device_list_signature,
        devices: bundles,
      };
    },
  );

  // ---- mailbox ---------------------------------------------------------------------------------

  app.post<{ Params: { riverId: string } }>(
    `${API_PREFIX}/messages/:riverId`,
    { ...authed, bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const me = request.session!;
      const target = parse(riverIdSchema, request.params.riverId);
      const req = parse(sendDirectRequestSchema, request.body);
      const devices = await db
        .selectFrom('devices')
        .select(['device_id', 'registration_id'])
        .where('river_id', '=', target)
        .execute();
      if (!devices.length)
        throw new HttpError(404, 'not_found', 'No River account with that ID on this server');
      // Every device must get a copy (except the sending device when writing to yourself).
      const expected = devices.filter((d) => !(target === me.riverId && d.device_id === me.deviceId));
      const sentTo = new Map(req.messages.map((m) => [m.deviceId, m]));
      const missing = expected.filter((d) => !sentTo.has(d.device_id)).map((d) => d.device_id);
      const extra = [...sentTo.keys()].filter((id) => !expected.some((d) => d.device_id === id));
      const stale = expected
        .filter(
          (d) => sentTo.has(d.device_id) && sentTo.get(d.device_id)!.registrationId !== d.registration_id,
        )
        .map((d) => d.device_id);
      if (missing.length || extra.length || stale.length || sentTo.size !== req.messages.length) {
        return reply.code(409).send({
          error: { code: 'device_mismatch', message: 'The recipient’s devices changed' },
          missing,
          extra,
          stale,
        });
      }
      // Blocked senders are not told; their messages are silently dropped.
      if (target !== me.riverId && (await isBlocked(target, me.riverId)))
        return reply.code(202).send({ ok: true });
      const receivedAt = deps.now().toISOString();
      const envelopes: EnvelopeWire[] = req.messages.map((m) => ({
        id: randomBytes(16).toString('base64url'),
        sender: me.riverId,
        senderDevice: me.deviceId,
        recipientDevice: m.deviceId,
        type: m.type,
        body: m.body,
        receivedAt,
      }));
      if (!req.ephemeral) {
        await db
          .insertInto('mailbox')
          .values(
            envelopes.map((e) => ({
              id: e.id,
              recipient: target,
              recipient_device: e.recipientDevice,
              sender: e.sender,
              sender_device: e.senderDevice,
              type: e.type,
              body: e.body,
              received_at: e.receivedAt,
            })),
          )
          .execute();
      }
      for (const envelope of envelopes) hub.sendTo([target], { t: 'dm', envelope });
      return reply.code(202).send({ ok: true });
    },
  );

  app.get(`${API_PREFIX}/messages`, authed, async (request) => {
    const me = request.session!;
    const rows = await db
      .selectFrom('mailbox')
      .selectAll()
      .where('recipient', '=', me.riverId)
      .where('recipient_device', '=', me.deviceId)
      .orderBy('received_at')
      .orderBy('id')
      .limit(PAGE + 1)
      .execute();
    return {
      envelopes: rows.slice(0, PAGE).map((r) => ({
        id: r.id,
        sender: r.sender,
        senderDevice: r.sender_device,
        recipientDevice: r.recipient_device,
        type: r.type,
        body: r.body,
        receivedAt: r.received_at,
      })),
      more: rows.length > PAGE,
    };
  });

  app.post(`${API_PREFIX}/messages/ack`, authed, async (request) => {
    const me = request.session!;
    const req = parse(ackRequestSchema, request.body);
    await db
      .deleteFrom('mailbox')
      .where('id', 'in', req.ids)
      .where('recipient', '=', me.riverId)
      .where('recipient_device', '=', me.deviceId)
      .execute();
    return { ok: true };
  });

  // ---- blocks ----------------------------------------------------------------------------------

  app.get(`${API_PREFIX}/blocks`, authed, async (request) => {
    const rows = await db
      .selectFrom('blocks')
      .select('blocked')
      .where('river_id', '=', request.session!.riverId)
      .execute();
    return { blocked: rows.map((r) => r.blocked) };
  });

  app.put<{ Params: { riverId: string } }>(`${API_PREFIX}/blocks/:riverId`, authed, async (request) => {
    const target = parse(riverIdSchema, request.params.riverId);
    if (target === request.session!.riverId) throw bad('You cannot block yourself');
    await db
      .insertInto('blocks')
      .values({ river_id: request.session!.riverId, blocked: target })
      .onConflict((oc) => oc.columns(['river_id', 'blocked']).doNothing())
      .execute();
    return { ok: true };
  });

  app.delete<{ Params: { riverId: string } }>(`${API_PREFIX}/blocks/:riverId`, authed, async (request) => {
    const target = parse(riverIdSchema, request.params.riverId);
    await db
      .deleteFrom('blocks')
      .where('river_id', '=', request.session!.riverId)
      .where('blocked', '=', target)
      .execute();
    return { ok: true };
  });

  // Undelivered mail expires.
  const collect = async (): Promise<void> => {
    const cutoff = new Date(deps.now().getTime() - MAILBOX_TTL_MS).toISOString();
    await db.deleteFrom('mailbox').where('received_at', '<', cutoff).execute();
  };
  const timer = setInterval(() => void collect().catch(() => undefined), 60 * 60 * 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
