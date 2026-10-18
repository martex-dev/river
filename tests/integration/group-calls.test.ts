import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
import type { DmEvent } from '../../apps/desktop/src/shared/dm.ts';
import { parseCallLink } from '../../apps/desktop/src/shared/invite-link.ts';
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';

/**
 * Group calls and call links (2.18), between real River clients and a real server: who rings,
 * whose connection setup is accepted, and the "Ask to join" flow of call links. (The media and
 * the server's call rooms: voice-reconnect.test.ts and apps/server/test.)
 */

const SERVER = 'http://127.0.0.1:8787';
let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
const locals: LocalDatabase[] = [];
const communities: CommunityService[] = [];

const injectFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const res = await server.inject({
    method: (init?.method ?? 'GET') as 'GET',
    url: url.pathname + url.search,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    ...(init?.body
      ? { payload: init.body instanceof Uint8Array ? Buffer.from(init.body) : String(init.body) }
      : {}),
  });
  return new Response(res.rawPayload.length ? new Uint8Array(res.rawPayload) : null, {
    status: res.statusCode,
    headers: res.headers as Record<string, string>,
  });
};
const deadSocket = (): WebSocket => ({ send() {}, close() {}, readyState: 0 }) as unknown as WebSocket;

async function person(name: string) {
  const local = migrateDatabase(join(dir, `${name}.db`), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  locals.push(local);
  const identity = new IdentityService(() => local);
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(injectFetch),
    log: nullLogger,
  });
  const community = new CommunityService({
    db: () => local,
    account,
    identity,
    requestJson: createRequestJson(injectFetch),
    requestBytes: createRequestBytes(injectFetch),
    blobDir: () => join(dir, `${name}-blobs`),
    log: nullLogger,
    createSocket: deadSocket,
  });
  communities.push(community);
  const dm = new DmService({ db: () => local, identity, account, community, log: nullLogger });
  const events: DmEvent[] = [];
  dm.onEvent((e) => events.push(e));
  const me = identity.create(name);
  await account.register(SERVER);
  await dm.sync();
  // Rings and call setup travel only to a live connection (never stored); these clients have no
  // sockets, so theirs go through the mailbox instead, as if the others were online.
  const internals = dm as unknown as {
    sendContent(peer: string, content: unknown, ephemeral?: boolean): Promise<void>;
  };
  const send = internals.sendContent.bind(dm);
  internals.sendContent = (peer, content) => send(peer, content, false);
  return { identity, account, dm, community, events, local, riverId: me.riverId, name };
}
type Person = Awaited<ReturnType<typeof person>>;

async function until(fn: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function friends(a: Person, b: Person): Promise<void> {
  await a.dm.action({ a: 'open', peer: b.riverId, name: b.name });
  await a.dm.action({ a: 'send', peer: b.riverId, text: 'hi' });
  await b.dm.sync();
  await b.dm.action({ a: 'accept', peer: a.riverId });
  await a.dm.sync();
}

const CALL = 'C'.repeat(22);
const gcalls = (p: Person) => p.events.filter((e): e is Extract<DmEvent, { t: 'gcall' }> => e.t === 'gcall');
const rings = (p: Person) =>
  p.events.filter(
    (e): e is Extract<DmEvent, { t: 'call' }> => e.t === 'call' && e.kind === 'invite' && !!e.group,
  );

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-gcall-'));
  serverDb = openDatabase('sqlite::memory:');
  await migrateToLatest(serverDb.db);
  server = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
      RIVER_ATTACHMENT_DIR: join(dir, 'blobs'),
    }),
    database: serverDb,
  });
});

