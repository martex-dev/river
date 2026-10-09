import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
import type { DmEvent } from '../../apps/desktop/src/shared/dm.ts';
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
  const dm = new DmService({ db: () => local, identity, account, community, log: nullLogger });
  const events: DmEvent[] = [];
  dm.onEvent((e) => events.push(e));
  await dm.sync();
  return { riverId: me.riverId, dm, community, events, local };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-dm-'));
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

describe('desktop ↔ server direct messages', { timeout: 30_000 }, () => {
  it('first contact, request, accept, replies, receipts, edits, reactions and deletes', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');

    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    const sent = await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'hi Bob 👋' });
    expect(sent.status).toBe('sent');

    // Bob was offline: the message waits in the mailbox, arrives as a request with Alice's profile.
    await bob.dm.sync();
    let convs = await bob.dm.action({ a: 'conversations' });
    expect(convs).toEqual([
      expect.objectContaining({ riverId: alice.riverId, name: 'Alice', state: 'request', unread: 1 }),
    ]);
    const [received] = await bob.dm.action({ a: 'messages', peer: alice.riverId });
    expect(received).toMatchObject({ id: sent.id, text: 'hi Bob 👋', mine: false });
    // Requests do not leak receipts.
    await alice.dm.sync();
    expect((await alice.dm.action({ a: 'messages', peer: bob.riverId }))[0]!.status).toBe('sent');

    await bob.dm.action({ a: 'accept', peer: alice.riverId });
    await bob.dm.action({ a: 'read', peer: alice.riverId });
    const reply = await bob.dm.action({ a: 'send', peer: alice.riverId, text: 'hey!', replyTo: sent.id });
    await alice.dm.sync();
    const aliceView = await alice.dm.action({ a: 'messages', peer: bob.riverId });
    expect(aliceView.find((m) => m.id === sent.id)!.status).toBe('read');
    expect(aliceView.find((m) => m.id === reply.id)).toMatchObject({ text: 'hey!', replyTo: sent.id });
    expect((await alice.dm.action({ a: 'conversations' }))[0]).toMatchObject({ name: 'Bob', unread: 1 });

    // Edit, react, delete for everyone.
    await alice.dm.action({ a: 'edit', peer: bob.riverId, id: sent.id, text: 'hi Bob!' });
    await alice.dm.action({ a: 'react', peer: bob.riverId, id: reply.id, emoji: '❤️', on: true });
    await bob.dm.sync();
    let bobView = await bob.dm.action({ a: 'messages', peer: alice.riverId });
    expect(bobView.find((m) => m.id === sent.id)).toMatchObject({ text: 'hi Bob!' });
    expect(bobView.find((m) => m.id === sent.id)!.editedAt).not.toBeNull();
    expect(bobView.find((m) => m.id === reply.id)!.reactions).toEqual([
      { emoji: '❤️', count: 1, mine: false, users: [alice.riverId] },
    ]);
    await alice.dm.action({ a: 'delete', peer: bob.riverId, id: sent.id, forEveryone: true });
    await bob.dm.sync();
    bobView = await bob.dm.action({ a: 'messages', peer: alice.riverId });
    expect(bobView.find((m) => m.id === sent.id)).toMatchObject({ deleted: true, text: '' });

    // Bob cannot edit Alice's message (only the author's edits are applied).
    await expect(
      bob.dm.action({ a: 'edit', peer: alice.riverId, id: sent.id, text: 'forged' }),
    ).rejects.toThrow();

    // Safety numbers match on both sides.
    const a = await alice.dm.action({ a: 'safetyNumber', peer: bob.riverId });
    const b = await bob.dm.action({ a: 'safetyNumber', peer: alice.riverId });
    expect(a.digits).toBe(b.digits);
    expect(a.digits).toMatch(/^\d{60}$/);

    // The server only ever held ciphertext.
    const mailbox = JSON.stringify(await serverDb.db.selectFrom('mailbox').selectAll().execute());
    for (const s of ['hi Bob', 'hey!', '❤️', 'Alice', 'Bob']) expect(mailbox).not.toContain(s);

    convs = await bob.dm.action({ a: 'conversations' });
    expect(convs[0]!.state).toBe('accepted');
  });

  it('sends encrypted files in direct messages', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const pointer = await alice.dm.action({
      a: 'upload',
      name: 'notes.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode('private notes'),
    });
    await alice.dm.action({ a: 'open', peer: bob.riverId });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: '', attachments: [pointer] });
    await bob.dm.sync();
    const [m] = await bob.dm.action({ a: 'messages', peer: alice.riverId });
    expect(m!.attachments).toEqual([pointer]);
    const bytes = await bob.community.downloadAttachment(m!.attachments[0]!);
    expect(new TextDecoder().decode(bytes)).toBe('private notes');
  });

  it('blocking hides you from the blocked person and drops their messages', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    await alice.dm.action({ a: 'open', peer: bob.riverId });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'one' });
    await bob.dm.sync();
    await bob.dm.action({ a: 'block', peer: alice.riverId });
    await expect(alice.dm.action({ a: 'send', peer: bob.riverId, text: 'two' })).resolves.toBeTruthy();
    await bob.dm.sync();
    expect((await bob.dm.action({ a: 'messages', peer: alice.riverId })).map((m) => m.text)).toEqual(['one']);
    // Nobody can open a conversation with themselves.
    const carol = await person('Carol');
    await expect(carol.dm.action({ a: 'open', peer: carol.riverId })).rejects.toThrow(/your own/);
    await bob.dm.action({ a: 'unblock', peer: alice.riverId });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'three' });
    await bob.dm.sync();
    expect((await bob.dm.action({ a: 'messages', peer: alice.riverId })).map((m) => m.text)).toEqual([
      'one',
      'three',
    ]);
  });

  it('refuses keys that disagree with the identity key from a shared community', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Crew');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await alice.community.refresh();
    // The key Bob published in the sealed community profile matches the server's: messaging works.
    await expect(alice.dm.action({ a: 'open', peer: bob.riverId })).resolves.toMatchObject({ name: 'Bob' });
    // A server that swaps Bob's identity key is caught.
    const forged = (await import('@river/crypto')).createIdentity();
    await serverDb.db
      .updateTable('accounts')
      .set({ identity_key: Buffer.from(forged.publicKey).toString('base64') })
      .where('river_id', '=', bob.riverId)
      .execute();
    alice.local.prepare(`DELETE FROM signal_store WHERE kind = 'session'`).run();
    alice.local.prepare(`DELETE FROM signal_store WHERE kind = 'meta' AND id LIKE 'dm:devices:%'`).run();
    await expect(alice.dm.action({ a: 'send', peer: bob.riverId, text: 'hello?' })).rejects.toThrow(
      /different safety key/,
    );
  });

  it('group conversations: create, messages from everyone, admin changes, leaving', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const dave = await person('Dave');
    const group = await alice.dm.action({
      a: 'createGroup',
      name: 'Weekend trip',
      members: [bob.riverId, carol.riverId],
    });
    expect(group).toMatchObject({ kind: 'group', name: 'Weekend trip', isAdmin: true, state: 'accepted' });
    await alice.dm.action({ a: 'send', peer: group.riverId, text: 'who brings the tent?' });

    for (const p of [bob, carol]) await p.dm.sync();
    const bobGroup = (await bob.dm.action({ a: 'conversations' })).find((c) => c.kind === 'group')!;
    expect(bobGroup).toMatchObject({
      riverId: group.riverId,
      name: 'Weekend trip',
      state: 'request',
      unread: 1,
    });
    // Bob knows the admin's name; Carol stays anonymous to him until she accepts or speaks.
    expect(bobGroup.members.map((m) => m.name)).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    await bob.dm.action({ a: 'accept', peer: group.riverId });
    await carol.dm.action({ a: 'send', peer: group.riverId, text: 'me!' });
    await alice.dm.sync();
    await bob.dm.sync();
    const aliceMsgs = await alice.dm.action({ a: 'messages', peer: group.riverId });
    expect(aliceMsgs.map((m) => [m.senderName, m.text])).toEqual([
      ['Alice', 'who brings the tent?'],
      ['Carol', 'me!'],
    ]);
    expect((await bob.dm.action({ a: 'messages', peer: group.riverId })).map((m) => m.text)).toEqual([
      'who brings the tent?',
      'me!',
    ]);
    expect(
      (await bob.dm.action({ a: 'conversations' }))
        .find((c) => c.kind === 'group')!
        .members.map((m) => m.name)
        .sort(),
    ).toEqual(['Alice', 'Bob', 'Carol']);
    // Group members are not turned into one-to-one requests.
    expect((await bob.dm.action({ a: 'conversations' })).filter((c) => c.kind === 'direct')).toEqual([]);

    // Only admins change the group; removed people stop receiving.
    await expect(bob.dm.action({ a: 'renameGroup', peer: group.riverId, name: 'Hijacked' })).rejects.toThrow(
      /admins/,
    );
    await alice.dm.action({ a: 'removeGroupMember', peer: group.riverId, member: carol.riverId });
    await alice.dm.action({ a: 'renameGroup', peer: group.riverId, name: 'Trip (final)' });
    await alice.dm.action({ a: 'send', peer: group.riverId, text: 'tent sorted' });
    await carol.dm.sync();
    await bob.dm.sync();
    const carolGroup = (await carol.dm.action({ a: 'conversations' })).find((c) => c.kind === 'group')!;
    expect(carolGroup.state).toBe('left');
    expect((await carol.dm.action({ a: 'messages', peer: group.riverId })).map((m) => m.text)).not.toContain(
      'tent sorted',
    );
    expect((await bob.dm.action({ a: 'conversations' })).find((c) => c.kind === 'group')!.name).toBe(
      'Trip (final)',
    );

    // Someone outside the group cannot post into it.
    await (dave.dm as unknown as { sendContent(p: string, c: unknown): Promise<void> }).sendContent(
      bob.riverId,
      {
        v: 1,
        t: 'msg',
        id: 'AAAAAAAAAAAAAAAAAAAAAA',
        text: 'spoofed',
        sentAt: new Date().toISOString(),
        groupId: group.riverId,
      },
    );
    await bob.dm.sync();
    expect((await bob.dm.action({ a: 'messages', peer: group.riverId })).map((m) => m.text)).not.toContain(
      'spoofed',
    );

    // Bob leaves; Alice sees it.
    await bob.dm.action({ a: 'leaveGroup', peer: group.riverId });
    await alice.dm.sync();
    const aliceGroup = (await alice.dm.action({ a: 'conversations' })).find((c) => c.kind === 'group')!;
    expect(aliceGroup.members.map((m) => m.name)).toEqual(['Alice']);
  });
});
