import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const links: LinkService[] = [];

/** Stopped before their databases close, so no reconnect timer outlives its test. */
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

/** One install of River: its own local database and services. `broken` requests fail (a network gone). */
function install(name: string, broken: { when: (url: string) => boolean } = { when: () => false }) {
  const local = migrateDatabase(join(dir, `${name}.db`), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  locals.push(local);
  const identity = new IdentityService(() => local);
  const fetchHere: typeof fetch = (input, init) =>
    broken.when(String(input)) ? Promise.reject(new TypeError('fetch failed')) : injectFetch(input, init);
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(fetchHere),
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
    requestJson: createRequestJson(fetchHere),
    log: nullLogger,
    onLinked: () => undefined,
    timings: { watchMs: 100, linkedShowMs: 3000 },
  });
  links.push(link);

  communities.push(community);
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
  for (const l of links.splice(0)) l.dispose();

  for (const c of communities.splice(0)) c.stop();
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
    // The name typed on the phone shows on both devices.
    expect(devices.find((d) => d.deviceId === 2)?.name).toBe('Alice’s phone');
    expect((await phone.link.devices()).find((d) => d.current)?.name).toBe('Alice’s phone');
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

  it('a linked device that has not published its keys does not stop direct messages', async () => {
    const desktop = install('dee-desktop');
    const me = desktop.identity.create('Dee');
    await desktop.account.register(SERVER);
    await desktop.dm.sync();
    const bob = install('bo');
    const bobId = bob.identity.create('Bo').riverId;
    await bob.account.register(SERVER);
    await bob.dm.sync();

    const offered = await desktop.link.start();
    const { code } = offered as Extract<LinkProgress, { state: 'offering' }>;
    const phone = install('dee-phone');
    await phone.link.join(code, 'Dee’s phone');
    await until(() => desktop.link.status().state === 'request');
    await desktop.link.confirm();
    await until(() => phone.link.status().state === 'review');
    await phone.link.accept();
    await until(() => phone.link.status().state === 'linked');
    // The phone is in the device list but its keys never reached the server (e.g. it went
    // offline right after linking): nobody can fetch them, so nobody can be asked to write to it.
    for (const table of ['signed_prekeys', 'kyber_prekeys', 'prekeys'] as const)
      await serverDb.db
        .deleteFrom(table)
        .where('river_id', '=', me.riverId)
        .where('device_id', '=', 2)
        .execute();

    await bob.dm.action({ a: 'open', peer: me.riverId, name: 'Dee' });
    await bob.dm.action({ a: 'send', peer: me.riverId, text: 'still reachable' });
    const got = await until(async () => {
      await desktop.dm.sync();
      const messages = await desktop.dm.action({ a: 'messages', peer: bobId });
      return messages.find((m) => m.text === 'still reachable');
    });
    expect(got.mine).toBe(false);
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

  it('a device whose account could not be sent is taken off the list again', async () => {
    const broken = { when: (_url: string) => false };
    const desktop = install('dan-desktop', broken);
    desktop.identity.create('Dan');
    await desktop.account.register(SERVER);
    const offered = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    const phone = install('dan-phone');
    await phone.link.join(offered.code, 'Phone');
    await until(() => desktop.link.status().state === 'request');
    broken.when = (url) => url.includes('/provision');
    await expect(desktop.link.confirm()).rejects.toThrow();
    broken.when = () => false;
    expect((await desktop.link.devices()).map((d) => d.deviceId)).toEqual([1]);
    // The server's list says the same (no device nobody holds).
    await desktop.account.connect();
    expect(desktop.account.status()).toMatchObject({ devices: 1 });
    phone.link.cancel();
    desktop.link.cancel();
  });

  it('confirming after the code ran out adds no device', async () => {
    const desktop = install('eve-desktop');
    desktop.identity.create('Eve');
    await desktop.account.register(SERVER);
    const offered = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    const phone = install('eve-phone');
    await phone.link.join(offered.code, 'Phone');
    await until(() => desktop.link.status().state === 'request');
    const later = Date.now() + 11 * 60 * 1000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await expect(desktop.link.confirm()).rejects.toThrow(/expired/);
    } finally {
      clock.mockRestore();
    }
    expect(desktop.link.status().state).toBe('failed');
    expect((await desktop.link.devices()).map((d) => d.deviceId)).toEqual([1]);
    phone.link.cancel();
  });

  it('a new device whose sign-in fails is left without the identity, ready to try again', async () => {
    const desktop = install('fay-desktop');
    desktop.identity.create('Fay');
    await desktop.account.register(SERVER);
    const offered = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    const broken = { when: (_url: string) => false };
    const phone = install('fay-phone', broken);
    await phone.link.join(offered.code, 'Phone');
    await until(() => desktop.link.status().state === 'request');
    await desktop.link.confirm();
    await until(() => phone.link.status().state === 'review');
    broken.when = (url) => url.includes('/auth/');
    await expect(phone.link.accept()).rejects.toThrow();
    expect(phone.link.status().state).toBe('failed');
    expect(phone.identity.get()).toBeNull();
    expect(phone.account.status().state).toBe('none');
    // Not stuck: the device can take a new code.
    broken.when = () => false;
    const again = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    expect((await phone.link.join(again.code, 'Phone')).state).toBe('joining');
    phone.link.cancel();
    desktop.link.cancel();
  });
});

