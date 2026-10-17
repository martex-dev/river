import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';
import { verify } from '@river/crypto';
import {
  API_PREFIX,
  challengeRequestSchema,
  deviceListMessage,
  parseDeviceList,
  linkIdSchema,
  provisionLinkRequestSchema,
  declineLinkRequestSchema,
  MAX_LINK_DECLINES,
  putLinkHelloRequestSchema,
  registerRequestSchema,
  registrationMessage,
  updateDevicesRequestSchema,
  type LinkHello,
  type LinkState,
  sessionMessage,
  sessionRequestSchema,
  setUsernameRequestSchema,
  usernameSchema,
  usernamesRequestSchema,
  type AccountResponse,
  type ErrorResponse,
  type RegisterResponse,
} from '@river/protocol';
import type { ServerConfig } from '../config.ts';
import { holdUsername, purgeSignups, sha256, signupMode, usernameFree } from '../accounts/usernames.ts';
import type { RiverDatabase } from '../db/database.ts';
import type { Database } from '../db/schema.ts';
import {
  authenticate,
  consumeChallenge,
  createSession,
  suspension,
  suspensionMessage,
  issueChallenge,
  purgeExpired,
} from '../accounts/auth-store.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireSession` on authenticated routes. */
    session: { riverId: string; deviceId: number } | null;
  }
}

const b = (s: string): Buffer => Buffer.from(s, 'base64');
const day = (d: Date): string => d.toISOString().slice(0, 10);

function fail(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  const body: ErrorResponse = { error: { code, message } };
  return reply.code(status).send(body);
}

