import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IPC, type CommunityView, type Result } from '../../apps/desktop/src/shared/ipc.ts';
import { DEFAULT_SETTINGS, type Settings } from '../../apps/desktop/src/shared/settings.ts';
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
import { startPhone, type Phone, type PhoneOptions } from './phone.ts';

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

async function phone(name: string, options?: PhoneOptions): Promise<Phone & { riverId: string }> {
  const p = await startPhone(bundle, mkdtempSync(join(dir, 'phone-')), options);
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

  it('leaves the call when the UI goes away while the core stays connected', async () => {
    const alice = await desktop('Caller');
    const created = await alice.community.create('Voice club');
    const p = await phone('Nokia');
    ok(await p.invoke<Result<unknown>>(IPC.communityJoin, await alice.community.invite(created.id)));
    const joined = ok(await p.invoke<Result<CommunityView[]>>(IPC.communityList)).find(
      (c) => c.id === created.id,
    )!;
    const channel = joined.channels.find((c) => c.kind === 'voice') ?? joined.channels[0]!;
    const callAsks = (): unknown[] => p.asks.filter((a) => a.kind === 'call').map((a) => a.args);
    ok(await p.invoke<Result<unknown>>(IPC.voiceJoin, channel.id));
    await until(async () => callAsks().length === 1);
    // The "In a call" notification names it (2.11).
    expect(callAsks()).toEqual([{ active: true, title: 'Voice channel' }]);
    // River's screen closed: its WebView carried the call's sound, so the core ends the call.
    p.uiGone();
    await until(async () => callAsks().length === 2);
    expect(callAsks()).toEqual([{ active: true, title: 'Voice channel' }, { active: false }]);
  });

  it('stays connected by default on a new Android install, and asks an existing install once', async () => {
    // A new install: nothing of River on the phone yet.
    const fresh = await phone('Fresh');
    const settings = await fresh.invoke<Settings>(IPC.settingsGet);
    expect(settings.system.background).toBe(true);
    expect(settings.system.backgroundAsked).toBe(false);
    expect(settings.system.wakeScreen).toBe(true);
    expect(fresh.asks.filter((a) => a.kind === 'background').map((a) => a.args)).toEqual([{ enabled: true }]);

    // An install from before 2.11: its settings file has neither new setting.
    const root = mkdtempSync(join(dir, 'phone-'));
    mkdirSync(join(root, 'files'), { recursive: true });
    const older = structuredClone(DEFAULT_SETTINGS) as unknown as { system: Record<string, unknown> };
    delete older.system.backgroundAsked;
    delete older.system.wakeScreen;
    writeFileSync(join(root, 'files', 'settings.json'), JSON.stringify(older));
    let existing = await startPhone(bundle, root);
    phones.push(existing);
    let kept = await existing.invoke<Settings>(IPC.settingsGet);
    // Not switched on behind the person's back: the UI asks once instead.
    expect(kept.system.background).toBe(false);
    expect(kept.system.backgroundAsked).toBe(false);
    expect(
      existing.asks.some((a) => a.kind === 'background' && (a.args as { enabled: boolean }).enabled),
    ).toBe(false);
    // "Not now": remembered, so River never asks again, even after starting again.
    await existing.invoke(IPC.settingsUpdate, { system: { backgroundAsked: true } });
    await existing.stop();
    phones.splice(phones.indexOf(existing), 1);
    existing = await startPhone(bundle, root);
    phones.push(existing);
    kept = await existing.invoke<Settings>(IPC.settingsGet);
    expect(kept.system).toMatchObject({ background: false, backgroundAsked: true });
  });

  it("reports the phone's state to Settings and passes fixes to the phone, validated", async () => {
    const p = await phone('Settings');
    expect(await p.invoke(IPC.appPhoneStatus)).toEqual({
      background: true,
      batteryExempt: false,
      fullScreenCalls: true,
      notifications: true,
    });
    await p.invoke(IPC.appPhoneFix, 'battery');
    await expect(p.invoke(IPC.appPhoneFix, 'reboot')).rejects.toThrow();
    expect(p.asks.filter((a) => a.kind === 'phoneFix').map((a) => a.args)).toEqual([{ fix: 'battery' }]);
  });

  describe("incoming calls on the phone's own call screen", () => {
    const callId = (name: string): string => name.padEnd(22, '_');
    let caller: Phone & { riverId: string };
    let callee: Phone & { riverId: string };

    beforeAll(async () => {
      caller = await phone('Caller phone');
      callee = await phone('Called phone', { hold: ['incomingCall'] });
      // People find each other through a community they share.
      const host = await desktop('Call host');
      const club = await host.community.create('Phone calls');
      for (const p of [caller, callee])
        ok(await p.invoke<Result<unknown>>(IPC.communityJoin, await host.community.invite(club.id)));
      ok(
        await caller.invoke<Result<unknown>>(IPC.dmAction, {
          a: 'open',
          peer: callee.riverId,
          name: 'Called',
        }),
      );
      ok(await caller.invoke<Result<unknown>>(IPC.dmAction, { a: 'send', peer: callee.riverId, text: 'hi' }));
      await until(async () => {
        const messages = ok(
          await callee.invoke<Result<Array<{ text: string }>>>(IPC.dmAction, {
            a: 'messages',
            peer: caller.riverId,
          }),
        );
        return messages.some((m) => m.text === 'hi');
      });
      ok(await callee.invoke<Result<unknown>>(IPC.dmAction, { a: 'accept', peer: caller.riverId }));
    }, 60_000);

    const invite = async (id: string): Promise<{ kind: string; args: unknown }> => {
      ok(
        await caller.invoke<Result<unknown>>(IPC.dmAction, {
          a: 'call',
          peer: callee.riverId,
          callId: id,
          kind: 'invite',
          video: true,
        }),
      );
      return until(async () =>
        callee.asks.find((a) => a.kind === 'incomingCall' && (a.args as { callId: string }).callId === id),
      );
    };
    const ringingOff = (): number =>
      callee.asks.filter((a) => a.kind === 'ringing' && !(a.args as { on: boolean }).on).length;

    it("rings with the caller hidden by default, and declines without River's screen", async () => {
      const id = callId('declined');
      const ring = await invite(id);
      // Settings → Notifications → preview is "Hidden" by default: no name on the lock screen.
      expect(ring.args).toEqual({ callId: id, name: 'Someone', video: true });
      const before = ringingOff();
      callee.answerAsk('incomingCall', 'decline');
      // The caller hears "declined": the core told it, with no window on the called phone.
      await caller.waitFor(IPC.dmEvent, (args) => {
        const e = args[0] as { t: string; kind?: string; callId?: string };
        return e.t === 'call' && e.kind === 'decline' && e.callId === id;
      });
      await callee.waitFor(IPC.appPhoneCall, (args) => {
        const e = args[0] as { callId: string; action: string };
        return e.callId === id && e.action === 'decline';
      });
      await until(async () => ringingOff() > before);
      // Kept in the call history, as a call declined in River's window is.
      const calls = await until(async () => {
        const list = ok(
          await callee.invoke<Result<Array<{ peer: string; answered: boolean }>>>(IPC.dmAction, {
            a: 'calls',
          }),
        );
        return list.some((c) => c.peer === caller.riverId && !c.answered) ? list : null;
      });
      expect(calls.length).toBeGreaterThan(0);
    });

    it('stops ringing when the caller hangs up', async () => {
      const id = callId('hungup');
      await invite(id);
      const before = ringingOff();
      ok(
        await caller.invoke<Result<unknown>>(IPC.dmAction, {
          a: 'call',
          peer: callee.riverId,
          callId: id,
          kind: 'end',
        }),
      );
      await until(async () => ringingOff() > before);
      // Ringing is over: an answer the phone sends late changes nothing.
      callee.answerAsk('incomingCall', 'ended');
      expect(ok(await callee.invoke<Result<unknown>>(IPC.dmAction, { a: 'pendingCall' }))).toBeNull();
    });

    it("answered on the call screen: River's window answers it, now or when it opens", async () => {
      const id = callId('answered');
      await invite(id);
      callee.answerAsk('incomingCall', 'accept');
      await callee.waitFor(IPC.appPhoneCall, (args) => {
        const e = args[0] as { callId: string; action: string };
        return e.callId === id && e.action === 'answer';
      });
      const pending = ok(
        await callee.invoke<Result<{ callId: string; answer?: boolean }>>(IPC.dmAction, { a: 'pendingCall' }),
      );
      expect(pending).toMatchObject({ callId: id, kind: 'invite', answer: true });
      // The window accepts it: the call no longer rings for a window that opens later.
      ok(
        await callee.invoke<Result<unknown>>(IPC.dmAction, {
          a: 'call',
          peer: caller.riverId,
          callId: id,
          kind: 'accept',
        }),
      );
      expect(ok(await callee.invoke<Result<unknown>>(IPC.dmAction, { a: 'pendingCall' }))).toBeNull();
    });
  });

  it('checks its connection when the watchdog wakes the phone', async () => {
    const p = await phone('Sleeper');
    p.wake();
    // Still connected afterwards: the probe's ping is answered, nothing is torn down.
    await new Promise((r) => setTimeout(r, 1500));
    expect(p.events.some((e) => e.channel === 'core:fatal')).toBe(false);
    expect(await p.invoke(IPC.accountStatus)).toMatchObject({ state: 'registered' });
  });
});
