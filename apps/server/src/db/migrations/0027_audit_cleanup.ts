import { sql, type Kysely } from 'kysely';

/**
 * Server audit: the per-person storage quota sums attachments by uploader on every upload, so
 * that column gets an index. Webhooks of channels deleted before webhooks were removed with their
 * channel are dropped: they could not post anywhere but still counted toward the community's
 * webhook limit.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createIndex('attachments_by_uploader').on('attachments').column('uploader').execute();
  await sql`DELETE FROM webhooks WHERE channel_id NOT IN (SELECT id FROM channels)`.execute(db);
}
