import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission } from '@river/protocol';
import { tally, voteEmoji } from '../../apps/desktop/src/shared/poll.ts';
import type { CommunityEvent } from '../../apps/desktop/src/shared/ipc.ts';
// Desktop main-process code under test.
import { AccountService } from '../../apps/desktop/src/main/account/account-service.ts';
import { CommunityService } from '../../apps/desktop/src/main/community/community-service.ts';
import { createRequestBytes, createRequestJson } from '../../apps/desktop/src/main/http.ts';
import { IdentityService } from '../../apps/desktop/src/main/identity/identity-service.ts';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import { migrateDatabase, type LocalDatabase } from '../../apps/desktop/src/main/storage/database.ts';
import { newDatabaseKey } from '../../apps/desktop/src/main/storage/key-file.ts';
import { CLIENT_MIGRATIONS } from '../../apps/desktop/src/main/storage/migrations.ts';
// The real server app.
import { buildApp } from '../../apps/server/src/app.ts';
import { loadConfig } from '../../apps/server/src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../../apps/server/src/db/database.ts';
import { HOME_LINK_BASE } from '../../apps/desktop/src/shared/home-server.ts';
import {
  messageBinding,
  newCommunityKey,
  randomId,
  seal,
  sealBound,
} from '../../apps/desktop/src/main/community/sealed.ts';
import { z } from 'zod';

