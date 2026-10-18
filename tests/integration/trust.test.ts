import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdentity } from '@river/crypto';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { LinkService } from '../../apps/desktop/src/main/account/link-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import {
  SEAL_V2_DEFAULT,
  messageBinding,
  newCommunityKey,
  open,
  openBound,
  seal,
} from '../../apps/desktop/src/main/community/sealed.ts';
// @ts-expect-error -- plain JavaScript reference script, no type declarations
import { parseAddress, sealPost } from '../../scripts/webhook/post.mjs';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
import type { DmEvent } from '../../apps/desktop/src/shared/dm.ts';
import type { LinkProgress } from '../../apps/desktop/src/shared/ipc.ts';
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';

/**
 * The trust audit (2.11): what a malicious or compromised server can no longer do, and the
 * normal flows that must keep working next to it.
 */

const SERVER = 'http://127.0.0.1:8787';
let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
const locals: LocalDatabase[] = [];
const services: CommunityService[] = [];
/** A malicious server changing its answers (a test sets it; cleared after each test). */
let rewrite: ((path: string, body: Buffer) => Buffer) | null = null;

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
  const payload = rewrite ? rewrite(url.pathname, res.rawPayload) : res.rawPayload;
  return new Response(payload.length ? new Uint8Array(payload) : null, {
    status: res.statusCode,
    headers: res.headers as Record<string, string>,
  });
};
const deadSocket = (): WebSocket => ({ send() {}, close() {}, readyState: 0 }) as unknown as WebSocket;

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
  community.keyRequestDelayMs = 0;
  services.push(community);
  const dm = new DmService({ db: () => local, identity, account, community, log: nullLogger });
  const link = new LinkService({
    identity,
    account,
    community,
    requestJson: createRequestJson(injectFetch),
    log: nullLogger,
    onLinked: () => undefined,
  });
  const events: DmEvent[] = [];
  dm.onEvent((e) => events.push(e));
  return { identity, account, dm, community, link, events, local };
}

async function person(name: string) {
  const x = install(name);
  const me = x.identity.create(name);
  await x.account.register(SERVER);
  await x.dm.sync();
  return { ...x, riverId: me.riverId };
}
type Person = Awaited<ReturnType<typeof person>>;

/**
 * The same River ID under a brand-new identity key, as after a reinstall without a backup on a
 * server that lost the account — or as a server that swaps someone's key would present it.
 */
async function reinstall(p: Person, name: string): Promise<Person> {
  const x = install(name);
  const fresh = createIdentity();
  x.identity.adopt({
    riverId: p.riverId,
    publicKey: fresh.publicKey,
    privateKey: fresh.privateKey,
    registrationId: fresh.registrationId,
    displayName: p.identity.get()!.displayName,
  });
  await serverDb.db.deleteFrom('sessions').where('river_id', '=', p.riverId).execute();
  await serverDb.db.deleteFrom('devices').where('river_id', '=', p.riverId).execute();
  await serverDb.db.deleteFrom('accounts').where('river_id', '=', p.riverId).execute();
  await x.account.register(SERVER);
  await x.dm.sync();
  return { ...x, riverId: p.riverId };
}

async function linkDevice(primary: Person, name: string): Promise<Person> {
  const device = install(name);
  const offered = (await primary.link.start()) as Extract<LinkProgress, { state: 'offering' }>;
  await device.link.join(offered.code, name);
  await until(async () => primary.link.status().state === 'request');
  await primary.link.confirm();
  await until(async () => device.link.status().state === 'review');
  await device.link.accept();
  await until(async () => device.link.status().state === 'linked');
  await device.dm.sync();
  return { ...device, riverId: primary.riverId };
}

async function until(check: () => Promise<unknown> | unknown, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}

type Internals = { sendContent(peer: string, content: unknown, ephemeral?: boolean): Promise<void> };
const internals = (p: { dm: DmService }): Internals => p.dm as unknown as Internals;
const messagesOf = async (p: Person, peer: string) => p.dm.action({ a: 'messages', peer });
const conversationOf = async (p: Person, peer: string) =>
  (await p.dm.action({ a: 'conversations' })).find((c) => c.riverId === peer);
const msgId = (): string => randomBytes(16).toString('base64url');
const epochs = (p: Person, communityId: string): number[] =>
  (
    p.local
      .prepare('SELECT epoch FROM community_keys WHERE community_id = ? ORDER BY epoch')
      .all(communityId) as Array<{ epoch: number }>
  ).map((r) => r.epoch);
