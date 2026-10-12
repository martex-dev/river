import type { Kysely } from 'kysely';

/**
 * 1.0.23: moderator notes about members. `data` is sealed with the community
 * key; the server lists notes only to people who may moderate members.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('member_notes')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('community_id', 'text', (c) => c.notNull().references('communities.id').onDelete('cascade'))
    .addColumn('target', 'text', (c) => c.notNull())
    .addColumn('author', 'text', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('member_notes_by_target')
    .on('member_notes')
    .columns(['community_id', 'target'])
    .execute();
}
