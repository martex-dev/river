import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityEvent } from '../../apps/desktop/src/shared/ipc.ts';
// Desktop main-process code under test.
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
// The real server app, listening on a real port so the realtime sockets are real.
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';

/**
 * 1.0.16: a voice call survives its members' connections to the server
 * dropping (a home server's tunnel reconnecting every few minutes). The seat
 * is held, the app reconnects and takes it back, and call setup sent in the
 * gap is delivered afterwards.
 */

const SERVER = 'http://127.0.0.1:8787';
let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
let port = 0;
const locals: LocalDatabase[] = [];
const services: CommunityService[] = [];

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

/** A real WebSocket whose incoming messages can be frozen (a connection that silently died). */
class FreezableSocket extends WebSocket {
  frozen = false;
  override set onmessage(fn: ((e: MessageEvent) => void) | null) {
    super.onmessage = fn ? (e: MessageEvent) => (this.frozen ? undefined : fn(e)) : null;
  }
  override get onmessage(): ((e: MessageEvent) => void) | null {
    return super.onmessage;
  }
}

async function person(
  name: string,
  presence?: ConstructorParameters<typeof CommunityService>[0]['presence'],
): Promise<{
  community: CommunityService;
  riverId: string;
  sockets: FreezableSocket[];
  events: CommunityEvent[];
  calls: boolean[];
  dm: () => Promise<DmService>;
  account: AccountService;
  /** New connections start frozen (a network that swallows everything). */
  freezeNew: { on: boolean };
}> {
  const local = migrateDatabase(join(dir, `${name}.db`), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  locals.push(local);
  const identity = new IdentityService(() => local);
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(injectFetch),
    log: nullLogger,
  });
  const created = identity.create(name);
  await account.register(SERVER);
  const sockets: FreezableSocket[] = [];
  const calls: boolean[] = [];
  const freezeNew = { on: false };
  const community = new CommunityService({
    onCallChange: (inCall) => calls.push(inCall),
    db: () => local,
    account,
    identity,
    requestJson: createRequestJson(injectFetch),
    requestBytes: createRequestBytes(injectFetch),
    log: nullLogger,
    ...(presence ? { presence } : {}),
    createSocket: (url) => {
      const s = new FreezableSocket(url.replace(':8787', `:${port}`));
      s.frozen = freezeNew.on;
      sockets.push(s);
      return s;
    },
  });
  services.push(community);
  const events: CommunityEvent[] = [];
  community.onEvent((e) => events.push(e));
  const dm = async (): Promise<DmService> => {
    const service = new DmService({ db: () => local, identity, account, community, log: nullLogger });
    await service.sync();
    return service;
  };
  return { community, riverId: created.riverId, sockets, events, calls, dm, account, freezeNew };
}

const online = (c: CommunityService) => () => expect(c.connectionState()).toBe('online');
const voiceEvents = (events: CommunityEvent[]) =>
  events.filter((e): e is Extract<CommunityEvent, { t: 'voice' }> => e.t === 'voice');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-voice-'));
  serverDb = openDatabase('sqlite::memory:');
  await migrateToLatest(serverDb.db);
  server = await buildApp({
    config: loadConfig({
      RIVER_ATTACHMENT_DIR: join(dir, 'blobs'),
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
    }),
    database: serverDb,
    voiceGraceMs: 10_000,
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  port = (server.server.address() as { port: number }).port;
});

