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
  type AccountResponse,
  type ErrorResponse,
  type RegisterResponse,
} from '@river/protocol';
import type { ServerConfig } from '../config.ts';
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

    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('accounts')
          .values({
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
    } catch {
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
      .select(['river_id', 'identity_key', 'device_list', 'device_list_signature'])
      .where('river_id', '=', request.session!.riverId)
      .executeTakeFirstOrThrow();
    const body: AccountResponse = {
      riverId: row.river_id,
      identityKey: row.identity_key,
      deviceList: row.device_list,
      deviceListSignature: row.device_list_signature,
    };
    return body;
  });
}
