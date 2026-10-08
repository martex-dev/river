import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';

export type LocalDatabase = Database.Database;

export class WrongKeyError extends Error {
  constructor() {
    super('The local database could not be decrypted with this key');
    this.name = 'WrongKeyError';
  }
}

export class NewerSchemaError extends Error {
  readonly found: number;
  readonly supported: number;
  constructor(found: number, supported: number) {
    super(`Local data was written by a newer River (schema ${found}; this version supports ${supported})`);
    this.name = 'NewerSchemaError';
    this.found = found;
    this.supported = supported;
  }
}

export class MigrationError extends Error {
  readonly migration: string;
  readonly backupPath: string | null;
  constructor(migration: string, cause: unknown, backupPath: string | null) {
    super(`Local database migration "${migration}" failed: ${(cause as Error)?.message ?? cause}`);
    this.name = 'MigrationError';
    this.migration = migration;
    this.backupPath = backupPath;
  }
}

/**
 * Opens (or creates) the SQLCipher-encrypted local database with a raw
 * 32-byte key (no password KDF needed — the key is already uniformly random).
 */
export function openEncryptedDatabase(path: string, key: Buffer): LocalDatabase {
  if (key.length !== 32) throw new Error('Database key must be 32 bytes');
  const db = new Database(path);
  try {
    db.pragma("cipher = 'sqlcipher'");
    db.pragma('legacy = 4');
    db.pragma(`key = "x'${key.toString('hex')}'"`);
    // Any read fails with SQLITE_NOTADB if the key is wrong.
    db.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (err) {
    db.close();
    if ((err as { code?: string }).code === 'SQLITE_NOTADB') throw new WrongKeyError();
    throw err;
  }
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');
  db.pragma('journal_mode = DELETE');
  return db;
}

export interface ClientMigration {
  /** Consecutive from 1. Stored in PRAGMA user_version. Never change a released migration. */
  version: number;
  name: string;
  /** Destructive migrations (drop/rewrite data) get a backup copy first. */
  destructive?: boolean;
  up(db: LocalDatabase): void;
}

export interface MigrationOutcome {
  from: number;
  to: number;
  applied: string[];
  backupPath: string | null;
}

const KEEP_BACKUPS = 3;

/**
 * Applies pending migrations in one transaction. Before any destructive
 * migration the (encrypted) database file is copied aside; on failure the
 * transaction rolls back and the copy is kept for recovery.
 * Returns the (possibly re-opened) database handle.
 */
export function migrateDatabase(
  path: string,
  key: Buffer,
  migrations: readonly ClientMigration[],
  now: () => Date = () => new Date(),
): { db: LocalDatabase; outcome: MigrationOutcome } {
  validateMigrations(migrations);
  const latest = migrations.at(-1)?.version ?? 0;

  let db = openEncryptedDatabase(path, key);
  const from = db.pragma('user_version', { simple: true }) as number;
  if (from > latest) {
    db.close();
    throw new NewerSchemaError(from, latest);
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { db, outcome: { from, to: from, applied: [], backupPath: null } };

  let backupPath: string | null = null;
  if (from > 0 && pending.some((m) => m.destructive)) {
    db.close();
    backupPath = `${path}.backup-v${from}-${now().getTime()}`;
    copyFileSync(path, backupPath);
    pruneBackups(path);
    db = openEncryptedDatabase(path, key);
  }

  let current = '';
  try {
    db.transaction(() => {
      for (const m of pending) {
        current = m.name;
        m.up(db);
        db.pragma(`user_version = ${m.version}`);
      }
    })();
  } catch (err) {
    db.close();
    throw new MigrationError(current, err, backupPath);
  }
  return { db, outcome: { from, to: latest, applied: pending.map((m) => m.name), backupPath } };
}

function validateMigrations(migrations: readonly ClientMigration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new Error(`Migration versions must be consecutive from 1 (got ${m.version} at ${i})`);
  });
}

function pruneBackups(path: string): void {
  const dir = dirname(path);
  const prefix = `${basename(path)}.backup-`;
  if (!existsSync(dir)) return;
  const backups = readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .sort((a, b) => Number(a.split('-').at(-1)) - Number(b.split('-').at(-1)));
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
    rmSync(join(dir, old), { force: true });
  }
}
