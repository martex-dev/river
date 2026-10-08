import type { Kysely } from 'kysely';

/**
 * Communities, channels, members, invites and messages. Names, profiles and
 * message bodies are client-side ciphertext; the server cannot read them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('communities')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('owner', 'varchar(36)', (c) => c.notNull())
    .addColumn('meta', 'text', (c) => c.notNull())
    .addColumn('created_on', 'varchar(10)', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('community_members')
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('role', 'varchar(8)', (c) => c.notNull())
    .addColumn('profile', 'text', (c) => c.notNull())
    .addColumn('joined_on', 'varchar(10)', (c) => c.notNull())
    .addPrimaryKeyConstraint('community_members_pk', ['community_id', 'river_id'])
    .execute();
  await db.schema
    .createIndex('community_members_by_user')
    .on('community_members')
    .column('river_id')
    .execute();

  await db.schema
    .createTable('channels')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('kind', 'varchar(8)', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('position', 'integer', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('invites')
    .addColumn('code_hash', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('expires_at', 'varchar(32)', (c) => c.notNull())
    .addColumn('uses', 'integer', (c) => c.notNull())
    .addColumn('max_uses', 'integer', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('messages')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('channel_id', 'varchar(22)', (c) => c.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('sender', 'varchar(36)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('sent_at', 'varchar(32)', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('messages_by_channel')
    .on('messages')
    .columns(['channel_id', 'sent_at'])
    .execute();
}
