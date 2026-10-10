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

/** Free means: no account has it, and no unclaimed sign-up holds it. */
export async function usernameFree(db: Kysely<Database>, username: string, now: Date): Promise<boolean> {
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