const testBlobDir = (): string => join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`);

const SERVER = 'http://127.0.0.1:8787';

let dir: string;
let server: FastifyInstance;
let serverDb: RiverDatabase;
const locals: LocalDatabase[] = [];

/** fetch() that delivers requests to the in-process server via Fastify inject. */
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

/** A realtime socket that never connects: these tests exercise the HTTP API only. */
const deadSocket = (): WebSocket => ({ send() {}, close() {}, readyState: 0 }) as unknown as WebSocket;

async function person(
  name: string,
  createSocket: (url: string) => WebSocket = deadSocket,
  blobDir?: string,
): Promise<{
  community: CommunityService;
  riverId: string;
  restart(): CommunityService;
  account: AccountService;
}> {
  const local = migrateDatabase(join(dir, `${name}.db`), newDatabaseKey(), CLIENT_MIGRATIONS).db;
  locals.push(local);
  const identity = new IdentityService(() => local);
  const account = new AccountService({
    db: () => local,
    identity,
    requestJson: createRequestJson(injectFetch),
    log: nullLogger,
  });
  const created = identity.create(name);
  await account.register(SERVER);
  // A fresh service over the same local database is what River looks like after a restart.
  const start = (): CommunityService =>
    new CommunityService({
      db: () => local,
      account,
      identity,
      requestJson: createRequestJson(injectFetch),
      requestBytes: createRequestBytes(injectFetch),
      log: nullLogger,
      createSocket,
      ...(blobDir ? { blobDir: () => blobDir } : {}),
    });
  return { community: start(), riverId: created.riverId, restart: start, account };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'river-int-'));
  serverDb = openDatabase('sqlite::memory:');
  await migrateToLatest(serverDb.db);
  server = await buildApp({
    config: loadConfig({
      RIVER_ATTACHMENT_DIR: testBlobDir(),
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
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

describe('scheduled events', () => {
  it('are sealed end to end, can be joined, cancelled, and remind interested people when they start', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Event Club');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const lounge = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'voice')!;
    await bob.community.refresh();
    const start = new Date(Date.now() + 60_000);
    const eventId = await alice.community.action({
      a: 'createEvent',
      communityId: created.id,
      name: 'Game night',
      description: 'Bring snacks',
      place: '',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3600_000).toISOString(),
      channelId: lounge.id,
    });
    // The server holds only sealed details.
    const stored = JSON.stringify(await serverDb.db.selectFrom('community_events').selectAll().execute());
    expect(stored).not.toContain('Game night');
    expect(stored).not.toContain('Bring snacks');

    const [seen] = await bob.community.events(created.id);
    expect(seen).toMatchObject({
      id: eventId,
      name: 'Game night',
      description: 'Bring snacks',
      channelId: lounge.id,
    });
    await bob.community.action({ a: 'eventInterest', eventId, on: true });
    expect((await alice.community.events(created.id))[0]!.interested).toEqual([bob.riverId]);

    // Bob is reminded once, right when it starts; Alice (not interested) is not.
    const reminders: string[] = [];
    bob.community.onEvent((e) => e.t === 'eventStarting' && reminders.push(e.name));
    await bob.community.events(created.id);
    bob.community.remindEvents(start.getTime() - 1000);
    expect(reminders).toEqual([]);
    bob.community.remindEvents(start.getTime() + 1000);
    bob.community.remindEvents(start.getTime() + 2000);
    expect(reminders).toEqual(['Game night']);

    await alice.community.action({ a: 'updateEvent', eventId, name: 'Game night (moved)', canceled: true });
    expect((await bob.community.events(created.id))[0]).toMatchObject({
      name: 'Game night (moved)',
      canceled: true,
    });
    await expect(bob.community.action({ a: 'deleteEvent', eventId })).rejects.toThrow();
    await alice.community.action({ a: 'deleteEvent', eventId });
    expect(await bob.community.events(created.id)).toEqual([]);
  });
});

describe('profiles', () => {
  it('carry About me, pronouns and a banner colour to other members, encrypted', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Profile Club');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await bob.community.action({
      a: 'setProfile',
      bio: 'I build bikes',
      pronouns: 'he/him',
      banner: 0x3ee08f,
    });
    expect(bob.community.profile()).toMatchObject({
      bio: 'I build bikes',
      pronouns: 'he/him',
      banner: 0x3ee08f,
    });
    const seen = (await alice.community.refresh())[0]!.members.find((m) => m.riverId === bob.riverId)!;
    expect(seen).toMatchObject({ bio: 'I build bikes', pronouns: 'he/him', banner: 0x3ee08f });
    const stored = JSON.stringify(await serverDb.db.selectFrom('community_members').selectAll().execute());
    expect(stored).not.toContain('I build bikes');
    expect(stored).not.toContain('he/him');
  });
});

describe('polls', () => {
  it('are encrypted end to end, votes included, and cannot be edited', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Poll Club');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'general')!;
    await bob.community.refresh();
    const sent = await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: '📊 Movie or games?',
      poll: {
        question: 'Movie or games?',
        options: ['Movie', 'Games'],
        multi: false,
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const [seen] = await bob.community.messages(general.id);
    expect(seen!.poll).toMatchObject({ question: 'Movie or games?', options: ['Movie', 'Games'] });
    await bob.community.action({
      a: 'react',
      channelId: general.id,
      messageId: sent.id,
      emoji: voteEmoji(1),
      on: true,
    });
    const [after] = await alice.community.messages(general.id);
    expect(tally(after!.poll!, after!.reactions, bob.riverId)).toMatchObject({
      counts: [0, 1],
      mine: [1],
      voters: 1,
    });
    const stored =
      JSON.stringify(await serverDb.db.selectFrom('messages').selectAll().execute()) +
      JSON.stringify(await serverDb.db.selectFrom('message_reactions').selectAll().execute());
    expect(stored).not.toContain('Movie');
    expect(stored).not.toContain('poll');
    await expect(
      alice.community.action({ a: 'edit', channelId: general.id, messageId: sent.id, text: 'changed' }),
    ).rejects.toThrow(/cannot be edited/);
  });

  it('editing a message keeps its reactions', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Edit Club');
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'general')!;
    const m = await alice.community.send(general.id, 'helo');
    await alice.community.action({
      a: 'react',
      channelId: general.id,
      messageId: m.id,
      emoji: '🔥',
      on: true,
    });
    await alice.community.action({ a: 'edit', channelId: general.id, messageId: m.id, text: 'hello' });
    const [after] = await alice.community.messages(general.id);
    expect(after).toMatchObject({ text: 'hello' });
    expect(after!.reactions.map((r) => r.emoji)).toEqual(['🔥']);
    void created;
  });

  it('downloads of the same file at once are counted once, and kept copies stay under their limit', async () => {
    const copies = join(dir, 'alice-files');
    const alice = await person('Alice', deadSocket, copies);
    const created = await alice.community.create('Files');
    void created;
    const files = [];
    for (let i = 0; i < 3; i++) {
      files.push(
        await alice.community.action({
          a: 'upload',
          name: `f${i}.bin`,
          mime: 'application/octet-stream',
          bytes: new Uint8Array(4000).fill(i),
        }),
      );
    }
    await Promise.all([
      alice.community.downloadAttachment(files[0]!),
      alice.community.downloadAttachment(files[0]!),
      alice.community.downloadAttachment(files[0]!),
    ]);
    expect((alice.community as unknown as { cacheBytes: number }).cacheBytes).toBe(4000);

    // Room for about two copies: keeping a third removes the one used longest ago.
    alice.community.attachmentDiskCapBytes = 9000;
    await new Promise((r) => setTimeout(r, 20));
    await alice.community.prefetchAttachment(files[1]!);
    await new Promise((r) => setTimeout(r, 20));
    await alice.community.prefetchAttachment(files[2]!);
    await alice.community.pruneAttachments();
    expect(readdirSync(copies).sort()).toEqual([files[1]!.id, files[2]!.id].sort());

    // Deleting the account removes every kept copy.
    alice.community.forgetAll();
    await vi.waitFor(() => expect(readdirSync(copies)).toEqual([]));
  });

  it('editing changes only the text: files, descriptions, the reply and its no-ping stay', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Edit Keeps');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    const question = await bob.community.send(general.id, 'which chart?');
    await alice.community.refresh();
    await alice.community.messages(general.id);
    const chart = await alice.community.action({
      a: 'upload',
      name: 'chart.png',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const sent = await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: 'this one',
      replyTo: question.id,
      noPing: true,
      attachments: [chart],
      alts: { [chart.id]: 'A bar chart' },
    });
    await alice.community.action({ a: 'edit', channelId: general.id, messageId: sent.id, text: 'this one!' });
    await bob.community.messages(general.id); // Bob knows his question is his
    const seen = (await bob.community.messages(general.id)).find((m) => m.id === sent.id)!;
    expect(seen).toMatchObject({
      text: 'this one!',
      replyTo: question.id,
      attachments: [chart],
      alts: { [chart.id]: 'A bar chart' },
      mentionsMe: false,
    });
    expect(seen.editedAt).not.toBeNull();
  });

  it('an edit River cannot base on the original is refused, never destroying the message', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Edit Threads');
    const general = created.channels.find((c) => c.kind === 'text')!;
    const root = await alice.community.send(general.id, 'root');
    await alice.community.action({ a: 'createThread', channelId: general.id, messageId: root.id, name: 'T' });
    const file = await alice.community.action({
      a: 'upload',
      name: 'notes.txt',
      mime: 'text/plain',
      bytes: new Uint8Array([9, 9]),
    });
    const inThread = await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: 'in the thread',
      threadId: root.id,
      attachments: [file],
    });
    // After a restart, the thread message has not been opened yet (it is in no channel page).
    const later = alice.restart();
    await later.refresh();
    await expect(
      later.action({ a: 'edit', channelId: general.id, messageId: inThread.id, text: 'changed' }),
    ).rejects.toThrow(/could not find that message/);
    // Once the thread is open, the edit works and keeps the file.
    await later.action({ a: 'threadMessages', channelId: general.id, messageId: root.id });
    await later.action({ a: 'edit', channelId: general.id, messageId: inThread.id, text: 'changed' });
    const [reply] = await later.action({ a: 'threadMessages', channelId: general.id, messageId: root.id });
    expect(reply).toMatchObject({ text: 'changed', attachments: [file] });
    // Saving a thread message works too.
    await later.action({ a: 'saveMessage', channelId: general.id, messageId: inThread.id, on: true });
    expect((await later.action({ a: 'savedMessages' })).map((m) => m.text)).toEqual(['changed']);
  });
});

describe('deleting your account', () => {
  it('removes it from the server and forgets it and its communities on this device', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Leaving Club');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await bob.account.connect();
    await bob.account.deleteAccount();
    bob.community.forgetAll();
    expect(bob.account.status().state).toBe('none');
    expect(bob.community.cached()).toEqual([]);
    const accounts = await serverDb.db.selectFrom('accounts').select('river_id').execute();
    expect(accounts.map((a) => a.river_id)).toEqual([alice.riverId]);
    // Bob is gone from the community too.
    expect((await alice.community.refresh())[0]!.members.map((m) => m.riverId)).toEqual([alice.riverId]);
  });
});

describe('custom emoji', () => {
  it('are sealed, shared with members, usable as reactions, and names stay unique', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Emoji Club');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'general')!;
    await bob.community.refresh();
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const id = await alice.community.action({
      a: 'addEmoji',
      communityId: created.id,
      name: 'party_parrot',
      image,
    });
    await expect(
      alice.community.action({ a: 'addEmoji', communityId: created.id, name: 'Party_Parrot', image }),
    ).rejects.toThrow(/already/);
    expect(await bob.community.emojis(created.id)).toEqual([{ id, name: 'party_parrot', image }]);
    const stored = JSON.stringify(await serverDb.db.selectFrom('community_emojis').selectAll().execute());
    expect(stored).not.toContain('party_parrot');
    expect(stored).not.toContain('iVBORw0K');
    // Members cannot add emoji by default.
    await expect(
      bob.community.action({ a: 'addEmoji', communityId: created.id, name: 'nope', image }),
    ).rejects.toThrow();
    // As a reaction.
    const m = await alice.community.send(general.id, 'look');
    await bob.community.messages(general.id);
    await bob.community.action({
      a: 'react',
      channelId: general.id,
      messageId: m.id,
      emoji: `<:party_parrot:${id}>`,
      on: true,
    });
    const [seen] = await alice.community.messages(general.id);
    expect(seen!.reactions.map((r) => r.emoji)).toEqual([`<:party_parrot:${id}>`]);
    // Renaming keeps the picture and the ID, and names stay unique.
    const other = await alice.community.action({
      a: 'addEmoji',
      communityId: created.id,
      name: 'cat',
      image,
    });
    await expect(
      alice.community.action({
        a: 'renameEmoji',
        communityId: created.id,
        emojiId: other,
        name: 'PARTY_parrot',
      }),
    ).rejects.toThrow(/already/);
    await alice.community.action({ a: 'renameEmoji', communityId: created.id, emojiId: id, name: 'parrot' });
    expect((await bob.community.emojis(created.id)).find((e) => e.id === id)).toEqual({
      id,
      name: 'parrot',
      image,
    });
    await expect(
      bob.community.action({ a: 'renameEmoji', communityId: created.id, emojiId: id, name: 'mine' }),
    ).rejects.toThrow();
  });
});

describe('reports', () => {
  it('reach moderators sealed, with the message as the reporter saw it, and can be resolved', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const created = await alice.community.create('Reports');
    for (const p of [bob, carol])
      await p.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'general')!;
    await bob.community.refresh();
    await carol.community.refresh();
    const bad = await bob.community.send(general.id, 'buy cheap coins at scam.example');
    await carol.community.messages(general.id);
    await carol.community.action({
      a: 'report',
      communityId: created.id,
      messageId: bad.id,
      reason: 'Scam or phishing',
      text: bad.text,
      senderName: 'Bob',
    });
    const stored = JSON.stringify(await serverDb.db.selectFrom('community_reports').selectAll().execute());
    expect(stored).not.toContain('scam.example');
    expect(stored).not.toContain('phishing');
    // Members without Manage messages cannot list reports.
    await expect(bob.community.action({ a: 'reports', communityId: created.id })).rejects.toThrow();
    await alice.community.refresh();
    const [r] = await alice.community.action({ a: 'reports', communityId: created.id });
    expect(r).toMatchObject({
      reporterName: 'Carol',
      targetName: 'Bob',
      reason: 'Scam or phishing',
      text: 'buy cheap coins at scam.example',
      status: 'open',
    });
    await alice.community.action({ a: 'updateReport', reportId: r!.id, status: 'resolved' });
    const [after] = await alice.community.action({ a: 'reports', communityId: created.id });
    expect(after).toMatchObject({ status: 'resolved', resolvedByName: 'Alice' });
  });
});

describe('onboarding', () => {
  it('sealed rules; newcomers accept them before talking, then pick their own roles', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Rules');
    const gamer = await alice.community.action({
      a: 'createRole',
      communityId: created.id,
      name: 'Gamer',
      color: 0,
      permissions: 0,
    });
    await alice.community.action({
      a: 'updateOnboarding',
      communityId: created.id,
      rules: ['Be kind', 'No spam'],
      welcome: 'Hello there',
      screening: true,
      selfRoles: [gamer],
    });
    const stored = JSON.stringify(await serverDb.db.selectFrom('communities').selectAll().execute());
    expect(stored).not.toContain('Be kind');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    let mine = (await bob.community.refresh())[0]!;
    expect(mine).toMatchObject({
      rules: ['Be kind', 'No spam'],
      welcomeNote: 'Hello there',
      myPending: true,
      screening: true,
    });
    const general = mine.channels.find((c) => c.name === 'general')!;
    await expect(bob.community.send(general.id, 'hi before accepting')).rejects.toThrow();
    await bob.community.action({ a: 'acceptRules', communityId: created.id });
    mine = (await bob.community.refresh())[0]!;
    expect(mine.myPending).toBe(false);
    await bob.community.send(general.id, 'hi');
    await bob.community.action({ a: 'setSelfRoles', communityId: created.id, roles: [gamer] });
    mine = (await bob.community.refresh())[0]!;
    expect(mine.members.find((m) => m.riverId === bob.riverId)?.roles).toEqual([gamer]);

    // The word filter is sealed with the rules and keeps them (1.0.28).
    await alice.community.action({
      a: 'updateFilter',
      communityId: created.id,
      words: ['scamcoin'],
      mode: 'block',
    });
    mine = (await bob.community.refresh())[0]!;
    expect(mine.filter).toEqual({ words: ['scamcoin'], mode: 'block' });
    expect(mine).toMatchObject({ rules: ['Be kind', 'No spam'], screening: true, selfRoles: [gamer] });
    const sealed = JSON.stringify(await serverDb.db.selectFrom('communities').selectAll().execute());
    expect(sealed).not.toContain('scamcoin');
    await alice.community.action({ a: 'updateFilter', communityId: created.id, words: [], mode: 'hide' });
    expect((await bob.community.refresh())[0]!.filter).toBeNull();
  });
});

describe('stickers', () => {
  it('are sealed and can be sent as a message', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Stickers');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'general')!;
    await bob.community.refresh();
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const id = await alice.community.action({
      a: 'addSticker',
      communityId: created.id,
      name: 'Wave',
      image,
    });
    expect(await bob.community.action({ a: 'stickers', communityId: created.id })).toEqual([
      { id, name: 'Wave', image },
    ]);
    const stored = JSON.stringify(await serverDb.db.selectFrom('community_stickers').selectAll().execute());
    expect(stored).not.toContain('Wave');
    await alice.community.action({ a: 'send', channelId: general.id, text: '', sticker: id });
    const [m] = (await bob.community.messages(general.id)).slice(-1);
    expect(m!.sticker).toBe(id);
    await expect(
      bob.community.action({ a: 'addSticker', communityId: created.id, name: 'nope', image }),
    ).rejects.toThrow();
  });
});

describe('favourite GIFs', () => {
  it('are kept on this device and sent again as a fresh encrypted file', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Gifs');
    const general = created.channels.find((c) => c.kind === 'text')!;
    const gif = new Uint8Array(Buffer.from('GIF89a tiny animation'));
    const pointer = await alice.community.action({
      a: 'upload',
      name: 'party.gif',
      mime: 'image/gif',
      bytes: gif,
    });
    await alice.community.action({ a: 'send', channelId: general.id, text: '', attachments: [pointer] });
    await alice.community.action({ a: 'favoriteMedia', pointer, on: true });
    const [fav] = await alice.community.action({ a: 'favoriteMediaList' });
    expect(fav).toMatchObject({ id: pointer.id, name: 'party.gif', mime: 'image/gif' });
    expect(
      Buffer.from(await alice.community.action({ a: 'favoriteMediaBytes', id: pointer.id })).equals(
        Buffer.from(gif),
      ),
    ).toBe(true);
    const sent = await alice.community.action({ a: 'sendFavorite', channelId: general.id, id: pointer.id });
    expect(sent.attachments[0]!.id).not.toBe(pointer.id);
    const bytes = await alice.community.action({ a: 'download', pointer: sent.attachments[0]! });
    expect(Buffer.from(bytes).equals(Buffer.from(gif))).toBe(true);
    await alice.community.action({ a: 'removeFavorite', id: pointer.id });
    expect(await alice.community.action({ a: 'favoriteMediaList' })).toEqual([]);
  });
});

describe('per-community pictures', () => {
  it('show in that community only', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const one = await alice.community.create('One');
    const two = await alice.community.create('Two');
    for (const c of [one, two])
      await bob.community.join(await alice.community.invite(c.id), async () => undefined);
    const pic =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await bob.community.action({ a: 'setCommunityAvatar', communityId: one.id, avatar: pic });
    const seen = await alice.community.refresh();
    const avatarIn = (id: string) =>
      seen.find((c) => c.id === id)!.members.find((m) => m.riverId === bob.riverId)?.avatar ?? null;
    expect(avatarIn(one.id)).toBe(pic);
    expect(avatarIn(two.id)).toBeNull();
    const mine = await bob.community.refresh();
    expect(mine.find((c) => c.id === one.id)?.myCommunityAvatar).toBe(pic);
    await bob.community.action({ a: 'setCommunityAvatar', communityId: one.id, avatar: null });
    expect(
      (await alice.community.refresh())
        .find((c) => c.id === one.id)!
        .members.find((m) => m.riverId === bob.riverId)?.avatar ?? null,
    ).toBeNull();
  });
});

describe('community pictures', () => {
  it('are sealed and keep the other picture when one changes', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Art');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const pic =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await alice.community.action({ a: 'updateArt', communityId: created.id, icon: pic });
    await alice.community.action({ a: 'updateArt', communityId: created.id, banner: pic });
    expect((await bob.community.refresh())[0]!.art).toEqual({ icon: pic, banner: pic });
    const stored = JSON.stringify(await serverDb.db.selectFrom('communities').selectAll().execute());
    expect(stored).not.toContain('iVBORw0K');
    await alice.community.action({ a: 'updateArt', communityId: created.id, icon: null });
    expect((await bob.community.refresh())[0]!.art).toEqual({ icon: null, banner: pic });
  });
});

describe('moderator notes', () => {
  it('are sealed, shown to moderators with their author, and hidden from others', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Notes');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await alice.community.refresh();
    await alice.community.action({
      a: 'addNote',
      communityId: created.id,
      riverId: bob.riverId,
      text: 'warned about spam',
    });
    const [note] = await alice.community.action({
      a: 'notes',
      communityId: created.id,
      riverId: bob.riverId,
    });
    expect(note).toMatchObject({ authorName: 'Alice', text: 'warned about spam' });
    const stored = JSON.stringify(await serverDb.db.selectFrom('member_notes').selectAll().execute());
    expect(stored).not.toContain('spam');
    await bob.community.refresh();
    await expect(
      bob.community.action({ a: 'notes', communityId: created.id, riverId: bob.riverId }),
    ).rejects.toThrow();
    await alice.community.action({ a: 'deleteNote', noteId: note!.id });
    expect(
      await alice.community.action({ a: 'notes', communityId: created.id, riverId: bob.riverId }),
    ).toEqual([]);
  });
});

describe('soundboard', () => {
  it('sounds are sealed, renamed and shared with members', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Sounds');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await bob.community.refresh();
    const audio = `data:audio/mpeg;base64,${Buffer.from('ID3 tiny honk').toString('base64')}`;
    const id = await alice.community.action({
      a: 'addSound',
      communityId: created.id,
      name: 'Honk',
      emoji: '📯',
      audio,
    });
    expect(await bob.community.action({ a: 'sounds', communityId: created.id })).toEqual([
      { id, name: 'Honk', emoji: '📯', audio },
    ]);
    const stored = JSON.stringify(await serverDb.db.selectFrom('community_sounds').selectAll().execute());
    expect(stored).not.toContain('Honk');
    expect(stored).not.toContain('tiny honk');
    await alice.community.action({
      a: 'updateSound',
      communityId: created.id,
      soundId: id,
      name: 'Big honk',
    });
    expect((await bob.community.action({ a: 'sounds', communityId: created.id }))[0]).toMatchObject({
      name: 'Big honk',
      emoji: '📯',
      audio,
    });
    await expect(
      bob.community.action({ a: 'addSound', communityId: created.id, name: 'nope', emoji: null, audio }),
    ).rejects.toThrow();
    await alice.community.action({ a: 'deleteSound', soundId: id });
    expect(await bob.community.action({ a: 'sounds', communityId: created.id })).toEqual([]);
  });
});

describe('saved messages', () => {
  it('are kept on this device, newest first, and can be removed', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Save Club');
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'general')!;
    const first = await alice.community.send(general.id, 'remember this');
    const second = await alice.community.send(general.id, 'and this');
    await alice.community.action({ a: 'saveMessage', channelId: general.id, messageId: first.id, on: true });
    await alice.community.action({ a: 'saveMessage', channelId: general.id, messageId: second.id, on: true });
    await alice.community.action({ a: 'saveMessage', channelId: general.id, messageId: second.id, on: true });
    const saved = alice.community.savedMessages();
    expect(saved.map((m) => m.text).sort()).toEqual(['and this', 'remember this']);
    expect(saved[0]).toMatchObject({ communityId: created.id, channelId: general.id, senderName: 'Alice' });
    await alice.community.action({ a: 'saveMessage', channelId: general.id, messageId: first.id, on: false });
    expect(alice.community.savedMessages().map((m) => m.text)).toEqual(['and this']);
  });
});

describe('replies', () => {
  it('notify the person replied to, unless the reply turned that off', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Reply Club');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'general')!;
    await bob.community.refresh();
    const original = await alice.community.send(general.id, 'who is up for games?');
    await bob.community.messages(general.id);
    await bob.community.action({ a: 'send', channelId: general.id, text: 'me!', replyTo: original.id });
    await bob.community.action({
      a: 'send',
      channelId: general.id,
      text: 'me too, quietly',
      replyTo: original.id,
      noPing: true,
    });
    const seen = await alice.community.messages(general.id);
    expect(seen.find((m) => m.text === 'me!')?.mentionsMe).toBe(true);
    expect(seen.find((m) => m.text === 'me too, quietly')?.mentionsMe).toBe(false);
  });
});

describe('sending again', () => {
  it('a retry of a message whose answer was lost does not post it twice', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Retry Club');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const view = (await alice.community.refresh())[0]!;
    const general = view.channels.find((c) => c.name === 'general')!;
    const messageId = 'R'.repeat(22);
    const first = await alice.community.action({ a: 'send', channelId: general.id, text: 'once', messageId });
    expect(first.id).toBe(messageId);
    // The answer never arrived (the tunnel dropped it), so the outbox tries again with the same ID.
    const again = await alice.community.action({ a: 'send', channelId: general.id, text: 'once', messageId });
    expect(again).toMatchObject({ id: messageId, text: 'once', mine: true });
    // In a thread too.
    await alice.community.action({ a: 'createThread', channelId: general.id, messageId, name: 'Plans' });
    const reply = await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: 'in the thread',
      threadId: messageId,
      messageId: 'T'.repeat(22),
    });
    expect(
      await alice.community.action({
        a: 'send',
        channelId: general.id,
        text: 'in the thread',
        threadId: messageId,
        messageId: reply.id,
      }),
    ).toMatchObject({ id: reply.id, threadId: messageId });
    await bob.community.refresh();
    expect((await bob.community.messages(general.id)).filter((m) => m.text === 'once')).toHaveLength(1);
    // Someone else's message ID is not "already sent" for you: that is refused.
    await expect(
      bob.community.action({ a: 'send', channelId: general.id, text: 'mine?', messageId }),
    ).rejects.toThrow();
  });
});

describe('desktop ↔ server communities', () => {
  it('roles, private channels, reactions, edits and profiles work end to end, encrypted', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('The Crew');
    expect(created.ownerId).toBe(alice.riverId);
    expect(created.roles.map((r) => r.name)).toEqual(['@everyone']);

    const link = await alice.community.invite(created.id);
    await bob.community.join(link, async () => undefined);
    let view = (await alice.community.refresh())[0]!;
    expect(view.members.map((m) => m.name).sort()).toEqual(['Alice', 'Bob']);

    // A coloured role with moderation powers, given to Bob.
    const modRole = await alice.community.action({
      a: 'createRole',
      communityId: created.id,
      name: 'Moderators',
      color: 0x3498db,
      permissions: Permission.MANAGE_MESSAGES | Permission.KICK_MEMBERS,
    });
    await alice.community.action({
      a: 'setMemberRoles',
      communityId: created.id,
      riverId: bob.riverId,
      roles: [modRole],
    });
    view = (await bob.community.refresh())[0]!;
    const bobView = view.members.find((m) => m.riverId === bob.riverId)!;
    expect(view.roles.find((r) => r.id === modRole)?.name).toBe('Moderators');
    expect(bobView.color).toBe(0x3498db);
    expect(view.permissions & Permission.MANAGE_MESSAGES).toBeTruthy();

    // A private channel Bob cannot see.
    await alice.community.action({
      a: 'createChannel',
      communityId: created.id,
      kind: 'text',
      name: 'staff',
      private: true,
    });
    view = (await alice.community.refresh())[0]!;
    const staff = view.channels.find((c) => c.name === 'staff')!;
    expect(staff.private).toBe(true);
    expect((await bob.community.refresh())[0]!.channels.some((c) => c.id === staff.id)).toBe(false);

    // Topic, edit, reply, reactions, pins.
    const general = view.channels.find((c) => c.name === 'general')!;
    await alice.community.action({ a: 'updateChannel', channelId: general.id, topic: 'Say hi' });
    expect((await bob.community.refresh())[0]!.channels.find((c) => c.id === general.id)?.topic).toBe(
      'Say hi',
    );
    const first = await bob.community.send(general.id, 'helo');
    await bob.community.action({
      a: 'edit',
      channelId: general.id,
      messageId: first.id,
      text: 'hello @Alice',
    });
    const reply = await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: 'hi Bob',
      replyTo: first.id,
    });
    await alice.community.action({
      a: 'react',
      channelId: general.id,
      messageId: first.id,
      emoji: '🔥',
      on: true,
    });
    await bob.community.action({
      a: 'react',
      channelId: general.id,
      messageId: first.id,
      emoji: '🔥',
      on: true,
    });
    await bob.community.action({ a: 'pin', messageId: first.id, pinned: true });
    const msgs = await alice.community.messages(general.id);
    const edited = msgs.find((m) => m.id === first.id)!;
    expect(edited.text).toBe('hello @Alice');
    expect(edited.editedAt).not.toBeNull();
    expect(edited.mentionsMe).toBe(true);
    expect(edited.pinned).toBe(true);
    expect(edited.reactions).toEqual([expect.objectContaining({ emoji: '🔥', count: 2, mine: true })]);
    expect(msgs.find((m) => m.id === reply.id)?.replyTo).toBe(first.id);
    expect(await alice.community.action({ a: 'pins', channelId: general.id })).toHaveLength(1);

    // The server only ever saw ciphertext: no names, emoji or text in its database.
    const dump = JSON.stringify(
      await Promise.all(
        ['communities', 'channels', 'roles', 'messages', 'message_reactions', 'community_members'].map((t) =>
          serverDb.db
            .selectFrom(t as 'messages')
            .selectAll()
            .execute(),
        ),
      ),
    );
    // Plaintext would stand on its own; inside random base64 or ids a short word like "Bob"
    // turns up by chance now and then, so only standalone occurrences count.
    for (const secret of ['The Crew', 'Moderators', 'staff', 'Say hi', 'hello', '🔥', 'Alice', 'Bob']) {
      expect(dump).not.toMatch(new RegExp(`(?<![A-Za-z0-9+/_-])${secret}(?![A-Za-z0-9+/=_-])`, 'u'));
    }

    // Profile: name and avatar reach the other member.
    const avatar = 'data:image/png;base64,iVBORw0KGgo=';
    await bob.community.action({ a: 'setProfile', name: 'Bobby', avatar });
    const seen = (await alice.community.refresh())[0]!.members.find((m) => m.riverId === bob.riverId)!;
    expect(seen).toMatchObject({ name: 'Bobby', avatar });

    // Moderation: Bob (moderator) cannot ban (no permission); Alice bans Bob, who cannot rejoin.
    await expect(
      bob.community.action({ a: 'ban', communityId: created.id, riverId: alice.riverId }),
    ).rejects.toThrow();
    await alice.community.action({ a: 'ban', communityId: created.id, riverId: bob.riverId });
    const bans = await alice.community.action({ a: 'bans', communityId: created.id });
    expect(bans).toEqual([expect.objectContaining({ riverId: bob.riverId, name: 'Bobby' })]);
    const again = await alice.community.invite(created.id);
    await expect(bob.community.join(again, async () => undefined)).rejects.toThrow(/banned/);
  });

  it('a permanent link (the River link page, not a server address) joins your own server', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('The Crew');
    const link = await alice.community.invite(created.id);
    const permanent = link.replace(SERVER, HOME_LINK_BASE);
    expect(permanent.startsWith('https://martex-dev.github.io/river/join#c=')).toBe(true);
    const joined = await bob.community.join(permanent, async () => {
      throw new Error('Bob already has an account; no new one should be made');
    });
    expect(joined.id).toBe(created.id);
  });

  it('an invite naming an old address of your own server still works', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('The Crew');
    const link = await alice.community.invite(created.id);
    // The host PC restarted since: the link names an address the server no longer has.
    const old = link.replace(SERVER, 'https://old-address.trycloudflare.com');
    const joined = await bob.community.join(old, async () => undefined);
    expect(joined.id).toBe(created.id);

    // A code this server never issued is an invite for some other server.
    const carol = await person('Carol');
    const foreign = old.replace(/c=[A-Za-z0-9_-]{22}/, `c=${'A'.repeat(22)}`);
    await expect(carol.community.join(foreign, async () => undefined)).rejects.toThrow(
      'This invite is for a different River server than the one your account is on.',
    );
  });

  it('rejects malformed actions from the renderer before they reach the server', async () => {
    const alice = await person('Alice');
    await expect(
      alice.community.action({ a: 'kick', communityId: 'x', riverId: 'not-a-uuid' } as never),
    ).rejects.toThrow();
    await expect(alice.community.action({ a: 'nope' } as never)).rejects.toThrow();
  });

  it('sends encrypted files that only members can decrypt', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Files');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    await bob.community.refresh();

    const secret = Buffer.from('%PDF-1.7 quarterly numbers: 42');
    const pointer = await alice.community.action({
      a: 'upload',
      name: 'report.pdf',
      mime: 'application/pdf',
      bytes: new Uint8Array(secret),
    });
    expect(pointer).toMatchObject({ name: 'report.pdf', mime: 'application/pdf', size: secret.length });
    await alice.community.action({ a: 'send', channelId: general.id, text: '', attachments: [pointer] });

    const [msg] = await bob.community.messages(general.id);
    expect(msg!.text).toBe('');
    expect(msg!.attachments).toEqual([pointer]);
    const bytes = await bob.community.action({ a: 'download', pointer: msg!.attachments[0]! });
    expect(Buffer.from(bytes).equals(secret)).toBe(true);

    // The server holds ciphertext only, and a forged pointer (wrong key) is refused.
    const row = await serverDb.db.selectFrom('attachments').selectAll().executeTakeFirstOrThrow();
    expect(row.size).toBeGreaterThan(secret.length);
    const forged = { ...pointer, key: Buffer.alloc(64, 7).toString('base64') };
    const fresh = await person('Carol');
    await fresh.community.join(await alice.community.invite(created.id), async () => undefined);
    await expect(fresh.community.action({ a: 'download', pointer: forged })).rejects.toThrow(/integrity/);

    // Empty messages without files are still refused.
    await expect(alice.community.action({ a: 'send', channelId: general.id, text: '  ' })).rejects.toThrow();

    // Picture descriptions travel inside the sealed body, beside (not inside) the pointers.
    const chart = await alice.community.action({
      a: 'upload',
      name: 'chart.png',
      mime: 'image/png',
      bytes: new Uint8Array(secret),
    });
    await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: 'with a description',
      attachments: [chart],
      alts: { [chart.id]: 'A bar chart of quarterly numbers', [created.id]: 'not an attachment here' },
    });
    const [described] = (await bob.community.messages(general.id)).slice(-1);
    expect(described!.attachments).toEqual([chart]);
    expect(described!.alts).toEqual({ [chart.id]: 'A bar chart of quarterly numbers' });
    const stored = JSON.stringify(await serverDb.db.selectFrom('messages').selectAll().execute());
    expect(stored).not.toContain('bar chart');

    // Link previews ride in the sealed body, and only for a link that is in the message.
    const embed = {
      url: 'https://example.com/a',
      title: 'Example',
      description: 'An example page',
      site: 'example.com',
    };
    await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: 'look https://example.com/a',
      embed,
    });
    await alice.community.action({
      a: 'send',
      channelId: general.id,
      text: 'no link here',
      embed: { ...embed, url: 'https://evil.example/' },
    });
    const latest = (await bob.community.messages(general.id)).slice(-2);
    expect(latest[0]!.embed).toEqual(embed);
    expect(latest[1]!.embed).toBeUndefined();
  });

  it('pages through older history and searches it on the device', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Archive');
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    for (let i = 0; i < 105; i++) {
      await alice.community.send(general.id, i === 2 ? 'the hidden needle' : `message ${i}`);
    }
    const latest = await alice.community.messages(general.id);
    expect(latest).toHaveLength(100);
    expect(latest.map((m) => m.text)).not.toContain('the hidden needle');
    const older = await alice.community.action({
      a: 'history',
      channelId: general.id,
      before: latest[0]!.sentAt,
    });
    expect(older.map((m) => m.text)).toContain('the hidden needle');
    const found = await alice.community.action({ a: 'search', communityId: created.id, query: 'NEEDLE' });
    expect(found.map((m) => m.text)).toEqual(['the hidden needle']);
  });

  it('history pages through messages this device cannot open; search and jumps go past them', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Before you');
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    await alice.community.send(general.id, 'the old needle');
    // A hundred messages sealed with a key this device never had (sent before it joined).
    const unknown = newCommunityKey();
    for (let i = 0; i < 100; i++) {
      await alice.community.api(
        `/channels/${general.id}/messages`,
        'POST',
        { id: randomId(), body: seal(unknown, created.id, `message:${general.id}`, { text: `x${i}` }) },
        z.unknown(),
      );
    }
    for (const t of ['one', 'two', 'three']) await alice.community.send(general.id, t);

    const newest = await alice.community.action({ a: 'historyPage', channelId: general.id });
    expect(newest.messages.map((m) => m.text)).toEqual(['one', 'two', 'three']);
    expect(newest.hasMore).toBe(true);
    // The next page starts where the server's page ended, not at the oldest message shown.
    const older = await alice.community.action({
      a: 'historyPage',
      channelId: general.id,
      before: newest.before!,
      beforeId: newest.beforeId!,
    });
    expect(older.messages.map((m) => m.text)).toEqual(['the old needle']);
    expect(older.hasMore).toBe(false);
    const found = await alice.community.action({ a: 'search', communityId: created.id, query: 'needle' });
    expect(found.map((m) => m.text)).toEqual(['the old needle']);
  });

  it('messages sharing a time at a page boundary are all paged, none skipped', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Same time');
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    const key = Buffer.from(
      (
        locals.at(-1)!.prepare('SELECT key FROM community_keys WHERE community_id = ?').get(created.id) as {
          key: Uint8Array;
        }
      ).key,
    );
    // 101 messages in the same millisecond (a burst, or a server with a coarse clock).
    const at = new Date().toISOString();
    await serverDb.db
      .insertInto('messages')
      .values(
        Array.from({ length: 101 }, (_, i) => {
          const id = randomId();
          return {
            id,
            channel_id: general.id,
            sender: alice.riverId,
            body: sealBound(
              key,
              created.id,
              `message:${general.id}`,
              messageBinding(id, alice.riverId),
              { text: `m${i}` },
              true,
            ),
            sent_at: at,
            pinned: 0,
            thread_id: null,
          };
        }),
      )
      .execute();
    const first = await alice.community.action({ a: 'historyPage', channelId: general.id });
    expect(first.messages).toHaveLength(100);
    const rest = await alice.community.action({
      a: 'historyPage',
      channelId: general.id,
      before: first.before!,
      beforeId: first.beforeId!,
    });
    expect(rest.messages).toHaveLength(1);
    expect(new Set([...first.messages, ...rest.messages].map((m) => m.text)).size).toBe(101);
  });

  it('categories, sidebar moves and unread markers that survive a restart', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Layout');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);

    // Encrypted category names; a channel created inside one.
    const gaming = await alice.community.action({
      a: 'createCategory',
      communityId: created.id,
      name: 'Gaming',
    });
    await alice.community.action({
      a: 'createChannel',
      communityId: created.id,
      kind: 'voice',
      name: 'Squad',
      parentId: gaming,
    });
    let view = (await bob.community.refresh())[0]!;
    expect(view.categories.map((k) => k.name)).toEqual(['Gaming']);
    expect(view.channels.find((c) => c.name === 'Squad')?.parentId).toBe(gaming);
    const general = view.channels.find((c) => c.name === 'general')!;

    // Bob may not rearrange; Alice moves general one step down (still uncategorised: past Lounge).
    const bobMove = await bob.community
      .action({
        a: 'layout',
        communityId: created.id,
        categories: [],
        channels: [{ id: general.id, position: 9, parentId: gaming }],
      })
      .catch((e: Error) => e);
    expect(bobMove).toBeInstanceOf(Error);
    await alice.community.action({ a: 'moveChannel', channelId: general.id, direction: 1 });
    await alice.community.action({
      a: 'renameCategory',
      communityId: created.id,
      categoryId: gaming,
      name: 'Games',
    });
    view = (await bob.community.refresh())[0]!;
    expect(view.categories[0]?.name).toBe('Games');
    const loose = view.channels.filter((c) => c.parentId === null).sort((a, b) => a.position - b.position);
    expect(loose.map((c) => c.name)).toEqual(['Lounge', 'general']);

    // Unread: old history starts read; a new message marks the channel; reading clears it for good.
    expect(view.channels.every((c) => !c.unread)).toBe(true);
    await alice.community.send(general.id, 'anyone up? @Bob');
    expect((await alice.community.refresh())[0]!.channels.find((c) => c.id === general.id)?.unread).toBe(
      false,
    );
    view = (await bob.community.refresh())[0]!;
    expect(view.channels.find((c) => c.id === general.id)?.unread).toBe(true);
    const restarted = bob.restart();
    // Catching up after a restart counts what arrived meanwhile, mentions included.
    const caught = new Promise<Extract<CommunityEvent, { t: 'catchUp' }>>((resolve) =>
      restarted.onEvent((e) => e.t === 'catchUp' && resolve(e)),
    );
    expect((await restarted.refresh())[0]!.channels.find((c) => c.id === general.id)?.unread).toBe(true);
    expect((await caught).unread[general.id]).toBe(1);
    expect((await caught).mentions[general.id]).toBe(1);
    await restarted.action({ a: 'markRead', channelId: general.id });
    const again = bob.restart();
    expect((await again.refresh())[0]!.channels.find((c) => c.id === general.id)?.unread).toBe(false);

    // Deleting the category keeps its channels.
    await alice.community.action({ a: 'deleteCategory', communityId: created.id, categoryId: gaming });
    view = (await alice.community.refresh())[0]!;
    expect(view.categories).toEqual([]);
    expect(view.channels.find((c) => c.name === 'Squad')?.parentId).toBeNull();
  });

  it('creates a community from a template in one step, with categories', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Squad', 'gaming');
    expect(created.categories.map((k) => k.name)).toEqual(['Info', 'Chat', 'Voice']);
    const inCategory = (name: string) =>
      created.channels
        .filter((c) => c.parentId === created.categories.find((k) => k.name === name)!.id)
        .sort((a, b) => a.position - b.position)
        .map((c) => c.name);
    expect(inCategory('Info')).toEqual(['welcome', 'announcements']);
    expect(inCategory('Chat')).toEqual(['general', 'clips', 'looking-for-group']);
    expect(inCategory('Voice')).toEqual(['Squad 1', 'Squad 2', 'AFK']);
    // No template: the familiar general + Lounge without categories.
    // The template's emoji becomes the icon; it can be changed or removed.
    expect(created.icon).toBe('🎮');
    await alice.community.action({
      a: 'updateCommunity',
      communityId: created.id,
      name: 'Squad',
      description: 'Friday nights',
      icon: '🚀',
    });
    let view = (await alice.community.refresh()).find((c) => c.id === created.id)!;
    expect([view.icon, view.description]).toEqual(['🚀', 'Friday nights']);
    await alice.community.action({
      a: 'updateCommunity',
      communityId: created.id,
      name: 'Squad',
      description: '',
    });
    view = (await alice.community.refresh()).find((c) => c.id === created.id)!;
    expect(view.icon).toBe('🚀');
    await alice.community.action({
      a: 'updateCommunity',
      communityId: created.id,
      name: 'Squad',
      description: '',
      icon: null,
    });
    view = (await alice.community.refresh()).find((c) => c.id === created.id)!;
    expect(view.icon).toBeNull();
    await expect(
      alice.community.action({
        a: 'updateCommunity',
        communityId: created.id,
        name: 'Squad',
        description: '',
        icon: 'ABC' as never,
      }),
    ).rejects.toThrow();
    const blank = await alice.community.create('Plain');
    expect(blank.categories).toEqual([]);
    expect(blank.channels.map((c) => c.name)).toEqual(['general', 'Lounge']);
  });

  it('mentions: mentionable roles, @everyone rights and replies to your messages', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const carol = await person('Carol');
    const created = await alice.community.create('Mentions');
    for (const p of [bob, carol])
      await p.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;
    const mods = await alice.community.action({
      a: 'createRole',
      communityId: created.id,
      name: 'Mods',
      color: 0x3498db,
      permissions: 0,
      mentionable: true,
    });
    const quiet = await alice.community.action({
      a: 'createRole',
      communityId: created.id,
      name: 'Quiet',
      color: 0,
      permissions: 0,
    });
    await alice.community.action({
      a: 'setMemberRoles',
      communityId: created.id,
      riverId: bob.riverId,
      roles: [mods, quiet],
    });
    expect((await bob.community.refresh())[0]!.roles.find((r) => r.id === mods)).toMatchObject({
      mentionable: true,
    });

    // Carol (a plain member) can ping the mentionable role, not the other one, and not @everyone.
    await carol.community.refresh();
    await carol.community.send(general.id, 'hey @Mods, help?');
    await carol.community.send(general.id, 'psst @Quiet');
    await carol.community.send(general.id, '@everyone party');
    const seen = await bob.community.messages(general.id);
    const flag = (text: string) => seen.find((m) => m.text === text)!.mentionsMe;
    expect([flag('hey @Mods, help?'), flag('psst @Quiet'), flag('@everyone party')]).toEqual([
      true,
      false,
      false,
    ]);
    // The owner may mention any role.
    await alice.community.send(general.id, 'owner says @Quiet');
    expect(
      (await bob.community.messages(general.id)).find((m) => m.text === 'owner says @Quiet')!.mentionsMe,
    ).toBe(true);

    // A reply to Bob's message pings Bob.
    const bobs = await bob.community.send(general.id, 'anyone?');
    await carol.community.action({ a: 'send', channelId: general.id, text: 'me!', replyTo: bobs.id });
    expect((await bob.community.messages(general.id)).find((m) => m.text === 'me!')!.mentionsMe).toBe(true);

    // Turning mentionable off keeps the name.
    await alice.community.action({
      a: 'updateRole',
      communityId: created.id,
      roleId: mods,
      mentionable: false,
    });
    const role = (await alice.community.refresh())[0]!.roles.find((r) => r.id === mods)!;
    expect([role.name, role.mentionable]).toEqual(['Mods', false]);
  });

  it('reconnects with jittered backoff, and right away when asked', async () => {
    const sockets: Array<{ onclose?: () => void; send(): void; close(): void; readyState: number }> = [];
    const make = (): WebSocket => {
      const socket = { send() {}, close() {}, readyState: 0 };
      sockets.push(socket);
      return socket as unknown as WebSocket;
    };
    const alice = await person('Alice', make);
    await alice.community.create('Net');
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const events: CommunityEvent[] = [];
    alice.community.onEvent((e) => events.push(e));

    sockets[0]!.onclose!();
    const offline = events.find((e) => e.t === 'connection' && e.state === 'offline');
    expect(offline).toBeDefined();
    const wait = (offline as { retryAt: number }).retryAt - Date.now();
    expect(wait).toBeGreaterThan(600);
    expect(wait).toBeLessThanOrEqual(1250);

    await alice.community.action({ a: 'reconnect' });
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    alice.community.stop();
  });

  type FakeSocket = {
    onmessage?: (e: { data: string }) => void;
    onclose?: () => void;
    send(data: string): void;
    close(): void;
    readyState: number;
    sent: string[];
  };
  const fakeSockets = (): { sockets: FakeSocket[]; make: () => WebSocket } => {
    const sockets: FakeSocket[] = [];
    return {
      sockets,
      make: () => {
        const socket: FakeSocket = {
          sent: [],
          send(data) {
            this.sent.push(data);
          },
          close() {},
          readyState: WebSocket.OPEN,
        };
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    };
  };
  const ready = (socket: FakeSocket, riverId: string): void =>
    socket.onmessage!({ data: JSON.stringify({ t: 'ready', riverId }) });

  it('keeps backing off when the server ends every connection right after it is ready', async () => {
    const { sockets, make } = fakeSockets();
    const alice = await person('Alice', make);
    alice.community.stableAfterMs = 60_000;
    await alice.community.create('Net');
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const retries: number[] = [];
    alice.community.onEvent((e) => {
      if (e.t === 'connection' && e.state === 'offline' && e.retryAt) retries.push(e.retryAt - Date.now());
    });
    ready(sockets[0]!, alice.riverId);
    sockets[0]!.onclose!();
    expect(retries[0]).toBeLessThanOrEqual(1250);
    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3_000 });
    // Ready again, and dropped again at once (a server restarting in a loop): wait longer this time.
    ready(sockets[1]!, alice.riverId);
    sockets[1]!.onclose!();
    expect(retries[1]).toBeGreaterThan(1500);
    alice.community.stop();
  });

  it('asks an "online" connection whether it still works when the network comes back, and replaces a dead one', async () => {
    const { sockets, make } = fakeSockets();
    const alice = await person('Alice', make);
    alice.community.probeMs = 50;
    await alice.community.create('Net');
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    ready(sockets[0]!, alice.riverId);
    expect(alice.community.connectionState()).toBe('online');

    // It answers: kept.
    await alice.community.action({ a: 'reconnect' });
    expect(sockets[0]!.sent.at(-1)).toBe(JSON.stringify({ t: 'ping' }));
    sockets[0]!.onmessage!({ data: JSON.stringify({ t: 'pong' }) });
    await new Promise((r) => setTimeout(r, 150));
    expect(sockets).toHaveLength(1);
    expect(alice.community.connectionState()).toBe('online');

    // The Wi-Fi changed under it: the old connection says nothing any more. Replaced.
    await alice.community.action({ a: 'reconnect' });
    expect(sockets[0]!.sent.filter((d) => d === JSON.stringify({ t: 'ping' }))).toHaveLength(2);
    await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3_000 });
    alice.community.stop();
  });

  it('moderation: timeouts, hoisted roles, category permissions and a readable audit log', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Mod', 'friends');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const staff = await alice.community.action({
      a: 'createRole',
      communityId: created.id,
      name: 'Staff',
      color: 0xe91e63,
      permissions: 0,
      hoist: true,
    });
    await alice.community.action({
      a: 'setMemberRoles',
      communityId: created.id,
      riverId: bob.riverId,
      roles: [staff],
    });

    // Timeout: Bob can no longer send (his own view says so too), until it is lifted.
    const until = new Date(Date.now() + 10 * 60_000).toISOString();
    await alice.community.action({ a: 'timeout', communityId: created.id, riverId: bob.riverId, until });
    let view = (await bob.community.refresh())[0]!;
    const general = view.channels.find((c) => c.name === 'general')!;
    expect(view.members.find((m) => m.riverId === bob.riverId)?.timeoutUntil).toBe(until);
    expect(general.permissions & Permission.SEND_MESSAGES).toBe(0);
    await expect(bob.community.send(general.id, 'let me talk')).rejects.toThrow();
    await alice.community.action({
      a: 'timeout',
      communityId: created.id,
      riverId: bob.riverId,
      until: null,
    });
    view = (await bob.community.refresh())[0]!;
    expect(
      view.channels.find((c) => c.id === general.id)!.permissions & Permission.SEND_MESSAGES,
    ).toBeTruthy();
    expect(view.roles.find((r) => r.id === staff)).toMatchObject({ name: 'Staff', hoist: true });

    // Category permissions apply to its synced channels.
    const text = view.categories.find((k) => k.name === 'Text channels')!;
    await alice.community.action({
      a: 'categoryPermissions',
      communityId: created.id,
      categoryId: text.id,
      overwrites: [{ roleId: created.id, allow: 0, deny: Permission.ADD_REACTIONS }],
    });
    const memes = (await bob.community.refresh())[0]!.channels.find((c) => c.name === 'memes')!;
    expect(memes.synced).toBe(true);
    expect(memes.permissions & Permission.ADD_REACTIONS).toBe(0);

    // The audit log reads like sentences with the names only members can decrypt.
    const log = await alice.community.action({ a: 'audit', communityId: created.id });
    const lines = log.map((e) => `${e.actorName} ${e.summary}`);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Alice changed the category Text channels (permissions)',
        'Alice ended the timeout of Bob',
        'Alice gave Bob Staff',
        'Alice created the role Staff',
        'Bob joined the community',
      ]),
    );
    expect(lines.some((l) => l.startsWith('Alice timed out Bob until'))).toBe(true);
    await expect(bob.community.action({ a: 'audit', communityId: created.id })).rejects.toThrow();
  });

  it('nicknames: one name per community, and @nickname pings you', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Nicks');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await bob.community.action({ a: 'setNickname', communityId: created.id, nickname: 'Bobby' });
    const view = (await alice.community.refresh())[0]!;
    expect(view.members.find((m) => m.riverId === bob.riverId)?.name).toBe('Bobby');
    expect((await bob.community.refresh())[0]!.myNickname).toBe('Bobby');

    const general = view.channels.find((c) => c.kind === 'text')!;
    await alice.community.send(general.id, 'hey @Bobby');
    expect((await bob.community.messages(general.id)).find((m) => m.text === 'hey @Bobby')!.mentionsMe).toBe(
      true,
    );

    await bob.community.action({ a: 'setNickname', communityId: created.id, nickname: null });
    expect((await alice.community.refresh())[0]!.members.find((m) => m.riverId === bob.riverId)?.name).toBe(
      'Bob',
    );
  });

  it('threads, announcement channels and slowmode through the app', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Threads');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const general = (await alice.community.refresh())[0]!.channels.find((c) => c.kind === 'text')!;

    const root = await bob.community.send(general.id, 'what should we play tonight?');
    await bob.community.action({
      a: 'createThread',
      channelId: general.id,
      messageId: root.id,
      name: 'Game night',
    });
    await alice.community.action({ a: 'send', channelId: general.id, text: 'chess!', threadId: root.id });
    const channel = await alice.community.messages(general.id);
    expect(channel.map((m) => m.text)).toEqual(['what should we play tonight?']);
    expect(channel[0]!.thread).toMatchObject({ name: 'Game night', count: 1, creator: bob.riverId });
    const replies = await bob.community.action({
      a: 'threadMessages',
      channelId: general.id,
      messageId: root.id,
    });
    expect(replies).toEqual([expect.objectContaining({ text: 'chess!', threadId: root.id })]);
    await bob.community.action({
      a: 'updateThread',
      channelId: general.id,
      messageId: root.id,
      name: 'Game night 🎲',
    });
    expect((await alice.community.messages(general.id))[0]!.thread?.name).toBe('Game night 🎲');

    await alice.community.action({
      a: 'updateChannel',
      channelId: general.id,
      announcement: true,
      slowmode: 30,
    });
    const view = (await bob.community.refresh())[0]!.channels.find((c) => c.id === general.id)!;
    expect([view.announcement, view.slowmode]).toEqual([true, 30]);
    expect(view.permissions & Permission.SEND_MESSAGES).toBe(0);
    await expect(bob.community.send(general.id, 'can I post?')).rejects.toThrow();
  });

  it('voice channels can have a user limit', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Voice');
    const lounge = created.channels.find((c) => c.kind === 'voice')!;
    expect(lounge.userLimit).toBe(0);
    await alice.community.action({ a: 'updateChannel', channelId: lounge.id, userLimit: 4 });
    expect((await alice.community.refresh())[0]!.channels.find((c) => c.id === lounge.id)?.userLimit).toBe(4);
  });

  it('forums: posts with sealed titles and tags, replies in their thread', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Forum');
    await alice.community.action({
      a: 'createChannel',
      communityId: created.id,
      kind: 'text',
      name: 'help',
      forum: true,
    });
    let forum = (await alice.community.refresh())[0]!.channels.find((c) => c.name === 'help')!;
    expect(forum.forum).toBe(true);
    await alice.community.action({ a: 'updateChannel', channelId: forum.id, tags: ['Question', 'Bug'] });
    forum = (await alice.community.refresh())[0]!.channels.find((c) => c.id === forum.id)!;
    expect(forum.tags).toEqual(['Question', 'Bug']);
    await expect(alice.community.send(forum.id, 'no title')).rejects.toThrow();
    const sent = await alice.community.action({
      a: 'send',
      channelId: forum.id,
      text: 'River will not start on my laptop',
      title: 'Startup problem',
      tags: ['Bug'],
    });
    await alice.community.action({
      a: 'send',
      channelId: forum.id,
      text: 'Fixed by updating',
      threadId: sent.id,
    });
    const [listed] = await alice.community.messages(forum.id);
    expect(listed).toMatchObject({ tags: ['Bug'], thread: { name: 'Startup problem', count: 1 } });
    const stored = JSON.stringify(await serverDb.db.selectFrom('threads').selectAll().execute());
    expect(stored).not.toContain('Startup problem');
    const channels = JSON.stringify(await serverDb.db.selectFrom('channels').selectAll().execute());
    expect(channels).not.toContain('Question');
  });

  it('roles can be placed anywhere in the order by dragging', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Order');
    const mk = (name: string) =>
      alice.community.action({ a: 'createRole', communityId: created.id, name, color: 0, permissions: 0 });
    const a = await mk('A');
    const b = await mk('B');
    const c = await mk('C');
    const order = async () =>
      (await alice.community.refresh())[0]!.roles.filter((r) => !r.everyone).map((r) => r.name);
    const before = await order();
    expect(before).toHaveLength(3);
    await alice.community.action({
      a: 'placeRole',
      communityId: created.id,
      roleId: c,
      aboveId: before[0] === 'A' ? a : b,
    });
    expect((await order())[0]).toBe('C');
    await alice.community.action({ a: 'placeRole', communityId: created.id, roleId: c, aboveId: null });
    expect((await order()).at(-1)).toBe('C');
  });

  it('a manager reorders only the roles below their own, all at once', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Ranks');
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    const mk = (name: string, permissions = 0) =>
      alice.community.action({ a: 'createRole', communityId: created.id, name, color: 0, permissions });
    // New roles go in just above @everyone, so the first one made ends up highest.
    await mk('Admins');
    const mods = await mk('Mods', Permission.MANAGE_ROLES);
    const x = await mk('X');
    await mk('Y');
    await alice.community.action({
      a: 'setMemberRoles',
      communityId: created.id,
      riverId: bob.riverId,
      roles: [mods],
    });
    const order = async () =>
      (await bob.community.refresh())[0]!.roles
        .filter((r) => !r.everyone)
        .map((r) => `${r.name}:${r.position}`);
    expect(await order()).toEqual(['Admins:4', 'Mods:3', 'X:2', 'Y:1']);
    // Below Bob's own role: works, keeping the positions in use.
    await bob.community.action({ a: 'moveRole', communityId: created.id, roleId: x, direction: -1 });
    expect(await order()).toEqual(['Admins:4', 'Mods:3', 'Y:2', 'X:1']);
    // Dragged "above Admins": lands as high as Bob may put it, nothing above him moves.
    await bob.community.action({ a: 'placeRole', communityId: created.id, roleId: x, aboveId: null });
    await bob.community.action({
      a: 'placeRole',
      communityId: created.id,
      roleId: x,
      aboveId: (await bob.community.refresh())[0]!.roles.find((r) => r.name === 'Admins')!.id,
    });
    expect(await order()).toEqual(['Admins:4', 'Mods:3', 'X:2', 'Y:1']);
    // Cannot pass his own role: nothing happens (and nothing is half done).
    await bob.community.action({ a: 'moveRole', communityId: created.id, roleId: x, direction: 1 });
    expect(await order()).toEqual(['Admins:4', 'Mods:3', 'X:2', 'Y:1']);
  });

  it('role icons are sealed and shown next to members with the role', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Icons');
    const roleId = await alice.community.action({
      a: 'createRole',
      communityId: created.id,
      name: 'Gardener',
      color: 0x23a55a,
      permissions: 0,
      icon: '🌱',
    });
    await alice.community.action({
      a: 'setMemberRoles',
      communityId: created.id,
      riverId: alice.riverId,
      roles: [roleId],
    });
    let c = (await alice.community.refresh())[0]!;
    expect(c.roles.find((r) => r.id === roleId)?.icon).toBe('🌱');
    expect(c.members.find((m) => m.riverId === alice.riverId)?.roleIcon).toBe('🌱');
    const stored = JSON.stringify(await serverDb.db.selectFrom('roles').selectAll().execute());
    expect(stored).not.toContain('🌱');
    // Changing something else keeps the icon; null removes it.
    await alice.community.action({ a: 'updateRole', communityId: created.id, roleId, name: 'Gardeners' });
    c = (await alice.community.refresh())[0]!;
    expect(c.roles.find((r) => r.id === roleId)).toMatchObject({ name: 'Gardeners', icon: '🌱' });
    await alice.community.action({ a: 'updateRole', communityId: created.id, roleId, icon: null });
    c = (await alice.community.refresh())[0]!;
    expect(c.roles.find((r) => r.id === roleId)?.icon).toBeNull();
  });

  it('duplicates a channel with its settings and permissions, but no messages', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Copies');
    const general = created.channels.find((c) => c.kind === 'text')!;
    await alice.community.action({ a: 'updateChannel', channelId: general.id, topic: 'rules', slowmode: 30 });
    await alice.community.action({
      a: 'updateChannel',
      channelId: general.id,
      overwrites: [{ roleId: created.id, allow: 0, deny: Permission.SEND_MESSAGES }],
    });
    await alice.community.send(general.id, 'only in the original');
    const id = await alice.community.action({
      a: 'duplicateChannel',
      channelId: general.id,
      name: 'general-2',
    });
    const copy = (await alice.community.refresh())[0]!.channels.find((c) => c.id === id)!;
    expect(copy).toMatchObject({ name: 'general-2', topic: 'rules', slowmode: 30, kind: 'text' });
    expect(copy.overwrites).toEqual([{ roleId: created.id, allow: 0, deny: Permission.SEND_MESSAGES }]);
    expect(await alice.community.messages(copy.id)).toEqual([]);
  });

  it('searches with filters on the device', async () => {
    const alice = await person('Alice');
    const bob = await person('Bob');
    const created = await alice.community.create('Filters');
    const general = created.channels.find((c) => c.kind === 'text')!;
    await bob.community.join(await alice.community.invite(created.id), async () => undefined);
    await alice.community.send(general.id, 'party at https://example.com');
    await bob.community.send(general.id, 'party later');
    await alice.community.refresh();
    const from = await alice.community.action({
      a: 'search',
      communityId: created.id,
      query: 'from:bob party',
    });
    expect(from.map((m) => m.text)).toEqual(['party later']);
    const links = await alice.community.action({ a: 'search', communityId: created.id, query: 'has:link' });
    expect(links.map((m) => m.text)).toEqual(['party at https://example.com']);
    const none = await alice.community.action({
      a: 'search',
      communityId: created.id,
      query: 'in:nowhere party',
    });
    expect(none).toEqual([]);
  });

  it('unsent messages are kept on this device across a restart', async () => {
    const alice = await person('Alice');
    const created = await alice.community.create('Outbox');
    const general = created.channels.find((c) => c.kind === 'text')!;
    await alice.community.action({
      a: 'outboxSave',
      localId: 'local-1-1',
      channelId: general.id,
      text: 'sent while offline',
      createdAt: new Date().toISOString(),
    });
    const later = alice.restart();
    expect(await later.action({ a: 'outboxList' })).toEqual([
      expect.objectContaining({ localId: 'local-1-1', channelId: general.id, text: 'sent while offline' }),
    ]);
    await later.action({ a: 'outboxDelete', localId: 'local-1-1' });
    expect(await later.action({ a: 'outboxList' })).toEqual([]);
  });
});
