import type { Kysely } from 'kysely';

/**
 * Moderation for 1.0.6: member timeouts, an audit log of administrative
 * actions (IDs and permission bits only, never content), and category
 * permissions that channels can stay in sync with.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('community_members').addColumn('timeout_until', 'varchar(32)').execute();

  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('actor', 'varchar(36)', (c) => c.notNull())
    .addColumn('action', 'varchar(40)', (c) => c.notNull())
    .addColumn('target', 'varchar(64)')
    .addColumn('details', 'text', (c) => c.notNull())
    .addColumn('created_at', 'varchar(32)', (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex('audit_log_by_community')
    .on('audit_log')
    .columns(['community_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('category_overwrites')
    .addColumn('category_id', 'varchar(22)', (c) =>
      c.notNull().references('categories.id').onDelete('cascade'),
    )
    .addColumn('role_id', 'varchar(22)', (c) => c.notNull())
    .addColumn('allow', 'integer', (c) => c.notNull())
    .addColumn('deny', 'integer', (c) => c.notNull())
    .addPrimaryKeyConstraint('category_overwrites_pk', ['category_id', 'role_id'])
    .execute();
  await db.schema
    .alterTable('channels')
    .addColumn('synced', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
}
