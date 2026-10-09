import type { Kysely } from 'kysely';

/**
 * Channel categories. A category has a sealed name and a position; channels
 * point at the category they sit in (or none). Deleting a category leaves its
 * channels uncategorised.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('categories')
    .addColumn('id', 'varchar(22)', (c) => c.primaryKey())
    .addColumn('community_id', 'varchar(22)', (c) =>
      c.notNull().references('communities.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('position', 'integer', (c) => c.notNull())
    .execute();
  await db.schema.createIndex('categories_by_community').on('categories').column('community_id').execute();
  await db.schema.alterTable('channels').addColumn('parent_id', 'varchar(22)').execute();
}
