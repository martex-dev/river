import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { BackupService } from '../../apps/desktop/src/main/backup/backup-service.ts';
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

/** One River install (a local database and its services), optionally with a new identity and account. */
async function install(file: string, name?: string) {
  const local = migrateDatabase(join(dir, file), newDatabaseKey(), CLIENT_MIGRATIONS).db;
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
    log: nullLogger,
    createSocket: deadSocket,
  });
  const dm = new DmService({ db: () => local, identity, account, community, log: nullLogger });
  const backup = new BackupService({ db: () => local });
  if (name) {
    identity.create(name);
    await account.register(SERVER);
    await dm.sync();
  }
  return { identity, account, community, dm, backup, local };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-backup-'));
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

describe('backup and restore', { timeout: 60_000 }, () => {
  it('restores identity, communities and messages on a new computer; conversations keep working', async () => {
    const alice = await install('alice.db', 'Alice');
    const bob = await install('bob.db', 'Bob');
    const aliceId = alice.identity.get()!.riverId;
    const bobId = bob.identity.get()!.riverId;
    const created = await alice.community.create('Crew');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    await alice.community.send(general.id, 'community history');
    await alice.dm.action({ a: 'open', peer: bobId });
    await alice.dm.action({ a: 'send', peer: bobId, text: 'before the crash' });
    await bob.dm.sync();
    await bob.dm.action({ a: 'accept', peer: aliceId });
    await bob.dm.action({ a: 'send', peer: aliceId, text: 'got it' });
    await alice.dm.sync();
    await alice.dm.action({ a: 'setVerified', peer: bobId, verified: true });

    const phrase = alice.backup.phrase();
    expect(phrase).toHaveLength(18);
    const file = alice.backup.create();
    expect(Buffer.from(file).toString('latin1')).not.toContain('before the crash');
    expect(alice.backup.status().lastBackupAt).not.toBeNull();

    // Alice's computer is gone. On a new one she restores from the file and her phrase.
    const restored = await install('alice-new.db');
    expect(() => restored.backup.restore(file, [...phrase].reverse().join(' '))).toThrow();
    restored.backup.restore(file, phrase.join(' '));
    expect(restored.identity.get()!.riverId).toBe(aliceId);
    restored.dm.afterRestore();
    await restored.account.connect();
    expect(restored.account.status()).toMatchObject({ state: 'registered', connection: 'online' });

    // Communities: keys came back, so history decrypts.
    const communities = await restored.community.refresh();
    expect(communities[0]!.name).toBe('Crew');
    expect((await restored.community.messages(general.id)).map((m) => m.text)).toContain('community history');

    // Direct messages: history and trust came back; new sessions are made automatically.
    expect((await restored.dm.action({ a: 'messages', peer: bobId })).map((m) => m.text)).toEqual([
      'before the crash',
      'got it',
    ]);
    expect((await restored.dm.action({ a: 'conversations' }))[0]).toMatchObject({
      name: 'Bob',
      verified: true,
    });
    await restored.dm.sync(); // fresh prekeys, then a hello to Bob that gives him a new session
    await bob.dm.sync();
    await bob.dm.action({ a: 'send', peer: aliceId, text: 'welcome back' });
    await restored.dm.sync();
    expect((await restored.dm.action({ a: 'messages', peer: bobId })).map((m) => m.text)).toContain(
      'welcome back',
    );

    // A stranger's first message works too (stale prekeys of the old install were replaced).
    const carol = await install('carol.db', 'Carol');
    await carol.dm.action({ a: 'open', peer: aliceId });
    await carol.dm.action({ a: 'send', peer: aliceId, text: 'hi Alice' });
    await restored.dm.sync();
    expect((await restored.dm.action({ a: 'conversations' })).map((c) => c.name)).toContain('Carol');

    // A restore never overwrites an existing identity.
    expect(() => restored.backup.restore(file, phrase.join(' '))).toThrow(/fresh install/);
  });
});
