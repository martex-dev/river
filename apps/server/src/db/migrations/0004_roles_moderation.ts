import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const DEFAULT_EVERYONE = 1 | 2 | 4 | 8 | 16 | 32 | 128 | (1 << 17);

/**
 * Roles and permissions, channel permission overwrites, bans, message edits,
 * pins and reactions. Existing communities get an @everyone role (ID = the
 * community ID) with the default permissions, so they keep working unchanged.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('roles')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('color', 'integer', (c) => c.notNull())
    .addColumn('permissions', 'integer', (c) => c.notNull())
    .addColumn('position', 'integer', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('member_roles')
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('role_id', 'varchar(22)', (c) => c.notNull().references('roles.id').onDelete('cascade'))
    .addPrimaryKeyConstraint('member_roles_pk', ['community_id', 'river_id', 'role_id'])
    .execute();

  await db.schema
    .createTable('channel_overwrites')
    .addColumn('channel_id', 'varchar(22)', (c) => c.notNull().references('channels.id').onDelete('cascade'))
    .addColumn('role_id', 'varchar(22)', (c) => c.notNull())
    .addColumn('allow', 'integer', (c) => c.notNull())
    .addColumn('deny', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('channel_overwrites_pk', ['channel_id', 'role_id'])
    .execute();

  await db.schema
    .createTable('bans')
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('banned_on', 'varchar(10)', (c) => c.notNull())
    .addPrimaryKeyConstraint('bans_pk', ['community_id', 'river_id'])
    .execute();

  await db.schema
    .createTable('message_reactions')
    .addColumn('message_id', 'varchar(22)', (c) => c.notNull().references('messages.id').onDelete('cascade'))
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('tag', 'varchar(32)', (c) => c.notNull())
    .addColumn('emoji', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('message_reactions_pk', ['message_id', 'river_id', 'tag'])
    .execute();

  await db.schema.alterTable('messages').addColumn('edited_at', 'varchar(32)').execute();
  await db.schema
    .alterTable('messages')
    .addColumn('pinned', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  await sql`INSERT INTO roles (id, community_id, name, color, permissions, position)
            SELECT id, id, '', 0, ${DEFAULT_EVERYONE}, 0 FROM communities`.execute(db);
}
