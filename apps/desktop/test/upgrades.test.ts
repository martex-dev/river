import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '../src/main/storage/database.ts';
import { newDatabaseKey } from '../src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../src/main/storage/migrations.ts';

/**
 * Every released River must upgrade cleanly to this one, keeping the user's
 * data. These tests write databases the way older versions did (by running
 * only their migrations), fill them, then upgrade.
 */
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-upgrade-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

/** Schema version that each release shipped. */
const RELEASES: Array<[string, number]> = [
  ['0.0.3', 1],
  ['0.0.4', 2],
  ['0.1.0', 3],
  ['0.2.0', 4],
  ['0.3.0', 5],
  ['0.5.0', 6],
  ['0.6.0', 8],
  ['0.7.0', 9],
];

function databaseFrom(version: number) {
  const path = join(dir, `v${version}.db`);
  const key = newDatabaseKey();
  const old = migrateDatabase(
    path,
    key,
    CLIENT_MIGRATIONS.filter((m) => m.version <= version),
  ).db;
  return { path, key, old };
}

describe('upgrading from every release', () => {
  it.each(RELEASES)('a database from %s (schema v%i) upgrades to the latest schema', (_release, version) => {
    const { path, key, old } = databaseFrom(version);
    const now = new Date().toISOString();
    if (version >= 2) {
      old
        .prepare(
          'INSERT INTO identity (id, river_id, public_key, private_key, registration_id, display_name, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)',
        )
        .run('a3f1c2d4-1111-4222-8333-944455556666', randomBytes(33), randomBytes(32), 42, 'Alex', now);
    }
    const communityKey = randomBytes(32);
    if (version >= 4) {
      old
        .prepare('INSERT INTO communities (id, key, joined_at) VALUES (?, ?, ?)')
        .run('AAAAAAAAAAAAAAAAAAAAAA', communityKey, now);
      if (version >= 7) {
        // From 0.6.0 on, River also records each key with its epoch.
        old
          .prepare('INSERT INTO community_keys (community_id, epoch, key, added_at) VALUES (?, 0, ?, ?)')
          .run('AAAAAAAAAAAAAAAAAAAAAA', communityKey, now);
      }
    }
    if (version >= 6) {
      old
        .prepare(
          "INSERT INTO contacts (river_id, name, avatar, state, created_at) VALUES ('b3f1c2d4-1111-4222-8333-944455556666', 'Sam', NULL, 'accepted', ?)",
        )
        .run(now);
      old
        .prepare(
          "INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions) VALUES ('BBBBBBBBBBBBBBBBBBBBBB', 'b3f1c2d4-1111-4222-8333-944455556666', 'b3f1c2d4-1111-4222-8333-944455556666', '{\"text\":\"hi\"}', ?, 'received', '{}')",
        )
        .run(now);
    }
    old.close();

    const { db, outcome } = migrateDatabase(path, key, CLIENT_MIGRATIONS);
    try {
      expect(outcome.to).toBe(CLIENT_MIGRATIONS.at(-1)!.version);
      if (version >= 2) {
        expect(db.prepare('SELECT display_name FROM identity').get()).toEqual({ display_name: 'Alex' });
      }
      if (version >= 4) {
        // Community keys from before key epochs became epoch 0.
        const row = db.prepare('SELECT epoch, key FROM community_keys').get() as {
          epoch: number;
          key: Buffer;
        };
        expect(row.epoch).toBe(0);
        expect(Buffer.from(row.key).equals(communityKey)).toBe(true);
      }
      if (version >= 6) {
        expect(db.prepare('SELECT name, bio FROM contacts').get()).toEqual({ name: 'Sam', bio: null });
        expect(db.prepare('SELECT body FROM dm_messages').get()).toEqual({ body: '{"text":"hi"}' });
      }
      // Every table the current version needs exists.
      const tables = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
      ).map((t) => t.name);
      for (const t of [
        'identity',
        'account',
        'community_keys',
        'contacts',
        'dm_groups',
        'posts',
        'signal_store',
      ]) {
        expect(tables).toContain(t);
      }
    } finally {
      db.close();
    }
  });
});
