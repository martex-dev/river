import type { Kysely } from 'kysely';

/**
 * Encrypted attachment blobs. The bytes live on disk (RIVER_ATTACHMENT_DIR);
 * this table only records who uploaded what, how big it is, and which message
 * it belongs to, so blobs are deleted with their message (and its channel or
 * community) and uploads never linked to a message are cleaned up.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('attachments')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('uploader', 'varchar(36)', (c) => c.notNull())
    .addColumn('size', 'integer', (c) => c.notNull())
    .addColumn('created_at', 'varchar(32)', (c) => c.notNull())
    .addColumn('message_id', 'varchar(22)', (c) => c.references('messages.id').onDelete('cascade'))
    .execute();
  await db.schema.createIndex('attachments_by_message').on('attachments').column('message_id').execute();
}