const keyOf = (p: Person, communityId: string, epoch: number): Buffer =>
  Buffer.from(
    (
      p.local
        .prepare('SELECT key FROM community_keys WHERE community_id = ? AND epoch = ?')
        .get(communityId, epoch) as { key: Uint8Array }
    ).key,
  );
const kept = (p: Person): number =>
  (
    p.local
      .prepare(`SELECT COUNT(*) AS n FROM signal_store WHERE kind = 'meta' AND id LIKE 'dm:inbox:%'`)
      .get() as {
      n: number;
    }
  ).n;

/** Two friends who have written to each other (sessions both ways). */
async function friends(a: Person, b: Person): Promise<void> {
  await a.dm.action({ a: 'open', peer: b.riverId });
  await a.dm.action({ a: 'send', peer: b.riverId, text: `hi ${b.identity.get()!.displayName}` });
  await b.dm.sync();
  await b.dm.action({ a: 'accept', peer: a.riverId });
  await b.dm.action({ a: 'send', peer: a.riverId, text: 'hello' });
  await a.dm.sync();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-trust-'));
  serverDb = openDatabase('sqlite::memory:');
  await migrateToLatest(serverDb.db);
  server = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
      RIVER_ATTACHMENT_DIR: join(dir, 'blobs'),
    }),
    database: serverDb,
    // Stuck rotations are looked for on every request here, not once a minute.
    rotationRecheckMs: 0,
  });
});