/** A refusal decided inside a transaction (which is then rolled back). */
class Refusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Accounts and device authentication routes (protocol v1). */
export function registerAccountRoutes(
  app: FastifyInstance,
  deps: {
    config: ServerConfig;
    database: RiverDatabase;
    now: () => Date;
    /** Devices were removed from an account (their live connections must end). */
    onDevicesRemoved?: (riverId: string, deviceIds: number[]) => void;
  },
): void {
  const { db } = deps.database;
  const sensitive = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.decorateRequest('session', null);

  const requireSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? await authenticate(db, token, deps.now()) : null;
    if (!session) {
      await fail(reply, 401, 'unauthorized', 'A valid session is required');
      return;
    }
    request.session = session;
  };

  app.post(`${API_PREFIX}/auth/challenge`, sensitive, async (request, reply) => {
    const parsed = challengeRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    if (parsed.data.purpose === 'register' && deps.config.registration === 'closed') {
      return fail(reply, 403, 'registration_closed', 'This server does not accept new accounts');
    }
    const now = deps.now();
    await purgeExpired(db, now);
    return issueChallenge(db, parsed.data.purpose, now);
  });

  app.post(`${API_PREFIX}/accounts`, sensitive, async (request, reply) => {
    if (deps.config.registration === 'closed') {
      return fail(reply, 403, 'registration_closed', 'This server does not accept new accounts');
    }
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    const req = parsed.data;
    const now = deps.now();
    const challenge = b(req.challenge);
    const listBytes = b(req.deviceList);
    const identityKey = b(req.identityKey);

    if (!(await consumeChallenge(db, challenge, 'register', now))) {
      return fail(reply, 401, 'invalid_challenge', 'Challenge is unknown, used or expired');
    }
    // Verify the identity signature over the exact bytes before parsing them.
    if (!verify(identityKey, deviceListMessage(listBytes), b(req.deviceListSignature))) {
      return fail(reply, 400, 'bad_signature', 'Device list signature is invalid');
    }
    let list;
    try {
      list = parseDeviceList(listBytes);
    } catch {
      return fail(reply, 400, 'bad_request', 'Device list is malformed');
    }
    const device = list.devices.find((d) => d.deviceId === req.deviceId);
    if (list.version !== 1 || list.devices.length !== 1 || !device) {
      return fail(
        reply,
        400,
        'bad_request',
        'A new account starts with exactly one device at list version 1',
      );
    }
    const message = registrationMessage(challenge, listBytes);
    if (!verify(identityKey, message, b(req.identitySignature))) {
      return fail(reply, 400, 'bad_signature', 'Identity signature is invalid');
    }
    if (!verify(b(device.authKey), message, b(req.deviceSignature))) {
      return fail(reply, 400, 'bad_signature', 'Device signature is invalid');
    }
    // A deleted account's River ID comes back only with the identity key it had: nobody else can
    // register it under a new key and pass as the person their contacts knew.
    const tombstone = await db
      .selectFrom('account_tombstones')
      .select('identity_key')
      .where('river_id', '=', list.riverId)
      .executeTakeFirst();
    if (tombstone && tombstone.identity_key !== req.identityKey) {
      return fail(reply, 409, 'account_exists', 'An account with this River ID already exists');
    }
    if (!req.signupCode && (await signupMode(db)) === 'invite') {
      return fail(
        reply,
        403,
        'signup_invite_only',
        'This River server only accepts people its owner invites. Ask them for a sign-up link.',
      );
    }

    try {
      await db.transaction().execute(async (trx) => {
        let username: string | null = null;
        if (req.signupCode) {
          // A sign-up the operator created: one use, and it brings the username they chose.
          const claimed = await trx
            .deleteFrom('signups')
            .where('code_hash', '=', sha256(req.signupCode))
            .where('expires_at', '>', now.toISOString())
            .returning('username')
            .executeTakeFirst();
          if (!claimed) throw new SignupError();
          username = claimed.username;
        }
        await trx
          .insertInto('accounts')
          .values({
            username,
            river_id: list.riverId,
            identity_key: req.identityKey,
            device_list: req.deviceList,
            device_list_signature: req.deviceListSignature,
            device_list_version: list.version,
            created_on: day(now),
          })
          .execute();
        await trx
          .insertInto('devices')
          .values({
            river_id: list.riverId,
            device_id: device.deviceId,
            auth_key: device.authKey,
            registration_id: device.registrationId,
            created_on: day(now),
          })
          .execute();
      });
    } catch (err) {
      if (err instanceof SignupError) {
        return fail(reply, 400, 'invalid_signup', 'This sign-up link has expired or was already used.');
      }
      return fail(reply, 409, 'account_exists', 'An account with this River ID already exists');
    }

    const session = await createSession(db, list.riverId, device.deviceId, deps.config.sessionTtlMs, now);
    const body: RegisterResponse = { riverId: list.riverId, deviceId: device.deviceId, session };
    return reply.code(201).send(body);
  });

  app.post(`${API_PREFIX}/auth/session`, sensitive, async (request, reply) => {
    const parsed = sessionRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    const req = parsed.data;
    const now = deps.now();
    const challenge = b(req.challenge);
    if (!(await consumeChallenge(db, challenge, 'session', now))) {
      return fail(reply, 401, 'invalid_challenge', 'Challenge is unknown, used or expired');
    }
    const device = await db
      .selectFrom('devices')
      .select(['auth_key'])
      .where('river_id', '=', req.riverId)
      .where('device_id', '=', req.deviceId)
      .executeTakeFirst();
    // Same answer for "no such device" and "bad signature": do not reveal which accounts exist.
    if (
      !device ||
      !verify(b(device.auth_key), sessionMessage(challenge, req.riverId, req.deviceId), b(req.signature))
    ) {
      return fail(reply, 401, 'unauthorized', 'Authentication failed');
    }
    const suspended = await suspension(db, req.riverId, now);
    if (suspended) return fail(reply, 403, 'account_suspended', suspensionMessage(suspended));
    return createSession(db, req.riverId, req.deviceId, deps.config.sessionTtlMs, now);
  });

  app.get(`${API_PREFIX}/accounts/me`, { preHandler: requireSession }, async (request) => {
    const row = await db
      .selectFrom('accounts')
      .select(['river_id', 'identity_key', 'device_list', 'device_list_signature', 'username'])
      .where('river_id', '=', request.session!.riverId)
      .executeTakeFirstOrThrow();
    const body: AccountResponse = {
      riverId: row.river_id,
      identityKey: row.identity_key,
      deviceList: row.device_list,
      deviceListSignature: row.device_list_signature,
      username: row.username,
    };
    return body;
  });

  // ---- usernames (1.0.13) ----------------------------------------------------------------------
  app.put(
    `${API_PREFIX}/accounts/me/username`,
    { preHandler: requireSession, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = setUsernameRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(reply, 400, 'bad_username', 'Use 3 to 32 letters, numbers, _ or . for your username.');
      }
      const { username } = parsed.data;
      const me = request.session!.riverId;
      const now = deps.now();
      await purgeSignups(db, now);
      // One transaction (2.11.2): the old name is held before the new one is checked and taken,
      // so there is no moment where someone else can pick up the old name.
      try {
        await db.transaction().execute(async (trx) => {
          const current = await trx
            .selectFrom('accounts')
            .select('username')
            .where('river_id', '=', me)
            .executeTakeFirst();
          if (current?.username === username) return;
          // Taking back a name we gave up: its hold is no longer needed.
          await trx
            .deleteFrom('username_holds')
            .where('username', '=', username)
            .where('river_id', '=', me)
            .execute();
          // The old name stays ours for a while: nobody else can pick it up and pass as us.
          if (current?.username) await holdUsername(trx, current.username, me, now);
          if (!(await usernameFree(trx, username, now, me))) {
            throw new Refusal(409, 'username_taken', `@${username} is taken. Try another one.`);
          }
          await trx.updateTable('accounts').set({ username }).where('river_id', '=', me).execute();
        });
      } catch (err) {
        if (err instanceof Refusal) return fail(reply, err.status, err.code, err.message);
        return fail(reply, 409, 'username_taken', `@${username} is taken. Try another one.`);
      }
      return { username, riverId: me };
    },
  );

  // Find someone by username to add them as a friend. Usernames are public on their server.
  app.get<{ Querystring: { username?: string } }>(
    `${API_PREFIX}/users/lookup`,
    { preHandler: requireSession, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = usernameSchema.safeParse(String(request.query.username ?? '').replace(/^@/, ''));
      if (!parsed.success) return fail(reply, 404, 'not_found', 'Nobody has that username.');
      const row = await db
        .selectFrom('accounts')
        .select(['river_id', 'username'])
        .where('username', '=', parsed.data)
        .executeTakeFirst();
      if (!row?.username) return fail(reply, 404, 'not_found', 'Nobody has that username.');
      return { username: row.username, riverId: row.river_id };
    },
  );

  app.post(`${API_PREFIX}/users/usernames`, { preHandler: requireSession }, async (request, reply) => {
    const parsed = usernamesRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    if (parsed.data.riverIds.length === 0) return { usernames: {} };
    const rows = await db
      .selectFrom('accounts')
      .select(['river_id', 'username'])
      .where('river_id', 'in', parsed.data.riverIds)
      .execute();
    return {
      usernames: Object.fromEntries(
        rows.filter((r) => r.username !== null).map((r) => [r.river_id, r.username as string]),
      ),
    };
  });

  // ---- linked devices (1.3, ADR 0006) ----------------------------------------------------------

  /**
   * A new device list, signed by the account's identity key: adds or removes devices. Replays of
   * an older list are refused (its version must grow), the calling device must stay with the same
   * key, and a listed device never changes its key (remove it and link it again instead).
   */
  app.put(
    `${API_PREFIX}/accounts/me/devices`,
    { ...sensitive, preHandler: requireSession },
    async (request, reply) => {
      const parsed = updateDevicesRequestSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
      const { riverId, deviceId } = request.session!;
      const account = await db
        .selectFrom('accounts')
        .select(['identity_key', 'device_list_version'])
        .where('river_id', '=', riverId)
        .executeTakeFirstOrThrow();
      const listBytes = b(parsed.data.deviceList);
      if (
        !verify(b(account.identity_key), deviceListMessage(listBytes), b(parsed.data.deviceListSignature))
      ) {
        return fail(reply, 400, 'bad_signature', 'The device list is not signed by this account');
      }
      let list: ReturnType<typeof parseDeviceList>;
      try {
        list = parseDeviceList(listBytes);
      } catch {
        return fail(reply, 400, 'bad_request', 'Malformed device list');
      }
      if (list.riverId !== riverId) {
        return fail(reply, 400, 'bad_request', 'The device list is for another account');
      }
      if (list.version <= account.device_list_version) {
        return fail(reply, 409, 'stale_device_list', 'A newer device list is already stored');
      }
      const today = deps.now().toISOString().slice(0, 10);
      let removed: number[];
      try {
        removed = await db.transaction().execute(async (trx) => {
          // Compare-and-set on the version first: it also locks the account row (PostgreSQL), so
          // concurrent updates are applied one after another and an older list never overwrites
          // a newer one. The device checks below then see the devices as they are now.
          const updated = await trx
            .updateTable('accounts')
            .set({
              device_list: parsed.data.deviceList,
              device_list_signature: parsed.data.deviceListSignature,
              device_list_version: list.version,
            })
            .where('river_id', '=', riverId)
            .where('device_list_version', '<', list.version)
            .executeTakeFirst();
          if (Number(updated.numUpdatedRows) !== 1)
            throw new Refusal(409, 'stale_device_list', 'A newer device list is already stored');
          const current = await trx
            .selectFrom('devices')
            .select(['device_id', 'auth_key'])
            .where('river_id', '=', riverId)
            .execute();
          const me = current.find((d) => d.device_id === deviceId);
          const mine = list.devices.find((d) => d.deviceId === deviceId);
          if (!me || !mine || mine.authKey !== me.auth_key) {
            throw new Refusal(400, 'bad_request', 'The device making the change must stay in the list');
          }
          for (const d of list.devices) {
            const known = current.find((c) => c.device_id === d.deviceId);
            if (known && known.auth_key !== d.authKey) {
              throw new Refusal(400, 'bad_request', 'A listed device cannot change its key');
            }
          }
          const kept = new Set(list.devices.map((d) => d.deviceId));
          const gone = current.filter((c) => !kept.has(c.device_id)).map((c) => c.device_id);
          await applyDeviceList(trx, current, gone);
          return gone;
        });
      } catch (err) {
        if (err instanceof Refusal) return fail(reply, err.status, err.code, err.message);
        throw err;
      }
      if (removed.length) deps.onDevicesRemoved?.(riverId, removed);
      return { devices: list.devices.length, removed };

      async function applyDeviceList(
        trx: Transaction<Database>,
        current: Array<{ device_id: number }>,
        removed: number[],
      ): Promise<void> {
        for (const d of list.devices) {
          if (current.some((c) => c.device_id === d.deviceId)) continue;
          await trx
            .insertInto('devices')
            .values({
              river_id: riverId,
              device_id: d.deviceId,
              auth_key: d.authKey,
              registration_id: d.registrationId,
              created_on: today,
            })
            .execute();
        }
        if (removed.length) {
          for (const table of [
            'sessions',
            'prekeys',
            'signed_prekeys',
            'kyber_prekeys',
            'devices',
          ] as const) {
            await trx
              .deleteFrom(table)
              .where('river_id', '=', riverId)
              .where('device_id', 'in', removed)
              .execute();
          }
          await trx
            .deleteFrom('mailbox')
            .where('recipient', '=', riverId)
            .where('recipient_device', 'in', removed)
            .execute();
        }
      }
    },
  );

  /**
   * The link mailbox (ADR 0006). Its ID comes from the link secret the linked device shows, so
   * only the two devices know it. The new device posts its hello (public keys, authenticated with
   * the secret); the linked device reads it and posts the provisioning message sealed to the new
   * device. Ten minutes, in memory, never written to disk; each part is written once.
   */
  interface PendingLink {
    /** Reserved by a signed-in device that showed the code (1.3.1); null: opened by a hello. */
    reservedBy: string | null;
    /** The network address that opened or reserved the slot, for the per-address caps. */
    openedBy: string | null;
    hello: LinkHello | null;
    mac: string | null;
    provision: string | null;
    deviceId: number | null;
    /**
     * The new device declined the account it was sent (a MAC only the two devices can check).
     * Up to MAX_LINK_DECLINES (2.11.2): a bogus one written first cannot shut out the real one.
     */
    declined: string[];
    expires: number;
  }
  const links = new Map<string, PendingLink>();
  const LINK_TTL_MS = 10 * 60 * 1000;
  const MAX_LINKS = 1000;
  /** Slots one account may hold reserved at once, and unreserved slots per network address. */
  const MAX_RESERVED_PER_ACCOUNT = 3;
  const MAX_OPEN_PER_IP = 3;
  /**
   * Throwaway accounts must not use up the slots: an account made today may reserve two at a
   * time, and one network address at most some in all (2.11). Many people can share one address
   * (a carrier's CGNAT, a school), so that cap is 20 (2.11.2); MAX_LINKS bounds the total.
   */
  const MAX_RESERVED_NEW_ACCOUNT = 2;
  const MAX_RESERVED_PER_IP = 20;
  const sweep = (): void => {
    const t = deps.now().getTime();
    for (const [id, l] of links) if (l.expires <= t) links.delete(id);
  };
  const linkState = (l: PendingLink): LinkState => ({
    hello: l.hello,
    mac: l.mac,
    provision: l.provision,
    deviceId: l.deviceId,
    declined: l.declined[0] ?? null,
    declines: [...l.declined],
    expiresAt: new Date(l.expires).toISOString(),
  });
  const notFound = (reply: FastifyReply): FastifyReply =>
    fail(reply, 404, 'not_found', 'Nothing is waiting under this link code.');

  // The device showing the code reserves its mailbox first, so strangers cannot use up the slots:
  // a hello then goes into a slot that already exists.
  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/link/:id/reserve`,
    { ...sensitive, preHandler: requireSession },
    async (request, reply) => {
      sweep();
      const id = linkIdSchema.safeParse(request.params.id);
      if (!id.success) return fail(reply, 400, 'bad_request', 'Bad request');
      const riverId = request.session!.riverId;
      const existing = links.get(id.data);
      if (existing) {
        if (existing.reservedBy === riverId) return reply.code(200).send(linkState(existing));
        return fail(reply, 409, 'link_in_use', 'This link code was already used.');
      }
      const account = await db
        .selectFrom('accounts')
        .select('created_on')
        .where('river_id', '=', riverId)
        .executeTakeFirst();
      const isNew = !account || account.created_on >= day(deps.now());
      const cap = isNew ? MAX_RESERVED_NEW_ACCOUNT : MAX_RESERVED_PER_ACCOUNT;
      const mine = [...links.entries()].filter(([, l]) => l.reservedBy === riverId);
      // Trying again: the oldest code nobody answered yet gives way; otherwise wait. It goes only
      // once every other check passed (2.11.2): a refused request must not destroy the code the
      // user is still showing.
      let evict: string | null = null;
      if (mine.length >= cap) {
        const unused = mine
          .filter(([, l]) => l.hello === null)
          .sort((a, b) => a[1].expires - b[1].expires)[0];
        if (!unused) {
          return fail(reply, 429, 'too_many_links', 'Finish or cancel the devices you are already linking');
        }
        evict = unused[0];
      }
      const fromHere = [...links.entries()].filter(
        ([key, l]) => key !== evict && l.reservedBy !== null && l.openedBy === request.ip,
      ).length;
      if (fromHere >= MAX_RESERVED_PER_IP) {
        return fail(reply, 429, 'too_many_links', 'Too many devices are being linked from here right now');
      }
      if (links.size - (evict ? 1 : 0) >= MAX_LINKS) {
        return fail(reply, 503, 'busy', 'Too many devices are being linked right now');
      }
      if (evict) links.delete(evict);
      const l: PendingLink = {
        reservedBy: riverId,
        // Remembered for the per-address cap only (in memory, gone with the slot).
        openedBy: request.ip,
        hello: null,
        mac: null,
        provision: null,
        deviceId: null,
        declined: [],
        expires: deps.now().getTime() + LINK_TTL_MS,
      };
      links.set(id.data, l);
      return reply.code(201).send(linkState(l));
    },
  );

  app.put<{ Params: { id: string } }>(`${API_PREFIX}/link/:id`, sensitive, async (request, reply) => {
    sweep();
    const id = linkIdSchema.safeParse(request.params.id);
    const parsed = putLinkHelloRequestSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    const reserved = links.get(id.data);
    if (reserved) {
      if (reserved.reservedBy === null || reserved.hello !== null) {
        return fail(reply, 409, 'link_in_use', 'This link code was already used.');
      }
      reserved.hello = parsed.data.hello;
      reserved.mac = parsed.data.mac;
      return reply.code(201).send(linkState(reserved));
    }
    // A code from an older app that did not reserve: allowed, a few per network address.
    const opened = [...links.values()].filter(
      (l) => l.reservedBy === null && l.openedBy === request.ip,
    ).length;
    if (opened >= MAX_OPEN_PER_IP) {
      return fail(reply, 429, 'too_many_links', 'Too many devices are being linked from here right now');
    }
    if (links.size >= MAX_LINKS) {
      return fail(reply, 503, 'busy', 'Too many devices are being linked right now');
    }
    const l: PendingLink = {
      reservedBy: null,
      openedBy: request.ip,
      hello: parsed.data.hello,
      mac: parsed.data.mac,
      provision: null,
      deviceId: null,
      declined: [],
      expires: deps.now().getTime() + LINK_TTL_MS,
    };
    links.set(id.data, l);
    return reply.code(201).send(linkState(l));
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/link/:id`, async (request, reply) => {
    sweep();
    const id = linkIdSchema.safeParse(request.params.id);
    const l = id.success ? links.get(id.data) : undefined;
    return l ? linkState(l) : notFound(reply);
  });

  app.put<{ Params: { id: string } }>(
    `${API_PREFIX}/link/:id/provision`,
    { ...sensitive, preHandler: requireSession },
    async (request, reply) => {
      sweep();
      const id = linkIdSchema.safeParse(request.params.id);
      const l = id.success ? links.get(id.data) : undefined;
      if (!l?.hello) return notFound(reply);
      const parsed = provisionLinkRequestSchema.safeParse(request.body);
      if (!parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
      if (l.provision !== null) return fail(reply, 409, 'already_linked', 'This device was already linked');
      // The device must already be in this account's signed list, with the key from the hello.
      const device = await db
        .selectFrom('devices')
        .select(['auth_key'])
        .where('river_id', '=', request.session!.riverId)
        .where('device_id', '=', parsed.data.deviceId)
        .executeTakeFirst();
      if (!device || device.auth_key !== l.hello.authKey) {
        return fail(reply, 400, 'bad_request', 'Add the device to your device list first');
      }
      l.provision = parsed.data.provision;
      l.deviceId = parsed.data.deviceId;
      return linkState(l);
    },
  );

  // The new device was sent the account but declined it ("Is this you?" → Cancel). Its MAC under
  // the link secret is passed on as it is: only the linked device can check it, and then takes the
  // device it added off its signed list again. Only after provisioning. The server cannot tell a
  // real MAC from a bogus one, so it keeps up to MAX_LINK_DECLINES of them (2.11.2): someone who
  // writes one first cannot shut out the new device's real "no". The linked device checks each.
  app.put<{ Params: { id: string } }>(`${API_PREFIX}/link/:id/decline`, sensitive, async (request, reply) => {
    sweep();
    const id = linkIdSchema.safeParse(request.params.id);
    const parsed = declineLinkRequestSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    const l = links.get(id.data);
    if (!l?.provision) return notFound(reply);
    if (l.declined.includes(parsed.data.mac)) return linkState(l);
    if (l.declined.length >= MAX_LINK_DECLINES) {
      return fail(reply, 409, 'link_in_use', 'This link was already answered.');
    }
    l.declined.push(parsed.data.mac);
    return linkState(l);
  });
}

class SignupError extends Error {}
