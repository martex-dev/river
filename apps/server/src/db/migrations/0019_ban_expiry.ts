import type { Kysely } from 'kysely';

/** 1.0.22: temporary bans. `until` is when the ban ends (ISO time), or null for good. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('bans').addColumn('until', 'text').execute();
}
