import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { open } from '../../apps/desktop/src/main/community/sealed.ts';
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

async function person(name: string) {
  const local = migrateDatabase(join(dir, `${name}.db`), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  locals.push(local);
  const identity = new IdentityService(() => local);
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(injectFetch),
    log: nullLogger,
  });
  const me = identity.create(name);
  await account.register(SERVER);
  const community = new CommunityService({
    db: () => local,
    account,
    identity,
    requestJson: createRequestJson(injectFetch),
    requestBytes: createRequestBytes(injectFetch),
    log: nullLogger,
    createSocket: deadSocket,
  });
  community.keyRequestDelayMs = 0;
  const dm = new DmService({ db: () => local, identity, account, community, log: nullLogger });
  await dm.sync();
  return { riverId: me.riverId, community, dm, local };
}

/** Waits until a condition holds (key work runs in the background after a refresh). */
async function until(check: () => Promise<boolean> | boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const epochs = (local: LocalDatabase, communityId: string): number[] =>
  (
    local
      .prepare('SELECT epoch FROM community_keys WHERE community_id = ? ORDER BY epoch')
      .all(communityId) as Array<{
      epoch: number;
    }>
  ).map((r) => r.epoch);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-epochs-'));
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

describe('community key epochs', { timeout: 60_000 }, () => {
  it('rotates the key when someone is removed; late joiners get it; fake members do not', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const created = await alice.community.create('Crew');
    const oldLink = await alice.community.invite(created.id);
    expect(oldLink).not.toContain('&e=');
    await bob.community.join(oldLink, async () => undefined);
    await carol.community.join(oldLink, async () => undefined);
    await alice.community.refresh();
    await bob.community.refresh();
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;

    // Alice kicks Carol: Alice's client rotates to epoch 1 and hands Bob the key.
    await alice.community.action({ a: 'kick', communityId: created.id, riverId: carol.riverId });
    await alice.community.refresh();
    await until(() => epochs(alice.local, created.id).includes(1));
    expect(
      await serverDb.db
        .selectFrom('communities')
        .select(['key_epoch', 'rotation_needed'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ key_epoch: 1, rotation_needed: 0 });
    // Alice hands the key over in the background; keep delivering mail as the WebSocket would.
    await until(async () => {
      await bob.community.refresh();
      await bob.dm.sync();
      return epochs(bob.local, created.id).includes(1);
    });

    // New messages use the new key: Bob reads them, Carol's old key cannot.
    const sent = await alice.community.send(general.id, 'after Carol left');
    expect((await bob.community.messages(general.id)).map((m) => m.text)).toContain('after Carol left');
    const row = await serverDb.db
      .selectFrom('messages')
      .select('body')
      .where('id', '=', sent.id)
      .executeTakeFirstOrThrow();
    const carolKey = (
      carol.local.prepare('SELECT key FROM community_keys WHERE community_id = ?').get(created.id) as {
        key: Uint8Array;
      }
    ).key;
    expect(() => open(carolKey, created.id, `message:${general.id}`, row.body)).toThrow();

    // Dave joins later with the old (epoch 0) link and asks members for the current key.
    const dave = await person('Dave');
    await dave.community.join(oldLink, async () => undefined);
    await dave.community.refresh();
    await until(async () => (await serverDb.db.selectFrom('mailbox').selectAll().execute()).length > 0);
    // Alice answers when she reads Dave's request, and Dave when he reads her answer; in the app
    // both arrive over the WebSocket, here each round delivers whatever is waiting.
    await until(async () => {
      await alice.community.refresh();
      await alice.dm.sync();
      await dave.dm.sync();
      return epochs(dave.local, created.id).includes(1);
    }, 20_000);
    expect((await dave.community.messages(general.id)).map((m) => m.text)).toContain('after Carol left');

    // A member the server injected (no real invite key, so its profile opens with no key) gets nothing.
    const eve = await person('Eve');
    await serverDb.db
      .insertInto('community_members')
      .values({
        community_id: created.id,
        river_id: eve.riverId,
        role: 'member',
        profile: randomBytes(60).toString('base64'),
        joined_on: '2026-10-09',
      })
      .execute();
    await alice.community.refresh();
    await (eve.dm as unknown as { sendContent(p: string, c: unknown): Promise<void> }).sendContent(
      alice.riverId,
      {
        v: 1,
        t: 'ckeyReq',
        communityId: created.id,
        epoch: 1,
      },
    );
    await alice.dm.sync();
    await new Promise((r) => setTimeout(r, 200));
    const toEve = await serverDb.db
      .selectFrom('mailbox')
      .selectAll()
      .where('recipient', '=', eve.riverId)
      .execute();
    expect(toEve).toEqual([]);
  });

  it('new invite links carry the current epoch and verify against a check value', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const created = await alice.community.create('Crew');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await alice.community.refresh();
    await alice.community.action({ a: 'kick', communityId: created.id, riverId: bob.riverId });
    await alice.community.refresh();
    await until(() => epochs(alice.local, created.id).includes(1));
    const link = await alice.community.invite(created.id);
    expect(link).toContain('&e=1');
    await carol.community.join(link, async () => undefined);
    expect(epochs(carol.local, created.id)).toEqual([1]);
    // A tampered key in the link is detected by the check value.
    const tampered = link.replace(/k=[^&]+/, `k=${randomBytes(32).toString('base64url')}`);
    const dave = await person('Dave');
    await expect(dave.community.join(tampered, async () => undefined)).rejects.toThrow(/damaged/);
  });
});
