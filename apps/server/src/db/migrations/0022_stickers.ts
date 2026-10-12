import type { Kysely } from 'kysely';

/** 1.0.24: community stickers. `data` is sealed with the community key ({ name, image }). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('community_stickers')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('community_id', 'text', (c) => c.notNull().references('communities.id').onDelete('cascade'))
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('community_stickers_by_community')
    .on('community_stickers')
    .column('community_id')
    .execute();
}
