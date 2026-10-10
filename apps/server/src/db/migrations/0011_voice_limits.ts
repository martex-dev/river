import type { Kysely } from 'kysely';

/** 1.0.8: a maximum number of people in a voice channel (0 = no limit). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('channels')
    .addColumn('user_limit', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
}