afterEach(async () => {
  for (const s of services.splice(0)) s.stop();
  for (const l of locals.splice(0)) l.close();
  await server.close();
  await serverDb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function inCall(fastHeartbeat = false, bobPresence?: Parameters<typeof person>[1]) {
  const alice = await person('Alice');
  const bob = await person('Bob', bobPresence);
  if (fastHeartbeat) {
    bob.community.heartbeatMs = 100;
    bob.community.deadAfterMs = 400;
  }
  const created = await alice.community.create('Voice Crew');
  await alice.community.action({ a: 'createChannel', communityId: created.id, kind: 'voice', name: 'Talk' });
  const link = await alice.community.invite(created.id);
  await bob.community.join(link, async () => undefined);
  const view = (await alice.community.refresh())[0]!;
  await bob.community.refresh();
  const voice = view.channels.find((c) => c.kind === 'voice')!.id;
  alice.community.ensureSocket();
  bob.community.ensureSocket();
  await vi.waitFor(online(alice.community), { timeout: 5000 });
  await vi.waitFor(online(bob.community), { timeout: 5000 });
  alice.community.voiceJoin(voice);
  bob.community.voiceJoin(voice);
  await vi.waitFor(() => expect(voiceEvents(alice.events).at(-1)?.participants).toHaveLength(2));
  return { alice, bob, voice };
}

describe('voice survives dropped connections', () => {
  it('a dropped connection keeps the seat, reconnects and takes it back by itself', async () => {
    const { alice, bob } = await inCall();
    const mark = alice.events.length;
    bob.sockets.at(-1)!.close(); // the tunnel dropped Bob's connection

    await vi.waitFor(
      () => expect(voiceEvents(alice.events).at(-1)?.states[bob.riverId]?.reconnecting).toBe(true),
      { timeout: 5000 },
    );
    await vi.waitFor(online(bob.community), { timeout: 10_000 });
    await vi.waitFor(
      () => expect(voiceEvents(alice.events).at(-1)?.states[bob.riverId]?.reconnecting).toBeFalsy(),
      { timeout: 5000 },
    );
    // Bob never left the channel in Alice's eyes, and nobody saw him go offline.
    for (const e of voiceEvents(alice.events.slice(mark))) expect(e.participants).toContain(bob.riverId);
    expect(bob.sockets.length).toBe(2);
  });

  it('call setup sent while offline is delivered after reconnecting', async () => {
    const { alice, bob, voice } = await inCall();
    bob.sockets.at(-1)!.close();
    await vi.waitFor(() => expect(bob.community.connectionState()).not.toBe('online'));
    // The renderer keeps negotiating meanwhile; these must not throw or be lost.
    expect(() => bob.community.signal(alice.riverId, voice, { type: 'hello', n: 1 })).not.toThrow();
    bob.community.signal(alice.riverId, voice, { type: 'hello', n: 2 });
    await vi.waitFor(
      () => {
        const got = alice.events
          .filter((e) => e.t === 'signal')
          .map((e) => (e as { data: { n: number } }).data.n);
        expect(got).toEqual([1, 2]);
      },
      { timeout: 10_000 },
    );
  });

  it('a connection that silently stops answering is noticed and replaced', async () => {
    const { alice, bob } = await inCall(true);
    bob.sockets.at(-1)!.frozen = true; // nothing arrives any more, but no close either
    await vi.waitFor(() => expect(bob.sockets.length).toBe(2), { timeout: 10_000 });
    await vi.waitFor(online(bob.community), { timeout: 10_000 });
    await vi.waitFor(() =>
      expect(voiceEvents(alice.events).at(-1)?.states[bob.riverId]?.reconnecting).toBeFalsy(),
    );
    expect(voiceEvents(alice.events).at(-1)?.participants).toContain(bob.riverId);
  }, 20_000);

  it('leaving on purpose while offline does not rejoin after reconnecting', async () => {
    const { alice, bob } = await inCall();
    bob.sockets.at(-1)!.close();
    await vi.waitFor(() => expect(bob.community.connectionState()).not.toBe('online'));
    bob.community.voiceLeave();
    await vi.waitFor(online(bob.community), { timeout: 10_000 });
    // The held seat runs out (10 s here) and is not taken back.
    await vi.waitFor(() => expect(voiceEvents(alice.events).at(-1)?.participants).toEqual([alice.riverId]), {
      timeout: 15_000,
    });
  }, 20_000);

  it('relays a 1:1 call between people who share only its private room, also after a reconnect', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    alice.community.ensureSocket();
    bob.community.ensureSocket();
    await vi.waitFor(online(alice.community), { timeout: 5000 });
    await vi.waitFor(online(bob.community), { timeout: 5000 });
    const got: Array<{ from: string; payload: number[] }> = [];
    bob.community.onRelay((from, payload) => got.push({ from, payload: [...payload] }));
    const room = 'q'.repeat(43);
    alice.community.callRoom(room);
    bob.community.callRoom(room);
    await new Promise((r) => setTimeout(r, 100));
    alice.community.relaySend([bob.riverId], new Uint8Array([7, 7]));
    await vi.waitFor(() => expect(got).toEqual([{ from: alice.riverId, payload: [7, 7] }]));

    // Bob's connection drops; he rejoins the room by himself and frames flow again.
    bob.sockets.at(-1)!.close();
    await vi.waitFor(() => expect(bob.sockets.length).toBe(2), { timeout: 10_000 });
    await vi.waitFor(online(bob.community), { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 100));
    alice.community.relaySend([bob.riverId], new Uint8Array([8]));
    await vi.waitFor(() => expect(got.at(-1)).toEqual({ from: alice.riverId, payload: [8] }));

    // The phone shell hears when the call starts; its Hang up reaches the window.
    expect(bob.calls).toEqual([true]);
    bob.community.hangUp();
    expect(bob.events.at(-1)).toEqual({ t: 'hangUp' });

    // After hanging up nothing more is accepted for Bob.
    bob.community.callRoom(null);
    expect(bob.calls).toEqual([true, false]);
    await new Promise((r) => setTimeout(r, 100));
    alice.community.relaySend([bob.riverId], new Uint8Array([9]));
    await new Promise((r) => setTimeout(r, 300));
    expect(got.at(-1)!.payload).toEqual([8]);
  }, 20_000);

  it('presence: Do Not Disturb, invisible and a custom status reach others (the text encrypted)', async () => {
    let status: 'online' | 'idle' | 'dnd' | 'invisible' = 'dnd';
    let custom: { text: string; emoji: string; until: string | null } | null = null;
    const { alice, bob } = await inCall(false, { status: () => status, custom: () => custom });
    const bobAsSeen = () => alice.community.cached()[0]!.members.find((m) => m.riverId === bob.riverId)!;
    // Connected as Do Not Disturb from the start.
    await alice.community.refresh();
    await vi.waitFor(() => expect(bobAsSeen()).toMatchObject({ online: true, status: 'dnd' }));

    custom = { text: 'deep in focus', emoji: '🎧', until: null };
    status = 'online';
    await bob.community.presenceChanged(true);
    await vi.waitFor(() => expect(bobAsSeen().status).toBeUndefined());
    await alice.community.refresh();
    expect(bobAsSeen().customStatus).toEqual({ text: 'deep in focus', emoji: '🎧' });
    // The server only ever holds the sealed profile.
    const stored = JSON.stringify(await serverDb.db.selectFrom('community_members').selectAll().execute());
    expect(stored).not.toContain('deep in focus');

    status = 'invisible';
    await bob.community.presenceChanged(false);
    await vi.waitFor(() => expect(bobAsSeen().online).toBe(false));
  }, 20_000);

  it('a 1:1 call that rings while the window is closed is shown when it opens, until it ends', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const aliceDm = await alice.dm();
    const bobDm = await bob.dm();
    alice.community.ensureSocket();
    bob.community.ensureSocket();
    await vi.waitFor(online(alice.community), { timeout: 5000 });
    await vi.waitFor(online(bob.community), { timeout: 5000 });
    await aliceDm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    await aliceDm.action({ a: 'send', peer: bob.riverId, text: 'call me' });
    await bobDm.sync();
    await bobDm.action({ a: 'accept', peer: alice.riverId });
    await aliceDm.sync();

    const callId = 'C'.repeat(22);
    expect(await aliceDm.action({ a: 'pendingCall' })).toBeNull();
    await bobDm.action({ a: 'call', peer: alice.riverId, callId, kind: 'invite', video: true });
    await vi.waitFor(async () =>
      expect(await aliceDm.action({ a: 'pendingCall' })).toMatchObject({
        t: 'call',
        peer: bob.riverId,
        callId,
        kind: 'invite',
        video: true,
      }),
    );
    await bobDm.action({ a: 'call', peer: alice.riverId, callId, kind: 'end' });
    await vi.waitFor(async () => expect(await aliceDm.action({ a: 'pendingCall' })).toBeNull());
  }, 20_000);

  it('group calls (2.18): a live ring, who is in the call from its room, voice relayed inside it, rejoining after a drop', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const people = [alice, bob, carol];
    const [aliceDm, bobDm, carolDm] = await Promise.all(people.map((p) => p.dm()));
    for (const p of people) p.community.ensureSocket();
    for (const p of people) await vi.waitFor(online(p.community), { timeout: 5000 });
    expect(alice.community.groupCallsSupported).toBe(true);
    for (const [other, otherDm] of [
      [bob, bobDm],
      [carol, carolDm],
    ] as const) {
      await aliceDm!.action({ a: 'open', peer: other.riverId, name: 'Friend' });
      await aliceDm!.action({ a: 'send', peer: other.riverId, text: 'hi' });
      await otherDm!.sync();
      await otherDm!.action({ a: 'accept', peer: alice.riverId });
    }
    await aliceDm!.sync();
    const group = await aliceDm!.action({
      a: 'createGroup',
      name: 'Climb',
      members: [bob.riverId, carol.riverId],
    });
    await bobDm!.sync();
    await carolDm!.sync();

    // The room is a hash of the call's secret ID, as River's window makes it.
    const callId = 'G'.repeat(22);
    const { createHash } = await import('node:crypto');
    const room = createHash('sha256').update(`river-call-room:${callId}`).digest('base64url');
    const rosters = (p: (typeof people)[number]) =>
      p.events
        .filter((e): e is Extract<CommunityEvent, { t: 'callRoster' }> => e.t === 'callRoster')
        .filter((e) => e.room === room)
        .map((e) => e.participants);

    // Alice starts it: in its room first, then the group rings — live, never stored.
    alice.community.groupCallRoom(room);
    await vi.waitFor(() => expect(rosters(alice).at(-1)).toEqual([alice.riverId]));
    await aliceDm!.action({ a: 'groupCall', kind: 'ring', callId, groupId: group.riverId, video: false });
    await vi.waitFor(async () =>
      expect(await bobDm!.action({ a: 'pendingCall' })).toMatchObject({
        callId,
        group: { id: group.riverId, name: 'Climb', people: 3 },
      }),
    );
    // Carol lets it ring and watches the call from the group ("Join" with who is in it).
    carol.community.watchCallRooms([room]);
    await vi.waitFor(() => expect(rosters(carol).at(-1)).toEqual([alice.riverId]));

    // Bob answers: everyone in the call and watching it sees him in it.
    await bobDm!.action({ a: 'groupCall', kind: 'join', callId, groupId: group.riverId });
    bob.community.groupCallRoom(room);
    await vi.waitFor(() =>
      expect(rosters(alice).at(-1)?.sort()).toEqual([alice.riverId, bob.riverId].sort()),
    );
    await vi.waitFor(() => expect(rosters(carol).at(-1)).toHaveLength(2));
    expect(bob.calls).toEqual([true]);

    // Voice to everyone in the call reaches Bob, not Carol who only watches.
    const atBob: number[][] = [];
    const atCarol: number[][] = [];
    bob.community.onRelay((_from, payload) => atBob.push([...payload]));
    carol.community.onRelay((_from, payload) => atCarol.push([...payload]));
    alice.community.relaySendAll(new Uint8Array([1, 2]));
    await vi.waitFor(() => expect(atBob).toEqual([[1, 2]]));

    // Bob's connection drops: he is held in the call, comes back into its room by himself.
    bob.sockets.at(-1)!.close();
    await vi.waitFor(() => expect(bob.sockets.length).toBe(2), { timeout: 10_000 });
    await vi.waitFor(online(bob.community), { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 100));
    alice.community.relaySendAll(new Uint8Array([3]));
    await vi.waitFor(() => expect(atBob.at(-1)).toEqual([3]));
    // Carol's watch survives her own reconnect too.
    const seen = rosters(carol).length;
    carol.sockets.at(-1)!.close();
    await vi.waitFor(() => expect(carol.sockets.length).toBe(2), { timeout: 10_000 });
    await vi.waitFor(online(carol.community), { timeout: 10_000 });
    await vi.waitFor(() => expect(rosters(carol).length).toBeGreaterThan(seen));
    expect(rosters(carol).at(-1)).toHaveLength(2);
    expect(atCarol).toEqual([]);

    // Bob leaves and rejoins; then both leave: the call is over for everyone watching.
    bob.community.groupCallRoom(null);
    await vi.waitFor(() => expect(rosters(carol).at(-1)).toEqual([alice.riverId]));
    bob.community.groupCallRoom(room);
    await vi.waitFor(() => expect(rosters(carol).at(-1)).toHaveLength(2));
    bob.community.groupCallRoom(null);
    alice.community.groupCallRoom(null);
    await vi.waitFor(() => expect(rosters(carol).at(-1)).toEqual([]));
  }, 40_000);
});

