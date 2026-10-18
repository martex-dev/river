import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql, type Selectable, type Transaction } from 'kysely';
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
import { authenticate, purgeExpired } from '../accounts/auth-store.ts';
import type { Hub } from '../communities/hub.ts';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';
import type { Database } from '../db/schema.ts';
import { HttpError } from '../http-error.ts';

/** Undelivered envelopes are kept this long, then deleted. */
/** Default for RIVER_MAILBOX_TTL_DAYS. */
const MAILBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Defaults for RIVER_MAILBOX_PER_SENDER and RIVER_MAILBOX_MAX_MB (2.20). */
const MAILBOX_PER_SENDER = 2500;
const MAILBOX_MAX_BYTES = 100 * 1024 * 1024;
const PAGE = 100;
/**
 * Key-bundle fetches one account may make for another per hour that take one-time prekeys
 * (2.20). A normal app fetches once per new contact, and again when their devices change; past
 * this, bundles come with the signed and last-resort keys only (sessions still start), so nobody
 * can use up someone's one-time keys and with them the extra protection they give first messages.
 */
const PREKEY_CLAIMS_PER_HOUR = 10;
const PREKEY_WINDOW_MS = 60 * 60 * 1000;
/** Requester/target pairs remembered at most (in memory); the oldest windows go first. */
const MAX_CLAIM_PAIRS = 100_000;

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
      if (!req.replaceAll) {
        // One-time keys of both kinds count against the cap, so neither table can be filled up.
        const counts = await db
          .selectFrom('prekeys')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .executeTakeFirst();
        const kyberCounts = await db
          .selectFrom('kyber_prekeys')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .where('last_resort', '=', 0)
          .executeTakeFirst();
        if (
          Number(counts?.n ?? 0) + req.preKeys.length > MAX_ONE_TIME_PREKEYS ||
          Number(kyberCounts?.n ?? 0) + req.kyberPreKeys.length > MAX_ONE_TIME_PREKEYS
        ) {
          throw bad('Too many prekeys');
        }
      }
      await db.transaction().execute(async (trx) => {
        if (req.replaceAll) {
          // Prekeys from a previous install of this device: their private halves are gone.
          await trx
            .deleteFrom('prekeys')
            .where('river_id', '=', riverId)
            .where('device_id', '=', deviceId)
            .execute();
          await trx
            .deleteFrom('kyber_prekeys')
            .where('river_id', '=', riverId)
            .where('device_id', '=', deviceId)
            .execute();
        }
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
        // The last-resort key must always be stored: if its ID matches a stored one-time key,
        // that row becomes the last-resort key (the device's store now holds this key under that ID).
        await trx
          .insertInto('kyber_prekeys')
          .values({
            river_id: riverId,
            device_id: deviceId,
            key_id: req.kyberLastResort.id,
            public_key: req.kyberLastResort.publicKey,
            signature: req.kyberLastResort.signature,
            last_resort: 1,
          })
          .onConflict((oc) =>
            oc.columns(['river_id', 'device_id', 'key_id']).doUpdateSet({
              public_key: req.kyberLastResort.publicKey,
              signature: req.kyberLastResort.signature,
              last_resort: 1,
            }),
          )
          .execute();
        for (const k of req.kyberPreKeys) {
          await trx
            .insertInto('kyber_prekeys')
            .values({
              river_id: riverId,
              device_id: deviceId,
              key_id: k.id,
              public_key: k.publicKey,
              signature: k.signature,
              last_resort: 0,
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

  const postgres = deps.database.dialect === 'postgres';
  /** Atomically takes (deletes and returns) the lowest one-time key of a device, if any is left. */
  async function claimOneTime(
    trx: Transaction<Database>,
    table: 'prekeys',
    riverId: string,
    deviceId: number,
  ): Promise<Selectable<Database['prekeys']> | undefined>;
  async function claimOneTime(
    trx: Transaction<Database>,
    table: 'kyber_prekeys',
    riverId: string,
    deviceId: number,
  ): Promise<Selectable<Database['kyber_prekeys']> | undefined>;
  async function claimOneTime(
    trx: Transaction<Database>,
    table: 'prekeys' | 'kyber_prekeys',
    riverId: string,
    deviceId: number,
  ): Promise<Selectable<Database['prekeys']> | Selectable<Database['kyber_prekeys']> | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (table === 'prekeys') {
        let pick = trx
          .selectFrom('prekeys')
          .select('key_id')
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .orderBy('key_id')
          .limit(1);
        if (postgres) pick = pick.forUpdate().skipLocked();
        const row = await trx
          .deleteFrom('prekeys')
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .where('key_id', '=', pick)
          .returningAll()
          .executeTakeFirst();
        if (row) return row;
      } else {
        let pick = trx
          .selectFrom('kyber_prekeys')
          .select('key_id')
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .where('last_resort', '=', 0)
          .orderBy('key_id')
          .limit(1);
        if (postgres) pick = pick.forUpdate().skipLocked();
        const row = await trx
          .deleteFrom('kyber_prekeys')
          .where('river_id', '=', riverId)
          .where('device_id', '=', deviceId)
          .where('last_resort', '=', 0)
          .where('key_id', '=', pick)
          .returningAll()
          .executeTakeFirst();
        if (row) return row;
      }
      // Nothing claimed: none left, or another fetch committed the candidate first; look again.
      let left = trx
        .selectFrom(table)
        .select('key_id')
        .where('river_id', '=', riverId)
        .where('device_id', '=', deviceId);
      if (table === 'kyber_prekeys') left = left.where('last_resort', '=', 0);
      if (!(await left.limit(1).executeTakeFirst())) return undefined;
    }
    return undefined;
  }

  /**
   * What each of these devices holds undelivered: envelopes and their stored size, in all and from
   * `sender` (one query, answered from the mailbox_usage index).
   */
  const mailboxUsage = async (
    recipient: string,
    deviceIds: number[],
    sender: string,
  ): Promise<Map<number, { count: number; bytes: number; mine: number; mineBytes: number }>> => {
    if (!deviceIds.length) return new Map();
    const rows = await db
      .selectFrom('mailbox')
      .select((eb) => [
        'recipient_device',
        eb.fn.countAll<number>().as('count'),
        eb.fn.sum<number>('size').as('bytes'),
        eb.fn.sum<number>(sql<number>`case when sender = ${sender} then 1 else 0 end`).as('mine'),
        eb.fn.sum<number>(sql<number>`case when sender = ${sender} then size else 0 end`).as('mineBytes'),
      ])
      .where('recipient', '=', recipient)
      .where('recipient_device', 'in', [...new Set(deviceIds)])
      .groupBy('recipient_device')
      .execute();
    return new Map(
      rows.map((r) => [
        r.recipient_device,
        {
          count: Number(r.count ?? 0),
          bytes: Number(r.bytes ?? 0),
          mine: Number(r.mine ?? 0),
          mineBytes: Number(r.mineBytes ?? 0),
        },
      ]),
    );
  };

  /** One-time prekey takings per requester and target, in memory only (2.20). */
  const claims = new Map<string, { since: number; n: number }>();
  const mayClaim = (requester: string, target: string): boolean => {
    const now = deps.now().getTime();
    const key = `${requester}>${target}`;
    let c = claims.get(key);
    if (!c || now - c.since >= PREKEY_WINDOW_MS) {
      claims.delete(key);
      c = { since: now, n: 0 };
      claims.set(key, c);
      if (claims.size > MAX_CLAIM_PAIRS) {
        for (const [k, v] of claims) {
          if (claims.size <= MAX_CLAIM_PAIRS) break;
          if (k !== key || now - v.since >= PREKEY_WINDOW_MS) claims.delete(k);
        }
      }
    }
    if (c.n >= PREKEY_CLAIMS_PER_HOUR) return false;
    c.n += 1;
    return true;
  };

  const isBlocked = async (owner: string, other: string): Promise<boolean> =>
    !!(await db
      .selectFrom('blocks')
      .select('blocked')
      .where('river_id', '=', owner)
      .where('blocked', '=', other)
      .executeTakeFirst());

  // The signed device list alone (2.11.2): re-checking someone's devices claims none of their keys.
  app.get<{ Params: { riverId: string } }>(
    `${API_PREFIX}/keys/:riverId/devices`,
    { ...authed, config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request) => {
      const target = parse(riverIdSchema, request.params.riverId);
      const account = await db
        .selectFrom('accounts')
        .select(['identity_key', 'device_list', 'device_list_signature'])
        .where('river_id', '=', target)
        .executeTakeFirst();
      // As for the full bundle: a blocked sender sees "not found".
      if (!account || (await isBlocked(target, request.session!.riverId))) {
        throw new HttpError(404, 'not_found', 'No River account with that ID on this server');
      }
      return {
        riverId: target,
        identityKey: account.identity_key,
        deviceList: account.device_list,
        deviceListSignature: account.device_list_signature,
      };
    },
  );

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
      // Over the budget for this pair: the bundle carries no one-time keys (none are used up).
      const oneTime = mayClaim(request.session!.riverId, target);
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
          // Each one-time key is claimed with DELETE … RETURNING, so two concurrent fetches can
          // never both hand out the same key (on PostgreSQL the candidate row is locked, skipping
          // rows another fetch already holds; SQLite runs one write transaction at a time).
          const kyber =
            (oneTime ? await claimOneTime(trx, 'kyber_prekeys', target, d.device_id) : undefined) ??
            (await trx
              .selectFrom('kyber_prekeys')
              .selectAll()
              .where('river_id', '=', target)
              .where('device_id', '=', d.device_id)
              .where('last_resort', '=', 1)
              .executeTakeFirst());
          if (!kyber) return null;
          const pre = oneTime ? await claimOneTime(trx, 'prekeys', target, d.device_id) : undefined;
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
      const notFound = new HttpError(404, 'not_found', 'No River account with that ID on this server');
      // A blocked sender's messages are accepted and dropped, before any other check: a device
      // mismatch (409), a full mailbox (429) or an error would reveal the block, and senders would
      // retry (scheduled messages) or fail whole group sends because of one blocked member.
      if (target !== me.riverId && (await isBlocked(target, me.riverId))) {
        return reply.code(202).send({ ok: true });
      }
      const devices = await db
        .selectFrom('devices')
        .select((eb) => [
          'devices.device_id',
          'devices.registration_id',
          // Same rule as GET /keys/:riverId: a device is reachable once it has published its keys.
          eb
            .and([
              eb.exists(
                eb
                  .selectFrom('signed_prekeys')
                  .select('signed_prekeys.key_id')
                  .whereRef('signed_prekeys.river_id', '=', 'devices.river_id')
                  .whereRef('signed_prekeys.device_id', '=', 'devices.device_id'),
              ),
              eb.exists(
                eb
                  .selectFrom('kyber_prekeys')
                  .select('kyber_prekeys.key_id')
                  .whereRef('kyber_prekeys.river_id', '=', 'devices.river_id')
                  .whereRef('kyber_prekeys.device_id', '=', 'devices.device_id'),
              ),
            ])
            .as('reachable'),
        ])
        .where('devices.river_id', '=', target)
        .execute();
      if (!devices.length) throw notFound;
      // Every device that published keys must get a copy (except the sending device when writing
      // to yourself). A device that never published keys cannot be written to by anyone who uses
      // GET /keys, so it is not required (that would make the account unreachable); a copy for it
      // is still accepted.
      const allowed = devices.filter((d) => !(target === me.riverId && d.device_id === me.deviceId));
      const required = allowed.filter((d) => Boolean(d.reachable));
      const sentTo = new Map(req.messages.map((m) => [m.deviceId, m]));
      const missing = required.filter((d) => !sentTo.has(d.device_id)).map((d) => d.device_id);
      const extra = [...sentTo.keys()].filter((id) => !allowed.some((d) => d.device_id === id));
      const stale = allowed
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
      let messages = req.messages;
      if (!req.ephemeral) {
        // A device that never collects its mail cannot be used to fill the server's disk, and
        // since 2.20 one sender cannot fill a device's mailbox for everyone else: a sender may
        // keep at most RIVER_MAILBOX_PER_SENDER envelopes, and half the stored size, waiting for
        // one device (your own devices are not counted against you). A copy over a cap is dropped;
        // the person's other devices still get theirs.
        const refused = new Map<number, 'full' | 'size' | 'sender'>();
        const usage = await mailboxUsage(
          target,
          req.messages.map((m) => m.deviceId),
          me.riverId,
        );
        const perSender = deps.config.mailboxPerSender ?? MAILBOX_PER_SENDER;
        const maxBytes = deps.config.mailboxMaxBytes ?? MAILBOX_MAX_BYTES;
        for (const m of req.messages) {
          const u = usage.get(m.deviceId) ?? { count: 0, bytes: 0, mine: 0, mineBytes: 0 };
          const size = m.body.length;
          if (u.count >= deps.config.mailboxLimit) refused.set(m.deviceId, 'full');
          else if (u.bytes + size > maxBytes) refused.set(m.deviceId, 'size');
          else if (target !== me.riverId && (u.mine >= perSender || u.mineBytes + size > maxBytes / 2))
            refused.set(m.deviceId, 'sender');
        }
        messages = req.messages.filter((m) => !refused.has(m.deviceId));
        if (!messages.length) {
          const why = new Set(refused.values());
          // The code stays mailbox_full (apps since 1.0 show its message); the status says which.
          if (why.has('sender'))
            throw new HttpError(
              429,
              'mailbox_full',
              'This person has not collected the many messages you already sent them. Try again once they are back online.',
            );
          if (why.has('size'))
            throw new HttpError(
              507,
              'mailbox_full',
              'This person’s mailbox on the server is full. Try again once they are back online.',
            );
          throw new HttpError(
            429,
            'mailbox_full',
            'This person has too many undelivered messages. Try later.',
          );
        }
      }
      const receivedAt = deps.now().toISOString();
      const envelopes: EnvelopeWire[] = messages.map((m) => ({
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
              size: e.body.length,
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

  // Undelivered mail expires, and so does what only mattered until a time that has passed:
  // sessions and sign-in challenges (a session's expiry shows roughly when its device was last
  // used), username holds and sign-up codes. Also at start: a server restarted more often than
  // hourly (a home PC) would otherwise never get here (2.13).
  const collect = async (): Promise<void> => {
    const now = deps.now();
    const cutoff = new Date(now.getTime() - (deps.config.mailboxTtlMs ?? MAILBOX_TTL_MS)).toISOString();
    await db.deleteFrom('mailbox').where('received_at', '<', cutoff).execute();
    await purgeExpired(db, now);
    await db.deleteFrom('username_holds').where('until', '<=', now.toISOString()).execute();
    await db.deleteFrom('signups').where('expires_at', '<=', now.toISOString()).execute();
  };
  const timer = setInterval(
    () => {
      void collect().catch(() => undefined);
      const now = deps.now().getTime();
      for (const [k, v] of claims) if (now - v.since >= PREKEY_WINDOW_MS) claims.delete(k);
    },
    60 * 60 * 1000,
  );
  timer.unref();
  app.addHook('onReady', async () => {
    await collect().catch(() => undefined);
  });
  app.addHook('onClose', async () => clearInterval(timer));
  app.decorate('collectMailbox', collect);
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Deletes expired mail, sessions, challenges, username holds and sign-up codes now (tests). */
    collectMailbox: () => Promise<void>;
  }
}
