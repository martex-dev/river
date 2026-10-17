import type { Kysely } from 'kysely';

/**
 * 2.11 trust audit:
 * - Key rotations remember when and by whom an epoch was claimed, so a rotation that never
 *   reaches anyone is asked for again (a few times) instead of leaving the community on the
 *   key a removed member still has.
 * - Usernames given up (changed or deleted) are held for a while before anyone else may take
 *   them, so nobody can pick up a name people still associate with someone else.
 * - Deleted River IDs leave a tombstone with their identity key: the ID can be registered again
 *   only with that same key, never by someone else under a new key.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('communities').addColumn('epoch_claimed_at', 'text').execute();
  await db.schema.alterTable('communities').addColumn('epoch_claimed_by', 'text').execute();
  await db.schema
    .alterTable('communities')
    .addColumn('rotation_retries', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema
    .createTable('username_holds')
    .addColumn('username', 'text', (c) => c.primaryKey())
    .addColumn('river_id', 'text', (c) => c.notNull())
    .addColumn('until', 'text', (c) => c.notNull())
    .execute();
  await db.schema
    .createTable('account_tombstones')
    .addColumn('river_id', 'text', (c) => c.primaryKey())
    .addColumn('identity_key', 'text', (c) => c.notNull())
    .addColumn('deleted_on', 'text', (c) => c.notNull())
    .execute();
}
