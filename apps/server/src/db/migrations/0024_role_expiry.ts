import type { Kysely } from 'kysely';

/** 1.0.30: temporary roles. `expires_at` is when a role given for a while ends, or null. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('member_roles').addColumn('expires_at', 'text').execute();
}
