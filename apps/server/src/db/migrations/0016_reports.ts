import type { Kysely } from 'kysely';

/**
 * 1.0.21: message reports to a community's moderators. `data` is sealed with
 * the community key ({ reason, text, senderName } as the reporter saw them);
 * the server sees only which message was reported, by whom, and its status.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('community_reports')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('community_id', 'text', (c) => c.notNull().references('communities.id').onDelete('cascade'))
    .addColumn('channel_id', 'text', (c) => c.notNull())
    .addColumn('message_id', 'text', (c) => c.notNull())
    .addColumn('reporter', 'text', (c) => c.notNull())
    .addColumn('target', 'text', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('resolved_by', 'text')
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('resolved_at', 'text')
    .execute();
  await db.schema
    .createIndex('community_reports_by_community')
    .on('community_reports')
    .columns(['community_id', 'status'])
    .execute();
  // One report per person per message.
  await db.schema
    .createIndex('community_reports_once')
    .on('community_reports')
    .columns(['message_id', 'reporter'])
    .unique()
    .execute();
}
