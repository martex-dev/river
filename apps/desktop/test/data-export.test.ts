import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExport, readBody } from '../src/main/data-export.ts';
import { migrateDatabase, type LocalDatabase } from '../src/main/storage/database.ts';
import { newDatabaseKey } from '../src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../src/main/storage/migrations.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

let dir = '';
let db: LocalDatabase | null = null;
afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('export my data', () => {
  it('reads message bodies in either format', () => {
    expect(readBody(JSON.stringify({ text: 'hi', attachments: [{ name: 'a.png' }, {}] }))).toEqual({
      text: 'hi',
      files: ['a.png'],
    });
    expect(readBody('plain old text')).toEqual({ text: 'plain old text', files: [] });
  });

  it('contains what you can read and never your keys', () => {
    dir = mkdtempSync(join(tmpdir(), 'river-export-'));
    db = migrateDatabase(join(dir, 'x.db'), newDatabaseKey(), CLIENT_MIGRATIONS).db;
    const secret = Buffer.from('PRIVATE-KEY-BYTES-DO-NOT-EXPORT');
    db.prepare(
      'INSERT INTO identity (id, river_id, public_key, private_key, registration_id, display_name, created_at) VALUES (1, ?, ?, ?, 1, ?, ?)',
    ).run('me-id', Buffer.from('pub'), secret, 'Ana', '2026-10-01T00:00:00Z');
    db.prepare('INSERT INTO communities (id, key, joined_at) VALUES (?, ?, ?)').run(
      'c1',
      secret,
      '2026-10-02T00:00:00Z',
    );
    db.prepare(
      "INSERT INTO contacts (river_id, name, state, created_at) VALUES ('bob', 'Bob', 'accepted', '2026-10-03')",
    ).run();
    db.prepare(
      "INSERT INTO dm_messages (id, peer, sender, body, sent_at, status) VALUES ('m1', 'bob', 'me-id', ?, '2026-10-04', 'sent')",
    ).run(JSON.stringify({ text: 'hello Bob' }));
    db.prepare(
      "INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, deleted) VALUES ('m2', 'bob', 'bob', 'gone', '2026-10-05', 'sent', 1)",
    ).run();
    const out = buildExport(db, DEFAULT_SETTINGS, '1.0.23', new Date('2026-10-12T00:00:00Z'));
    expect(out.you).toMatchObject({ riverId: 'me-id', name: 'Ana' });
    expect(out.directMessages).toEqual([
      {
        with: 'bob',
        withName: 'Bob',
        messages: [{ from: 'you', text: 'hello Bob', sentAt: '2026-10-04', editedAt: null, files: [] }],
      },
    ]);
    expect(out.communities).toEqual([{ id: 'c1', joinedAt: '2026-10-02T00:00:00Z', nickname: null }]);
    const text = JSON.stringify(out);
    expect(text).not.toContain('PRIVATE-KEY');
    expect(text).not.toContain(secret.toString('base64'));
    expect(text).not.toContain('gone');
  });
});
