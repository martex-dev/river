import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verify } from '@river/crypto';
import {
  API_PREFIX,
  challengeRequestSchema,
  deviceListMessage,
  parseDeviceList,
  linkIdSchema,
  provisionLinkRequestSchema,
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
import { purgeSignups, sha256, signupMode, usernameFree } from '../accounts/usernames.ts';
import type { RiverDatabase } from '../db/database.ts';
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
      const current = await db
        .selectFrom('accounts')
        .select('username')
        .where('river_id', '=', me)
        .executeTakeFirst();
      if (current?.username !== username) {
        if (!(await usernameFree(db, username, now))) {
          return fail(reply, 409, 'username_taken', `@${username} is taken. Try another one.`);
        }
        try {
          await db.updateTable('accounts').set({ username }).where('river_id', '=', me).execute();
        } catch {
          return fail(reply, 409, 'username_taken', `@${username} is taken. Try another one.`);
        }
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
      let list;
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
      const current = await db
        .selectFrom('devices')
        .select(['device_id', 'auth_key'])
        .where('river_id', '=', riverId)
        .execute();
      const me = current.find((d) => d.device_id === deviceId);
      const mine = list.devices.find((d) => d.deviceId === deviceId);
      if (!me || !mine || mine.authKey !== me.auth_key) {
        return fail(reply, 400, 'bad_request', 'The device making the change must stay in the list');
      }
      for (const d of list.devices) {
        const known = current.find((c) => c.device_id === d.deviceId);
        if (known && known.auth_key !== d.authKey) {
          return fail(reply, 400, 'bad_request', 'A listed device cannot change its key');
        }
      }
      const kept = new Set(list.devices.map((d) => d.deviceId));
      const removed = current.filter((c) => !kept.has(c.device_id)).map((c) => c.device_id);
      const today = deps.now().toISOString().slice(0, 10);
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('accounts')
          .set({
            device_list: parsed.data.deviceList,
            device_list_signature: parsed.data.deviceListSignature,
            device_list_version: list.version,
          })
          .where('river_id', '=', riverId)
          .execute();
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
      });
      if (removed.length) deps.onDevicesRemoved?.(riverId, removed);
      return { devices: list.devices.length, removed };
    },
  );

  /**
   * The link mailbox (ADR 0006). Its ID comes from the link secret the linked device shows, so
   * only the two devices know it. The new device posts its hello (public keys, authenticated with
   * the secret); the linked device reads it and posts the provisioning message sealed to the new
   * device. Ten minutes, in memory, never written to disk; each part is written once.
   */
  interface PendingLink {
    hello: LinkHello | null;
    mac: string | null;
    provision: string | null;
    deviceId: number | null;
    expires: number;
  }
  const links = new Map<string, PendingLink>();
  const LINK_TTL_MS = 10 * 60 * 1000;
  const MAX_LINKS = 1000;
  const sweep = (): void => {
    const t = deps.now().getTime();
    for (const [id, l] of links) if (l.expires <= t) links.delete(id);
  };
  const linkState = (l: PendingLink): LinkState => ({
    hello: l.hello,
    mac: l.mac,
    provision: l.provision,
    deviceId: l.deviceId,
    expiresAt: new Date(l.expires).toISOString(),
  });
  const notFound = (reply: FastifyReply): FastifyReply =>
    fail(reply, 404, 'not_found', 'Nothing is waiting under this link code.');

  app.put<{ Params: { id: string } }>(`${API_PREFIX}/link/:id`, sensitive, async (request, reply) => {
    sweep();
    const id = linkIdSchema.safeParse(request.params.id);
    const parsed = putLinkHelloRequestSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return fail(reply, 400, 'bad_request', 'Bad request');
    if (links.has(id.data)) return fail(reply, 409, 'link_in_use', 'This link code was already used.');
    if (links.size >= MAX_LINKS) {
      return fail(reply, 503, 'busy', 'Too many devices are being linked right now');
    }
    const l: PendingLink = {
      hello: parsed.data.hello,
      mac: parsed.data.mac,
      provision: null,
      deviceId: null,
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
}

class SignupError extends Error {}