/** Desktop shows a code, the phone uses it, the desktop confirms; returns when the phone reviews. */
async function linkUpToReview(desktop: ReturnType<typeof install>, phone: ReturnType<typeof install>) {
  const offered = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
  await phone.link.join(offered.code, 'Phone');
  await until(() => desktop.link.status().state === 'request');
  const { deviceId } = await desktop.link.confirm();
  await until(() => phone.link.status().state === 'review');
  return deviceId;
}

describe('linking, carefully', { timeout: 60_000 }, () => {
  it('a new device that cancels at “Is this you?” is taken off the account again', async () => {
    const desktop = install('eve-desktop');
    desktop.identity.create('Eve');
    await desktop.account.register(SERVER);
    const phone = install('eve-phone');
    const deviceId = await linkUpToReview(desktop, phone);
    expect((await desktop.link.devices()).map((d) => d.deviceId)).toEqual([1, deviceId]);

    phone.link.cancel();
    expect(phone.link.status().state).toBe('idle');
    expect(phone.identity.get()).toBeNull();
    // The desktop sees the signed "no" and removes the device it had added.
    const told = await until(() => {
      const p = desktop.link.status();
      return p.state === 'failed' ? p : null;
    });
    expect(told.message).toMatch(/did not take the account/);
    expect((await desktop.link.devices()).map((d) => d.deviceId)).toEqual([1]);
  });

  it('a “no” the new device did not sign removes nothing', async () => {
    const desktop = install('fay-desktop');
    desktop.identity.create('Fay');
    await desktop.account.register(SERVER);
    const offered = (await desktop.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    const phone = install('fay-phone');
    await phone.link.join(offered.code, 'Phone');
    await until(() => desktop.link.status().state === 'request');
    await desktop.link.confirm();
    // Someone (the server) writes a decline without the link secret.
    const id = mailboxId(parseLinkCode(offered.code)!.secret);
    const forged = await server.inject({
      method: 'PUT',
      url: `/v1/link/${id}/decline`,
      payload: { mac: 'A'.repeat(43) },
    });
    expect(forged.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    expect((await desktop.link.devices()).map((d) => d.deviceId)).toEqual([1, 2]);
    phone.link.cancel();
  });

  it('pressing “Link a new device” twice shows one working code, and Link it twice links once', async () => {
    const desktop = install('gil-desktop');
    desktop.identity.create('Gil');
    await desktop.account.register(SERVER);
    const [, second] = await Promise.all([desktop.link.start(), desktop.link.start()]);
    const shown = desktop.link.status() as Extract<LinkProgress, { state: 'offering' }>;
    expect(shown.state).toBe('offering');
    // Never the wiped secret of the replaced attempt (a code of zeros).
    expect(shown.shortCode).not.toMatch(/^[0-]+$/);
    expect(second).toEqual(shown);

    const phone = install('gil-phone');
    await phone.link.join(shown.code, 'Phone');
    await until(() => desktop.link.status().state === 'request');
    const confirms = await Promise.allSettled([desktop.link.confirm(), desktop.link.confirm()]);
    expect(confirms.filter((c) => c.status === 'fulfilled')).toHaveLength(1);
    expect(confirms.find((c) => c.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringMatching(/already being linked/) }),
    });
    const list = await desktop.account.deviceList();
    expect(list.version).toBe(2);
    expect(list.devices.map((d) => d.deviceId)).toEqual([1, 2]);

    // "Linked" names the new device on the desktop only, and clears after a while.
    const linked = desktop.link.status();
    expect(linked).toEqual({ state: 'linked', deviceName: 'Phone' });
    await until(() => phone.link.status().state === 'review');
    await phone.link.accept();
    expect(phone.link.status()).toEqual({ state: 'linked' });
    await until(() => desktop.link.status().state === 'idle', 10_000);
  });

  it('cancelling while the code is being reserved shows no code', async () => {
    const desktop = install('hal-desktop');
    desktop.identity.create('Hal');
    await desktop.account.register(SERVER);
    const starting = desktop.link.start();
    desktop.link.cancel();
    expect((await starting).state).toBe('idle');
    expect(desktop.link.status().state).toBe('idle');
  });

  it('a removed device can be linked again, only to its own account', async () => {
    const desktop = install('ida-desktop');
    const me = desktop.identity.create('Ida');
    await desktop.account.register(SERVER);
    const phone = install('ida-phone');
    await linkUpToReview(desktop, phone);
    await phone.link.accept();
    await until(() => phone.link.status().state === 'linked');
    await desktop.link.remove(2);
    expect(await phone.account.connect()).toMatchObject({ missing: true, wasLinked: true });

    // "Link this device again".
    phone.account.forgetForRelink();
    expect(phone.identity.get()).toBeNull();

    // A code from someone else's account is refused (this phone holds Ida's messages)…
    const other = install('jon-desktop');
    other.identity.create('Jon');
    await other.account.register(SERVER);
    const foreign = (await other.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
    await phone.link.join(foreign.code, 'Phone');
    await until(() => other.link.status().state === 'request');
    await other.link.confirm();
    const refused = await until(() => {
      const p = phone.link.status();
      return p.state === 'failed' ? p : null;
    });
    expect(refused.message).toMatch(/different account/);
    expect(phone.identity.get()).toBeNull();
    // …and Jon's account does not keep the device it was refused by.
    await until(async () => (await other.account.deviceList()).devices.length === 1);

    // A code from Ida's desktop links it again, as a new device of the same account.
    await linkUpToReview(desktop, phone);
    await phone.link.accept();
    expect(phone.identity.get()?.riverId).toBe(me.riverId);
    expect(phone.account.status()).toMatchObject({ state: 'registered', deviceId: 2, connection: 'online' });
    expect(phone.account.relinkTarget()).toBeNull();
  });
});
