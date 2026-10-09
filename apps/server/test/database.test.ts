import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';
import type { Database } from '../src/db/schema.ts';

const dir = mkdtempSync(join(tmpdir(), 'river-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the shared suite against SQLite always, and PostgreSQL when RIVER_TEST_POSTGRES_URL is set (CI). */
const targets: Array<[string, () => RiverDatabase]> = [
  [
    'sqlite file',
    () => openDatabase(`sqlite:${join(dir, `t-${Math.random().toString(36).slice(2)}.sqlite`)}`),
  ],
];
const pgUrl = process.env.RIVER_TEST_POSTGRES_URL;
if (pgUrl) targets.push(['postgres', () => openDatabase(pgUrl)]);

async function reset(db: Kysely<Database>): Promise<void> {
  for (const t of [
    'attachments',
    'signed_prekeys',
    'prekeys',
    'kyber_prekeys',
    'mailbox',
    'blocks',
    'message_reactions',
    'bans',
    'channel_overwrites',
    'category_overwrites',
    'audit_log',
    'member_roles',
    'roles',
    'messages',
    'invites',
    'channels',
    'categories',
    'community_members',
    'communities',
    'sessions',
    'devices',
    'accounts',
    'auth_challenges',
    'server_meta',
    'schema_migrations',
    'schema_migrations_lock',
  ]) {
    await sql`drop table if exists ${sql.table(t)}`.execute(db);
  }
}

describe.each(targets)('migrations on %s', (_name, open) => {
  it('migrates an empty database to the latest schema, idempotently', async () => {
    const database = open();
    try {
      await reset(database.db);
      const first = await migrateToLatest(database.db);
      expect(first.results?.map((r) => r.migrationName)).toEqual(Object.keys(MIGRATIONS));
      const second = await migrateToLatest(database.db);
      expect(second.results).toEqual([]);

      const row = await database.db
        .selectFrom('server_meta')
        .select('value')
        .where('key', '=', 'instance_id')
        .executeTakeFirstOrThrow();
      expect(row.value).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await database.close();
    }
  });

  it('rolls back a failing migration without leaving partial state', async () => {
    const database = open();
    try {
      await reset(database.db);
      await migrateToLatest(database.db);
      const broken: Migration = {
        up: async (db) => {
          await db.schema.createTable('half_done').addColumn('id', 'integer').execute();
          throw new Error('boom');
        },
      };
      await expect(migrateToLatest(database.db, { ...MIGRATIONS, '9999_broken': broken })).rejects.toThrow(
        'boom',
      );
      const tables = (await database.db.introspection.getTables()).map((t) => t.name);
      expect(tables).not.toContain('half_done');
      // The good migrations remain applied.
      expect(tables).toContain('server_meta');
    } finally {
      await database.close();
    }
  });
});

describe('openDatabase', () => {
  it('supports in-memory SQLite and rejects unknown URLs', async () => {
    const mem = openDatabase('sqlite::memory:');
    await migrateToLatest(mem.db);
    await mem.close();
    expect(() => openDatabase('mysql://nope')).toThrow(/Unsupported/);
  });
});
