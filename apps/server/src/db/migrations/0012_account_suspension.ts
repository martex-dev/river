import type { Kysely } from 'kysely';

/**
 * 1.0.12: the server operator can suspend an account — for a while (a
 * timeout) or until lifted (a ban). Stored as an ISO time; a ban is far in the
 * future. The reason is the operator's own note, shown to the person.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('accounts').addColumn('suspended_until', 'text').execute();
  await db.schema.alterTable('accounts').addColumn('suspend_reason', 'text').execute();
}
