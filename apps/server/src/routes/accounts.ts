import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verify } from '@river/crypto';
import {
  API_PREFIX,
  challengeRequestSchema,
  deviceListMessage,
  parseDeviceList,
  registerRequestSchema,
  registrationMessage,
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
  deps: { config: ServerConfig; database: RiverDatabase; now: () => Date },
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
}

class SignupError extends Error {}
