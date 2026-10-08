import type { Kysely } from 'kysely';

/**
 * Accounts, devices, sessions and one-time auth challenges.
 *
 * Privacy notes: keys are public keys only; timestamps on accounts/devices are
 * stored with day precision; no IP addresses, no user agents, no "last seen".
 * Binary values are base64 text so the same schema works on SQLite and PostgreSQL.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('accounts')
    .addColumn('river_id', 'varchar(36)', (c) => c.primaryKey())
    .addColumn('identity_key', 'text', (c) => c.notNull())
    .addColumn('device_list', 'text', (c) => c.notNull())
    .addColumn('device_list_signature', 'text', (c) => c.notNull())
    .addColumn('device_list_version', 'integer', (c) => c.notNull())
    .addColumn('created_on', 'varchar(10)', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('devices')
    .addColumn('river_id', 'varchar(36)', (c) =>
      c.notNull().references('accounts.river_id').onDelete('cascade'),
    )
    .addColumn('device_id', 'integer', (c) => c.notNull())
    .addColumn('auth_key', 'text', (c) => c.notNull())
    .addColumn('registration_id', 'integer', (c) => c.notNull())
    .addColumn('created_on', 'varchar(10)', (c) => c.notNull())
    .addPrimaryKeyConstraint('devices_pk', ['river_id', 'device_id'])
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('token_hash', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('river_id', 'varchar(36)', (c) => c.notNull())
    .addColumn('device_id', 'integer', (c) => c.notNull())
    .addColumn('expires_at', 'varchar(32)', (c) => c.notNull())
    .addForeignKeyConstraint(
      'sessions_device_fk',
      ['river_id', 'device_id'],
      'devices',
      ['river_id', 'device_id'],
      (c) => c.onDelete('cascade'),
    )
    .execute();
  await db.schema.createIndex('sessions_expiry').on('sessions').column('expires_at').execute();

  await db.schema
    .createTable('auth_challenges')
    .addColumn('challenge_hash', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('purpose', 'varchar(16)', (c) => c.notNull())
    .addColumn('expires_at', 'varchar(32)', (c) => c.notNull())
    .execute();
  await db.schema.createIndex('auth_challenges_expiry').on('auth_challenges').column('expires_at').execute();
}
