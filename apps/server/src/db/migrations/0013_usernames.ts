import type { Kysely } from 'kysely';

/**
 * 1.0.13: usernames (unique, stored lowercase) and accounts the operator
 * creates ahead of time: a one-time sign-up code that comes with a username.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('accounts').addColumn('username', 'text').execute();
  await db.schema.createIndex('accounts_username').unique().on('accounts').column('username').execute();
  await db.schema
    .createTable('signups')
    .addColumn('code_hash', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('username', 'text', (c) => c.notNull().unique())
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'text', (c) => c.notNull())
    .execute();
}