afterEach(async () => {
  rewrite = null;
  for (const s of services.splice(0)) s.stop();
  for (const l of locals.splice(0)) l.close();
  await server.close();
  await serverDb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('identity keys a server cannot swap', { timeout: 60_000 }, () => {
  it('a new key after a reinstall is accepted with a warning; a verified contact stays "changed" until verified again', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    await friends(alice, bob);
    await friends(carol, bob);
    const { digits } = await alice.dm.action({ a: 'safetyNumber', peer: bob.riverId });
    // Marking needs the number that was shown.
    await expect(
      alice.dm.action({ a: 'setVerified', peer: bob.riverId, verified: true, digits: '1'.repeat(60) }),
    ).rejects.toThrow(/safety number changed/);
    await expect(alice.dm.action({ a: 'setVerified', peer: bob.riverId, verified: true })).rejects.toThrow();
    await alice.dm.action({ a: 'setVerified', peer: bob.riverId, verified: true, digits });
    expect(await conversationOf(alice, bob.riverId)).toMatchObject({ verified: true });

    // Bob reinstalls: same River ID, new identity key, a device list signed by the new key.
    const bob2 = await reinstall(bob, 'Bob2');
    for (const friend of [alice, carol]) {
      await bob2.dm.action({ a: 'open', peer: friend.riverId });
      await bob2.dm.action({ a: 'send', peer: friend.riverId, text: 'new phone' });
      await friend.dm.sync();
      expect((await messagesOf(friend, bob.riverId)).map((m) => m.text)).toContain('new phone');
    }

    // Carol never verified Bob: a warning, and messaging simply continues.
    expect(await conversationOf(carol, bob.riverId)).toMatchObject({ keyChanged: true, verified: false });
    expect((await conversationOf(carol, bob.riverId))?.verifiedChanged).toBeFalsy();
    await carol.dm.action({ a: 'send', peer: bob.riverId, text: 'welcome back' });
    await bob2.dm.sync();
    expect((await messagesOf(bob2, carol.riverId)).map((m) => m.text)).toContain('welcome back');

    // Alice verified Bob: never silently cleared. River says so and sends nothing until she verifies.
    expect(await conversationOf(alice, bob.riverId)).toMatchObject({
      keyChanged: true,
      verified: false,
      verifiedChanged: true,
    });
    await alice.dm.action({ a: 'acknowledgeKeyChange', peer: bob.riverId });
    expect(await conversationOf(alice, bob.riverId)).toMatchObject({ verifiedChanged: true });
    await expect(alice.dm.action({ a: 'send', peer: bob.riverId, text: 'is that you?' })).rejects.toThrow(
      /Verify them again/,
    );
    await bob2.dm.sync();
    expect((await messagesOf(bob2, alice.riverId)).map((m) => m.text)).not.toContain('is that you?');
    const now = await alice.dm.action({ a: 'safetyNumber', peer: bob.riverId });
    expect(now).toMatchObject({ verified: false, changedSinceVerified: true });
    expect(now.digits).not.toBe(digits);
    // The old number no longer verifies anything; the new one does.
    await expect(
      alice.dm.action({ a: 'setVerified', peer: bob.riverId, verified: true, digits }),
    ).rejects.toThrow();
    await alice.dm.action({ a: 'setVerified', peer: bob.riverId, verified: true, digits: now.digits });
    expect(await conversationOf(alice, bob.riverId)).toMatchObject({ verified: true, keyChanged: false });
    expect((await conversationOf(alice, bob.riverId))?.verifiedChanged).toBeFalsy();
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'verified again' });
    await bob2.dm.sync();
    expect((await messagesOf(bob2, alice.riverId)).map((m) => m.text)).toContain('verified again');
  });

  it('a key that disagrees with the shared community profile is refused when a message arrives', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Crew');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await alice.community.refresh();
    await friends(alice, bob);
    const before = Buffer.from(
      (
        alice.local
          .prepare("SELECT value FROM signal_store WHERE kind = 'identity' AND id = ?")
          .get(bob.riverId) as {
          value: Uint8Array;
        }
      ).value,
    );
    // The server hands out a key of its own for Bob and sends a message "from" him under it.
    const forged = await reinstall(bob, 'Mallory');
    await forged.dm.action({ a: 'open', peer: alice.riverId });
    await forged.dm.action({ a: 'send', peer: alice.riverId, text: 'send me your password' });
    await alice.dm.sync();
    expect((await messagesOf(alice, bob.riverId)).map((m) => m.text)).not.toContain('send me your password');
    const after = alice.local
      .prepare("SELECT value FROM signal_store WHERE kind = 'identity' AND id = ?")
      .get(bob.riverId) as { value: Uint8Array };
    expect(Buffer.from(after.value).equals(before)).toBe(true);
    expect(await conversationOf(alice, bob.riverId)).toMatchObject({ keyChanged: false });
  });

  it('copies "from this account" are accepted only from its own listed devices and identity key', async () => {
    const alice = await person('Alice');
    const laptop = await linkDevice(alice, 'Alice laptop');
    const bob = await person('Bob');
    const victim = await person('Victim');
    const mallory = await person('Mallory');
    await friends(alice, victim);
    await laptop.dm.sync();

    // Normal flow: a message sent on the laptop shows on the desktop as Alice's own.
    await laptop.dm.action({ a: 'open', peer: bob.riverId });
    await laptop.dm.action({ a: 'send', peer: bob.riverId, text: 'from my laptop' });
    let copy: { mine: boolean } | undefined;
    await until(async () => {
      await alice.dm.sync();
      copy = (await messagesOf(alice, bob.riverId)).find((m) => m.text === 'from my laptop');
      return copy;
    });
    expect(copy).toMatchObject({ mine: true });

    // The server relabels Mallory's messages as coming from Alice's laptop, or from a device
    // Alice does not have: a "contacts" copy that would block someone, and a forged sent message.
    const blockVictim = {
      v: 1,
      t: 'contacts',
      contacts: [{ riverId: victim.riverId, state: 'blocked', name: null }],
    };
    const fakeSync = {
      v: 1,
      t: 'sync',
      conv: victim.riverId,
      message: { id: msgId(), text: 'I never wrote this', sentAt: new Date().toISOString() },
    };
    for (const [content, device] of [
      [blockVictim, 2],
      [fakeSync, 2],
      [blockVictim, 9],
    ] as const) {
      await internals(mallory).sendContent(alice.riverId, content);
      await serverDb.db
        .updateTable('mailbox')
        .set({ sender: alice.riverId, sender_device: device })
        .where('sender', '=', mallory.riverId)
        .execute();
      await alice.dm.sync();
    }
    expect(alice.dm.contactState(victim.riverId)).toBe('accepted');
    expect((await messagesOf(alice, victim.riverId)).map((m) => m.text)).not.toContain('I never wrote this');
  });

  it('peer device lists are fetched and verified again once they are a day old', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    await friends(alice, bob);
    const checkedAt = (): number =>
      Number(
        Buffer.from(
          (
            alice.local
              .prepare("SELECT value FROM signal_store WHERE kind = 'meta' AND id = ?")
              .get(`dm:devicesAt:${bob.riverId}`) as { value: Uint8Array }
          ).value,
        ).toString('utf8'),
      );
    const first = checkedAt();
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'fresh list, no lookup' });
    expect(checkedAt()).toBe(first);
    alice.local
      .prepare("UPDATE signal_store SET value = ? WHERE kind = 'meta' AND id = ?")
      .run(Buffer.from(String(Date.now() - 25 * 3_600_000)), `dm:devicesAt:${bob.riverId}`);
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'old list, looked up again' });
    expect(checkedAt()).toBeGreaterThan(Date.now() - 60_000);
    await bob.dm.sync();
    expect((await messagesOf(bob, alice.riverId)).map((m) => m.text)).toContain('old list, looked up again');
  });
});

