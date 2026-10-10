import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import {
  API_PREFIX,
  BANNED_UNTIL,
  adminCreateSignupRequestSchema,
  adminSettingsRequestSchema,
  adminSuspendRequestSchema,
  type AdminOverview,
} from '@river/protocol';
import type { ServerConfig } from '../config.ts';
import type { RiverDatabase } from '../db/database.ts';
import type { Hub } from '../communities/hub.ts';
import { requireHost } from '../host-auth.ts';
import { HttpError } from '../http-error.ts';
import {
  SIGNUP_TTL_MS,
  purgeSignups,
  setSignupMode,
  sha256,
  signupMode,
  usernameFree,
} from '../accounts/usernames.ts';
import type { CommunityOps } from './communities.ts';

/** WebSocket close code for "your account was suspended or removed by the operator". */
export const CLOSE_SUSPENDED = 4403;

/**
 * The server operator's view: every account and community on this server,
 * with suspensions (timeouts and bans), account removal and community
 * removal. Only the program hosting the server can reach these routes (see
 * requireHost); without RIVER_HOST_TOKEN they do not exist.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { config: ServerConfig; database: RiverDatabase; now: () => Date; hub: Hub; ops: CommunityOps },
): void {
  const { hostToken } = deps.config;
  if (!hostToken) return;
  const { db } = deps.database;
  const { hub, ops } = deps;
  const host = {
    preHandler: async (request: FastifyRequest): Promise<void> => requireHost(request, hostToken),
  };

  const exists = async (riverId: string): Promise<void> => {
    const row = await db
      .selectFrom('accounts')
      .select('river_id')
      .where('river_id', '=', riverId)
      .executeTakeFirst();
    if (!row) throw new HttpError(404, 'not_found', 'No such account');
  };

  app.get(`${API_PREFIX}/admin/overview`, host, async (): Promise<AdminOverview> => {
    const now = deps.now().toISOString();
    const accounts = await db
      .selectFrom('accounts')
      .select((eb) => [
        'river_id',
        'created_on',
        'suspended_until',
        'suspend_reason',
        'username',
        eb
          .selectFrom('devices')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('devices.river_id', '=', 'accounts.river_id')
          .as('devices'),
        eb
          .selectFrom('community_members')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('community_members.river_id', '=', 'accounts.river_id')
          .as('communities'),
      ])
      .orderBy('created_on')
      .execute();
    const communities = await db
      .selectFrom('communities')
      .select((eb) => [
        'id',
        'owner',
        'created_on',
        eb
          .selectFrom('community_members')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('community_members.community_id', '=', 'communities.id')
          .as('members'),
        eb
          .selectFrom('channels')
          .select(sql<number>`count(*)`.as('n'))
          .whereRef('channels.community_id', '=', 'communities.id')
          .as('channels'),
      ])
      .orderBy('created_on')
      .execute();
    return {
      accounts: accounts.map((a) => {
        const active = a.suspended_until !== null && a.suspended_until > now;
        return {
          riverId: a.river_id,
          username: a.username,
          createdOn: a.created_on,
          devices: Number(a.devices ?? 0),
          communities: Number(a.communities ?? 0),
          online: hub.isOnline(a.river_id),
          suspendedUntil: active ? a.suspended_until : null,
          suspendReason: active ? a.suspend_reason : null,
        };
      }),
      communities: communities.map((c) => ({
        id: c.id,
        owner: c.owner,
        createdOn: c.created_on,
        members: Number(c.members ?? 0),
        channels: Number(c.channels ?? 0),
      })),
      signups: (
        await db
          .selectFrom('signups')
          .select(['username', 'created_at', 'expires_at'])
          .where('expires_at', '>', now)
          .orderBy('created_at')
          .execute()
      ).map((s) => ({ username: s.username, createdAt: s.created_at, expiresAt: s.expires_at })),
      signupMode: await signupMode(db),
    };
  });

  // Create an account for someone: a one-time sign-up code that comes with the username chosen
  // here. The app turns it into a link; whoever opens it in River gets that account.
  app.post(`${API_PREFIX}/admin/signups`, host, async (request) => {
    const parsed = adminCreateSignupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'bad_username', 'Use 3 to 32 letters, numbers, _ or . for the username.');
    }
    const { username } = parsed.data;
    const now = deps.now();
    await purgeSignups(db, now);
    if (!(await usernameFree(db, username, now))) {
      throw new HttpError(409, 'username_taken', `@${username} is already taken.`);
    }
    const code = randomBytes(16).toString('base64url');
    const expiresAt = new Date(now.getTime() + SIGNUP_TTL_MS).toISOString();
    await db
      .insertInto('signups')
      .values({ code_hash: sha256(code), username, created_at: now.toISOString(), expires_at: expiresAt })
      .execute();
    return { username, code, expiresAt };
  });

  app.delete<{ Params: { username: string } }>(
    `${API_PREFIX}/admin/signups/:username`,
    host,
    async (request) => {
      await db.deleteFrom('signups').where('username', '=', request.params.username).execute();
      return { ok: true };
    },
  );

  // 'invite': only people the operator created an account for can join.
  app.put(`${API_PREFIX}/admin/settings`, host, async (request) => {
    const parsed = adminSettingsRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'bad_request', 'Bad request');
    await setSignupMode(db, parsed.data.signupMode);
    return { ok: true };
  });

  // A timeout (until a time) or a ban (until lifted). Signs the person out everywhere at once.
  app.post<{ Params: { id: string } }>(`${API_PREFIX}/admin/accounts/:id/suspend`, host, async (request) => {
    const parsed = adminSuspendRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'bad_request', 'Bad request');
    const { until, reason } = parsed.data;
    if (until !== null && new Date(until) <= deps.now()) {
      throw new HttpError(400, 'bad_request', 'The end of a timeout must be in the future');
    }
    await exists(request.params.id);
    await db
      .updateTable('accounts')
      .set({ suspended_until: until ?? BANNED_UNTIL, suspend_reason: reason || null })
      .where('river_id', '=', request.params.id)
      .execute();
    await db.deleteFrom('sessions').where('river_id', '=', request.params.id).execute();
    hub.disconnect(request.params.id, CLOSE_SUSPENDED);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/admin/accounts/:id/unsuspend`,
    host,
    async (request) => {
      await exists(request.params.id);
      await db
        .updateTable('accounts')
        .set({ suspended_until: null, suspend_reason: null })
        .where('river_id', '=', request.params.id)
        .execute();
      return { ok: true };
    },
  );

  // Removes the account from the server: it leaves every community (communities it owns are
  // deleted), and its keys, devices, sessions and undelivered mail go. Messages it already sent
  // stay in their channels as they are (ciphertext), like a departed member's.
  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/admin/accounts/:id`, host, async (request) => {
    const id = request.params.id;
    await exists(id);
    hub.disconnect(id, CLOSE_SUSPENDED);
    await ops.removeEverywhere(id);
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('prekeys').where('river_id', '=', id).execute();
      await trx.deleteFrom('signed_prekeys').where('river_id', '=', id).execute();
      await trx.deleteFrom('kyber_prekeys').where('river_id', '=', id).execute();
      await trx.deleteFrom('message_reactions').where('river_id', '=', id).execute();
      await trx.deleteFrom('bans').where('river_id', '=', id).execute();
      await trx
        .deleteFrom('blocks')
        .where((eb) => eb.or([eb('river_id', '=', id), eb('blocked', '=', id)]))
        .execute();
      await trx.deleteFrom('mailbox').where('recipient', '=', id).execute();
      // Devices and sessions go with the account (foreign keys).
      await trx.deleteFrom('accounts').where('river_id', '=', id).execute();
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/admin/communities/:id`, host, async (request) => {
    if (!(await ops.deleteCommunity(request.params.id))) {
      throw new HttpError(404, 'not_found', 'No such community');
    }
    return { ok: true };
  });
}
