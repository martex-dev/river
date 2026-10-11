import type { Kysely } from 'kysely';

/**
 * 1.0.18: scheduled community events. Name, description and place are sealed
 * with the community key (`data`); the server keeps only the times (to order
 * them) and who is interested.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('community_events')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('community_id', 'text', (c) => c.notNull().references('communities.id').onDelete('cascade'))
    .addColumn('created_by', 'text', (c) => c.notNull())
    .addColumn('data', 'text', (c) => c.notNull())
    .addColumn('starts_at', 'text', (c) => c.notNull())
    .addColumn('ends_at', 'text', (c) => c.notNull())
    .addColumn('channel_id', 'text')
    .addColumn('canceled', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('community_events_by_community')
    .on('community_events')
    .columns(['community_id', 'starts_at'])
    .execute();
  await db.schema
    .createTable('community_event_rsvps')
    .addColumn('event_id', 'text', (c) => c.notNull().references('community_events.id').onDelete('cascade'))
    .addColumn('river_id', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('community_event_rsvps_pk', ['event_id', 'river_id'])
    .execute();
}
