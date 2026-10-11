import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityEvent } from '../../apps/desktop/src/shared/ipc.ts';
// Desktop main-process code under test.
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
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
  const community = new CommunityService({
    db: () => local,
    account,
    identity,
    requestJson: createRequestJson(injectFetch),
    requestBytes: createRequestBytes(injectFetch),
    log: nullLogger,
    ...(presence ? { presence } : {}),
    createSocket: (url) => {
      const s = new FreezableSocket(url.replace(':8787', `:${port}`));
      sockets.push(s);
      return s;
    },
  });
  services.push(community);
  const events: CommunityEvent[] = [];
  community.onEvent((e) => events.push(e));
  return { community, riverId: created.riverId, sockets, events };
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

    // After hanging up nothing more is accepted for Bob.
    bob.community.callRoom(null);
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
});