describe('the realtime connection', () => {
  it('opens one connection however many times it is asked to at once', async () => {
    const p = await person('Alice');
    // Startup asks from several places (status listener, connectAll, registration, wake-up).
    p.community.ensureSocket();
    p.community.ensureSocket();
    p.community.reconnectNow();
    p.community.ensureSocket();
    await vi.waitFor(online(p.community), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(p.sockets).toHaveLength(1);
  });

  it('stop() cancels an open still waiting for its token', async () => {
    const p = await person('Alice');
    p.community.ensureSocket();
    p.community.stop();
    await new Promise((r) => setTimeout(r, 300));
    expect(p.sockets).toHaveLength(0);
    expect(p.community.connectionState()).toBe('offline');
  });

  it('a connection the old one was replaced by is the only one heard', async () => {
    const p = await person('Alice');
    p.community.ensureSocket();
    await vi.waitFor(online(p.community), { timeout: 5000 });
    const first = p.sockets[0]!;
    p.community.stop();
    p.community.ensureSocket();
    await vi.waitFor(() => expect(p.sockets).toHaveLength(2), { timeout: 5000 });
    await vi.waitFor(online(p.community), { timeout: 5000 });
    // A late message on the closed socket must not reach listeners.
    const before = p.events.length;
    first.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ t: 'typing', communityId: 'x', channelId: 'y', riverId: 'z' }),
      }),
    );
    expect(p.events.length).toBe(before);
  });

  it('signs in again when the server refuses an expired session, instead of retrying it forever', async () => {
    const p = await person('Alice');
    // With a community listed, opening the connection makes no other request that could notice.
    await p.community.create('Crew');
    p.community.ensureSocket();
    await vi.waitFor(online(p.community), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 500)); // the refresh that follows "ready" is done
    const oldToken = p.account.sessionToken();
    // The session runs out on the server; then the connection drops.
    await serverDb.db.deleteFrom('sessions').execute();
    p.sockets.at(-1)!.close();
    // The stale token is refused once (4401); River signs in again and the third connection works.
    await vi.waitFor(() => expect(p.sockets.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    await vi.waitFor(online(p.community), { timeout: 10_000 });
    expect(p.account.sessionToken()).not.toBe(oldToken);
    expect(p.sockets).toHaveLength(3);
  }, 20_000);

  it('gives up on a connection that never becomes ready and tries again', async () => {
    const p = await person('Alice');
    p.community.connectTimeoutMs = 300;
    p.freezeNew.on = true;
    p.community.ensureSocket();
    await vi.waitFor(() => expect(p.sockets).toHaveLength(1), { timeout: 5000 });
    expect(p.community.connectionState()).toBe('connecting');
    p.freezeNew.on = false;
    await vi.waitFor(() => expect(p.sockets).toHaveLength(2), { timeout: 5000 });
    await vi.waitFor(online(p.community), { timeout: 5000 });
  }, 15_000);
});
