import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatFingerprint, identityFingerprint } from '@river/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IdentityService, displayNameSchema } from '../src/main/identity/identity-service.ts';
import { migrateDatabase, type LocalDatabase } from '../src/main/storage/database.ts';
import { newDatabaseKey } from '../src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../src/main/storage/migrations.ts';

let dir: string;
let db: LocalDatabase;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-identity-'));
  db = migrateDatabase(join(dir, 'river.db'), newDatabaseKey(), CLIENT_MIGRATIONS).db;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('IdentityService', () => {
  it('creates one identity and exposes only public material', () => {
    const service = new IdentityService(
      () => db,
      () => new Date('2026-10-08T12:00:00Z'),
    );
    expect(service.get()).toBeNull();
    const info = service.create('  Alex  ');
    expect(info.displayName).toBe('Alex');
    expect(info.createdAt).toBe('2026-10-08T12:00:00.000Z');
    expect(info.words).toHaveLength(16);
    expect(Object.keys(info).sort()).toEqual(['createdAt', 'displayName', 'fingerprint', 'riverId', 'words']);

    const row = db.prepare('SELECT public_key, private_key FROM identity').get() as {
      public_key: Uint8Array;
      private_key: Uint8Array;
    };
    expect(row.private_key).toHaveLength(32);
    expect(Buffer.from(row.private_key).some((b) => b !== 0)).toBe(true);
    expect(info.fingerprint).toBe(formatFingerprint(identityFingerprint(new Uint8Array(row.public_key))));
    expect(JSON.stringify(info)).not.toContain(Buffer.from(row.private_key).toString('hex'));
    expect(() => service.create('Mallory')).toThrow(/already exists/);
  });

  it('never writes the private key to disk in plaintext', () => {
    const service = new IdentityService(() => db);
    service.create('Alex');
    const priv = (db.prepare('SELECT private_key FROM identity').get() as { private_key: Uint8Array })
      .private_key;
    const file = readFileSync(join(dir, 'river.db'));
    expect(file.includes(Buffer.from(priv))).toBe(false);
  });

  it('refuses to work without open storage', () => {
    const service = new IdentityService(() => null);
    expect(service.get()).toBeNull();
    expect(() => service.create('x')).toThrow(/not open/);
  });

  it('normalises and limits display names', () => {
    expect(displayNameSchema.parse('  A \n  B ')).toBe('A B');
    expect(displayNameSchema.parse('   ')).toBeNull();
    expect(() => displayNameSchema.parse('x'.repeat(65))).toThrow();
    expect(() => displayNameSchema.parse(42)).toThrow();
    const service = new IdentityService(() => db);
    service.create('');
    expect(service.get()!.displayName).toBeNull();
    expect(service.setDisplayName('Sam').displayName).toBe('Sam');
  });
});