describe('direct-message replays and parking', { timeout: 60_000 }, () => {
  it('drops traffic for removed and unknown groups, caps what waits, and never rings an old call', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const stranger = await person('Stranger');
    await friends(alice, bob);
    const group = await alice.dm.action({
      a: 'createGroup',
      name: 'Trip',
      members: [bob.riverId, carol.riverId],
    });
    await bob.dm.sync();
    await carol.dm.sync();
    // Bob removes the group: Carol's later messages are dropped, not parked forever.
    await bob.dm.action({ a: 'removeConversation', peer: group.riverId });
    await carol.dm.action({ a: 'send', peer: group.riverId, text: 'still here?' });
    await bob.dm.sync();
    expect(kept(bob)).toBe(0);
    expect((await bob.dm.action({ a: 'conversations' })).some((c) => c.riverId === group.riverId)).toBe(
      false,
    );

    // A stranger cannot fill the waiting space with made-up groups.
    for (let i = 0; i < 3; i++) {
      await internals(stranger).sendContent(bob.riverId, {
        v: 1,
        t: 'msg',
        id: msgId(),
        text: 'spam',
        sentAt: new Date().toISOString(),
        groupId: msgId(),
      });
    }
    await bob.dm.sync();
    expect(kept(bob)).toBe(0);
    // A friend's messages for groups Bob does not know yet wait, at most twenty of them.
    for (let i = 0; i < 24; i++) {
      await internals(alice).sendContent(bob.riverId, {
        v: 1,
        t: 'msg',
        id: msgId(),
        text: `early ${i}`,
        sentAt: new Date().toISOString(),
        groupId: msgId(),
      });
    }
    await bob.dm.sync();
    expect(kept(bob)).toBe(20);

    // An invite's age is measured on this device's own clock (2.11.2): the server's time (here
    // set two minutes back, as a server whose clock runs behind would) never drops a live call.
    // Invites are not stored any more, so an old one cannot wait in the mailbox to ring later.
    const callId = msgId();
    await internals(alice).sendContent(bob.riverId, { v: 1, t: 'call', callId, kind: 'invite' });
    await serverDb.db
      .updateTable('mailbox')
      .set({ received_at: new Date(Date.now() - 120_000).toISOString() })
      .where('recipient', '=', bob.riverId)
      .execute();
    await bob.dm.sync();
    expect(bob.events.some((e) => e.t === 'call' && e.callId === callId)).toBe(true);
    await internals(alice).sendContent(bob.riverId, { v: 1, t: 'call', callId, kind: 'end' });
    await bob.dm.sync();
    const fresh = msgId();
    await internals(alice).sendContent(bob.riverId, { v: 1, t: 'call', callId: fresh, kind: 'invite' });
    await bob.dm.sync();
    expect(bob.events.some((e) => e.t === 'call' && e.callId === fresh)).toBe(true);
  });
});

