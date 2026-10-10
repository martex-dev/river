import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beaconMessage } from '@river/protocol';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { ServerLocator } from '../../apps/desktop/src/main/community/server-locator.ts';
import { createFetchBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';

// A home server restarts behind a new tunnel address; the app follows it, but only to the same server.
const TOKEN = 't'.repeat(48);
let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
let local: LocalDatabase;
/** What the public relay holds: one JSON line per note, as ntfy returns them. */
let relayLines: string[];
/** Addresses where the server can be reached right now. */
let reachable: Set<string>;

const inject = async (url: URL, init?: RequestInit): Promise<Response> => {
  const res = await server.inject({
    method: (init?.method ?? 'GET') as 'GET',
    url: url.pathname + url.search,
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    ...(init?.body ? { payload: String(init.body) } : {}),
  });
  return new Response(res.rawPayload.length ? new Uint8Array(res.rawPayload) : null, {
    status: res.statusCode,
    headers: res.headers as Record<string, string>,
  });
};

/** The network as the app sees it. */
const network: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.host === 'relay.test') return new Response(relayLines.join('\n'));
  if (!reachable.has(url.origin)) throw new TypeError('fetch failed');
  return inject(url, init);
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-locator-'));
  relayLines = [];
  reachable = new Set(['https://old.test']);
  serverDb = openDatabase('sqlite::memory:');
  await migrateToLatest(serverDb.db);
  server = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_ATTACHMENT_DIR: join(dir, 'blobs'),
      RIVER_BEACON_RELAY: 'https://relay.test',
      RIVER_HOST_TOKEN: TOKEN,
    }),
    database: serverDb,
    // The server publishing to the relay.
    fetch: (async (_url: string, init: RequestInit) => {
      relayLines.push(JSON.stringify({ event: 'message', message: String(init.body) }));
      return new Response('ok');
    }) as unknown as typeof fetch,
  });
  local = migrateDatabase(join(dir, 'app.db'), newDatabaseKey(), CLIENT_MIGRATIONS).db;
});

afterEach(async () => {
  local.close();
  await server.close();
  await serverDb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function setUp(): Promise<{ account: AccountService; locator: ServerLocator; moved: string[] }> {
  const identity = new IdentityService(() => local);
  identity.create('Alice');
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(network),
    log: nullLogger,
  });
  await account.register('https://old.test');
  const moved: string[] = [];
  const locator = new ServerLocator({
    db: () => local,
    account,
    requestJson: createRequestJson(network),
    fetchBytes: createFetchBytes(network),
    log: nullLogger,
    onMoved: (url) => moved.push(url),
  });
  return { account, locator, moved };
}

/** River Host telling the server its new address (from this machine, with its token). */
const announce = (url: string) =>
  server.inject({
    method: 'POST',
    url: '/v1/instance/address',
    headers: { authorization: `Bearer ${TOKEN}` },
    payload: { url },
  });

describe('following a home server to its new address', () => {
  it('moves the account to the address the server signed, after checking it is the same server', async () => {
    const { account, locator, moved } = await setUp();
    await locator.pin();
    expect(await locator.follow()).toBeNull(); // nothing announced yet

    // The PC restarts: the old address dies, the server announces the new one.
    reachable = new Set(['https://new.test']);
    expect((await announce('https://new.test')).statusCode).toBe(200);
    expect(await locator.follow()).toBe('https://new.test');
    expect(account.status()).toMatchObject({ serverUrl: 'https://new.test' });
    expect(moved).toEqual(['https://new.test']);
  });

  it('ignores notes signed by anyone else, and a different server at the announced address', async () => {
    const { account, locator } = await setUp();
    await locator.pin();
    reachable = new Set(['https://evil.test']);
    // A forged note: right format, wrong key.
    const forger = generateKeyPairSync('ed25519').privateKey;
    const issuedAt = new Date().toISOString();
    const id = ((await (await network('https://evil.test/v1/instance')).json()) as { id: string }).id;
    relayLines.push(
      JSON.stringify({
        event: 'message',
        message: JSON.stringify({
          url: 'https://evil.test',
          issuedAt,
          sig: sign(null, beaconMessage(id, 'https://evil.test', issuedAt), forger).toString('base64'),
        }),
      }),
    );
    expect(await locator.follow()).toBeNull();
    expect(account.status()).toMatchObject({ serverUrl: 'https://old.test' });
  });
});
