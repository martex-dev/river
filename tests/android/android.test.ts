import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { _android as android, type AndroidDevice, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/**
 * River for Android on an emulator (CI: .github/workflows/android.yml): the
 * installed debug APK, its two WebViews (UI and client core), libsignal,
 * SQLCipher and the Android Keystore, against a real server and a desktop
 * client running on the test machine. The phone reaches the server through
 * `adb reverse` at 127.0.0.1:8787.
 */

const PACKAGE = 'io.github.martexdev.river';
const PORT = 8787;
const SERVER = `http://127.0.0.1:${PORT}`;

let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
let device: AndroidDevice;
let ui: Page;
let core: Page;
const locals: LocalDatabase[] = [];

const adb = (...args: string[]): string => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(300);
  }
}

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
  await account.register(SERVER);
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

/** Runs window.river calls in the app's UI and unwraps River's Result values. */
async function river<T>(expression: string, arg?: unknown): Promise<T> {
  return ui.evaluate(
    async ({ expression, arg }) => {
      // eslint-disable-next-line no-new-func -- the test drives the app's own API
      const out = await new Function('river', 'arg', `return (${expression})`)(
        (globalThis as unknown as { river: unknown }).river,
        arg,
      );
      if (out && typeof out === 'object' && 'ok' in out && out.ok === false) {
        throw new Error(`River said: ${(out as { message?: string }).message}`);
      }
      return out && typeof out === 'object' && 'ok' in out && 'value' in out ? out.value : out;
    },
    { expression, arg },
  ) as Promise<T>;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-android-'));
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
  await server.listen({ host: '127.0.0.1', port: PORT });
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);

  [device] = await until(() => android.devices().then((d) => (d.length ? d : null)));
  await device.shell(`am force-stop ${PACKAGE}`);
  await device.shell(`am start -W -n ${PACKAGE}/.MainActivity`);
  // Both WebViews live in River's process: the UI (Capacitor) and the private client core.
  const webview = await device.webView({ pkg: PACKAGE }, { timeout: 60_000 });
  const first = await webview.page();
  const pages = (): Page[] => first.context().pages();
  ui = await until(async () => pages().find((p) => p.url().startsWith('https://localhost')) ?? null, 60_000);
  core = await until(async () => pages().find((p) => p.url().includes('/assets/core/')) ?? null, 60_000);
  await until(() => ui.evaluate(() => 'river' in globalThis));
}, 240_000);

/** A clean-up step that may hang (a connection the emulator keeps open): given up on after `ms`. */
const bounded = (step: Promise<unknown> | undefined, ms = 15_000): Promise<unknown> =>
  Promise.race([
    (step ?? Promise.resolve()).catch(() => undefined),
    new Promise((done) => setTimeout(done, ms).unref?.()),
  ]);

afterAll(async () => {
  await bounded(device?.close());
  for (const l of locals.splice(0)) l.close();
  await bounded(server?.close());
  await bounded(serverDb?.close());
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}, 90_000);

