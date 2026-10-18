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
import * as m0012 from './migrations/0012_account_suspension.ts';
import * as m0013 from './migrations/0013_usernames.ts';
import * as m0014 from './migrations/0014_events.ts';
import * as m0015 from './migrations/0015_emojis.ts';
import * as m0016 from './migrations/0016_reports.ts';
import * as m0017 from './migrations/0017_sounds.ts';
import * as m0018 from './migrations/0018_forums.ts';
import * as m0019 from './migrations/0019_ban_expiry.ts';
import * as m0020 from './migrations/0020_member_notes.ts';
import * as m0021 from './migrations/0021_onboarding.ts';
import * as m0022 from './migrations/0022_stickers.ts';
import * as m0023 from './migrations/0023_community_art.ts';
import * as m0024 from './migrations/0024_role_expiry.ts';
import * as m0025 from './migrations/0025_invite_tracking.ts';
import * as m0026 from './migrations/0026_webhooks.ts';
import * as m0027 from './migrations/0027_audit_cleanup.ts';
import * as m0028 from './migrations/0028_trust_audit.ts';
import * as m0029 from './migrations/0029_session_lifetime.ts';
import * as m0030 from './migrations/0030_mailbox_caps.ts';
import * as m0031 from './migrations/0031_rotation_stalls.ts';
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
  '0012_account_suspension': m0012,
  '0013_usernames': m0013,
  '0014_events': m0014,
  '0015_emojis': m0015,
  '0016_reports': m0016,
  '0017_sounds': m0017,
  '0018_forums': m0018,
  '0019_ban_expiry': m0019,
  '0020_member_notes': m0020,
  '0021_onboarding': m0021,
  '0022_stickers': m0022,
  '0023_community_art': m0023,
  '0024_role_expiry': m0024,
  '0025_invite_tracking': m0025,
  '0026_webhooks': m0026,
  '0027_audit_cleanup': m0027,
  '0028_trust_audit': m0028,
  '0029_session_lifetime': m0029,
  '0030_mailbox_caps': m0030,
  '0031_rotation_stalls': m0031,
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

/**
 * The PostgreSQL connection pool. An idle connection that PostgreSQL closes (a restart, a
 * failover, an idle timeout in a proxy) makes the pool emit 'error'; with no listener, Node turns
 * that into an uncaught exception and the whole server stops. The pool drops the broken
 * connection by itself and opens a new one for the next query, so the error is only reported.
 */
export function createPgPool(url: string, onError: (err: Error) => void = () => undefined): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (err) => onError(err));
  return pool;
}

export function openDatabase(url: string): RiverDatabase {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const pool = createPgPool(url, (err) =>
      process.emitWarning(`PostgreSQL connection lost (${err.message}); reconnecting on the next query`),
    );
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
