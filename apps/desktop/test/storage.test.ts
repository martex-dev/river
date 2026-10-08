import { argon2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../src/main/logger.ts';
import {
  MigrationError,
  NewerSchemaError,
  WrongKeyError,
  migrateDatabase,
  openEncryptedDatabase,
  type ClientMigration,
} from '../src/main/storage/database.ts';
import {
  WrongPassphraseError,
  deriveKek,
  keyFileSchema,
  newDatabaseKey,
  openWithPassphrase,
  sealWithPassphrase,
  type OsKeystore,
} from '../src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../src/main/storage/migrations.ts';
import { StorageService } from '../src/main/storage/storage-service.ts';

/** Fast Argon2 parameters for tests only; production uses ARGON2_PARAMS. */
const FAST = { memory: 19 * 1024, passes: 1, parallelism: 1 } as const;

/** Stand-in for the OS keystore: XOR with a secret pad, enough to prove wrapping is used. */
function fakeKeystore(usable = true): OsKeystore & { broken: boolean } {
  const pad = randomBytes(64);
  return {
    broken: false,
    usable: () => usable,
    name: () => 'Test keystore',
    wrap(p) {
      return Buffer.from(p.map((b, i) => b ^ pad[i]!));
    },
    unwrap(w) {
      if (this.broken) throw new Error('keyring locked');
      return Buffer.from(w.map((b, i) => b ^ pad[i]!));
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-storage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

describe('encrypted database', () => {
  it('stores nothing in plaintext on disk', () => {
    const path = join(dir, 'a.db');
    const key = newDatabaseKey();
    const db = openEncryptedDatabase(path, key);
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('RIVER-PLAINTEXT-MARKER-123')");
    db.close();
    const bytes = readFileSync(path);
    expect(bytes.includes(Buffer.from('RIVER-PLAINTEXT-MARKER-123'))).toBe(false);
    expect(bytes.subarray(0, 15).toString()).not.toBe('SQLite format 3');
    const reopened = openEncryptedDatabase(path, key);
    expect(reopened.prepare('SELECT v FROM t').get()).toEqual({ v: 'RIVER-PLAINTEXT-MARKER-123' });
    reopened.close();
  });

  it('refuses the wrong key', () => {
    const path = join(dir, 'b.db');
    const db = openEncryptedDatabase(path, newDatabaseKey());
    db.exec('CREATE TABLE t (v)');
    db.close();
    expect(() => openEncryptedDatabase(path, newDatabaseKey())).toThrow(WrongKeyError);
    expect(() => openEncryptedDatabase(path, Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe('client migrations', () => {
  const key = newDatabaseKey();
  const v1: ClientMigration = {
    version: 1,
    name: '0001',
    up: (db) => db.exec("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('keep me')"),
  };

  it('migrates from empty, is idempotent and records the version', () => {
    const path = join(dir, 'm.db');
    const first = migrateDatabase(path, key, CLIENT_MIGRATIONS);
    expect(first.outcome).toMatchObject({ from: 0, to: CLIENT_MIGRATIONS.length, backupPath: null });
    first.db.close();
    const second = migrateDatabase(path, key, CLIENT_MIGRATIONS);
    expect(second.outcome.applied).toEqual([]);
    second.db.close();
  });

  it('backs up before a destructive migration and rolls back on failure', () => {
    const path = join(dir, 'm.db');
    migrateDatabase(path, key, [v1]).db.close();
    const broken: ClientMigration = {
      version: 2,
      name: '0002-broken',
      destructive: true,
      up: (db) => {
        db.exec('DELETE FROM notes');
        throw new Error('boom');
      },
    };
    let error: unknown;
    try {
      migrateDatabase(path, key, [v1, broken]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MigrationError);
    const backup = (error as MigrationError).backupPath;
    expect(backup && existsSync(backup)).toBe(true);
    // The transaction rolled back: data and schema version are unchanged.
    const db = openEncryptedDatabase(path, key);
    expect(db.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'keep me' }]);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.close();
    // The backup is itself encrypted and readable with the same key.
    const b = openEncryptedDatabase(backup!, key);
    expect(b.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 1 });
    b.close();
  });

  it('refuses data written by a newer River', () => {
    const path = join(dir, 'm.db');
    const v2: ClientMigration = { version: 2, name: '0002', up: () => {} };
    migrateDatabase(path, key, [v1, v2]).db.close();
    expect(() => migrateDatabase(path, key, [v1])).toThrow(NewerSchemaError);
  });

  it('rejects gaps in migration numbering', () => {
    expect(() => migrateDatabase(join(dir, 'x.db'), key, [{ ...v1, version: 2 }])).toThrow(/consecutive/);
  });
});

describe('Argon2id key derivation', () => {
  it('libsodium agrees with an independent implementation (OpenSSL via node:crypto)', async () => {
    const salt = Buffer.from('0123456789abcdef');
    const ours = await deriveKek('correct horse battery staple', salt, FAST);
    const openssl = argon2Sync('argon2id', {
      message: Buffer.from('correct horse battery staple'),
      nonce: salt,
      memory: FAST.memory,
      passes: FAST.passes,
      parallelism: 1,
      tagLength: 32,
    });
    expect(ours.equals(openssl)).toBe(true);
  });
});

describe('passphrase-sealed key', () => {
  it('round-trips with the right passphrase and rejects the wrong one', async () => {
    const key = newDatabaseKey();
    const sealed = await sealWithPassphrase(key, 'correct horse battery staple', FAST);
    expect(keyFileSchema.parse(sealed).protection).toBe('passphrase');
    expect(JSON.stringify(sealed)).not.toContain(key.toString('base64'));
    if (sealed.protection !== 'passphrase') throw new Error('unexpected');
    expect((await openWithPassphrase(sealed, 'correct horse battery staple')).equals(key)).toBe(true);
    await expect(openWithPassphrase(sealed, 'wrong horse battery staple')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('detects tampering with the sealed key', async () => {
    const sealed = await sealWithPassphrase(newDatabaseKey(), 'correct horse battery staple', FAST);
    if (sealed.protection !== 'passphrase') throw new Error('unexpected');
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0]! ^= 1;
    await expect(
      openWithPassphrase(
        { ...sealed, ciphertext: flipped.toString('base64') },
        'correct horse battery staple',
      ),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('enforces a minimum length', async () => {
    await expect(sealWithPassphrase(newDatabaseKey(), 'short', FAST)).rejects.toThrow(/at least/);
  });
});

describe('StorageService', () => {
  const service = (keystore: OsKeystore) =>
    new StorageService({ dir, keystore, log: nullLogger, appVersion: '0.0.3' });

  it('opens automatically with an OS keystore and reopens on the next start', () => {
    const keystore = fakeKeystore();
    const first = service(keystore);
    expect(first.start()).toMatchObject({
      state: 'open',
      protection: 'os-keystore',
      keystore: 'Test keystore',
    });
    first.db()!.prepare("INSERT INTO meta VALUES ('probe', 'x')").run();
    first.close();

    const keyFile = JSON.parse(readFileSync(join(dir, 'database.key'), 'utf8'));
    expect(keyFile.protection).toBe('os-keystore');

    const second = service(keystore);
    expect(second.start().state).toBe('open');
    expect(second.db()!.prepare("SELECT value FROM meta WHERE key = 'created_with'").get()).toEqual({
      value: '0.0.3',
    });
    second.close();
  });

  it('asks for a passphrase when no OS keystore exists, then locks on the next start', async () => {
    const keystore = fakeKeystore(false);
    const first = service(keystore);
    expect(first.start()).toMatchObject({ state: 'setup-required' });
    expect(first.db()).toBeNull();
    // Use fast parameters through the public API by sealing via setupPassphrase (production params) once.
    await first.setupPassphrase('correct horse battery staple');
    expect(first.getStatus()).toMatchObject({ state: 'open', protection: 'passphrase' });
    first.close();

    const second = service(keystore);
    expect(second.start()).toEqual({ state: 'locked' });
    await expect(second.unlock('nope nope nope nope')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(second.getStatus()).toEqual({ state: 'locked' });
    await second.unlock('correct horse battery staple');
    expect(second.getStatus().state).toBe('open');
    second.close();
  }, 20_000);

  it('reports a locked keyring instead of overwriting data', () => {
    const keystore = fakeKeystore();
    const first = service(keystore);
    first.start();
    first.close();
    keystore.broken = true;
    const s = service(keystore);
    expect(s.start()).toMatchObject({ state: 'error', code: 'keystore-unavailable' });
    expect(existsSync(join(dir, 'river.db'))).toBe(true);
  });

  it('never replaces a damaged key file', () => {
    writeFileSync(join(dir, 'database.key'), '{ broken');
    const s = service(fakeKeystore());
    expect(s.start()).toMatchObject({ state: 'error', code: 'corrupt' });
    expect(readFileSync(join(dir, 'database.key'), 'utf8')).toBe('{ broken');
  });

  it('keeps an orphaned database aside rather than deleting it', () => {
    writeFileSync(join(dir, 'river.db'), 'old encrypted bytes');
    const s = service(fakeKeystore());
    expect(s.start().state).toBe('open');
    expect(readdirSync(dir).some((n) => n.startsWith('river.db.orphaned-'))).toBe(true);
    s.close();
  });
});
