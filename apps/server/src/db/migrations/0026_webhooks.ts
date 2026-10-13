import type { Kysely } from 'kysely';

/**
 * 1.0.32: incoming webhooks (ADR 0004). `sealed` holds { name, key } sealed
 * with the community key; the server keeps only a hash of the posting token.
 * Revoked webhooks keep their row so earlier posts stay readable.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('webhooks')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('community_id', 'text', (c) => c.notNull().references('communities.id').onDelete('cascade'))
    .addColumn('channel_id', 'text', (c) => c.notNull())
    .addColumn('sealed', 'text', (c) => c.notNull())
    .addColumn('token_hash', 'text')
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('revoked', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.createIndex('webhooks_by_community').on('webhooks').column('community_id').execute();
  await db.schema.alterTable('messages').addColumn('webhook_id', 'text').execute();
}
