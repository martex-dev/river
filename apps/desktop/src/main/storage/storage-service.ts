import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageStatus } from '../../shared/ipc.ts';
import type { Logger } from '../logger.ts';
import {
  MigrationError,
  NewerSchemaError,
  WrongKeyError,
  migrateDatabase,
  type LocalDatabase,
} from './database.ts';
import {
  MIN_PASSPHRASE_LENGTH,
  keyFileSchema,
  newDatabaseKey,
  openWithKeystore,
  openWithPassphrase,
  sealWithKeystore,
  sealWithPassphrase,
  type KeyFile,
  type OsKeystore,
} from './key-file.ts';
import { CLIENT_MIGRATIONS } from './migrations.ts';

export interface StorageServiceDeps {
  dir: string;
  keystore: OsKeystore;
  log: Logger;
  appVersion: string;
  now?: () => Date;
}

export class StorageService {
  private status: StorageStatus = { state: 'opening' };
  private database: LocalDatabase | null = null;
  private readonly listeners = new Set<(s: StorageStatus) => void>();
  private readonly deps: StorageServiceDeps;
  readonly dbPath: string;
  readonly keyPath: string;

  constructor(deps: StorageServiceDeps) {
    this.deps = deps;
    this.dbPath = join(deps.dir, 'river.db');
    this.keyPath = join(deps.dir, 'database.key');
  }

  getStatus(): StorageStatus {
    return this.status;
  }

  onStatus(listener: (s: StorageStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The open database, or null while locked / not set up. Main process only. */
  db(): LocalDatabase | null {
    return this.database;
  }

  /** Decides how to obtain the key and opens the database if no user input is needed. */
  start(): StorageStatus {
    mkdirSync(this.deps.dir, { recursive: true });
    const keyFile = this.readKeyFile();
    if (keyFile === 'corrupt') return this.status;

    if (keyFile === null) {
      if (existsSync(this.dbPath)) {
        // Without its key the old file can never be read; keep it aside rather than delete it.
        const aside = `${this.dbPath}.orphaned-${this.now().getTime()}`;
        renameSync(this.dbPath, aside);
        this.deps.log.warn('Local database had no key file; moved it aside and started fresh');
      }
      if (this.deps.keystore.usable()) {
        const key = newDatabaseKey();
        try {
          this.writeKeyFile(sealWithKeystore(key, this.deps.keystore));
          this.open(key, 'os-keystore');
        } finally {
          key.fill(0);
        }
      } else {
        this.set({ state: 'setup-required', minLength: MIN_PASSPHRASE_LENGTH });
      }
      return this.status;
    }

    if (keyFile.protection === 'passphrase') {
      this.set({ state: 'locked' });
      return this.status;
    }

    let key: Buffer;
    try {
      key = openWithKeystore(keyFile, this.deps.keystore);
    } catch (err) {
      this.deps.log.error(`Keystore unwrap failed: ${(err as Error).message}`);
      this.set({
        state: 'error',
        code: 'keystore-unavailable',
        message:
          'River cannot reach your system keyring to unlock its local data. Unlock or restore your keyring and restart River.',
      });
      return this.status;
    }
    try {
      this.open(key, 'os-keystore');
    } finally {
      key.fill(0);
    }
    return this.status;
  }

  /** First run without an OS keystore: protect the database key with a passphrase. */
  async setupPassphrase(passphrase: string): Promise<StorageStatus> {
    if (this.status.state !== 'setup-required') throw new Error('Passphrase setup is not expected now');
    const key = newDatabaseKey();
    try {
      this.writeKeyFile(await sealWithPassphrase(key, passphrase));
      this.open(key, 'passphrase');
    } finally {
      key.fill(0);
    }
    return this.status;
  }

  /** Throws WrongPassphraseError on a wrong passphrase. */
  async unlock(passphrase: string): Promise<StorageStatus> {
    if (this.status.state !== 'locked') throw new Error('River is not locked');
    const keyFile = this.readKeyFile();
    if (keyFile === null || keyFile === 'corrupt' || keyFile.protection !== 'passphrase') {
      throw new Error('Key file changed unexpectedly');
    }
    const key = await openWithPassphrase(keyFile, passphrase);
    try {
      this.open(key, 'passphrase');
    } finally {
      key.fill(0);
    }
    return this.status;
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }

  private open(key: Buffer, protection: 'os-keystore' | 'passphrase'): void {
    try {
      const { db, outcome } = migrateDatabase(this.dbPath, key, CLIENT_MIGRATIONS, this.deps.now);
      this.database = db;
      if (outcome.applied.length)
        this.deps.log.info(`Local database migrated ${outcome.from} → ${outcome.to}`);
      const insert = db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)');
      insert.run('created_at', this.now().toISOString());
      insert.run('created_with', this.deps.appVersion);
      this.set({
        state: 'open',
        protection,
        keystore: protection === 'os-keystore' ? this.deps.keystore.name() : 'Passphrase (Argon2id)',
        schema: outcome.to,
      });
    } catch (err) {
      this.deps.log.error(`Opening local database failed: ${(err as Error).name}: ${(err as Error).message}`);
      if (err instanceof NewerSchemaError) {
        this.set({
          state: 'error',
          code: 'newer-data',
          message:
            'Your local River data was created by a newer version of River. Install the latest River to open it.',
        });
      } else if (err instanceof MigrationError) {
        this.set({
          state: 'error',
          code: 'migration-failed',
          message:
            'River could not upgrade its local data. Nothing was changed; a backup was kept. Please report this problem.',
        });
      } else if (err instanceof WrongKeyError) {
        this.set({
          state: 'error',
          code: 'corrupt',
          message: 'River could not decrypt its local data with the stored key.',
        });
      } else {
        this.set({ state: 'error', code: 'unknown', message: 'River could not open its local data.' });
      }
    }
  }

  private readKeyFile(): KeyFile | null | 'corrupt' {
    if (!existsSync(this.keyPath)) return null;
    try {
      return keyFileSchema.parse(JSON.parse(readFileSync(this.keyPath, 'utf8')));
    } catch {
      this.deps.log.error('Database key file is unreadable');
      this.set({
        state: 'error',
        code: 'corrupt',
        message: 'River’s local key file is damaged. Your data has not been changed.',
      });
      return 'corrupt';
    }
  }

  private writeKeyFile(file: KeyFile): void {
    const tmp = `${this.keyPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    renameSync(tmp, this.keyPath);
  }

  private set(status: StorageStatus): void {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
