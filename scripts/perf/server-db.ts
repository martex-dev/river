/**
 * Benchmark: the server's hot queries on SQLite with a big server.
 *
 *   node scripts/perf/server-db.ts [messages=100000] [members=1000] [communities=300]
 *
 * Seeds one big community (members, roles, 20 channels, one channel with `messages` messages of
 * which a tenth are thread replies, reactions) among many small ones, and a mailbox of 50 000
 * envelopes, then prints each hot query's plan (EXPLAIN QUERY PLAN) and median time: opening a
 * community (every request does), the community list's newest-message times, a page of channel
 * history (newest and deep), a thread page and a mailbox page. Everything stays in memory.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect, type Compilable } from 'kysely';
import { lastMessageTimes, loadCommunity, loadMessages } from '../../apps/server/src/communities/model.ts';
import { migrateToLatest } from '../../apps/server/src/db/database.ts';
import type { Database } from '../../apps/server/src/db/schema.ts';
import { Permission } from '../../packages/protocol/src/permissions.ts';

const [messagesArg, membersArg, communitiesArg] = process.argv.slice(2).map(Number);
const MESSAGES = messagesArg || 100_000;
const MEMBERS = membersArg || 1000;
const COMMUNITIES = communitiesArg || 300;
const PAGE = 50;

const sqlite = new SQLite(':memory:');
sqlite.pragma('foreign_keys = ON');
const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
await migrateToLatest(db);

const id22 = (): string => randomBytes(16).toString('base64url');
const t0 = performance.now();
const big = id22();
const channels: string[] = [];
const me = randomUUID();
sqlite.transaction(() => {
  const community = sqlite.prepare(
    `INSERT INTO communities (id, owner, meta, created_on) VALUES (?, ?, 'sealed', '2026-01-01')`,
  );
  const channel = sqlite.prepare(
    `INSERT INTO channels (id, community_id, kind, name, position) VALUES (?, ?, 'text', 'sealed', ?)`,
  );
  const role = sqlite.prepare(
    `INSERT INTO roles (id, community_id, name, color, permissions, position) VALUES (?, ?, 'sealed', 0, 0, ?)`,
  );
  const member = sqlite.prepare(
    `INSERT INTO community_members (community_id, river_id, role, profile, joined_on) VALUES (?, ?, 'member', ?, '2026-01-01')`,
  );
  // Many small communities: the channel and role tables are shared by all of them.
  for (let c = 0; c < COMMUNITIES; c++) {
    const cid = id22();
    community.run(cid, randomUUID());
    for (let k = 0; k < 10; k++) channel.run(id22(), cid, k);
    for (let k = 0; k < 5; k++) role.run(id22(), cid, k);
    for (let k = 0; k < 5; k++) member.run(cid, randomUUID(), 'sealed profile');
  }
  community.run(big, me);
  for (let k = 0; k < 20; k++) {
    const ch = id22();
    channels.push(ch);
    channel.run(ch, big, k);
  }
  const roles = Array.from({ length: 30 }, (_, k) => {
    const r = id22();
    role.run(r, big, k);
    return r;
  });
  const memberRole = sqlite.prepare(
    `INSERT INTO member_roles (community_id, river_id, role_id) VALUES (?, ?, ?)`,
  );
  const profile = 'x'.repeat(600); // a sealed profile is a few hundred bytes of ciphertext
  member.run(big, me, profile);
  for (let m = 1; m < MEMBERS; m++) {
    const who = randomUUID();
    member.run(big, who, profile);
    memberRole.run(big, who, roles[m % roles.length]);
    if (m % 3 === 0) memberRole.run(big, who, roles[(m + 7) % roles.length]);
  }
  const message = sqlite.prepare(
    `INSERT INTO messages (id, channel_id, sender, body, sent_at, pinned, thread_id) VALUES (?, ?, ?, ?, ?, 0, ?)`,
  );
  const thread = sqlite.prepare(
    `INSERT INTO threads (id, channel_id, name, creator, created_at) VALUES (?, ?, 'sealed', ?, ?)`,
  );
  const reaction = sqlite.prepare(
    `INSERT INTO message_reactions (message_id, river_id, tag, emoji) VALUES (?, ?, ?, 'sealed')`,
  );
  const body = 'y'.repeat(300);
  const start = Date.parse('2026-01-01T00:00:00Z');
  let lastThread: string | null = null;
  for (let i = 0; i < MESSAGES; i++) {
    const mid = id22();
    const at = new Date(start + i * 1000).toISOString();
    const inThread = lastThread && i % 10 === 0 ? lastThread : null;
    message.run(mid, channels[0], me, body, at, inThread);
    if (i % 500 === 0) {
      thread.run(mid, channels[0], me, at);
      lastThread = mid;
    }
    if (i % 10 === 1) reaction.run(mid, me, 'tag');
    // The other channels get some messages too.
    if (i % 100 === 0) message.run(id22(), channels[1 + (i % 19)], me, body, at, null);
  }
  const envelope = sqlite.prepare(
    `INSERT INTO mailbox (id, recipient, recipient_device, sender, sender_device, type, body, received_at, size)
     VALUES (?, ?, 1, ?, 1, 1, ?, ?, 400)`,
  );
  const others = Array.from({ length: 500 }, () => randomUUID());
  for (let i = 0; i < 50_000; i++) {
    const at = new Date(start + Math.floor(i / 3) * 1000).toISOString(); // several share a time
    envelope.run(
      id22(),
      i % 25 === 0 ? me : others[i % others.length],
      others[(i * 7) % others.length],
      'z'.repeat(400),
      at,
    );
  }
})();
const seedMs = performance.now() - t0;

async function median(fn: () => Promise<unknown>, runs = 15): Promise<number> {
  await fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

function plan(q: Compilable): string {
  const c = q.compile();
  return (
    sqlite.prepare(`EXPLAIN QUERY PLAN ${c.sql}`).all(...(c.parameters as unknown[])) as Array<{
      detail: string;
    }>
  )
    .map((r) => `      ${r.detail}`)
    .join('\n');
}

const messageRows = () => db.selectFrom('messages').selectAll();
const channelPage = (before?: { at: string; id: string }) => {
  let q = messageRows().where('channel_id', '=', channels[0]!).where('thread_id', 'is', null);
  // As the route does (apps/server/src/routes/communities.ts, beforeCursor); RIVER_PERF_OLD_CURSOR=1
  // leaves out the range hint, as 2.20 did.
  if (before) {
    if (!process.env.RIVER_PERF_OLD_CURSOR) q = q.where('sent_at', '<=', before.at);
    q = q.where((eb) =>
      eb.or([
        eb('sent_at', '<', before.at),
        eb.and([eb('sent_at', '=', before.at), eb('id', '<', before.id)]),
      ]),
    );
  }
  return q.orderBy('sent_at', 'desc').orderBy('id', 'desc').limit(PAGE);
};
const deep = (await messageRows()
  .where('channel_id', '=', channels[0]!)
  .where('thread_id', 'is', null)
  .orderBy('sent_at')
  .limit(1)
  .offset(Math.floor(MESSAGES / 4))
  .executeTakeFirstOrThrow()) as { sent_at: string; id: string };
const someThread = (await db.selectFrom('threads').select('id').limit(1).offset(50).executeTakeFirstOrThrow())
  .id;
const threadPage = () =>
  messageRows()
    .where('thread_id', '=', someThread)
    .orderBy('sent_at', 'desc')
    .orderBy('id', 'desc')
    .limit(PAGE);
const mailboxPage = () =>
  db
    .selectFrom('mailbox')
    .selectAll()
    .where('recipient', '=', me)
    .where('recipient_device', '=', 1)
    .orderBy('received_at')
    .orderBy('id')
    .limit(101);
const allChannels = (
  await db.selectFrom('channels').select('id').where('community_id', '=', big).execute()
).map((r) => r.id);

const rows: Array<[string, number, string]> = [
  [
    'open a community (every request)',
    await median(() => loadCommunity(db, big)),
    plan(db.selectFrom('channels').selectAll().where('community_id', '=', big).orderBy('position')),
  ],
  [
    'who may see a new message (every member)',
    await (async () => {
      const model = (await loadCommunity(db, big))!;
      return median(async () =>
        model.members.filter((m) => model.can(m.riverId, Permission.VIEW_CHANNELS, channels[0])),
      );
    })(),
    '',
  ],
  ['newest-message times (community list)', await median(() => lastMessageTimes(db, allChannels)), ''],
  [
    'channel history, newest page',
    await median(async () => loadMessages(db, await channelPage().execute())),
    plan(channelPage()),
  ],
  [
    'channel history, deep page',
    await median(async () =>
      loadMessages(db, await channelPage({ at: deep.sent_at, id: deep.id }).execute()),
    ),
    plan(channelPage({ at: deep.sent_at, id: deep.id })),
  ],
  [
    'thread page',
    await median(async () => loadMessages(db, await threadPage().execute())),
    plan(threadPage()),
  ],
  ['mailbox page', await median(() => mailboxPage().execute()), plan(mailboxPage())],
];

console.log(
  `River server (SQLite): ${COMMUNITIES} small communities, one with ${MEMBERS} members and ${MESSAGES} messages, 50000 mailbox envelopes (seeded in ${seedMs.toFixed(0)} ms)`,
);
for (const [name, ms, p] of rows) {
  console.log(`  ${name.padEnd(40)} ${ms.toFixed(2).padStart(8)} ms`);
  if (p) console.log(p);
}
await db.destroy();