describe('community keys a server cannot inject', { timeout: 90_000 }, () => {
  async function crew() {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const created = await alice.community.create('Crew');
    const link = await alice.community.invite(created.id);
    await bob.community.join(link, async () => undefined);
    await carol.community.join(link, async () => undefined);
    for (const p of [alice, bob, carol]) await p.community.refresh();
    return { alice, bob, carol, id: created.id, link };
  }

  /** A member the server lists without an invite: its profile is sealed with a key it made up. */
  async function inject(p: Person, communityId: string, profile: string): Promise<void> {
    await serverDb.db
      .insertInto('community_members')
      .values({
        community_id: communityId,
        river_id: p.riverId,
        role: 'member',
        profile,
        joined_on: '2026-10-09',
      })
      .execute();
  }

  it('an invite answered with the ID of a community you are in adds no key to it (2.18)', async () => {
    const { alice, bob, id } = await crew();
    const eve = await person('Eve');
    const bait = await eve.community.create('Bait');
    const baitLink = await eve.community.invite(bait.id);
    const baitKey = keyOf(eve, bait.id, 0);
    // The server answers Alice's join of Eve's invite as if it were for Crew, with a check value
    // sealed (under the key in Eve's link, which the server knows) for the next epoch of Crew.
    rewrite = (path, body) => {
      if (!path.endsWith('/invites/join')) return body;
      const res = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      return Buffer.from(
        JSON.stringify({ ...res, id, inviteCheck: seal(baitKey, id, 'invite', { epoch: 1 }) }),
      );
    };
    await serverDb.db.updateTable('communities').set({ key_epoch: 1 }).where('id', '=', id).execute();
    await alice.community.join(baitLink, async () => undefined).catch(() => undefined);
    rewrite = null;
    expect(epochs(alice, id)).toEqual([0]);
    expect(keyOf(alice, id, 0).equals(keyOf(bob, id, 0))).toBe(true);
    // A link to a community you are already in still just opens it.
    const crewLink = await alice.community.invite(id);
    expect((await bob.community.join(crewLink, async () => undefined)).id).toBe(id);
    expect(epochs(bob, id)).toEqual([0]);
  });

  it('a channel listed under another community is not sealed with that community’s key (2.18)', async () => {
    const { alice, id } = await crew();
    const eve = await person('Eve');
    const bait = await eve.community.create('Bait');
    await alice.community.join(await eve.community.invite(bait.id), async () => undefined);
    const general = (await alice.community.refresh())
      .find((c) => c.id === id)!
      .channels.find((c) => c.kind === 'text')!;
    // The server (which knows Bait's key: Eve made it) lists Crew's channel under Bait, first.
    rewrite = (path, body) => {
      if (!path.endsWith('/communities')) return body;
      const res = JSON.parse(body.toString('utf8')) as {
        communities: Array<{ id: string; channels: Array<{ id: string }> }>;
      };
      const crewWire = res.communities.find((c) => c.id === id)!;
      const baitWire = res.communities.find((c) => c.id === bait.id)!;
      baitWire.channels.push(crewWire.channels.find((ch) => ch.id === general.id)!);
      res.communities = [baitWire, crewWire];
      return Buffer.from(JSON.stringify(res));
    };
    const views = await alice.community.refresh();
    expect(views.find((c) => c.id === bait.id)!.channels.map((c) => c.id)).not.toContain(general.id);
    expect(views.find((c) => c.id === id)!.channels.map((c) => c.id)).toContain(general.id);
    const sent = await alice.community.send(general.id, 'for Crew only');
    rewrite = null;
    const row = await serverDb.db
      .selectFrom('messages')
      .select('body')
      .where('id', '=', sent.id)
      .executeTakeFirstOrThrow();
    const purpose = `message:${general.id}` as const;
    const binding = messageBinding(sent.id, alice.riverId);
    expect(openBound(keyOf(alice, id, 0), id, purpose, binding, row.body).value).toMatchObject({
      text: 'for Crew only',
    });
    expect(() => openBound(keyOf(eve, bait.id, 0), bait.id, purpose, binding, row.body)).toThrow();
  });

  it('a key from a member who never held one is refused, with or without a made-up proof', async () => {
    const { alice, bob, id } = await crew();
    const eve = await person('Eve');
    const fake = newCommunityKey();
    await inject(eve, id, seal(fake, id, 'profile', { name: 'Eve', identityKey: 'x'.repeat(44) }));
    // The server moves the epoch on so the key "is due".
    await serverDb.db.updateTable('communities').set({ key_epoch: 1 }).where('id', '=', id).execute();
    await bob.community.refresh();
    const ckey = { v: 1, t: 'ckey', communityId: id, epoch: 1, key: fake.toString('base64') };
    await internals(eve).sendContent(bob.riverId, ckey);
    await internals(eve).sendContent(bob.riverId, {
      ...ckey,
      prev: 0,
      wrap: seal(newCommunityKey(), id, 'epoch:1', { key: fake.toString('base64'), prev: 0 }),
    });
    await bob.dm.sync();
    await new Promise((r) => setTimeout(r, 300));
    expect(epochs(bob, id)).toEqual([0]);
    expect(alice.riverId).toBeTruthy();
  });

  it('a genuine profile copied into a fake member gets no key and vouches for nothing', async () => {
    const { alice, bob, carol, id } = await crew();
    const eve = await person('Eve');
    const aliceRow = await serverDb.db
      .selectFrom('community_members')
      .select('profile')
      .where('river_id', '=', alice.riverId)
      .executeTakeFirstOrThrow();
    await inject(eve, id, aliceRow.profile);
    for (const p of [alice, bob]) await p.community.refresh();
    // Eve asks for the key: Alice's genuine profile opens, but names Alice's identity key, not Eve's.
    await internals(eve).sendContent(alice.riverId, { v: 1, t: 'ckeyReq', communityId: id, epoch: 0 });
    await alice.dm.sync();
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await serverDb.db.selectFrom('mailbox').selectAll().where('recipient', '=', eve.riverId).execute(),
    ).toEqual([]);
    // Nor does a key "from" Eve without proof count as coming from a member Bob trusted.
    const fake = newCommunityKey();
    await serverDb.db
      .updateTable('community_members')
      .set({ profile: seal(fake, id, 'profile', { name: 'Alice', identityKey: 'y'.repeat(44) }) })
      .where('river_id', '=', eve.riverId)
      .execute();
    await serverDb.db.updateTable('communities').set({ key_epoch: 1 }).where('id', '=', id).execute();
    await bob.community.refresh();
    await internals(eve).sendContent(bob.riverId, {
      v: 1,
      t: 'ckey',
      communityId: id,
      epoch: 1,
      key: fake.toString('base64'),
    });
    await bob.dm.sync();
    await new Promise((r) => setTimeout(r, 300));
    expect(epochs(bob, id)).toEqual([0]);
    expect(carol.riverId).toBeTruthy();
  });

  it('normal rotation after a kick carries a proof; keys from older Rivers still work from trusted members', async () => {
    const { alice, bob, carol, id } = await crew();
    const eve = await person('Eve');
    await inject(
      eve,
      id,
      seal(newCommunityKey(), id, 'profile', { name: 'Eve', identityKey: 'z'.repeat(44) }),
    );
    // Only what the rotation sends is checked below: Bob does not ask anyone for the key meanwhile
    // (on a busy machine his refresh can see the new epoch first, and a request may go to Eve).
    bob.community.keyRequestDelayMs = 20_000;
    await alice.community.action({ a: 'kick', communityId: id, riverId: carol.riverId });
    await alice.community.refresh();
    await until(() => epochs(alice, id).includes(1));
    await until(async () => {
      await bob.community.refresh();
      await bob.dm.sync();
      return epochs(bob, id).includes(1);
    });
    expect(keyOf(bob, id, 1).equals(keyOf(alice, id, 1))).toBe(true);
    // The rotation went only to members holding a genuine key: nothing for the injected Eve.
    expect(
      await serverDb.db.selectFrom('mailbox').selectAll().where('recipient', '=', eve.riverId).execute(),
    ).toEqual([]);
    // Bob reported the new key: the rotation counts as done.
    await until(
      async () =>
        (
          await serverDb.db
            .selectFrom('communities')
            .select('epoch_claimed_at')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).epoch_claimed_at === null,
    );

    // An older River rotates (no proof): Bob accepts it from Alice, whose profile he opened before.
    const next = newCommunityKey();
    await alice.community.api(
      `/communities/${id}/epoch`,
      'POST',
      { from: 1 },
      (await import('zod')).z.unknown(),
    );
    (alice.community as unknown as { storeKey(id: string, k: Buffer, e: number): void }).storeKey(
      id,
      next,
      2,
    );
    await (alice.community as unknown as { publishProfile(id: string): Promise<void> }).publishProfile(id);
    await internals(alice).sendContent(bob.riverId, {
      v: 1,
      t: 'ckey',
      communityId: id,
      epoch: 2,
      key: next.toString('base64'),
    });
    await bob.community.refresh();
    await bob.dm.sync();
    await until(() => epochs(bob, id).includes(2));
  });

  it('a rotation that reaches nobody is asked for again and redone, with an honest notice meanwhile', async () => {
    const { alice, bob, carol, id } = await crew();
    for (const p of [bob, carol]) {
      p.community.keyStuckMs = 0;
      p.community.rotateHandoffMs = 50;
    }
    // Alice claims epoch 1 and then vanishes without handing out the key.
    await alice.community.api(
      `/communities/${id}/epoch`,
      'POST',
      { from: 0 },
      (await import('zod')).z.unknown(),
    );
    let views = await bob.community.refresh();
    expect(views.find((c) => c.id === id)?.securing).toBe(true);
    // Ten minutes pass without anyone reporting the key: the server asks for a rotation again.
    await serverDb.db
      .updateTable('communities')
      .set({ epoch_claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      .where('id', '=', id)
      .execute();
    await until(async () => {
      await bob.community.refresh();
      await carol.community.refresh();
      await bob.dm.sync();
      await carol.dm.sync();
      return epochs(bob, id).includes(2) && epochs(carol, id).includes(2);
    }, 30_000);
    expect(keyOf(bob, id, 2).equals(keyOf(carol, id, 2))).toBe(true);
    views = await bob.community.refresh();
    expect(views.find((c) => c.id === id)?.securing).toBeFalsy();
  });

  it('late joiners get every missing key as a chain, each sealed under the one before', async () => {
    const { alice, bob, carol, id, link } = await crew();
    await alice.community.action({ a: 'kick', communityId: id, riverId: carol.riverId });
    await alice.community.refresh();
    await until(() => epochs(alice, id).includes(1));
    await until(async () => {
      await bob.community.refresh();
      await bob.dm.sync();
      return epochs(bob, id).includes(1);
    });
    await alice.community.action({ a: 'kick', communityId: id, riverId: bob.riverId });
    await alice.community.refresh();
    await until(() => epochs(alice, id).includes(2));
    // Dave joins with the epoch-0 link: he needs keys 1 and 2.
    const dave = await person('Dave');
    dave.community.keyRequestDelayMs = 0;
    await dave.community.join(link, async () => undefined);
    await dave.community.refresh();
    await until(async () => {
      await alice.community.refresh();
      await alice.dm.sync();
      await dave.dm.sync();
      return epochs(dave, id).includes(2);
    }, 20_000);
    expect(epochs(dave, id)).toEqual([0, 1, 2]);
  });
});

describe('community key requests from newcomers', { timeout: 60_000 }, () => {
  it('a member who joined after our last look at the members still gets the key', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Crew');
    const link = await alice.community.invite(created.id);
    await bob.community.join(link, async () => undefined);
    await alice.community.refresh();
    await alice.community.action({ a: 'kick', communityId: created.id, riverId: bob.riverId });
    await alice.community.refresh();
    await until(() => epochs(alice, created.id).includes(1));
    // Dave joins with the epoch-0 link; Alice has not looked at the member list since.
    const dave = await person('Dave');
    await dave.community.join(link, async () => undefined);
    await dave.community.refresh();
    await until(async () => {
      await alice.dm.sync();
      await dave.dm.sync();
      return epochs(dave, created.id).includes(1);
    }, 20_000);
    expect(keyOf(dave, created.id, 1).equals(keyOf(alice, created.id, 1))).toBe(true);
  });

  it('the new key goes out even when the rotating member cannot republish its profile', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const created = await alice.community.create('Crew');
    const link = await alice.community.invite(created.id);
    await bob.community.join(link, async () => undefined);
    await carol.community.join(link, async () => undefined);
    for (const p of [alice, bob, carol]) await p.community.refresh();
    // The profile update fails (the server hiccups) right when Alice replaces the key.
    (alice.community as unknown as { publishProfile(): Promise<void> }).publishProfile = async () => {
      throw new Error('server hiccup');
    };
    await alice.community.action({ a: 'kick', communityId: created.id, riverId: carol.riverId });
    await alice.community.refresh();
    await until(() => epochs(alice, created.id).includes(1));
    await until(async () => {
      await bob.community.refresh();
      await bob.dm.sync();
      return epochs(bob, created.id).includes(1);
    });
    expect(keyOf(bob, created.id, 1).equals(keyOf(alice, created.id, 1))).toBe(true);
  });
});

