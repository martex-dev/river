import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteAdapter, SqliteDialect, type DialectAdapter } from 'kysely';
import { Migrator, type Migration, type MigrationResultSet } from 'kysely/migration';
import pg from 'pg';
import * as m0001 from './migrations/0001_server_meta.ts';
import type { Database } from './schema.ts';

export type Dialect = 'sqlite' | 'postgres';

export interface RiverDatabase {
  db: Kysely<Database>;
  dialect: Dialect;
  close(): Promise<void>;
}

/**
 * Ordered, forward-only migrations. Never edit or reorder a released
 * migration — add a new one. Names sort lexically, so keep the 4-digit prefix.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '0001_server_meta': m0001,
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
  return { db, dialect: 'sqlite', close: () => db.destroy() };
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
