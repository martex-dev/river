import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Desktop main-process code under test.
import { AccountService, UserFacingError } from '../../apps/desktop/src/main/account/account-service.ts';
import { createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
// The real server app.
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';

const testBlobDir = (): string => join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`);

const SERVER = 'http://127.0.0.1:8787';

let dir: string;
let local: LocalDatabase;
let server: FastifyInstance;
let serverDb: RiverDatabase;
let reachable = true;

/** fetch() that delivers requests to the in-process server via Fastify inject. */
const injectFetch: typeof fetch = async (input, init) => {
  if (!reachable) throw new TypeError('fetch failed: ECONNREFUSED');
  const url = new URL(String(input));
  const res = await server.inject({
    method: (init?.method ?? 'GET') as 'GET' | 'POST',
    url: url.pathname + url.search,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    ...(init?.body ? { payload: String(init.body) } : {}),
  });
  return new Response(res.body, { status: res.statusCode, headers: res.headers as Record<string, string> });
};

async function startServer(env: Record<string, string> = {}): Promise<void> {
  serverDb = openDatabase('sqlite::memory:');
  await migrateToLatest(serverDb.db);
  server = await buildApp({
    config: loadConfig({
      RIVER_ATTACHMENT_DIR: testBlobDir(),
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
      ...env,
    }),
    database: serverDb,
  });
}

function client(): { identity: IdentityService; account: AccountService } {
  const identity = new IdentityService(() => local);
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(injectFetch),
    log: nullLogger,
  });
  return { identity, account };
}

beforeEach(async () => {
  reachable = true;
  dir = mkdtempSync(join(tmpdir(), 'river-int-'));
  local = migrateDatabase(join(dir, 'river.db'), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  await startServer();
});

afterEach(async () => {
  local.close();
  await server.close();
  await serverDb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('desktop ↔ server accounts', () => {
  it('registers, then reconnects with only the device key after a restart', async () => {
    const first = client();
    first.identity.create('Alex');
    const status = await first.account.register(SERVER);
    expect(status).toMatchObject({
      state: 'registered',
      deviceId: 1,
      devices: 1,
      listVersion: 1,
      connection: 'online',
    });
    expect(first.account.sessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // "Restart": fresh services over the same local database.
    const second = client();
    expect(second.account.status()).toMatchObject({ state: 'registered', connection: 'offline' });
    expect(await second.account.connect()).toMatchObject({ connection: 'online' });
    expect(second.account.sessionToken()).not.toBe(first.account.sessionToken());
  });

  it('the server never receives the display name or any private key', async () => {
    const c = client();
    c.identity.create('Very Private Name');
    await c.account.register(SERVER);
    const dump = JSON.stringify([
      await serverDb.db.selectFrom('accounts').selectAll().execute(),
      await serverDb.db.selectFrom('devices').selectAll().execute(),
    ]);
    expect(dump).not.toContain('Very Private Name');
    const keys = local
      .prepare('SELECT i.private_key AS a, x.device_private_key AS b FROM identity i, account x')
      .get() as {
      a: Uint8Array;
      b: Uint8Array;
    };
    expect(dump).not.toContain(Buffer.from(keys.a).toString('base64'));
    expect(dump).not.toContain(Buffer.from(keys.b).toString('base64'));
  });

  it('detects a server that swaps the signed device list', async () => {
    const c = client();
    c.identity.create('');
    await c.account.register(SERVER);
    await serverDb.db
      .updateTable('accounts')
      .set({ device_list_signature: randomBytes(64).toString('base64') })
      .execute();
    const status = await c.account.connect();
    expect(status).toMatchObject({ connection: 'error' });
    expect(status.state === 'registered' && status.message).toMatch(/not signed by your identity/);
    expect(c.account.sessionToken()).toBeNull();
  });

  it('reports offline servers without losing the account', async () => {
    const c = client();
    c.identity.create('');
    await c.account.register(SERVER);
    reachable = false;
    expect(await c.account.connect()).toMatchObject({ state: 'registered', connection: 'offline' });
  });

  it('explains closed registration and missing prerequisites in plain language', async () => {
    await server.close();
    await serverDb.close();
    await startServer({ RIVER_REGISTRATION: 'closed' });
    const c = client();
    await expect(c.account.register(SERVER)).rejects.toThrow(/Create your identity/);
    c.identity.create('');
    await expect(c.account.register('http://example.org')).rejects.toThrow(/valid server address/);
    const err = await c.account.register(SERVER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserFacingError);
    expect((err as Error).message).toMatch(/not accepting new accounts/);
    expect(c.account.status()).toEqual({ state: 'none' });
  });

  it('proves it can sign in at its own server before River moves it there', async () => {
    const c = client();
    c.identity.create('');
    await c.account.register(SERVER);
    // Same server, any address (the app uses its loopback address on the hosting PC).
    expect(await c.account.canSignInAt('http://127.0.0.1:9999')).toBe(true);
    // A server that does not hold this account refuses: River would not move there.
    await serverDb.db.deleteFrom('devices').execute();
    expect(await c.account.canSignInAt('http://127.0.0.1:9999')).toBe(false);
    // Unreachable: no.
    reachable = false;
    expect(await c.account.canSignInAt('http://127.0.0.1:9999')).toBe(false);
  });

  it('shares the public address, not 127.0.0.1, when this PC hosts the server', async () => {
    const identity = new IdentityService(() => local);
    let address: string | null = 'https://crew-public.trycloudflare.com';
    const account = new AccountService({
      db: () => local,
      identity,
      requestJson: createRequestJson(injectFetch),
      log: nullLogger,
      publicAddress: () => address,
    });
    identity.create('');
    await account.register(SERVER); // SERVER is a loopback address in these tests
    const status = account.status();
    expect(status.state === 'registered' && status.shareUrl).toBe('https://crew-public.trycloudflare.com');
    // Not hosting (no public address): links fall back to the address the account uses.
    address = null;
    const after = account.status();
    expect(after.state === 'registered' && after.shareUrl).toBe(SERVER);
  });

  it('refuses a second account on the same device', async () => {
    const c = client();
    c.identity.create('');
    await c.account.register(SERVER);
    await expect(c.account.register(SERVER)).rejects.toThrow(/already has an account/);
  });
});
