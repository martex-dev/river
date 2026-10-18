import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect, type Compilable } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permission } from '@river/protocol';
import { lastMessageTimes, loadCommunity } from '../src/communities/model.ts';
import { migrateToLatest } from '../src/db/database.ts';
import type { Database } from '../src/db/schema.ts';

/**
 * Speed on big servers: the queries every request, every message and every page of history run
 * read by index, and give the same answers as before (scripts/perf/server-db.ts times them).
 */

let sqlite: SQLite.Database;
let db: Kysely<Database>;

beforeEach(async () => {
  sqlite = new SQLite(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
  await migrateToLatest(db);
  sqlite.exec(`
    INSERT INTO communities (id, owner, meta, created_on) VALUES ('c', 'owner', 'm', '2026-01-01');
    INSERT INTO channels (id, community_id, kind, name, position) VALUES
      ('a', 'c', 'text', 'n', 0), ('b', 'c', 'text', 'n', 1), ('empty', 'c', 'text', 'n', 2);
    INSERT INTO roles (id, community_id, name, color, permissions, position) VALUES
      ('c', 'c', '', 0, ${Permission.VIEW_CHANNELS}, 0), ('r1', 'c', 'n', 0, 0, 1), ('r2', 'c', 'n', 0, 0, 2);
    INSERT INTO community_members (community_id, river_id, role, profile, joined_on) VALUES
      ('c', 'owner', 'owner', 'p', '2026-01-01'), ('c', 'm1', 'member', 'p', '2026-01-01'),
      ('c', 'm2', 'member', 'p', '2026-01-01');
    INSERT INTO member_roles (community_id, river_id, role_id, expires_at) VALUES
      ('c', 'm1', 'r2', NULL), ('c', 'm1', 'r1', '2999-01-01T00:00:00.000Z'), ('c', 'm2', 'r1', NULL);
    INSERT INTO messages (id, channel_id, sender, body, sent_at, pinned, thread_id) VALUES
      ('m-1', 'a', 'm1', 'x', '2026-01-01T00:00:01.000Z', 0, NULL),
      ('m-2', 'a', 'm1', 'x', '2026-01-01T00:00:05.000Z', 0, NULL),
      ('m-3', 'a', 'm1', 'x', '2026-01-01T00:00:09.000Z', 0, 'm-2'),
      ('m-4', 'b', 'm1', 'x', '2026-01-01T00:00:03.000Z', 0, NULL);
  `);
});

afterEach(async () => {
  await db.destroy();
});

function plan(q: Compilable): string {
  const c = q.compile();
  return (
    sqlite.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all(...(c.parameters as unknown[])) as Array<{
      detail: string;
    }>
  )
    .map((r) => r.detail)
    .join('\n');
}

describe('hot server queries', () => {
  it('newest-message times: per channel, thread replies included, channels without messages left out', async () => {
    const last = await lastMessageTimes(db, ['a', 'b', 'empty']);
    expect([...last.entries()].sort()).toEqual([
      ['a', '2026-01-01T00:00:09.000Z'],
      ['b', '2026-01-01T00:00:03.000Z'],
    ]);
    expect(await lastMessageTimes(db, [])).toEqual(new Map());
  });

  it('a community keeps every member with their roles in order, and finds members by ID', async () => {
    const model = (await loadCommunity(db, 'c'))!;
    const members = model.members
      .map((m) => [m.riverId, [...m.roles].sort(), m.roleExpiry] as const)
      .sort((x, y) => x[0].localeCompare(y[0]));
    expect(members).toEqual([
      ['m1', ['r1', 'r2'], { r1: '2999-01-01T00:00:00.000Z' }],
      ['m2', ['r1'], {}],
      ['owner', [], {}],
    ]);
    expect(model.member('m2')?.riverId).toBe('m2');
    expect(model.member('nobody')).toBeUndefined();
    expect(model.can('m1', Permission.VIEW_CHANNELS, 'a')).toBe(true);
    expect(model.can('nobody', Permission.VIEW_CHANNELS, 'a')).toBe(false);
  });

  it('opening a community reads its channels and roles by community', () => {
    expect(
      plan(db.selectFrom('channels').selectAll().where('community_id', '=', 'c').orderBy('position')),
    ).toBe('SEARCH channels USING INDEX channels_by_community (community_id=?)');
    expect(plan(db.selectFrom('roles').selectAll().where('community_id', '=', 'c').orderBy('position'))).toBe(
      'SEARCH roles USING INDEX roles_by_community (community_id=?)',
    );
  });

  it('a page of channel history starts at its cursor and needs no sorting', () => {
    const page = db
      .selectFrom('messages')
      .selectAll()
      .where('channel_id', '=', 'a')
      .where('thread_id', 'is', null)
      .where('sent_at', '<=', '2026-01-01T00:00:05.000Z')
      .where((eb) =>
        eb.or([
          eb('sent_at', '<', '2026-01-01T00:00:05.000Z'),
          eb.and([eb('sent_at', '=', '2026-01-01T00:00:05.000Z'), eb('id', '<', 'zzzzzzzzzzzzzzzzzzzzzz')]),
        ]),
      )
      .orderBy('sent_at', 'desc')
      .orderBy('id', 'desc')
      .limit(50);
    expect(plan(page)).toBe(
      'SEARCH messages USING INDEX messages_channel_page (channel_id=? AND thread_id=? AND sent_at<?)',
    );
  });
});
