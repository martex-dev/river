import type { Kysely } from 'kysely';

/**
 * 1.0.7: announcement channels, slowmode and threads. A thread hangs off a
 * starting message; its replies live in the same channel but are listed
 * separately. Thread names are sealed like everything else.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('channels')
    .addColumn('announcement', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .alterTable('channels')
    .addColumn('slowmode', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable('messages').addColumn('thread_id', 'varchar(22)').execute();
  await db.schema
    .createIndex('messages_by_thread')
    .on('messages')
    .columns(['thread_id', 'sent_at'])
    .execute();
  await db.schema
    .createTable('threads')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('channel_id', 'varchar(22)', (c) => c.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('creator', 'varchar(36)', (c) => c.notNull())
    .addColumn('created_at', 'varchar(32)', (c) => c.notNull())
    .addColumn('last_at', 'varchar(32)')
    .addColumn('count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('archived', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
}
