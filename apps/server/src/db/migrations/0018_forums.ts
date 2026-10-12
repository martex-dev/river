import type { Kysely } from 'kysely';

/**
 * 1.0.22: forum channels. A forum is a text channel where every top-level
 * message starts a titled thread (a post). Older clients see it as a text
 * channel with threads.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('channels')
    .addColumn('forum', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
}
