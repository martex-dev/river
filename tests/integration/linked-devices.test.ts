import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import {
  LinkService,
  helloMac,
  mailboxId,
  parseLinkCode,
} from '../../apps/desktop/src/main/account/link-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
import type { LinkProgress } from '../../apps/desktop/src/shared/ipc.ts';
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';

/** Linked devices (1.3, ADR 0006): one account on two devices, against the real server. */

const SERVER = 'http://127.0.0.1:8787';
let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
const locals: LocalDatabase[] = [];

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

/** One install of River: its own local database and services. */
function install(name: string) {
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
  const dm = new DmService({ db: () => local, identity, account, community, log: nullLogger });
  const link = new LinkService({
    identity,
    account,
    community,
    requestJson: createRequestJson(injectFetch),
    log: nullLogger,
    onLinked: () => undefined,
  });
  return { identity, account, community, dm, link };
}

async function until<T>(
  fn: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  ms = 20_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-link-'));
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
  for (const l of locals.splice(0)) l.close();
  await server.close();
  await serverDb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('linked devices', { timeout: 60_000 }, () => {
  it('links a second device that shares the account, its communities and its direct messages', async () => {
    const desktop = install('alice-desktop');
    const me = desktop.identity.create('Alice');
    await desktop.account.register(SERVER);
    await desktop.dm.sync();
    const club = await desktop.community.create('Linked club');

    const bob = install('bob');
    const bobId = bob.identity.create('Bob').riverId;
    await bob.account.register(SERVER);
    await bob.dm.sync();
    await bob.community.join(await desktop.community.invite(club.id), async () => undefined);

    // The desktop shows a link code; the phone uses it; the desktop confirms.
    const offered = await desktop.link.start();
    expect(offered.state).toBe('offering');
    const { code, shortCode } = offered as Extract<LinkProgress, { state: 'offering' }>;
    expect(shortCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(parseLinkCode(code)).not.toBeNull();
    const phone = install('alice-phone');
    expect((await phone.link.join(code, 'Alice’s phone')).state).toBe('joining');
    const request = await until(() => {
      const p = desktop.link.status();
      return p.state === 'request' ? p : null;
    });
    expect(request.deviceName).toBe('Alice’s phone');
    const { deviceId } = await desktop.link.confirm();
    expect(deviceId).toBe(2);
    const review = await until(() => {
      const p = phone.link.status();
      return p.state === 'review' ? p : null;
    });
    expect(review.server).toBe(new URL(SERVER).host);
    await phone.link.accept();
    await until(() => phone.link.status().state === 'linked');

    // Same person, its own device.
    expect(phone.identity.get()?.riverId).toBe(me.riverId);
    expect(phone.identity.get()?.displayName).toBe('Alice');
    expect(phone.account.status()).toMatchObject({ state: 'registered', deviceId: 2 });
    const devices = await desktop.link.devices();
    expect(devices.map((d) => d.deviceId)).toEqual([1, 2]);
    expect(devices.find((d) => d.current)?.deviceId).toBe(1);

    // The phone is in the community and can read and write it.
    const [seen] = await phone.community.refresh();
    expect(seen?.name).toBe('Linked club');
    const text = seen!.channels.find((c) => c.kind === 'text')!;
    await phone.community.send(text.id, 'from my phone');
    await bob.community.refresh();
    const fromPhone = (await bob.community.messages(text.id)).find((m) => m.text === 'from my phone');
    expect(fromPhone?.senderName).toBe('Alice');

    // A direct message from Bob reaches both of Alice's devices.
    await phone.dm.sync();
    await bob.dm.action({ a: 'open', peer: me.riverId, name: 'Alice' });
    await bob.dm.action({ a: 'send', peer: me.riverId, text: 'hi Alice, both of you' });
    for (const device of [desktop, phone]) {
      const got = await until(async () => {
        await device.dm.sync();
        const messages = await device.dm.action({ a: 'messages', peer: bobId });
        return messages.find((m) => m.text === 'hi Alice, both of you');
      });
      expect(got.mine).toBe(false);
    }

    // What Alice sends from the desktop also appears on her phone, as hers.
    await desktop.dm.action({ a: 'send', peer: bobId, text: 'sent from the desktop' });
    const synced = await until(async () => {
      await phone.dm.sync();
      const messages = await phone.dm.action({ a: 'messages', peer: bobId });
      return messages.find((m) => m.text === 'sent from the desktop');
    });
    expect(synced.mine).toBe(true);
    // Bob gets it once, from Alice.
    await bob.dm.sync();
    const atBob = (await bob.dm.action({ a: 'messages', peer: me.riverId })).filter(
      (m) => m.text === 'sent from the desktop',
    );
    expect(atBob).toHaveLength(1);

    // Removing the phone signs it out for good.
    await desktop.link.remove(2);
    expect((await desktop.link.devices()).map((d) => d.deviceId)).toEqual([1]);
    const after = await phone.account.connect();
    expect(after).toMatchObject({ state: 'registered', connection: 'error' });
  });

  it('a new device gets the friends list and blocks from the account’s other devices', async () => {
    const desktop = install('ann-desktop');
    const me = desktop.identity.create('Ann');
    await desktop.account.register(SERVER);
    await desktop.dm.sync();
    const carol = install('carol');
    const carolId = carol.identity.create('Carol').riverId;
    await carol.account.register(SERVER);
    await carol.dm.sync();
    const mallory = install('mallory');
    const malloryId = mallory.identity.create('Mallory').riverId;
    await mallory.account.register(SERVER);
    await mallory.dm.sync();
    await desktop.dm.action({ a: 'open', peer: carolId, name: 'Carol' });
    await desktop.dm.action({ a: 'block', peer: malloryId });
    expect(desktop.dm.contactState(carolId)).toBe('accepted');

    const offered = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    const phone = install('ann-phone');
    await phone.link.join(offered.code, 'Phone');
    await until(() => desktop.link.status().state === 'request');
    await desktop.link.confirm();
    await until(() => phone.link.status().state === 'review');
    await phone.link.accept();
    await until(() => phone.link.status().state === 'linked');
    expect(phone.identity.get()?.riverId).toBe(me.riverId);

    // The phone asks; the desktop answers; the phone applies it.
    await until(async () => {
      await phone.dm.sync();
      await desktop.dm.sync();
      await phone.dm.sync();
      return phone.dm.contactState(carolId) === 'accepted' ? true : null;
    });
    expect(phone.dm.contactState(malloryId)).toBe('blocked');

    // Blocking later on one device reaches the other.
    await phone.dm.action({ a: 'block', peer: carolId });
    await until(async () => {
      await desktop.dm.sync();
      return desktop.dm.contactState(carolId) === 'blocked' ? true : null;
    });
  });

  it('ignores a device that does not have the code, and a code typed alone needs a known server', async () => {
    const desktop = install('carol-desktop');
    desktop.identity.create('Carol');
    await desktop.account.register(SERVER);
    const offered = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    const { secret } = parseLinkCode(offered.code)!;
    // Someone who knows the mailbox ID (as the server does) but not the secret posts a hello.
    const forged = {
      authKey: Buffer.alloc(33, 5).toString('base64'),
      registrationId: 9,
      linkKey: Buffer.alloc(33, 5).toString('base64'),
      deviceName: 'Not you',
    };
    const wrongSecret = Buffer.alloc(10, 7);
    await injectFetch(`${SERVER}/v1/link/${mailboxId(secret)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: forged, mac: helloMac(wrongSecret, forged) }),
    });
    const failed = await until(() => {
      const p = desktop.link.status();
      return p.state === 'failed' ? p : null;
    });
    expect(failed.message).toMatch(/without your code/);
    expect((await desktop.link.devices()).map((d) => d.deviceId)).toEqual([1]);

    const phone = install('carol-phone');
    await expect(phone.link.join(offered.shortCode, 'Phone')).rejects.toThrow(/whole link/);
  });
});
