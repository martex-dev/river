import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SignupMode } from '@river/protocol';
import type { Database } from '../db/schema.ts';

export const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');

/** How long an account the operator created can wait to be claimed. */
export const SIGNUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 'open' unless the operator made the server invite-only (Admin). */
export async function signupMode(db: Kysely<Database>): Promise<SignupMode> {
  const row = await db
    .selectFrom('server_meta')
    .select('value')
    .where('key', '=', 'signup_mode')
    .executeTakeFirst();
  return row?.value === 'invite' ? 'invite' : 'open';
}

export async function setSignupMode(db: Kysely<Database>, mode: SignupMode): Promise<void> {
  await db
    .insertInto('server_meta')
    .values({ key: 'signup_mode', value: mode })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: mode }))
    .execute();
}

/** How long a username someone gave up (changed or deleted) stays theirs to take back (2.11). */
export const USERNAME_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Usernames one account may hold at once after giving them up (2.11.2): renaming again and again
 * cannot reserve a whole list of names. The newest holds stay.
 */
export const MAX_HOLDS_PER_ACCOUNT = 2;

/**
 * Holds a username its owner gave up, so for a while nobody else can take it and be mistaken
 * for them. Only `riverId` may take it back meanwhile. Keeps at most MAX_HOLDS_PER_ACCOUNT active
 * holds for that account (the newest), and drops its expired ones.
 */
export async function holdUsername(
  db: Kysely<Database>,
  username: string,
  riverId: string,
  now: Date,
): Promise<void> {
  const until = new Date(now.getTime() + USERNAME_HOLD_MS).toISOString();
  await db
    .insertInto('username_holds')
    .values({ username, river_id: riverId, until })
    .onConflict((oc) => oc.column('username').doUpdateSet({ river_id: riverId, until }))
    .execute();
  const holds = await db
    .selectFrom('username_holds')
    .select(['username', 'until'])
    .where('river_id', '=', riverId)
    .orderBy('until', 'desc')
    .orderBy('username')
    .execute();
  const keep = new Set(
    holds
      .filter((h) => h.until > now.toISOString())
      .slice(0, MAX_HOLDS_PER_ACCOUNT)
      .map((h) => h.username),
  );
  const drop = holds.map((h) => h.username).filter((u) => !keep.has(u));
  if (drop.length) {
    await db
      .deleteFrom('username_holds')
      .where('river_id', '=', riverId)
      .where('username', 'in', drop)
      .execute();
  }
}

/**
 * Free means: no account has it, no unclaimed sign-up holds it, and nobody else gave it up
 * recently (`forRiverId` may take back its own). The operator may pass over such a hold
 * (`ignoreHolds`, Admin → create an account, 2.11.2).
 */
export async function usernameFree(
  db: Kysely<Database>,
  username: string,
  now: Date,
  forRiverId?: string,
  options: { ignoreHolds?: boolean } = {},
): Promise<boolean> {
  const hold = await db
    .selectFrom('username_holds')
    .select(['river_id', 'until'])
    .where('username', '=', username)
    .executeTakeFirst();
  if (!options.ignoreHolds && hold && hold.until > now.toISOString() && hold.river_id !== forRiverId)
    return false;
  const taken = await db
    .selectFrom('accounts')
    .select('river_id')
    .where('username', '=', username)
    .executeTakeFirst();
  if (taken) return false;
  const held = await db
    .selectFrom('signups')
    .select('username')
    .where('username', '=', username)
    .where('expires_at', '>', now.toISOString())
    .executeTakeFirst();
  return !held;
}

/** Removes sign-ups nobody claimed in time, so their usernames are free again. */
export async function purgeSignups(db: Kysely<Database>, now: Date): Promise<void> {
  await db.deleteFrom('signups').where('expires_at', '<=', now.toISOString()).execute();
}
