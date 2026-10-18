import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountService } from '../src/main/account/account-service.ts';
import type { CommunityService } from '../src/main/community/community-service.ts';
import { DmService } from '../src/main/dm/dm-service.ts';
import { IdentityService } from '../src/main/identity/identity-service.ts';
import { nullLogger } from '../src/main/logger.ts';
import { migrateDatabase, statement, type LocalDatabase } from '../src/main/storage/database.ts';
import { newDatabaseKey } from '../src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../src/main/storage/migrations.ts';

/**
 * Speed with big accounts: the chat list is built again on every new message, so it must not
 * cost two queries per chat (seconds with hundreds of chats on a phone, where every query is a
 * native call). These tests pin the results and the number of queries.
 */

let dir: string;
let db: LocalDatabase;
let me: string;
let dm: DmService;

const account = {
  status: () => ({ state: 'none' }),
  hasOtherDevices: () => false,
} as unknown as AccountService;
const community = {
  onServerEvent: () => () => undefined,
  setKeyChannel: () => undefined,
  knownProfile: (id: string) =>
    id.startsWith('0000') ? { name: 'Known from a community', avatar: 'k' } : null,
  communityIdentityKey: () => null,
  forgetAttachment: async () => undefined,
} as unknown as CommunityService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-speed-'));
  db = migrateDatabase(join(dir, 'river.db'), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  const identity = new IdentityService(() => db);
  me = identity.create('Me').riverId;
  dm = new DmService({ db: () => db, identity, account, community, log: nullLogger });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function contact(id: string, name: string | null, lastRead: string | null = null): void {
  db.prepare(
    `INSERT INTO contacts (river_id, name, avatar, state, created_at, last_read, heard_from)
     VALUES (?, ?, NULL, 'accepted', '2026-01-01T00:00:00.000Z', ?, 1)`,
  ).run(id, name, lastRead);
}

function group(
  id: string,
  members: string[],
  profiles: Record<string, { name: string }>,
  lastRead: string | null,
) {
  db.prepare(
    `INSERT INTO dm_groups (id, name, members, admins, profiles, state, created_at, last_read)
     VALUES (?, 'The group', ?, ?, ?, 'accepted', '2026-01-01T00:00:00.000Z', ?)`,
  ).run(id, JSON.stringify(members), JSON.stringify([me]), JSON.stringify(profiles), lastRead);
}

function message(
  peer: string,
  sender: string,
  text: string,
  at: string,
  opts: { deleted?: boolean } = {},
): string {
  const id = randomBytes(16).toString('base64url');
  db.prepare(
    `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions, received_at, deleted)
     VALUES (?, ?, ?, ?, ?, 'received', '{}', ?, ?)`,
  ).run(id, peer, sender, JSON.stringify({ text }), at, at, opts.deleted ? 1 : 0);
  return id;
}

const at = (minute: number): string => new Date(Date.UTC(2026, 0, 2, 0, minute)).toISOString();

describe('chat list with many chats', () => {
  it('shows the same last messages, unread counts and names as reading each chat on its own', () => {
    const ann = randomUUID();
    const bob = randomUUID();
    const known = `0000${randomUUID().slice(4)}`;
    contact(ann, 'Ann', at(5));
    contact(bob, null);
    contact(known, null);
    message(ann, ann, 'old, read', at(1));
    message(ann, ann, 'new one', at(10));
    message(ann, me, 'my reply', at(11));
    message(ann, ann, 'deleted', at(12), { deleted: true });
    // Two messages at the same moment: the one stored last is the chat's last, as before.
    message(bob, bob, 'first at 20', at(20));
    message(bob, bob, 'second at 20', at(20));
    const gid = randomBytes(16).toString('base64url');
    group(gid, [me, ann, bob, known], { [bob]: { name: 'Bob in the group' } }, at(30));
    message(gid, bob, 'before you read', at(29));
    message(gid, bob, 'hello group', at(31));
    message(gid, me, 'mine do not count', at(32));

    const list = dm.conversations();
    const byId = new Map(list.map((c) => [c.riverId, c]));
    expect(byId.get(ann)).toMatchObject({
      name: 'Ann',
      unread: 1,
      last: { text: 'Message deleted', sentAt: at(12), mine: false },
      verified: false,
      keyChanged: false,
    });
    expect(byId.get(bob)).toMatchObject({
      name: `River ${bob.slice(0, 8)}`,
      unread: 2,
      last: { text: 'second at 20', mine: false },
    });
    expect(byId.get(known)).toMatchObject({
      name: 'Known from a community',
      avatar: 'k',
      last: null,
      unread: 0,
    });
    const g = byId.get(gid)!;
    expect(g).toMatchObject({
      kind: 'group',
      unread: 1,
      isAdmin: true,
      last: { text: 'mine do not count', mine: true },
    });
    expect(g.members.map((m) => m.name)).toEqual(['Me', 'Ann', 'Bob in the group', 'Known from a community']);
    // Newest first.
    expect(list.map((c) => c.riverId)).toEqual([gid, bob, ann, known]);
  });

  it('runs the same few queries for 3 chats as for 60', () => {
    const count = (): number => {
      let n = 0;
      const proto = Object.getPrototypeOf(db.prepare('SELECT 1')) as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      const saved = { get: proto.get!, all: proto.all!, run: proto.run! };
      for (const k of ['get', 'all', 'run'] as const) {
        proto[k] = function (this: unknown, ...args: unknown[]) {
          n++;
          return saved[k].apply(this, args);
        };
      }
      try {
        dm.conversations();
      } finally {
        Object.assign(proto, saved);
      }
      return n;
    };
    const add = (k: number): void => {
      for (let i = 0; i < k; i++) {
        const id = randomUUID();
        contact(id, `P${i}`);
        message(id, id, 'hi', at(i));
      }
    };
    add(3);
    dm.conversations();
    const few = count();
    add(57);
    expect(count()).toBe(few);
    expect(few).toBeLessThan(15);
  });

  it('a new message names its chat without building the whole chat list', () => {
    const ann = randomUUID();
    contact(ann, 'Ann');
    const id = message(ann, ann, 'hi', at(1));
    const events: unknown[] = [];
    dm.onEvent((e) => events.push(e));
    (dm as unknown as { emitMessage(id: string, isNew: boolean): void }).emitMessage(id, true);
    expect(events).toEqual([expect.objectContaining({ t: 'message', isNew: true, senderName: 'Ann' })]);
  });
});

describe('local database indexes', () => {
  const plan = (sql: string, ...args: unknown[]): string =>
    (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>)
      .map((r) => r.detail)
      .join('\n');

  it('unread counts read only messages after the read marker', () => {
    expect(
      plan(
        `SELECT COUNT(*) FROM dm_messages WHERE peer = ? AND sender = ? AND COALESCE(received_at, sent_at) > ? AND deleted = 0`,
        'a',
        'a',
        '',
      ),
    ).toContain('dm_messages_unread (peer=? AND <expr>>?)');
  });

  it('the history sweep finds old messages without reading every message', () => {
    expect(
      plan('SELECT id, peer, body FROM dm_messages WHERE COALESCE(received_at, sent_at) < ?', 'x'),
    ).toContain('dm_messages_received');
  });

  it('keeps one prepared statement per connection', () => {
    expect(statement(db, 'SELECT 1 AS one')).toBe(statement(db, 'SELECT 1 AS one'));
    expect(statement(db, 'SELECT 1 AS one').get()).toEqual({ one: 1 });
  });
});