describe('community messages and profiles bound to who sent them', { timeout: 60_000 }, () => {
  it('v2 messages open for everyone; a server cannot move them to another sender or ID; v1 still works', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Crew');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    await bob.community.refresh();

    // Mixed versions: Alice seals v2 (the default since 2.12), Bob acts as 2.11 (v1). Both read both.
    bob.community.sealV2 = false;
    const v2 = await alice.community.send(general.id, 'sealed v2');
    const v1 = await bob.community.send(general.id, 'sealed v1');
    expect((await bob.community.messages(general.id)).map((m) => m.text)).toEqual(
      expect.arrayContaining(['sealed v2', 'sealed v1']),
    );
    expect((await alice.community.messages(general.id)).map((m) => m.text)).toEqual(
      expect.arrayContaining(['sealed v2', 'sealed v1']),
    );
    // An edit of a v2 message stays v2 and still opens.
    await alice.community.action({
      a: 'edit',
      channelId: general.id,
      messageId: v2.id,
      text: 'sealed v2, edited',
    });
    expect((await bob.community.messages(general.id)).map((m) => m.text)).toContain('sealed v2, edited');

    // The server re-attributes both messages to the other person.
    await serverDb.db.updateTable('messages').set({ sender: bob.riverId }).where('id', '=', v2.id).execute();
    await serverDb.db
      .updateTable('messages')
      .set({ sender: alice.riverId })
      .where('id', '=', v1.id)
      .execute();
    const seen = await bob.community.messages(general.id);
    // v2: refused. v1 (older Rivers): still shown, as before — the reason v2 is coming.
    expect(seen.find((m) => m.id === v2.id)).toBeUndefined();
    expect(seen.find((m) => m.id === v1.id)?.sender).toBe(alice.riverId);

    // A v2 profile copied to another member does not open there.
    await (alice.community as unknown as { publishProfile(id: string): Promise<void> }).publishProfile(
      created.id,
    );
    const aliceRow = await serverDb.db
      .selectFrom('community_members')
      .select('profile')
      .where('river_id', '=', alice.riverId)
      .executeTakeFirstOrThrow();
    await serverDb.db
      .updateTable('community_members')
      .set({ profile: aliceRow.profile })
      .where('river_id', '=', bob.riverId)
      .execute();
    const views = await bob.community.refresh();
    expect(views[0]!.members.find((m) => m.riverId === bob.riverId)?.name).not.toBe('Alice');
    expect(views[0]!.members.find((m) => m.riverId === alice.riverId)?.name).toBe('Alice');
  });

  it('2.12 seals messages, edits and profiles v2 by default; v1 from older Rivers and webhooks still open', async () => {
    expect(SEAL_V2_DEFAULT).toBe(true);
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Crew');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    await bob.community.refresh();
    const key = keyOf(alice, created.id, 0);
    const purpose = `message:${general.id}` as const;
    const stored = async (id: string): Promise<{ body: string; sender: string }> =>
      serverDb.db
        .selectFrom('messages')
        .select(['body', 'sender'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    // A new message is bound to its ID and sender: v1 associated data does not open it.
    const sent = await alice.community.send(general.id, 'hello v2');
    const row = await stored(sent.id);
    expect(() => open(key, created.id, purpose, row.body)).toThrow();
    expect(openBound(key, created.id, purpose, messageBinding(sent.id, alice.riverId), row.body)).toEqual({
      value: expect.objectContaining({ text: 'hello v2' }),
      version: 2,
    });
    // Its edit keeps the same binding (same ID, same sender).
    await alice.community.action({ a: 'edit', channelId: general.id, messageId: sent.id, text: 'edited' });
    const edited = await stored(sent.id);
    expect(
      openBound(key, created.id, purpose, messageBinding(sent.id, alice.riverId), edited.body).version,
    ).toBe(2);
    // The profile is bound to its member.
    const profile = await serverDb.db
      .selectFrom('community_members')
      .select('profile')
      .where('river_id', '=', alice.riverId)
      .executeTakeFirstOrThrow();
    expect(() => open(key, created.id, 'profile', profile.profile)).toThrow();
    expect(openBound(key, created.id, 'profile', alice.riverId, profile.profile).version).toBe(2);

    // A message from a River before 2.12 (v1) still opens, and editing it moves it to v2.
    bob.community.sealV2 = false;
    const old = await bob.community.send(general.id, 'hello v1');
    expect(open<{ text: string }>(key, created.id, purpose, (await stored(old.id)).body).text).toBe(
      'hello v1',
    );
    bob.community.sealV2 = true;
    await bob.community.action({ a: 'edit', channelId: general.id, messageId: old.id, text: 'v1 edited' });
    expect(
      openBound(key, created.id, purpose, messageBinding(old.id, bob.riverId), (await stored(old.id)).body)
        .version,
    ).toBe(2);

    // A webhook post sealed by an outside service with v1 associated data (scripts/webhook) opens.
    const address = await alice.community.action({
      a: 'createWebhook',
      communityId: created.id,
      channelId: general.id,
      name: 'CI',
    });
    const hook = parseAddress(address) as { endpoint: string; token: string };
    const posted = await server.inject({
      method: 'POST',
      url: new URL(hook.endpoint).pathname,
      headers: { authorization: `Bearer ${hook.token}`, 'content-type': 'application/json' },
      payload: { id: msgId(), body: sealPost(parseAddress(address), 'Build passed') },
    });
    expect(posted.statusCode).toBe(201);
    await bob.community.refresh();
    const seen = await bob.community.messages(general.id);
    expect(seen.map((m) => m.text)).toEqual(['edited', 'v1 edited', 'Build passed']);
    expect(seen.find((m) => m.text === 'Build passed')).toMatchObject({ senderName: 'CI' });
  });

  it('a cached file is never served for a pointer with another digest or key', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Files');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    await bob.community.refresh();
    const secret = Buffer.from('the real file');
    const pointer = await alice.community.action({
      a: 'upload',
      name: 'a.txt',
      mime: 'text/plain',
      bytes: new Uint8Array(secret),
    });
    await alice.community.action({ a: 'send', channelId: general.id, text: '', attachments: [pointer] });
    expect(Buffer.from(await bob.community.action({ a: 'download', pointer })).equals(secret)).toBe(true);
    const forged = { ...pointer, digest: Buffer.alloc(32, 9).toString('base64') };
    await expect(bob.community.action({ a: 'download', pointer: forged })).rejects.toThrow(/integrity/);
  });
});
