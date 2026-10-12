import type { Kysely } from 'kysely';

/**
 * 1.0.22: forum and stage channels. A forum is a text channel where every
 * top-level message starts a titled thread (a post); a stage is a voice
 * channel where only invited speakers talk. Older clients see them as plain
 * text and voice channels.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('channels')
    .addColumn('forum', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .alterTable('channels')
    .addColumn('stage', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
}
