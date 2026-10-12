import type { Kysely } from 'kysely';

/**
 * 1.0.22: soundboard sounds. Each row's `data` is sealed with the community
 * key ({ name, emoji, audio }); the server sees only its size and who added it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('community_sounds')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('community_id', 'text', (c) => c.notNull().references('communities.id').onDelete('cascade'))
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('community_sounds_by_community')
    .on('community_sounds')
    .column('community_id')
    .execute();
}
