import type { FastifyInstance } from 'fastify';
import { verify } from '@river/crypto';
import { API_PREFIX, deleteAccountMessage, deleteAccountRequestSchema } from '@river/protocol';
import { authenticate, consumeChallenge } from '../accounts/auth-store.ts';
import { purgeAccount } from '../accounts/purge.ts';
import type { Hub } from '../communities/hub.ts';
import type { RiverDatabase } from '../db/database.ts';
import { HttpError } from '../http-error.ts';
import type { CommunityOps } from './communities.ts';

const b = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

/**
 * DELETE /v1/accounts/me (1.0.18): people delete their own account. Besides a
 * valid session it needs a fresh challenge signed by one of the account's
 * device keys under its own signing context, so a stolen session token alone
 * cannot delete an account.
 */
export function registerSelfRoutes(
  app: FastifyInstance,
  deps: { database: RiverDatabase; now: () => Date; hub: Hub; ops: CommunityOps },
): void {
  const { db } = deps.database;
  app.delete(`${API_PREFIX}/accounts/me`, async (request) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = token ? await authenticate(db, token, deps.now()) : null;
    if (!session) throw new HttpError(401, 'unauthorized', 'A valid session is required');
    const parsed = deleteAccountRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'bad_request', 'Bad request');
    const req = parsed.data;
    const challenge = b(req.challenge);
    if (!(await consumeChallenge(db, challenge, 'session', deps.now())))
      throw new HttpError(401, 'invalid_challenge', 'Challenge is unknown, used or expired');
    const device = await db
      .selectFrom('devices')
      .select('auth_key')
      .where('river_id', '=', session.riverId)
      .where('device_id', '=', req.deviceId)
      .executeTakeFirst();
    if (
      !device ||
      !verify(
        b(device.auth_key),
        deleteAccountMessage(challenge, session.riverId, req.deviceId),
        b(req.signature),
      )
    )
      throw new HttpError(401, 'unauthorized', 'Authentication failed');
    await purgeAccount(db, deps.hub, deps.ops, session.riverId);
    return { ok: true };
  });
}
