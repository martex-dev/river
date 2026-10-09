import type { Kysely } from 'kysely';

/**
 * Direct messages: public libsignal prekeys per device, an offline mailbox of
 * end-to-end encrypted envelopes (deleted when acknowledged), and blocks.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('signed_prekeys')
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('device_id', 'integer', (c) => c.notNull())
    .addColumn('key_id', 'integer', (c) => c.notNull())
    .addColumn('public_key', 'text', (c) => c.notNull())
    .addColumn('signature', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('signed_prekeys_pk', ['river_id', 'device_id'])
    .execute();

  await db.schema
    .createTable('prekeys')
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('device_id', 'integer', (c) => c.notNull())
    .addColumn('key_id', 'integer', (c) => c.notNull())
    .addColumn('public_key', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('prekeys_pk', ['river_id', 'device_id', 'key_id'])
    .execute();

  await db.schema
    .createTable('kyber_prekeys')
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('device_id', 'integer', (c) => c.notNull())
    .addColumn('key_id', 'integer', (c) => c.notNull())
    .addColumn('public_key', 'text', (c) => c.notNull())
    .addColumn('signature', 'text', (c) => c.notNull())
    .addColumn('last_resort', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('kyber_prekeys_pk', ['river_id', 'device_id', 'key_id'])
    .execute();

  await db.schema
    .createTable('mailbox')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('recipient', 'varchar(36)', (c) => c.notNull())
    .addColumn('recipient_device', 'integer', (c) => c.notNull())
    .addColumn('sender', 'varchar(36)', (c) => c.notNull())
    .addColumn('sender_device', 'integer', (c) => c.notNull())
    .addColumn('type', 'integer', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('received_at', 'varchar(32)', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('mailbox_by_recipient')
    .on('mailbox')
    .columns(['recipient', 'recipient_device', 'received_at'])
    .execute();

  await db.schema
    .createTable('blocks')
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('blocked', 'varchar(36)', (c) => c.notNull())
    .addPrimaryKeyConstraint('blocks_pk', ['river_id', 'blocked'])
    .execute();
}
