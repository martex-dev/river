import { BANNED_UNTIL } from '@river/protocol';
import { createHash, randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { CHALLENGE_BYTES } from '@river/protocol';
import type { Database } from '../db/schema.ts';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const sha256 = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');

/** Issues a single-use challenge. Only its hash is stored. */
export async function issueChallenge(
  db: Kysely<Database>,
  purpose: 'register' | 'session',
  now: Date,
): Promise<{ challenge: string; expiresAt: string }> {
  const bytes = randomBytes(CHALLENGE_BYTES);
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  await db
    .insertInto('auth_challenges')
    .values({ challenge_hash: sha256(bytes), purpose, expires_at: expiresAt })
    .execute();
  return { challenge: bytes.toString('base64'), expiresAt };
}

/** Atomically consumes a challenge. True only once, only for its purpose, only before expiry. */
export async function consumeChallenge(
  db: Kysely<Database>,
  challenge: Uint8Array,
  purpose: 'register' | 'session',
  now: Date,
): Promise<boolean> {
  const result = await db
    .deleteFrom('auth_challenges')
    .where('challenge_hash', '=', sha256(challenge))
    .where('purpose', '=', purpose)
    .where('expires_at', '>', now.toISOString())
    .executeTakeFirst();
  return result.numDeletedRows === 1n;
}

/** Default absolute lifetime of a session (RIVER_SESSION_MAX_DAYS), from sign-in. */
export const SESSION_MAX_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Opaque bearer token; the server stores only SHA-256(token). It expires after `ttlMs` unless
 * renewed, and never later than `maxMs` after sign-in (2.20): then the device signs in again.
 */
export async function createSession(
  db: Kysely<Database>,
  riverId: string,
  deviceId: number,
  ttlMs: number,
  now: Date,
  maxMs: number = SESSION_MAX_MS,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const notAfter = new Date(now.getTime() + maxMs).toISOString();
  const expiresAt = new Date(now.getTime() + Math.min(ttlMs, maxMs)).toISOString();
  await db
    .insertInto('sessions')
    .values({
      token_hash: sha256(token),
      river_id: riverId,
      device_id: deviceId,
      expires_at: expiresAt,
      not_after: notAfter,
    })
    .execute();
  return { token, expiresAt };
}

/** The stored form of a session token (what sign-out deletes by). Null for a malformed token. */
export function sessionHash(token: string): string | null {
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? sha256(token) : null;
}

/** Ends one session (sign-out). True if it existed. */
export async function endSession(db: Kysely<Database>, token: string): Promise<boolean> {
  const hash = sessionHash(token);
  if (!hash) return false;
  const res = await db.deleteFrom('sessions').where('token_hash', '=', hash).executeTakeFirst();
  return res.numDeletedRows > 0n;
}

export async function authenticate(
  db: Kysely<Database>,
  token: string,
  now: Date,
): Promise<{ riverId: string; deviceId: number } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const iso = now.toISOString();
  const row = await db
    .selectFrom('sessions')
    .innerJoin('accounts', 'accounts.river_id', 'sessions.river_id')
    .select(['sessions.river_id', 'sessions.device_id'])
    .where('sessions.token_hash', '=', sha256(token))
    .where('sessions.expires_at', '>', iso)
    // Past its absolute end a session is over, however recently it was renewed (2.20).
    .where('sessions.not_after', '>', iso)
    // A suspended account's sessions stop working at once, wherever they are used.
    .where((eb) =>
      eb.or([eb('accounts.suspended_until', 'is', null), eb('accounts.suspended_until', '<=', iso)]),
    )
    .executeTakeFirst();
  return row ? { riverId: row.river_id, deviceId: row.device_id } : null;
}

/**
 * Keeps a session in use alive (2.10.13): past half its lifetime it is extended to a full one, so a
 * device that stays connected is never cut off once a day. Never past the session's absolute end
 * (2.20): a session does not renew forever. Signed out, deleted or expired sessions are not
 * touched (the update matches only a live one).
 */
export async function renewSession(
  db: Kysely<Database>,
  token: string,
  now: Date,
  ttlMs: number,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  const next = new Date(now.getTime() + ttlMs).toISOString();
  await db
    .updateTable('sessions')
    // ISO times of one length compare as text: the earlier of a full lifetime and the absolute end.
    .set({ expires_at: sql<string>`case when not_after < ${next} then not_after else ${next} end` })
    .where('token_hash', '=', sha256(token))
    .where('expires_at', '>', now.toISOString())
    .where('not_after', '>', now.toISOString())
    .where('expires_at', '<', new Date(now.getTime() + ttlMs / 2).toISOString())
    .execute();
}

/** The account's current suspension, or null. */
export async function suspension(
  db: Kysely<Database>,
  riverId: string,
  now: Date,
): Promise<{ until: string; reason: string | null } | null> {
  const row = await db
    .selectFrom('accounts')
    .select(['suspended_until', 'suspend_reason'])
    .where('river_id', '=', riverId)
    .executeTakeFirst();
  if (!row?.suspended_until || row.suspended_until <= now.toISOString()) return null;
  return { until: row.suspended_until, reason: row.suspend_reason };
}

/** What a suspended person is told when River signs in. */
export function suspensionMessage(s: { until: string; reason: string | null }): string {
  const base =
    s.until === BANNED_UNTIL
      ? 'Your account has been banned from this River server.'
      : `Your account is suspended on this River server until ${s.until.slice(0, 16).replace('T', ' ')} UTC.`;
  return s.reason ? `${base} Reason: ${s.reason}` : base;
}

/** Removes expired challenges and sessions. Cheap; called opportunistically. */
export async function purgeExpired(db: Kysely<Database>, now: Date): Promise<void> {
  const iso = now.toISOString();
  await db.deleteFrom('auth_challenges').where('expires_at', '<=', iso).execute();
  await db
    .deleteFrom('sessions')
    .where((eb) =>
      eb.or([eb('expires_at', '<=', iso), eb('not_after', 'is', null), eb('not_after', '<=', iso)]),
    )
    .execute();
}
