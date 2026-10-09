import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Permission } from '@river/protocol';
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
): Promise<{ community: CommunityService; riverId: string; restart(): CommunityService }> {
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
      createSocket: deadSocket,
    });
  return { community: start(), riverId: created.riverId, restart: start };
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
    for (const secret of ['The Crew', 'Moderators', 'staff', 'Say hi', 'hello', '🔥', 'Alice', 'Bob']) {
      expect(dump).not.toContain(secret);
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
    await alice.community.send(general.id, 'anyone up?');
    expect((await alice.community.refresh())[0]!.channels.find((c) => c.id === general.id)?.unread).toBe(
      false,
    );
    view = (await bob.community.refresh())[0]!;
    expect(view.channels.find((c) => c.id === general.id)?.unread).toBe(true);
    const restarted = bob.restart();
    expect((await restarted.refresh())[0]!.channels.find((c) => c.id === general.id)?.unread).toBe(true);
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
});
