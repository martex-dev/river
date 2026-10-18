/**
 * Benchmark: the desktop's (and phone core's) local database with a big account.
 *
 *   node scripts/perf/desktop-db.ts [contacts=300] [groups=30] [messages=100000]
 *
 * Seeds a fresh SQLCipher database with that many direct chats, groups of 32 and messages (half
 * of them in one busy chat), then times what the app does at start and on every new message:
 * opening the database, the chat list (DmService.conversations), one chat's latest 500 messages,
 * a search, the disappearing-message and history sweeps. Prints medians in milliseconds.
 * Nothing leaves this computer; the temporary directory is removed afterwards.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import type { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';

const [contactsArg, groupsArg, messagesArg] = process.argv.slice(2).map(Number);
const CONTACTS = contactsArg || 300;
const GROUPS = groupsArg || 30;
const MESSAGES = messagesArg || 100_000;

/** Counts statement runs (get, all, run) while `fn` runs. */
function patchStatements(db: { prepare(sql: string): object }): { count(): number; restore(): void } {
  const proto = Object.getPrototypeOf(db.prepare('SELECT 1')) as Record<string, (...a: unknown[]) => unknown>;
  const saved = { get: proto.get!, all: proto.all!, run: proto.run! };
  let n = 0;
  for (const k of ['get', 'all', 'run'] as const) {
    proto[k] = function (this: unknown, ...args: unknown[]) {
      n++;
      return saved[k].apply(this, args);
    };
  }
  return { count: () => n, restore: () => Object.assign(proto, saved) };
}
let countDb: { prepare(sql: string): object } | null = null;
function countQueries(fn: () => unknown): number {
  const p = patchStatements(countDb!);
  try {
    fn();
    return p.count();
  } finally {
    p.restore();
  }
}
async function countQueriesAsync(fn: () => Promise<unknown>): Promise<number> {
  const p = patchStatements(countDb!);
  try {
    await fn();
    return p.count();
  } finally {
    p.restore();
  }
}

function median(fn: () => unknown, runs = 9): number {
  fn(); // warm-up (prepared statements, page cache)
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

const dir = mkdtempSync(join(tmpdir(), 'river-perf-'));
try {
  const key = newDatabaseKey();
  const path = join(dir, 'river.db');
  let db = migrateDatabase(path, key, CLIENT_MIGRATIONS).db;
  const identity = new IdentityService(() => db);
  const me = identity.create('Me').riverId;
  const account = {
    status: () => ({ state: 'none' }),
    hasOtherDevices: () => false,
  } as unknown as AccountService;
  const community = {
    onServerEvent: () => () => undefined,
    setKeyChannel: () => undefined,
    knownProfile: () => null,
    communityIdentityKey: () => null,
    forgetAttachment: async () => undefined,
  } as unknown as CommunityService;

  // ---- seed ----
  const t0 = performance.now();
  const people = Array.from({ length: CONTACTS }, () => randomUUID());
  const groups = Array.from({ length: GROUPS }, () => randomBytes(16).toString('base64url'));
  const start = Date.parse('2026-01-01T00:00:00Z');
  db.transaction(() => {
    const contact = db.prepare(
      `INSERT INTO contacts (river_id, name, avatar, state, created_at, last_read, heard_from)
       VALUES (?, ?, NULL, 'accepted', ?, ?, 1)`,
    );
    people.forEach((p, i) =>
      contact.run(
        p,
        `Person ${i}`,
        new Date(start).toISOString(),
        new Date(start + MESSAGES * 30_000).toISOString(),
      ),
    );
    const group = db.prepare(
      `INSERT INTO dm_groups (id, name, members, admins, profiles, state, created_at, last_read)
       VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?)`,
    );
    groups.forEach((g, i) => {
      const members = [me, ...people.slice(i, i + 31)];
      const profiles = Object.fromEntries(members.map((m, j) => [m, { name: `Member ${j}`, avatar: null }]));
      group.run(
        g,
        `Group ${i}`,
        JSON.stringify(members),
        JSON.stringify([me]),
        JSON.stringify(profiles),
        new Date(start).toISOString(),
        new Date(start + MESSAGES * 30_000).toISOString(),
      );
    });
    const message = db.prepare(
      `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions, received_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'received', '{}', ?, ?)`,
    );
    const convs = [...people, ...groups];
    for (let i = 0; i < MESSAGES; i++) {
      // Half of all messages in one busy chat, the rest spread over every chat.
      const peer = i % 2 === 0 ? people[0]! : convs[(i >> 1) % convs.length]!;
      const sender = i % 3 === 0 ? me : peer.length === 22 ? people[i % CONTACTS]! : peer;
      const at = new Date(start + i * 60_000).toISOString();
      const expires = i % 50 === 0 ? new Date(start + MESSAGES * 120_000).toISOString() : null;
      message.run(
        randomBytes(16).toString('base64url'),
        peer,
        sender,
        JSON.stringify({ text: `Message number ${i} with a few words in it` }),
        at,
        at,
        expires,
      );
    }
  })();
  const seedMs = performance.now() - t0;

  const dm = new DmService({
    db: () => db,
    identity,
    account,
    community,
    log: nullLogger,
    keep: () => ({ historyDays: 3650, newChatTimer: 0 }),
  });
  const action = (a: Record<string, unknown>): Promise<unknown> =>
    dm.action(a as Parameters<DmService['action']>[0]);

  // ---- measure ----
  db.close();
  const openMs = median(() => {
    db = migrateDatabase(path, key, CLIENT_MIGRATIONS).db;
    db.close();
  }, 5);
  db = migrateDatabase(path, key, CLIENT_MIGRATIONS).db;
  countDb = db;

  const results: Array<[string, number]> = [
    ['open + migrate database', openMs],
    ['chat list (conversations)', median(() => dm.conversations())],
  ];
  let t = performance.now();
  for (let i = 0; i < 5; i++) await action({ a: 'messages', peer: people[0] });
  results.push(['busy chat, latest 500 messages', (performance.now() - t) / 5]);
  t = performance.now();
  for (let i = 0; i < 5; i++) await action({ a: 'messages', peer: groups[0] });
  results.push(['group chat, latest messages', (performance.now() - t) / 5]);
  t = performance.now();
  for (let i = 0; i < 3; i++) await action({ a: 'search', query: 'number 4242' });
  results.push(['search all chats', (performance.now() - t) / 3]);
  results.push(['disappearing-message sweep (every 15 s)', median(() => dm.sweepExpired(new Date(start)))]);
  results.push(['history sweep (every 5 min)', median(() => dm.sweepHistory(new Date(start)))]);

  console.log(
    `River local database: ${CONTACTS} chats, ${GROUPS} groups of 32, ${MESSAGES} messages (seeded in ${seedMs.toFixed(0)} ms)`,
  );
  for (const [name, ms] of results) console.log(`  ${name.padEnd(42)} ${ms.toFixed(2).padStart(9)} ms`);
  // On phones every query is a synchronous native call, so the number of queries matters most there.
  console.log('Queries (each one a native call on a phone):');
  console.log(`  ${'chat list'.padEnd(42)} ${String(countQueries(() => dm.conversations())).padStart(9)}`);
  console.log(
    `  ${'busy chat, latest 500 messages'.padEnd(42)} ${String(await countQueriesAsync(() => action({ a: 'messages', peer: people[0] }))).padStart(9)}`,
  );
  console.log(
    `  ${'group chat, latest messages'.padEnd(42)} ${String(await countQueriesAsync(() => action({ a: 'messages', peer: groups[0] }))).padStart(9)}`,
  );
  db.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
