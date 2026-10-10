import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteAdapter, SqliteDialect, type DialectAdapter } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';
import pg from 'pg';
import * as m0001 from './migrations/0001_server_meta.ts';
import * as m0002 from './migrations/0002_accounts.ts';
import * as m0003 from './migrations/0003_communities.ts';
import * as m0004 from './migrations/0004_roles_moderation.ts';
import * as m0005 from './migrations/0005_attachments.ts';
import * as m0006 from './migrations/0006_messaging.ts';
import * as m0007 from './migrations/0007_key_epochs.ts';
import * as m0008 from './migrations/0008_categories.ts';
import * as m0009 from './migrations/0009_moderation.ts';
import * as m0010 from './migrations/0010_channels_threads.ts';
import * as m0011 from './migrations/0011_voice_limits.ts';
import type { Database } from './schema.ts';

export type Dialect = 'sqlite' | 'postgres';

export interface RiverDatabase {
  db: Kysely<Database>;
  dialect: Dialect;
  close(): Promise<void>;
  /**
   * SQLite only: writes a consistent copy of the database to `path` while the
   * server keeps running (SQLite's online backup). PostgreSQL has its own tools.
   */
  backup?(path: string): Promise<void>;
}

/**
 * Ordered, forward-only migrations. Never edit or reorder a released
 * migration — add a new one. Names sort lexically, so keep the 4-digit prefix.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '0001_server_meta': m0001,
  '0002_accounts': m0002,
  '0003_communities': m0003,
  '0004_roles_moderation': m0004,
  '0005_attachments': m0005,
  '0006_messaging': m0006,
  '0007_key_epochs': m0007,
  '0008_categories': m0008,
  '0009_moderation': m0009,
  '0010_channels_threads': m0010,
  '0011_voice_limits': m0011,
};

/**
 * SQLite supports transactional DDL, but Kysely's adapter conservatively says
 * it does not, which would let a failing migration leave half-created tables.
 * River runs each SQLite migration batch in one transaction, like PostgreSQL.
 */
class TransactionalSqliteAdapter extends SqliteAdapter {
  override get supportsTransactionalDdl(): boolean {
    return true;
  }
}

class RiverSqliteDialect extends SqliteDialect {
  override createAdapter(): DialectAdapter {
    return new TransactionalSqliteAdapter();
  }
}

export function openDatabase(url: string): RiverDatabase {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    return { db, dialect: 'postgres', close: () => db.destroy() };
  }
  if (!url.startsWith('sqlite:')) throw new Error('Unsupported database URL');
  const target = url.slice('sqlite:'.length);
  const path = target === ':memory:' ? ':memory:' : resolve(target);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new SQLite(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('secure_delete = ON');
  const db = new Kysely<Database>({ dialect: new RiverSqliteDialect({ database: sqlite }) });
  return {
    db,
    dialect: 'sqlite',
    close: () => db.destroy(),
    backup: async (to) => {
      mkdirSync(dirname(resolve(to)), { recursive: true });
      await sqlite.backup(resolve(to));
    },
  };
}

/** Applies all pending migrations in one transaction (where the database supports transactional DDL). */
export async function migrateToLatest(
  db: Kysely<Database>,
  migrations: Record<string, Migration> = MIGRATIONS,
): Promise<MigrationResultSet> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
    migrationTableName: 'schema_migrations',
    migrationLockTableName: 'schema_migrations_lock',
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error instanceof Error ? result.error : new Error(String(result.error));
  return result;
}