afterEach(async () => {
  for (const c of communities.splice(0)) c.stop();
  for (const l of locals.splice(0)) l.close();
  await server.close();
  await serverDb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('group calls (2.18)', { timeout: 60_000 }, () => {
  async function climbers() {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const dave = await person('Dave');
    for (const p of [bob, carol, dave]) await friends(alice, p);
    const group = await alice.dm.action({
      a: 'createGroup',
      name: 'Climb',
      members: [bob.riverId, carol.riverId],
    });
    for (const p of [bob, carol]) await p.dm.sync();
    return { alice, bob, carol, dave, groupId: group.riverId };
  }

  it('rings every other member of the group ("Group call · 3 people"), never anyone else', async () => {
    const { alice, bob, carol, dave, groupId } = await climbers();
    const started = await alice.dm.action({
      a: 'groupCall',
      kind: 'ring',
      callId: CALL,
      groupId,
      video: true,
    });
    expect(started?.allowed.sort()).toEqual([alice.riverId, bob.riverId, carol.riverId].sort());
    for (const p of [bob, carol]) {
      await p.dm.sync();
      expect(rings(p)).toEqual([
        expect.objectContaining({
          peer: alice.riverId,
          callId: CALL,
          video: true,
          group: { id: groupId, name: 'Climb', people: 3 },
        }),
      ]);
      // A window that opens now (from the notification) finds it ringing.
      expect(await p.dm.action({ a: 'pendingCall' })).toMatchObject({ callId: CALL, group: { id: groupId } });
    }
    await dave.dm.sync();
    expect(dave.events.some((e) => e.t === 'call' || e.t === 'gcall')).toBe(false);
    // Only a member of the group may start a call in it.
    await expect(
      dave.dm.action({ a: 'groupCall', kind: 'ring', callId: 'D'.repeat(22), groupId, video: false }),
    ).rejects.toThrow(/not in this group/);
  });

  it('connection setup is accepted only from people in the call, and goes only to them', async () => {
    const { alice, bob, carol, dave, groupId } = await climbers();
    await alice.dm.action({ a: 'groupCall', kind: 'ring', callId: CALL, groupId, video: false });
    await bob.dm.sync();
    const ends: string[] = [];
    bob.dm.onRingEnd((e) => ends.push(e.how));
    const joined = await bob.dm.action({ a: 'groupCall', kind: 'join', callId: CALL, groupId });
    expect(joined?.allowed).toContain(carol.riverId);
    expect(ends).toEqual(['answered']);
    expect(bob.dm.currentGroupCall()).toBe(CALL);

    await bob.dm.action({
      a: 'groupCall',
      kind: 'signal',
      callId: CALL,
      groupId,
      to: [alice.riverId],
      data: { type: 'hello' },
    });
    await alice.dm.sync();
    expect(gcalls(alice).filter((e) => e.kind === 'signal')).toEqual([
      expect.objectContaining({ from: bob.riverId, callId: CALL, groupId, data: { type: 'hello' } }),
    ]);
    // Nobody outside the call gets anything from it…
    await expect(
      bob.dm.action({
        a: 'groupCall',
        kind: 'signal',
        callId: CALL,
        groupId,
        to: [dave.riverId],
        data: { type: 'hello' },
      }),
    ).rejects.toThrow(/not in that call/);
    // …and setup made up by someone outside it (who knows the call's ID) is dropped.
    const forge = dave.dm as unknown as { sendContent(peer: string, content: unknown): Promise<void> };
    await forge.sendContent(alice.riverId, {
      v: 1,
      t: 'gcall',
      callId: CALL,
      groupId,
      kind: 'signal',
      data: { type: 'hello' },
    });
    await alice.dm.sync();
    expect(gcalls(alice).filter((e) => e.from === dave.riverId)).toEqual([]);
    // A member who is not in the call (Carol was rung, but never joined) sends no setup until she joins.
    await carol.dm.sync();
    await expect(
      carol.dm.action({
        a: 'groupCall',
        kind: 'signal',
        callId: CALL,
        groupId,
        to: [alice.riverId],
        data: { type: 'hello' },
      }),
    ).rejects.toThrow(/not in that call/);
  });

  it('declining tells who rang; the call history names the group', async () => {
    const { alice, carol, groupId } = await climbers();
    await alice.dm.action({ a: 'groupCall', kind: 'ring', callId: CALL, groupId, video: false });
    await carol.dm.sync();
    await carol.dm.action({ a: 'groupCall', kind: 'decline', callId: CALL, groupId, to: [alice.riverId] });
    expect(await carol.dm.action({ a: 'pendingCall' })).toBeNull();
    await alice.dm.sync();
    expect(gcalls(alice)).toEqual([expect.objectContaining({ kind: 'decline', from: carol.riverId })]);
    await carol.dm.action({
      a: 'logCall',
      peer: groupId,
      kind: 'group',
      direction: 'in',
      video: false,
      answered: false,
      outcome: 'declined',
      durationSec: 0,
    });
    await alice.dm.action({
      a: 'logCall',
      peer: groupId,
      kind: 'group',
      direction: 'out',
      video: false,
      answered: true,
      durationSec: 61,
      people: 3,
    });
    expect((await carol.dm.action({ a: 'calls' }))[0]).toMatchObject({
      peer: groupId,
      name: 'Climb',
      kind: 'group',
      outcome: 'declined',
    });
    expect((await alice.dm.action({ a: 'calls' }))[0]).toMatchObject({ name: 'Climb', people: 3 });
    // A group call is logged by its group, a 1:1 call by its person.
    await expect(
      alice.dm.action({
        a: 'logCall',
        peer: carol.riverId,
        kind: 'group',
        direction: 'out',
        video: false,
        answered: false,
        durationSec: 0,
      }),
    ).rejects.toThrow();
  });

  it('a removed member is not rung, and their setup is no longer accepted', async () => {
    const { alice, bob, carol, groupId } = await climbers();
    await alice.dm.action({ a: 'removeGroupMember', peer: groupId, member: carol.riverId });
    await carol.dm.sync();
    await bob.dm.sync();
    await alice.dm.action({ a: 'groupCall', kind: 'ring', callId: CALL, groupId, video: false });
    await carol.dm.sync();
    expect(rings(carol)).toEqual([]);
    const forge = carol.dm as unknown as { sendContent(peer: string, content: unknown): Promise<void> };
    await forge.sendContent(alice.riverId, { v: 1, t: 'gcall', callId: CALL, groupId, kind: 'decline' });
    await alice.dm.sync();
    expect(gcalls(alice)).toEqual([]);
  });

  it('in a 1:1 call already, a group call does not ring: the group shows the call instead', async () => {
    const { alice, bob, carol, groupId } = await climbers();
    await friends(bob, carol);
    await bob.dm.action({ a: 'call', peer: carol.riverId, callId: 'O'.repeat(22), kind: 'invite' });
    await alice.dm.action({ a: 'groupCall', kind: 'ring', callId: CALL, groupId, video: false });
    await bob.dm.sync();
    expect(rings(bob)).toEqual([]);
    expect(gcalls(bob)).toEqual([expect.objectContaining({ kind: 'ongoing', callId: CALL, groupId })]);
    // Bob can still join it from the group.
    await expect(
      bob.dm.action({ a: 'groupCall', kind: 'join', callId: CALL, groupId }),
    ).resolves.toBeTruthy();
  });
});

describe('call links (2.18)', { timeout: 60_000 }, () => {
  it('ask to join: the host sees who asks and lets them in; only then is the call ID shared', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const eve = await person('Eve');
    await friends(alice, bob);
    const link = await alice.dm.action({ a: 'createCallLink', video: false, title: 'Standup' });
    const parsed = parseCallLink(link.url);
    expect(parsed).toMatchObject({ host: alice.riverId, link: link.id, serverUrl: SERVER });
    // The link names the link, never the call.
    expect(link.url).not.toContain(link.callId);
    expect(await alice.dm.action({ a: 'callLinks' })).toEqual([expect.objectContaining({ id: link.id })]);

    await bob.dm.action({ a: 'knock', host: alice.riverId, link: link.id });
    await eve.dm.action({ a: 'knock', host: alice.riverId, link: link.id });
    await alice.dm.sync();
    const knocks = alice.events.filter((e): e is Extract<DmEvent, { t: 'knock' }> => e.t === 'knock');
    expect(knocks).toEqual([
      { t: 'knock', link: link.id, from: bob.riverId, name: 'Bob', contact: true },
      { t: 'knock', link: link.id, from: eve.riverId, name: 'Eve', contact: false },
    ]);

    await alice.dm.action({ a: 'answerKnock', link: link.id, who: bob.riverId, admit: true });
    await alice.dm.action({ a: 'answerKnock', link: link.id, who: eve.riverId, admit: false });
    await bob.dm.sync();
    expect(gcalls(bob)).toEqual([
      expect.objectContaining({
        kind: 'admitted',
        callId: link.callId,
        host: alice.riverId,
        title: 'Standup',
        allowed: expect.arrayContaining([alice.riverId, bob.riverId]),
      }),
    ]);
    await eve.dm.sync();
    expect(gcalls(eve)).toEqual([]);
    expect(eve.events).toContainEqual({
      t: 'knockAnswer',
      link: link.id,
      host: alice.riverId,
      answer: 'deny',
    });
    // Eve, refused, cannot take part even with the call's ID.
    await expect(eve.dm.action({ a: 'groupCall', kind: 'join', callId: link.callId })).rejects.toThrow(
      /over/,
    );

    // Both in the call: setup flows between host and guest.
    await alice.dm.action({ a: 'groupCall', kind: 'join', callId: link.callId });
    await bob.dm.action({ a: 'groupCall', kind: 'join', callId: link.callId });
    await bob.dm.action({
      a: 'groupCall',
      kind: 'signal',
      callId: link.callId,
      to: [alice.riverId],
      data: { type: 'hello' },
    });
    await alice.dm.sync();
    expect(gcalls(alice).filter((e) => e.kind === 'signal')).toEqual([
      expect.objectContaining({ from: bob.riverId, callId: link.callId }),
    ]);
    expect(await alice.dm.action({ a: 'callLinks' })).toEqual([
      expect.objectContaining({ admitted: [bob.riverId] }),
    ]);
  });

  it('a guest cannot turn a call-link call into a group call to bring a group into it (2.20)', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    for (const p of [bob, carol]) await friends(alice, p);
    const group = await alice.dm.action({
      a: 'createGroup',
      name: 'Climb',
      members: [bob.riverId, carol.riverId],
    });
    for (const p of [bob, carol]) await p.dm.sync();
    const link = await alice.dm.action({ a: 'createCallLink', video: false });
    await bob.dm.action({ a: 'knock', host: alice.riverId, link: link.id });
    await alice.dm.sync();
    await alice.dm.action({ a: 'answerKnock', link: link.id, who: bob.riverId, admit: true });
    await bob.dm.sync();
    await alice.dm.action({ a: 'groupCall', kind: 'join', callId: link.callId });

    // Bob, let in, "rings" the group with the link call's ID; Carol (never let in) then sends setup.
    const forge = (p: Person) =>
      p.dm as unknown as { sendContent(peer: string, content: unknown): Promise<void> };
    await forge(bob).sendContent(alice.riverId, {
      v: 1,
      t: 'gcall',
      callId: link.callId,
      groupId: group.riverId,
      kind: 'ring',
    });
    await forge(carol).sendContent(alice.riverId, {
      v: 1,
      t: 'gcall',
      callId: link.callId,
      groupId: group.riverId,
      kind: 'signal',
      data: { type: 'hello' },
    });
    await alice.dm.sync();
    expect(gcalls(alice).filter((e) => e.from === carol.riverId)).toEqual([]);
    // Who may be in the call is still the host and the people let in.
    const again = await alice.dm.action({ a: 'groupCall', kind: 'join', callId: link.callId });
    expect(again?.allowed.sort()).toEqual([alice.riverId, bob.riverId].sort());
    // The window cannot do it either.
    await expect(
      alice.dm.action({ a: 'groupCall', kind: 'ring', callId: link.callId, groupId: group.riverId }),
    ).rejects.toThrow();
  });

  it('people let in later are announced by the host only; a revoked link answers "gone"', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const mallory = await person('Mallory');
    const link = await alice.dm.action({ a: 'createCallLink', video: true });
    for (const p of [bob, carol]) {
      await p.dm.action({ a: 'knock', host: alice.riverId, link: link.id });
      await alice.dm.sync();
      await alice.dm.action({ a: 'answerKnock', link: link.id, who: p.riverId, admit: true });
      await p.dm.sync();
    }
    // Bob hears that Carol may now be in the call (from the host).
    await bob.dm.sync();
    expect(
      gcalls(bob)
        .filter((e) => e.kind === 'allow')
        .at(-1)?.allowed,
    ).toContain(carol.riverId);
    // Anyone else saying so is ignored.
    const forge = mallory.dm as unknown as { sendContent(peer: string, content: unknown): Promise<void> };
    await forge.sendContent(bob.riverId, {
      v: 1,
      t: 'gcall',
      callId: link.callId,
      kind: 'allow',
      allowed: [mallory.riverId],
    });
    // A "you're in" nobody asked for is ignored too.
    await forge.sendContent(bob.riverId, {
      v: 1,
      t: 'clink',
      link: 'L'.repeat(22),
      kind: 'admit',
      callId: 'M'.repeat(22),
    });
    const before = gcalls(bob).length;
    await bob.dm.sync();
    expect(gcalls(bob).length).toBe(before);

    // The host stops the link: asking again finds it gone.
    await alice.dm.action({ a: 'revokeCallLink', link: link.id });
    await mallory.dm.action({ a: 'knock', host: alice.riverId, link: link.id });
    await alice.dm.sync();
    expect(alice.events.some((e) => e.t === 'knock' && e.from === mallory.riverId)).toBe(false);
    // (The answer goes out once Alice's River has read the question.)
    await until(async () => {
      await mallory.dm.sync();
      return mallory.events.some((e) => e.t === 'knockAnswer');
    });
    expect(mallory.events).toContainEqual({
      t: 'knockAnswer',
      link: link.id,
      host: alice.riverId,
      answer: 'gone',
    });
  });
});
