import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IPC, type CommunityView, type Result } from '../../apps/desktop/src/shared/ipc.ts';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';
import { startPhone, type Phone } from './phone.ts';

/**
 * River for Android's client core (apps/mobile/core), as built for the phone,
 * against a real server and the desktop client: accounts, joining by invite,
 * sealed community messages both ways, and libsignal direct messages.
 */

const MOBILE = resolve(import.meta.dirname, '../../apps/mobile');
let bundle: string;
let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
let url: string;
const locals: LocalDatabase[] = [];
const phones: Phone[] = [];

async function desktop(name: string) {
  const local = migrateDatabase(join(dir, `${name}.db`), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  locals.push(local);
  const identity = new IdentityService(() => local);
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(fetch),
    log: nullLogger,
  });
  const me = identity.create(name);
  await account.register(url);
  const community = new CommunityService({
    db: () => local,
    account,
    identity,
    requestJson: createRequestJson(fetch),
    requestBytes: createRequestBytes(fetch),
    blobDir: () => join(dir, `${name}-blobs`),
    log: nullLogger,
    createSocket: () => ({ send() {}, close() {}, readyState: 0 }) as unknown as WebSocket,
  });
  const dm = new DmService({ db: () => local, identity, account, community, log: nullLogger });
  await dm.sync();
  return { riverId: me.riverId, community, dm };
}

async function phone(name: string): Promise<Phone & { riverId: string }> {
  const p = await startPhone(bundle, mkdtempSync(join(dir, 'phone-')));
  phones.push(p);
  await p.invoke(IPC.settingsUpdate, { server: { url } });
  const created = await p.invoke<{ riverId: string }>(IPC.identityCreate, name);
  const registered = await p.invoke<{ ok: boolean; message?: string }>(IPC.accountRegister);
  expect(registered).toMatchObject({ ok: true });
  return Object.assign(p, { riverId: created.riverId });
}

const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

async function until<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 15_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  await build({ configFile: join(MOBILE, 'vite.core.config.ts'), logLevel: 'silent' });
  const assets = join(MOBILE, 'dist/core/assets');
  bundle = join(
    assets,
    readdirSync(assets).find((f) => f.endsWith('.js'))!,
  );
  dir = mkdtempSync(join(tmpdir(), 'river-phone-'));
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
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}, 120_000);

afterAll(async () => {
  for (const p of phones.splice(0)) await p.stop();
  for (const l of locals.splice(0)) l.close();
  await server?.close();
  await serverDb?.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('River for Android: client core', { timeout: 60_000 }, () => {
  it('starts with encrypted local storage and the Security Center reporting the phone keystore', async () => {
    const p = await phone('Starter');
    expect(await p.invoke(IPC.storageStatus)).toMatchObject({ state: 'open', protection: 'os-keystore' });
    const info = await p.invoke<{ platform: string }>(IPC.appInfo);
    expect(info.platform).toBe('android');
    expect(p.nativeCalls.get('db.open')).toBe(1);
    // Hosting is a computer feature and says so.
    expect(await p.invoke(IPC.hostStatus)).toMatchObject({ state: 'off', enabled: false });
  });

  it('passes haptics and picture-in-picture to the phone, and drops anything malformed', async () => {
    const p = await phone('Feel');
    p.send(IPC.appHaptic, 'select');
    p.send(IPC.appHaptic, 'boom');
    p.send(IPC.voicePip, 'yes');
    p.send(IPC.voicePip, true);
    const deadline = Date.now() + 5000;
    while (!p.asks.some((a) => a.kind === 'pip') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(p.asks.filter((a) => a.kind === 'haptic').map((a) => a.args)).toEqual([{ kind: 'select' }]);
    expect(p.asks.filter((a) => a.kind === 'pip').map((a) => a.args)).toEqual([{ on: true }]);
  });

  it('joins a desktop community by invite and exchanges sealed messages both ways', async () => {
    const alice = await desktop('Alice');
    const created = await alice.community.create('Phones welcome');
    const link = await alice.community.invite(created.id);

    const p = await phone('Pixel');
    ok(await p.invoke<Result<unknown>>(IPC.communityJoin, link));
    const list = ok(await p.invoke<Result<CommunityView[]>>(IPC.communityList));
    const joined = list.find((c) => c.id === created.id)!;
    expect(joined.name).toBe('Phones welcome');
    const text = joined.channels.find((c) => c.kind === 'text')!;

    ok(await p.invoke<Result<unknown>>(IPC.communitySend, text.id, 'hello from Android 📱'));
    const seen = await until(async () => {
      await alice.community.refresh();
      const messages = await alice.community.messages(text.id);
      return messages.find((m) => m.text === 'hello from Android 📱');
    });
    expect(seen.senderName).toBe('Pixel');

    await alice.community.send(text.id, 'hi phone');
    const back = await until(async () => {
      const messages = ok(
        await p.invoke<Result<Array<{ text: string; senderName: string }>>>(IPC.communityMessages, text.id),
      );
      return messages.find((m) => m.text === 'hi phone');
    });
    expect(back.senderName).toBe('Alice');
  });

  it('sends and receives libsignal direct messages with a desktop', async () => {
    const alice = await desktop('Dana');
    const created = await alice.community.create('DM club');
    const p = await phone('Galaxy');
    ok(await p.invoke<Result<unknown>>(IPC.communityJoin, await alice.community.invite(created.id)));
    await alice.community.refresh();
    const dmOk = <T>(r: Result<T>): T => ok(r);
    dmOk(await p.invoke<Result<unknown>>(IPC.dmAction, { a: 'open', peer: alice.riverId, name: 'Dana' }));
    dmOk(
      await p.invoke<Result<unknown>>(IPC.dmAction, {
        a: 'send',
        peer: alice.riverId,
        text: 'first contact from a phone',
      }),
    );
    const got = await until(async () => {
      await alice.dm.sync();
      const messages = await alice.dm.action({ a: 'messages', peer: p.riverId });
      return messages.find((m) => m.text === 'first contact from a phone');
    });
    expect(got.mine).toBe(false);

    await alice.dm.action({ a: 'accept', peer: p.riverId });
    await alice.dm.action({ a: 'send', peer: p.riverId, text: 'reply from the desktop' });
    const reply = await until(async () => {
      const messages = dmOk(
        await p.invoke<Result<Array<{ text: string; mine: boolean }>>>(IPC.dmAction, {
          a: 'messages',
          peer: alice.riverId,
        }),
      );
      return messages.find((m) => m.text === 'reply from the desktop');
    });
    expect(reply.mine).toBe(false);

    // Both sides compute the same safety number (libsignal fingerprint, native on the phone).
    const mine = dmOk(
      await p.invoke<Result<{ digits: string }>>(IPC.dmAction, { a: 'safetyNumber', peer: alice.riverId }),
    );
    const theirs = await alice.dm.action({ a: 'safetyNumber', peer: p.riverId });
    expect(mine.digits).toBe(theirs.digits);
  });
});