describe('River for Android on an emulator', { timeout: 180_000 }, () => {
  it('keeps the UI and the client core apart', async () => {
    // The UI has window.river and nothing else; the native interface exists only in the core.
    expect(await ui.evaluate(() => typeof (globalThis as { RiverNative?: unknown }).RiverNative)).toBe(
      'undefined',
    );
    expect(await core.evaluate(() => typeof (globalThis as { RiverNative?: unknown }).RiverNative)).toBe(
      'object',
    );
  });

  it('serves the UI none of River’s own files, only its interface (2.18)', async () => {
    const status = (path: string) =>
      ui.evaluate(
        (p) =>
          fetch(p).then(
            (r) => r.status,
            () => 0,
          ),
        path,
      );
    expect(await status(`/_capacitor_file_/data/data/${PACKAGE}/files/settings.json`)).toBe(404);
    expect(await status(`/_capacitor_file_/data/user/0/${PACKAGE}/shared_prefs/river-app-lock.xml`)).toBe(
      404,
    );
    expect(await status('/_capacitor_content_/settings/system')).toBe(404);
    expect(await status('/index.html')).toBe(200);
  });

  it('opens SQLCipher storage protected by the Android Keystore', async () => {
    const storage = await until(() =>
      river<{ state: string; protection?: string }>('river.storage.status()').then((s) =>
        s.state === 'open' ? s : null,
      ),
    );
    expect(storage.protection).toBe('os-keystore');
    const security = await river<{ items: Array<{ id: string; value: string; detail: string }> }>(
      'river.security.status()',
    );
    const item = security.items.find((i) => i.id === 'storage');
    expect(item?.value).toBe('Active');
    expect(item?.detail).toContain('Android Keystore');
    expect((await river<{ platform: string }>('river.app.info()')).platform).toBe('android');
  });

  it('creates an account, joins a desktop community and exchanges sealed messages', async () => {
    await river('river.settings.update({ server: { url: arg } })', SERVER);
    await river('river.identity.create("Android CI")');
    expect(await river<{ ok: boolean }>('river.account.register()')).toMatchObject({});

    const alice = await desktop('Alice');
    const created = await alice.community.create('Phones welcome');
    const link = await alice.community.invite(created.id);
    const joined = await river<{ id: string; channels: Array<{ id: string; kind: string }> }>(
      'river.community.join(arg)',
      link,
    );
    expect(joined.id).toBe(created.id);
    const text = joined.channels.find((c) => c.kind === 'text')!;

    await river('river.community.send(arg.channel, arg.text)', {
      channel: text.id,
      text: 'hello from a real Android',
    });
    const seen = await until(async () => {
      await alice.community.refresh();
      return (await alice.community.messages(text.id)).find((m) => m.text === 'hello from a real Android');
    });
    expect(seen.senderName).toBe('Android CI');

    await alice.community.send(text.id, 'hi Android');
    const back = await until(async () => {
      const messages = await river<Array<{ text: string; senderName: string }>>(
        'river.community.messages(arg)',
        text.id,
      );
      return messages.find((m) => m.text === 'hi Android');
    });
    expect(back.senderName).toBe('Alice');

    // libsignal direct messages, both ways, and matching safety numbers.
    await river('river.dm.action(arg)', { a: 'open', peer: alice.riverId, name: 'Alice' });
    await river('river.dm.action(arg)', { a: 'send', peer: alice.riverId, text: 'a DM from Android' });
    const phoneId = (await river<{ riverId: string }>('river.identity.get()')).riverId;
    await until(async () => {
      await alice.dm.sync();
      return (await alice.dm.action({ a: 'messages', peer: phoneId })).find(
        (m) => m.text === 'a DM from Android',
      );
    });
    await alice.dm.action({ a: 'accept', peer: phoneId });
    await alice.dm.action({ a: 'send', peer: phoneId, text: 'DM back to Android' });
    await until(async () => {
      const messages = await river<Array<{ text: string }>>('river.dm.action(arg)', {
        a: 'messages',
        peer: alice.riverId,
      });
      return messages.find((m) => m.text === 'DM back to Android');
    });
    const mine = await river<{ digits: string }>('river.dm.action(arg)', {
      a: 'safetyNumber',
      peer: alice.riverId,
    });
    const theirs = await alice.dm.action({ a: 'safetyNumber', peer: phoneId });
    expect(mine.digits).toBe(theirs.digits);
  });

  it('shows the phone shell: chats, a conversation, a community channel (screenshots for review)', async () => {
    const shots = join(process.cwd(), 'android-screenshots');
    mkdirSync(shots, { recursive: true });
    // The UI was driven through window.river; load it again to show the account it now has.
    await ui.reload();
    // 2.14: no skin chooser in the way — the phone shell comes straight up ("Pick your look" is a card).
    await ui.waitForSelector('.pshell', { timeout: 60_000 });
    await ui.screenshot({ path: join(shots, '0-first-screen.png') });
    await sleep(1500);
    // Chats: the conversation with Alice, opened full screen over the list.
    await ui.screenshot({ path: join(shots, '1-chats.png') });
    await ui.locator('.prow', { hasText: 'Alice' }).first().click();
    await until(() => ui.evaluate("!!document.querySelector('.pchat .pchat-head')"));
    await sleep(800);
    await ui.screenshot({ path: join(shots, '2-direct-message.png') });
    // Android's Back closes the conversation, as MainActivity asks it.
    expect(await ui.evaluate('window.__riverBack()')).toBe(true);
    await until(() => ui.evaluate("!document.querySelector('.pscreen--pushed:not(.is-leaving)')"));
    // Communities: the community, its channels, then the channel.
    await ui
      .getByRole('navigation', { name: 'River' })
      .getByRole('button', { name: /^Communities/ })
      .click();
    await ui.locator('.prow').first().click();
    await ui.waitForSelector('.channel__open', { timeout: 15_000 });
    await sleep(500);
    await ui.screenshot({ path: join(shots, '3-channels.png') });
    await ui.locator('.channel__open').first().click();
    await until(() => ui.evaluate("!!document.querySelector('.pchannel')"));
    await sleep(800);
    await ui.screenshot({ path: join(shots, '4-channel.png') });
    expect(await ui.locator('text=hi Android').count()).toBeGreaterThan(0);
    // Back: the channel, the community, then Chats; on Chats, Back leaves River.
    expect(await ui.evaluate('window.__riverBack()')).toBe(true);
    expect(await ui.evaluate('window.__riverBack()')).toBe(true);
    expect(await ui.evaluate('window.__riverBack()')).toBe(true);
    await until(() => ui.evaluate("!document.querySelector('.pscreen--pushed:not(.is-leaving)')"));
    expect(await ui.evaluate('window.__riverBack()')).toBe(false);
  });
});
