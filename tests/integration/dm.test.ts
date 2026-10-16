import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { DmService } from '../../apps/desktop/src/main/dm/dm-service.ts';
import { SocialService } from '../../apps/desktop/src/main/social/social-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
import type { DmEvent } from '../../apps/desktop/src/shared/dm.ts';
import { tally, voteEmoji } from '../../apps/desktop/src/shared/poll.ts';
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

async function person(name: string, privacy?: { readReceipts: boolean; typing: boolean }) {
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
    blobDir: () => join(dir, `${name}-blobs`),
    log: nullLogger,
    createSocket: deadSocket,
  });
  const dm = new DmService({
    db: () => local,
    identity,
    account,
    community,
    log: nullLogger,
    ...(privacy ? { privacy: () => privacy } : {}),
  });
  const social = new SocialService({ db: () => local, identity, dm, log: nullLogger });
  const events: DmEvent[] = [];
  dm.onEvent((e) => events.push(e));
  await dm.sync();
  return { riverId: me.riverId, dm, community, social, events, local };
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
    // For Alice it is a sent request until Bob answers; for Bob it is an incoming one.
    expect((await alice.dm.action({ a: 'conversations' }))[0]).toMatchObject({ awaitingReply: true });
    expect(convs[0]).toMatchObject({ awaitingReply: false });

    await bob.dm.action({ a: 'accept', peer: alice.riverId });
    // Accepting shares Bob's profile: Alice now sees a friend, before Bob even writes.
    await alice.dm.sync();
    expect((await alice.dm.action({ a: 'conversations' }))[0]).toMatchObject({
      state: 'accepted',
      awaitingReply: false,
    });
    await bob.dm.action({ a: 'read', peer: alice.riverId });
    const reply = await bob.dm.action({ a: 'send', peer: alice.riverId, text: 'hey!', replyTo: sent.id });
    await alice.dm.sync();
    const aliceView = await alice.dm.action({ a: 'messages', peer: bob.riverId });
    expect(aliceView.find((m) => m.id === sent.id)!.status).toBe('read');
    expect(aliceView.find((m) => m.id === reply.id)).toMatchObject({ text: 'hey!', replyTo: sent.id });
    expect((await alice.dm.action({ a: 'conversations' }))[0]).toMatchObject({ name: 'Bob', unread: 1 });

    // Pins reach the other person, and either of you can unpin (1.0.29).
    await bob.dm.action({ a: 'pin', peer: alice.riverId, id: sent.id, pinned: true });
    await alice.dm.sync();
    expect(
      (await alice.dm.action({ a: 'messages', peer: bob.riverId })).find((m) => m.id === sent.id)?.pinned,
    ).toBe(true);
    await alice.dm.action({ a: 'pin', peer: bob.riverId, id: sent.id, pinned: false });
    await bob.dm.sync();
    expect(
      (await bob.dm.action({ a: 'messages', peer: alice.riverId })).find((m) => m.id === sent.id)?.pinned,
    ).toBe(false);

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

    // Search runs on the device over decrypted history (special characters are literal).
    expect((await bob.dm.action({ a: 'search', query: 'HEY' })).map((m) => m.text)).toEqual(['hey!']);
    expect(await bob.dm.action({ a: 'search', query: '%_' })).toEqual([]);

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

  it('chat list: pin to top, archive, mark unread (kept on the device)', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'older' });
    await alice.dm.action({ a: 'open', peer: carol.riverId, name: 'Carol' });
    await alice.dm.action({ a: 'send', peer: carol.riverId, text: 'newer' });
    const order = async () => (await alice.dm.action({ a: 'conversations' })).map((c) => c.name);
    expect(await order()).toEqual(['Carol', 'Bob']);

    await alice.dm.action({ a: 'chatFlags', peer: bob.riverId, pinned: true });
    expect(await order()).toEqual(['Bob', 'Carol']);
    const pinnedBob = (await alice.dm.action({ a: 'conversations' }))[0]!;
    expect(pinnedBob).toMatchObject({ pinned: true, archived: false });

    // Archiving unpins; marking unread is cleared by reading.
    await alice.dm.action({ a: 'chatFlags', peer: bob.riverId, archived: true });
    await alice.dm.action({ a: 'chatFlags', peer: carol.riverId, markedUnread: true });
    let convs = await alice.dm.action({ a: 'conversations' });
    expect(convs.find((c) => c.name === 'Bob')).toMatchObject({ pinned: false, archived: true });
    expect(convs.find((c) => c.name === 'Carol')).toMatchObject({ markedUnread: true });
    await alice.dm.action({ a: 'read', peer: carol.riverId });
    convs = await alice.dm.action({ a: 'conversations' });
    expect(convs.find((c) => c.name === 'Carol')).toMatchObject({ markedUnread: false });
  });

  it('note to self: your own notes, never sent to anyone, not a friend', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    const note = await alice.dm.action({ a: 'noteToSelf' });
    expect(note).toMatchObject({ riverId: alice.riverId, self: true, name: 'Note to self', unread: 0 });
    // Opening it again does not make a second one.
    await alice.dm.action({ a: 'noteToSelf' });
    const sent = await alice.dm.action({ a: 'send', peer: alice.riverId, text: 'buy milk' });
    expect(sent).toMatchObject({ mine: true, status: 'sent', text: 'buy milk' });
    await alice.dm.action({ a: 'read', peer: alice.riverId });
    const convs = await alice.dm.action({ a: 'conversations' });
    expect(convs.filter((c) => c.self)).toHaveLength(1);
    expect(convs.find((c) => c.self)).toMatchObject({ unread: 0, last: { text: 'buy milk', mine: true } });
    expect(alice.dm.friends()).toEqual([bob.riverId]);
    await expect(
      alice.dm.action({ a: 'call', peer: alice.riverId, callId: 'A'.repeat(22), kind: 'invite' }),
    ).rejects.toThrow();
    // Bob got nothing.
    await bob.dm.sync();
    expect(bob.events.filter((e) => e.t === 'message')).toHaveLength(0);
  });

  it('polls in direct messages: encrypted question, votes as reactions, one choice', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'hi' });
    await bob.dm.sync();
    await bob.dm.action({ a: 'accept', peer: alice.riverId });
    await alice.dm.sync();
    const poll = {
      question: 'Pizza or sushi?',
      options: ['Pizza', 'Sushi'],
      multi: false,
      endsAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    const sent = await alice.dm.action({ a: 'send', peer: bob.riverId, text: '📊 Pizza or sushi?', poll });
    expect(sent.poll).toEqual(poll);
    await bob.dm.sync();
    const got = (await bob.dm.action({ a: 'messages', peer: alice.riverId })).find((m) => m.id === sent.id)!;
    expect(got.poll).toEqual(poll);
    await bob.dm.action({ a: 'react', peer: alice.riverId, id: sent.id, emoji: voteEmoji(1), on: true });
    await alice.dm.sync();
    const seen = (await alice.dm.action({ a: 'messages', peer: bob.riverId })).find((m) => m.id === sent.id)!;
    expect(tally(seen.poll!, seen.reactions, alice.riverId)).toMatchObject({
      counts: [0, 1],
      voters: 1,
      mine: [],
    });
    // A malformed poll is refused before anything is sent.
    await expect(
      alice.dm.action({ a: 'send', peer: bob.riverId, text: 'x', poll: { ...poll, options: ['only one'] } }),
    ).rejects.toThrow();
  });

  it('searches inside one conversation only', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'pizza tonight?' });
    await alice.dm.action({ a: 'open', peer: carol.riverId, name: 'Carol' });
    await alice.dm.action({ a: 'send', peer: carol.riverId, text: 'pizza is great' });
    const everywhere = await alice.dm.action({ a: 'search', query: 'pizza' });
    expect(everywhere).toHaveLength(2);
    const withBob = await alice.dm.action({ a: 'search', query: 'pizza', peer: bob.riverId });
    expect(withBob.map((m) => m.text)).toEqual(['pizza tonight?']);
  });

  it('disappearing messages: a shared timer, then both devices delete on time', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'hi' });
    await bob.dm.sync();
    await bob.dm.action({ a: 'accept', peer: alice.riverId });
    await alice.dm.sync();

    await alice.dm.action({ a: 'setTimer', peer: bob.riverId, seconds: 30 });
    await bob.dm.sync();
    const bobConv = (await bob.dm.action({ a: 'conversations' })).find((c) => c.riverId === alice.riverId)!;
    expect(bobConv.timer).toBe(30);
    // Both see a notice about the change.
    const notice = (await bob.dm.action({ a: 'messages', peer: alice.riverId })).find((m) => m.notice);
    expect(notice?.notice).toEqual({ timer: 30 });

    const sent = await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'gone soon' });
    expect(sent.expiresAt).toBeTruthy();
    await bob.dm.sync();
    const got = (await bob.dm.action({ a: 'messages', peer: alice.riverId })).find(
      (m) => m.text === 'gone soon',
    );
    expect(got?.expiresAt).toBeTruthy();

    // Not yet… then gone on both sides; older messages stay.
    expect(alice.dm.sweepExpired(new Date(Date.now() + 5_000))).toBe(0);
    const later = new Date(Date.now() + 31_000);
    expect(alice.dm.sweepExpired(later)).toBe(1);
    expect(bob.dm.sweepExpired(later)).toBe(1);
    const left = (await bob.dm.action({ a: 'messages', peer: alice.riverId })).map((m) => m.text);
    expect(left).toContain('hi');
    expect(left).not.toContain('gone soon');

    // Turning it off: new messages stay.
    await bob.dm.action({ a: 'setTimer', peer: alice.riverId, seconds: 0 });
    await alice.dm.sync();
    const kept = await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'stays' });
    expect(kept.expiresAt).toBeNull();
  });

  it('send without sound, and messages scheduled on this device go out on time', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'quiet one', silent: true });
    await bob.dm.sync();
    const quiet = (await bob.dm.action({ a: 'messages', peer: alice.riverId })).find(
      (m) => m.text === 'quiet one',
    );
    expect(quiet?.silent).toBe(true);

    await expect(
      alice.dm.action({
        a: 'schedule',
        peer: bob.riverId,
        text: 'too soon',
        sendAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/a minute/);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const queued = await alice.dm.action({ a: 'schedule', peer: bob.riverId, text: 'later', sendAt: at });
    expect(queued).toMatchObject({ text: 'later', failed: false });
    expect(await alice.dm.action({ a: 'scheduled', peer: bob.riverId })).toHaveLength(1);
    // Not due yet: nothing goes out. At the time: sent once, and the list is empty.
    expect(await alice.dm.sendDueScheduled(new Date())).toBe(0);
    expect(await alice.dm.sendDueScheduled(new Date(Date.now() + 3601_000))).toBe(1);
    expect(await alice.dm.action({ a: 'scheduled', peer: bob.riverId })).toHaveLength(0);
    await bob.dm.sync();
    const later = (await bob.dm.action({ a: 'messages', peer: alice.riverId })).filter(
      (m) => m.text === 'later',
    );
    expect(later).toHaveLength(1);

    // Cancelled ones never go out.
    const other = await alice.dm.action({ a: 'schedule', peer: bob.riverId, text: 'never', sendAt: at });
    await alice.dm.action({ a: 'cancelScheduled', id: other.id });
    expect(await alice.dm.sendDueScheduled(new Date(Date.now() + 7200_000))).toBe(0);
  });

  it('read receipts off: none are sent, and none are shown', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob', { readReceipts: false, typing: false });
    await alice.dm.action({ a: 'open', peer: bob.riverId, name: 'Bob' });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'did you read this?' });
    await bob.dm.sync();
    await bob.dm.action({ a: 'accept', peer: alice.riverId });
    await bob.dm.action({ a: 'read', peer: alice.riverId });
    await alice.dm.sync();
    const mine = (await alice.dm.action({ a: 'messages', peer: bob.riverId })).find((m) => m.mine)!;
    expect(mine.status).not.toBe('read');

    // Bob does not see Alice's read receipts either.
    const reply = await bob.dm.action({ a: 'send', peer: alice.riverId, text: 'maybe' });
    await alice.dm.sync();
    await alice.dm.action({ a: 'read', peer: bob.riverId });
    await bob.dm.sync();
    const bobsView = (await bob.dm.action({ a: 'messages', peer: alice.riverId })).find(
      (m) => m.id === reply.id,
    )!;
    expect(bobsView.status).not.toBe('read');
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
    // Bob's River keeps its own encrypted copy as soon as the message arrives…
    const local = join(dir, 'Bob-blobs', pointer.id);
    for (let i = 0; i < 100 && !existsSync(local); i++) await new Promise((r) => setTimeout(r, 20));
    expect(readFileSync(local).toString('utf8')).not.toContain('private notes');
    // …so the file still opens after the server's copy has expired.
    await serverDb.db.deleteFrom('attachments').execute();
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
    await alice.dm.action({ a: 'setGroupIcon', peer: group.riverId, icon: '⛺' });
    await expect(bob.dm.action({ a: 'setGroupIcon', peer: group.riverId, icon: '💀' })).rejects.toThrow(
      /admins/,
    );
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
    expect((await bob.dm.action({ a: 'conversations' })).find((c) => c.kind === 'group')!.icon).toBe('⛺');

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

  it('social: posts, comments relayed by the author, stories with views, bios', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    // Alice and Bob are contacts; Carol is a stranger.
    await alice.dm.action({ a: 'open', peer: bob.riverId });
    await alice.dm.action({ a: 'send', peer: bob.riverId, text: 'hi' });
    await bob.dm.sync();
    await bob.dm.action({ a: 'accept', peer: alice.riverId });
    alice.dm.setMyBio('Climber. Coffee.');
    const photo = await alice.dm.action({
      a: 'upload',
      name: 'summit.jpg',
      mime: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const post = await alice.social.action({
      a: 'post',
      kind: 'post',
      text: 'Made it to the top!',
      attachments: [photo],
      audience: 'friends',
    });
    expect(post).toMatchObject({ mine: true, audience: 1 });

    await bob.dm.sync();
    let feed = await bob.social.action({ a: 'feed' });
    expect(feed.posts).toEqual([
      expect.objectContaining({ id: post.id, authorName: 'Alice', text: 'Made it to the top!' }),
    ]);
    expect(feed.posts[0]!.attachments).toEqual([photo]);
    await bob.social.action({ a: 'comment', postId: post.id, text: 'Congrats!!' });
    await bob.social.action({ a: 'react', postId: post.id, emoji: '🔥', on: true });

    await alice.dm.sync();
    let mine = (await alice.social.action({ a: 'feed' })).posts[0]!;
    expect(mine.comments.map((c) => [c.authorName, c.text])).toEqual([['Bob', 'Congrats!!']]);
    expect(mine.reactions).toEqual([{ emoji: '🔥', count: 1, mine: false }]);
    // The author relays the snapshot to the audience.
    await alice.social.relay(post.id);
    await bob.dm.sync();
    feed = await bob.social.action({ a: 'feed' });
    expect(feed.posts[0]!.comments.map((c) => c.text)).toEqual(['Congrats!!']);
    expect(feed.posts[0]!.reactions).toEqual([{ emoji: '🔥', count: 1, mine: true }]);

    // Stories: unseen until viewed; the author sees who viewed.
    const story = await alice.social.action({
      a: 'post',
      kind: 'story',
      text: 'sunrise',
      attachments: [],
      audience: 'friends',
    });
    await bob.dm.sync();
    feed = await bob.social.action({ a: 'feed' });
    expect(feed.stories).toEqual([expect.objectContaining({ name: 'Alice', unseen: true })]);
    await bob.social.action({ a: 'seen', postId: story.id });
    await alice.dm.sync();
    mine = (await alice.social.action({ a: 'feed' })).stories[0]!.stories[0]!;
    expect(mine.viewers.map((v) => v.name)).toEqual(['Bob']);

    // Profiles show bios and posts.
    const profile = await bob.social.action({ a: 'profile', riverId: alice.riverId });
    expect(profile).toMatchObject({ name: 'Alice', bio: 'Climber. Coffee.', isContact: true });
    expect(profile.posts.map((p) => p.id)).toEqual([post.id]);

    // A stranger cannot put posts in Bob's feed.
    await (carol.dm as unknown as { sendContent(p: string, c: unknown): Promise<void> }).sendContent(
      bob.riverId,
      {
        v: 1,
        t: 'post',
        postId: 'BBBBBBBBBBBBBBBBBBBBBB',
        kind: 'post',
        text: 'spam',
        attachments: [],
        createdAt: new Date().toISOString(),
      },
    );
    await bob.dm.sync();
    expect((await bob.social.action({ a: 'feed' })).posts.map((p) => p.text)).not.toContain('spam');

    // Deleting a post removes it for the audience; nothing readable reached the server.
    await alice.social.action({ a: 'deletePost', postId: post.id });
    await bob.dm.sync();
    expect((await bob.social.action({ a: 'feed' })).posts).toEqual([]);
    const mailbox = JSON.stringify(await serverDb.db.selectFrom('mailbox').selectAll().execute());
    for (const t of ['Made it', 'Congrats', 'sunrise', 'Climber']) expect(mailbox).not.toContain(t);
  });
});
