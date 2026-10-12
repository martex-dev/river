import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdentity, generateKeyPair, sign } from '@river/crypto';
import {
  DEFAULT_EVERYONE,
  Permission,
  challengeResponseSchema,
  communitySchema,
  deviceListMessage,
  registerResponseSchema,
  registrationMessage,
} from '@river/protocol';
import {
  MAX_RELAY_PAYLOAD,
  RELAY_BURST,
  decodeRelayIn,
  encodeRelayOut,
  eventsResponseSchema,
  emojisResponseSchema,
  reportsResponseSchema,
  soundsResponseSchema,
  notesResponseSchema,
} from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';

const testBlobDir = (): string => join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`);

let app: FastifyInstance;
let database: RiverDatabase;

afterEach(async () => {
  await app?.close();
  await database?.close();
});

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
const id = (): string => randomBytes(16).toString('base64url');
const sealed = (): string => randomBytes(40).toString('base64');

async function start(options: { voiceGraceMs?: number } = {}): Promise<FastifyInstance> {
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_ATTACHMENT_DIR: testBlobDir(),
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
    }),
    database,
    ...options,
  });
  return app;
}

async function user(a: FastifyInstance): Promise<{ riverId: string; token: string }> {
  const identity = createIdentity();
  const device = generateKeyPair();
  const listBytes = Buffer.from(
    JSON.stringify({
      version: 1,
      riverId: identity.riverId,
      devices: [
        {
          deviceId: 1,
          authKey: b64(device.publicKey),
          registrationId: identity.registrationId,
          addedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  const chal = Buffer.from(
    challengeResponseSchema.parse(
      (
        await a.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose: 'register' } })
      ).json(),
    ).challenge,
    'base64',
  );
  const msg = registrationMessage(chal, listBytes);
  const res = await a.inject({
    method: 'POST',
    url: '/v1/accounts',
    payload: {
      identityKey: b64(identity.publicKey),
      deviceId: 1,
      deviceList: b64(listBytes),
      deviceListSignature: b64(sign(identity.privateKey, deviceListMessage(listBytes))),
      challenge: b64(chal),
      identitySignature: b64(sign(identity.privateKey, msg)),
      deviceSignature: b64(sign(device.privateKey, msg)),
    },
  });
  return { riverId: identity.riverId, token: registerResponseSchema.parse(res.json()).session.token };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function createCommunity(a: FastifyInstance, token: string) {
  const cid = id();
  const text = id();
  const voice = id();
  const res = await a.inject({
    method: 'POST',
    url: '/v1/communities',
    headers: auth(token),
    payload: {
      id: cid,
      meta: sealed(),
      profile: sealed(),
      channels: [
        { id: text, kind: 'text', name: sealed() },
        { id: voice, kind: 'voice', name: sealed() },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
  return { cid, text, voice, community: communitySchema.parse(res.json()) };
}

describe('communities', () => {
  it('owner creates, invites; member joins with the code and both can message', async () => {
    const a = await start();
    const owner = await user(a);
    const member = await user(a);
    const { cid, text } = await createCommunity(a, owner.token);

    const inv = await a.inject({
      method: 'POST',
      url: `/v1/communities/${cid}/invites`,
      headers: auth(owner.token),
    });
    expect(inv.statusCode).toBe(201);
    const join = await a.inject({
      method: 'POST',
      url: '/v1/invites/join',
      headers: auth(member.token),
      payload: { code: inv.json().code, profile: sealed() },
    });
    expect(join.statusCode).toBe(200);
    expect(
      communitySchema
        .parse(join.json())
        .members.map((m) => m.role)
        .sort(),
    ).toEqual(['member', 'owner']);

    const body = sealed();
    const sent = await a.inject({
      method: 'POST',
      url: `/v1/channels/${text}/messages`,
      headers: auth(member.token),
      payload: { id: id(), body },
    });
    expect(sent.statusCode).toBe(201);
    const list = await a.inject({
      method: 'GET',
      url: `/v1/channels/${text}/messages`,
      headers: auth(owner.token),
    });
    expect(list.json().messages).toHaveLength(1);
    expect(list.json().messages[0].body).toBe(body);
    // The community list says when each channel last had a message (for unread markers).
    const listed = communitySchema.parse(
      (await a.inject({ method: 'GET', url: '/v1/communities', headers: auth(owner.token) })).json()
        .communities[0],
    );
    expect(listed.channels.find((c) => c.id === text)?.lastMessageAt).toBe(list.json().messages[0].sentAt);
    expect(listed.channels.find((c) => c.id !== text)?.lastMessageAt).toBeNull();
  });

  it('non-members can neither read, post nor list', async () => {
    const a = await start();
    const owner = await user(a);
    const stranger = await user(a);
    const { cid, text } = await createCommunity(a, owner.token);
    expect(
      (await a.inject({ method: 'GET', url: `/v1/channels/${text}/messages`, headers: auth(stranger.token) }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/v1/channels/${text}/messages`,
          headers: auth(stranger.token),
          payload: { id: id(), body: sealed() },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await a.inject({ method: 'GET', url: '/v1/communities', headers: auth(stranger.token) })).json()
        .communities,
    ).toEqual([]);
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/v1/communities/${cid}/invites`,
          headers: auth(stranger.token),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('members may invite by default but not add channels; invalid invites are refused', async () => {
    const a = await start();
    const owner = await user(a);
    const member = await user(a);
    const { cid } = await createCommunity(a, owner.token);
    const code = (
      await a.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(owner.token) })
    ).json().code;
    await a.inject({
      method: 'POST',
      url: '/v1/invites/join',
      headers: auth(member.token),
      payload: { code, profile: sealed() },
    });
    expect(
      (await a.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(member.token) }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/v1/communities/${cid}/channels`,
          headers: auth(member.token),
          payload: { id: id(), kind: 'text', name: sealed() },
        })
      ).statusCode,
    ).toBe(403);
    const bogus = await a.inject({
      method: 'POST',
      url: '/v1/invites/join',
      headers: auth(member.token),
      payload: { code: id(), profile: sealed() },
    });
    expect(bogus.statusCode).toBe(404);
  });

  it('stores only what clients sent — opaque ciphertext — and never invite codes', async () => {
    const a = await start();
    const owner = await user(a);
    const { cid } = await createCommunity(a, owner.token);
    const code = (
      await a.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(owner.token) })
    ).json().code;
    const invites = await database.db.selectFrom('invites').selectAll().execute();
    expect(JSON.stringify(invites)).not.toContain(code);
  });

  it('requires a session for everything', async () => {
    const a = await start();
    for (const [method, url] of [
      ['GET', '/v1/communities'],
      ['POST', '/v1/communities'],
      ['POST', '/v1/invites/join'],
    ] as const) {
      expect((await a.inject({ method, url })).statusCode).toBe(401);
    }
  });
  describe('roles and moderation', () => {
    const join = async (a: FastifyInstance, ownerToken: string, cid: string) => {
      const m = await user(a);
      const code = (
        await a.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(ownerToken) })
      ).json().code;
      await a.inject({
        method: 'POST',
        url: '/v1/invites/join',
        headers: auth(m.token),
        payload: { code, profile: sealed() },
      });
      return m;
    };
    const role = async (a: FastifyInstance, token: string, cid: string, permissions: number) => {
      const rid = id();
      const res = await a.inject({
        method: 'POST',
        url: `/v1/communities/${cid}/roles`,
        headers: auth(token),
        payload: { id: rid, name: sealed(), color: 0xff8800, permissions },
      });
      return { rid, status: res.statusCode };
    };
    const assign = (a: FastifyInstance, token: string, cid: string, target: string, roles: string[]) =>
      a.inject({
        method: 'PUT',
        url: `/v1/communities/${cid}/members/${target}/roles`,
        headers: auth(token),
        payload: { roles },
      });
    const status = async (
      a: FastifyInstance,
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url: string,
      token: string,
      payload?: object,
    ) => (await a.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) })).statusCode;
    const fetchCommunity = async (a: FastifyInstance, token: string, cid: string) =>
      communitySchema.parse(
        (await a.inject({ method: 'GET', url: '/v1/communities', headers: auth(token) }))
          .json()
          .communities.find((c: { id: string }) => c.id === cid),
      );

    it('scheduled events: managers create and cancel, everyone sees them and can be interested', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, voice } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const hour = 3600_000;
      const event = (over: object = {}) => ({
        id: id(),
        data: sealed(),
        startsAt: new Date(Date.now() + hour).toISOString(),
        endsAt: new Date(Date.now() + 2 * hour).toISOString(),
        channelId: voice,
        ...over,
      });
      const list = async (token: string) =>
        eventsResponseSchema.parse(
          (
            await a.inject({ method: 'GET', url: `/v1/communities/${cid}/events`, headers: auth(token) })
          ).json(),
        ).events;

      // Members cannot create events by default; the owner can.
      expect(await status(a, 'POST', `/v1/communities/${cid}/events`, member.token, event())).toBe(403);
      const e = event();
      expect(await status(a, 'POST', `/v1/communities/${cid}/events`, owner.token, e)).toBe(201);
      // Nonsense times are refused.
      const backwards = event({ endsAt: new Date(Date.now()).toISOString() });
      expect(await status(a, 'POST', `/v1/communities/${cid}/events`, owner.token, backwards)).toBe(400);
      const over = event({
        startsAt: new Date(Date.now() - 3 * hour).toISOString(),
        endsAt: new Date(Date.now() - 2 * hour).toISOString(),
      });
      expect(await status(a, 'POST', `/v1/communities/${cid}/events`, owner.token, over)).toBe(400);

      expect((await list(member.token)).map((x) => x.id)).toEqual([e.id]);
      expect(await status(a, 'PUT', `/v1/events/${e.id}/interested`, member.token)).toBe(200);
      expect(await status(a, 'PUT', `/v1/events/${e.id}/interested`, member.token)).toBe(200);
      expect((await list(owner.token))[0]!.interested).toEqual([member.riverId]);
      expect(await status(a, 'DELETE', `/v1/events/${e.id}/interested`, member.token)).toBe(200);
      expect((await list(owner.token))[0]!.interested).toEqual([]);

      expect(await status(a, 'PATCH', `/v1/events/${e.id}`, member.token, { canceled: true })).toBe(403);
      expect(await status(a, 'PATCH', `/v1/events/${e.id}`, owner.token, { canceled: true })).toBe(200);
      expect((await list(member.token))[0]!.canceled).toBe(true);
      expect(await status(a, 'DELETE', `/v1/events/${e.id}`, owner.token)).toBe(200);
      expect(await list(member.token)).toEqual([]);

      // Strangers see nothing.
      const stranger = await user(a);
      expect(await status(a, 'GET', `/v1/communities/${cid}/events`, stranger.token)).not.toBe(200);
    });

    it('ownership can be handed to a member, only by the owner', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const transfer = (token: string, riverId: string) =>
        status(a, 'POST', `/v1/communities/${cid}/transfer`, token, { riverId });
      expect(await transfer(member.token, member.riverId)).toBe(403);
      const stranger = await user(a);
      expect(await transfer(owner.token, stranger.riverId)).toBe(400);
      expect(await transfer(owner.token, member.riverId)).toBe(200);
      expect((await fetchCommunity(a, member.token, cid)).ownerId).toBe(member.riverId);
      // The old owner is no longer the owner.
      expect(await transfer(owner.token, owner.riverId)).toBe(403);
    });

    it('reports: members report others, only message managers see and handle them', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const other = await join(a, owner.token, cid);
      const mod = await join(a, owner.token, cid);
      const { rid } = await role(a, owner.token, cid, Permission.MANAGE_MESSAGES);
      await assign(a, owner.token, cid, mod.riverId, [rid]);
      const mid = id();
      await status(a, 'POST', `/v1/channels/${text}/messages`, other.token, { id: mid, body: sealed() });
      const report = (token: string, messageId = mid, rid2 = id()) =>
        status(a, 'POST', `/v1/communities/${cid}/reports`, token, { id: rid2, messageId, data: sealed() });
      expect(await report(other.token)).toBe(400); // your own message
      const r1 = id();
      expect(await report(member.token, mid, r1)).toBe(201);
      expect(await report(member.token)).toBe(409); // once per message
      expect(await report(member.token, id())).toBe(404); // no such message
      const stranger = await user(a);
      expect(await report(stranger.token)).not.toBe(201);
      // Reviewers only.
      expect(await status(a, 'GET', `/v1/communities/${cid}/reports`, member.token)).toBe(403);
      const listed = await a.inject({
        method: 'GET',
        url: `/v1/communities/${cid}/reports`,
        headers: auth(mod.token),
      });
      const reports = reportsResponseSchema.parse(listed.json()).reports;
      expect(reports.map((r) => [r.id, r.reporter, r.target, r.status])).toEqual([
        [r1, member.riverId, other.riverId, 'open'],
      ]);
      expect(await status(a, 'PATCH', `/v1/reports/${r1}`, member.token, { status: 'resolved' })).toBe(403);
      expect(await status(a, 'PATCH', `/v1/reports/${r1}`, mod.token, { status: 'resolved' })).toBe(200);
      const after = reportsResponseSchema.parse(
        (
          await a.inject({ method: 'GET', url: `/v1/communities/${cid}/reports`, headers: auth(owner.token) })
        ).json(),
      ).reports[0]!;
      expect([after.status, after.resolvedBy]).toEqual(['resolved', mod.riverId]);
    });

    it('onboarding: screened newcomers only read until they accept; self-assignable roles are safe', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const old = await join(a, owner.token, cid);
      const { rid: gamer } = await role(a, owner.token, cid, 0);
      const { rid: mod } = await role(a, owner.token, cid, Permission.KICK_MEMBERS);
      const put = (token: string, body: object) =>
        status(a, 'PUT', `/v1/communities/${cid}/onboarding`, token, body);
      expect(await put(old.token, { onboarding: sealed(), screening: true, selfRoles: [] })).toBe(403);
      expect(await put(owner.token, { onboarding: sealed(), screening: true, selfRoles: [mod] })).toBe(400);
      expect(await put(owner.token, { onboarding: sealed(), screening: true, selfRoles: [gamer] })).toBe(200);
      const fresh = await join(a, owner.token, cid);
      const send = (token: string) =>
        status(a, 'POST', `/v1/channels/${text}/messages`, token, { id: id(), body: sealed() });
      expect(await send(old.token)).toBe(201); // members from before keep talking
      expect(await send(fresh.token)).toBe(403);
      const listed = await fetchCommunity(a, owner.token, cid);
      expect(listed.screening).toBe(true);
      expect(listed.members.find((m) => m.riverId === fresh.riverId)?.pending).toBe(true);
      expect(
        await status(a, 'PUT', `/v1/communities/${cid}/self-roles`, fresh.token, { roles: [gamer] }),
      ).toBe(403);
      expect(await status(a, 'POST', `/v1/communities/${cid}/accept`, fresh.token)).toBe(200);
      expect(await send(fresh.token)).toBe(201);
      expect(await status(a, 'PUT', `/v1/communities/${cid}/self-roles`, fresh.token, { roles: [mod] })).toBe(
        403,
      );
      expect(
        await status(a, 'PUT', `/v1/communities/${cid}/self-roles`, fresh.token, { roles: [gamer] }),
      ).toBe(200);
      expect(
        (await fetchCommunity(a, owner.token, cid)).members.find((m) => m.riverId === fresh.riverId)?.roles,
      ).toEqual([gamer]);
      expect(await status(a, 'PUT', `/v1/communities/${cid}/self-roles`, fresh.token, { roles: [] })).toBe(
        200,
      );
      expect(
        (await fetchCommunity(a, owner.token, cid)).members.find((m) => m.riverId === fresh.riverId)?.roles,
      ).toEqual([]);
    });

    it('bulk delete: message managers remove up to 100 messages of one channel', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const ids = [id(), id(), id()];
      for (const mid of ids)
        await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, { id: mid, body: sealed() });
      const url = `/v1/channels/${text}/messages/bulk-delete`;
      expect(await status(a, 'POST', url, member.token, { ids })).toBe(403);
      expect(await status(a, 'POST', url, owner.token, { ids: [] })).toBe(400);
      const res = await a.inject({
        method: 'POST',
        url,
        headers: auth(owner.token),
        payload: { ids: [ids[0], ids[1], id()] },
      });
      expect(res.json()).toEqual({ ok: true, deleted: 2 });
      const left = (
        await a.inject({ method: 'GET', url: `/v1/channels/${text}/messages`, headers: auth(owner.token) })
      ).json().messages as Array<{ id: string }>;
      expect(left.map((m) => m.id)).toEqual([ids[2]]);
    });

    it('moderator notes are only for people who moderate members', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const other = await join(a, owner.token, cid);
      const url = `/v1/communities/${cid}/members/${other.riverId}/notes`;
      expect(await status(a, 'POST', url, member.token, { id: id(), data: sealed() })).toBe(403);
      expect(await status(a, 'GET', url, member.token)).toBe(403);
      const nid = id();
      expect(await status(a, 'POST', url, owner.token, { id: nid, data: sealed() })).toBe(201);
      const notes = notesResponseSchema.parse(
        (await a.inject({ method: 'GET', url, headers: auth(owner.token) })).json(),
      ).notes;
      expect(notes.map((n) => [n.id, n.author])).toEqual([[nid, owner.riverId]]);
      expect(await status(a, 'DELETE', `/v1/notes/${nid}`, member.token)).toBe(403);
      expect(await status(a, 'DELETE', `/v1/notes/${nid}`, owner.token)).toBe(200);
    });

    it('custom emoji: managers add and remove, every member can list, strangers cannot', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const add = (token: string, emojiId = id()) =>
        status(a, 'POST', `/v1/communities/${cid}/emojis`, token, { id: emojiId, data: sealed() });
      expect(await add(member.token)).toBe(403);
      const e = id();
      expect(await add(owner.token, e)).toBe(201);
      expect(await add(owner.token, e)).toBe(409);
      const list = (
        await a.inject({ method: 'GET', url: `/v1/communities/${cid}/emojis`, headers: auth(member.token) })
      ).json();
      expect(emojisResponseSchema.parse(list).emojis.map((x) => x.id)).toEqual([e]);
      expect(await status(a, 'PATCH', `/v1/emojis/${e}`, member.token, { data: sealed() })).toBe(403);
      expect(await status(a, 'PATCH', `/v1/emojis/${e}`, owner.token, { data: sealed() })).toBe(200);
      expect(await status(a, 'PATCH', `/v1/emojis/${id()}`, owner.token, { data: sealed() })).toBe(404);
      expect(await status(a, 'DELETE', `/v1/emojis/${e}`, member.token)).toBe(403);
      expect(await status(a, 'DELETE', `/v1/emojis/${e}`, owner.token)).toBe(200);
      const stranger = await user(a);
      expect(await status(a, 'GET', `/v1/communities/${cid}/emojis`, stranger.token)).not.toBe(200);
    });

    it('new communities get an @everyone role with default permissions', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const c = await fetchCommunity(a, owner.token, cid);
      expect(c.ownerId).toBe(owner.riverId);
      expect(c.members[0]!.joinedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.roles).toEqual([{ id: cid, name: '', color: 0, permissions: DEFAULT_EVERYONE, position: 0 }]);
    });

    it('roles grant permissions and respect the hierarchy', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const mod = await join(a, owner.token, cid);
      const member = await join(a, owner.token, cid);
      expect((await role(a, member.token, cid, 0)).status).toBe(403);
      const modRole = await role(
        a,
        owner.token,
        cid,
        Permission.MANAGE_ROLES | Permission.KICK_MEMBERS | Permission.MANAGE_CHANNELS,
      );
      expect(modRole.status).toBe(201);
      expect((await assign(a, owner.token, cid, mod.riverId, [modRole.rid])).statusCode).toBe(200);
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/channels`, mod.token, {
          id: id(),
          kind: 'text',
          name: sealed(),
        }),
      ).toBe(201);
      // Cannot grant permissions you lack, nor hand out your own (equal) role.
      expect((await role(a, mod.token, cid, Permission.BAN_MEMBERS)).status).toBe(403);
      expect((await assign(a, mod.token, cid, member.riverId, [modRole.rid])).statusCode).toBe(403);
      const helper = await role(a, mod.token, cid, Permission.KICK_MEMBERS);
      expect(helper.status).toBe(201);
      expect((await assign(a, mod.token, cid, member.riverId, [helper.rid])).statusCode).toBe(200);
      expect(await status(a, 'DELETE', `/v1/communities/${cid}/members/${mod.riverId}`, member.token)).toBe(
        403,
      );
      expect(await status(a, 'DELETE', `/v1/communities/${cid}/members/${owner.riverId}`, mod.token)).toBe(
        403,
      );
      expect(await status(a, 'DELETE', `/v1/communities/${cid}/members/${member.riverId}`, mod.token)).toBe(
        200,
      );
      const c = await fetchCommunity(a, owner.token, cid);
      expect(c.members.map((m) => m.riverId).sort()).toEqual([owner.riverId, mod.riverId].sort());
    });

    it('private channels are hidden from members without access', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const secret = id();
      const deny = { roleId: cid, allow: 0, deny: Permission.VIEW_CHANNELS };
      await status(a, 'POST', `/v1/communities/${cid}/channels`, owner.token, {
        id: secret,
        kind: 'text',
        name: sealed(),
        overwrites: [deny],
      });
      expect((await fetchCommunity(a, member.token, cid)).channels.map((ch) => ch.id)).not.toContain(secret);
      expect(await status(a, 'GET', `/v1/channels/${secret}/messages`, member.token)).toBe(404);
      const vip = await role(a, owner.token, cid, 0);
      await status(a, 'PATCH', `/v1/channels/${secret}`, owner.token, {
        overwrites: [deny, { roleId: vip.rid, allow: Permission.VIEW_CHANNELS, deny: 0 }],
      });
      await assign(a, owner.token, cid, member.riverId, [vip.rid]);
      expect((await fetchCommunity(a, member.token, cid)).channels.map((ch) => ch.id)).toContain(secret);
    });

    it('forums: top-level messages must start a titled thread, replies go inside it', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      expect(await status(a, 'PATCH', `/v1/channels/${text}`, member.token, { forum: true })).toBe(403);
      expect(await status(a, 'PATCH', `/v1/channels/${text}`, owner.token, { forum: true })).toBe(200);
      expect((await fetchCommunity(a, member.token, cid)).channels.find((c) => c.id === text)?.forum).toBe(
        true,
      );
      const plain = await a.inject({
        method: 'POST',
        url: `/v1/channels/${text}/messages`,
        headers: auth(member.token),
        payload: { id: id(), body: sealed() },
      });
      expect([plain.statusCode, plain.json().error.code]).toEqual([400, 'forum_post']);
      const post = id();
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, {
          id: post,
          body: sealed(),
          thread: { name: sealed() },
        }),
      ).toBe(201);
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, owner.token, {
          id: id(),
          body: sealed(),
          threadId: post,
        }),
      ).toBe(201);
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, owner.token, {
          id: id(),
          body: sealed(),
          threadId: post,
          thread: { name: sealed() },
        }),
      ).toBe(400);
      const list = (
        await a.inject({ method: 'GET', url: `/v1/channels/${text}/messages`, headers: auth(owner.token) })
      ).json().messages as Array<{ id: string; thread: { count: number } | null }>;
      expect(list.find((m) => m.id === post)?.thread?.count).toBe(1);
    });

    it('a ban can delete the person’s recent messages, and only those', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const theirs = [id(), id()];
      for (const mid of theirs)
        await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, { id: mid, body: sealed() });
      const mine = id();
      await status(a, 'POST', `/v1/channels/${text}/messages`, owner.token, { id: mine, body: sealed() });
      expect(
        await status(a, 'PUT', `/v1/communities/${cid}/bans/${member.riverId}`, owner.token, {
          deleteMessagesSeconds: 12345,
        }),
      ).toBe(400);
      const res = await a.inject({
        method: 'PUT',
        url: `/v1/communities/${cid}/bans/${member.riverId}`,
        headers: auth(owner.token),
        payload: { deleteMessagesSeconds: 3600 },
      });
      expect(res.json()).toEqual({ ok: true, deleted: 2 });
      const left = (
        await a.inject({ method: 'GET', url: `/v1/channels/${text}/messages`, headers: auth(owner.token) })
      ).json().messages as Array<{ id: string }>;
      expect(left.map((m) => m.id)).toEqual([mine]);
    });

    it('temporary bans end on their own', async () => {
      let now = Date.parse('2026-10-12T10:00:00Z');
      database = openDatabase('sqlite::memory:');
      await migrateToLatest(database.db);
      const a = await buildApp({
        config: loadConfig({
          RIVER_ATTACHMENT_DIR: testBlobDir(),
          RIVER_LOG_LEVEL: 'silent',
          RIVER_RATE_LIMIT_PER_MINUTE: '10000',
        }),
        database,
        now: () => new Date(now),
      });
      app = a;
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      expect(
        await status(a, 'PUT', `/v1/communities/${cid}/bans/${member.riverId}`, owner.token, {
          durationSeconds: 999,
        }),
      ).toBe(400);
      expect(
        await status(a, 'PUT', `/v1/communities/${cid}/bans/${member.riverId}`, owner.token, {
          durationSeconds: 3600,
        }),
      ).toBe(200);
      const code = (
        await a.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(owner.token) })
      ).json().code;
      expect(await status(a, 'POST', '/v1/invites/join', member.token, { code, profile: sealed() })).toBe(
        403,
      );
      const bans = (
        await a.inject({ method: 'GET', url: `/v1/communities/${cid}/bans`, headers: auth(owner.token) })
      ).json().bans;
      expect(bans[0].until).toBe('2026-10-12T11:00:00.000Z');
      now += 3601_000;
      expect(await status(a, 'POST', '/v1/invites/join', member.token, { code, profile: sealed() })).toBe(
        200,
      );
    });

    it('banned users are removed and cannot rejoin until unbanned', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      expect(await status(a, 'PUT', `/v1/communities/${cid}/bans/${member.riverId}`, member.token)).toBe(403);
      expect(await status(a, 'PUT', `/v1/communities/${cid}/bans/${member.riverId}`, owner.token)).toBe(200);
      const code = (
        await a.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(owner.token) })
      ).json().code;
      const rejoin = await a.inject({
        method: 'POST',
        url: '/v1/invites/join',
        headers: auth(member.token),
        payload: { code, profile: sealed() },
      });
      expect(rejoin.statusCode).toBe(403);
      expect(rejoin.json().error.code).toBe('banned');
      const bans = (
        await a.inject({ method: 'GET', url: `/v1/communities/${cid}/bans`, headers: auth(owner.token) })
      ).json().bans;
      expect(bans.map((b: { riverId: string }) => b.riverId)).toEqual([member.riverId]);
      await status(a, 'DELETE', `/v1/communities/${cid}/bans/${member.riverId}`, owner.token);
      expect(await status(a, 'POST', '/v1/invites/join', member.token, { code, profile: sealed() })).toBe(
        200,
      );
    });

    it('@everyone can be restricted: no invites, read-only channels', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      expect(
        await status(a, 'PATCH', `/v1/roles/${cid}`, owner.token, {
          permissions: DEFAULT_EVERYONE & ~Permission.CREATE_INVITE,
        }),
      ).toBe(200);
      expect(await status(a, 'POST', `/v1/communities/${cid}/invites`, member.token)).toBe(403);
      await status(a, 'PATCH', `/v1/channels/${text}`, owner.token, {
        overwrites: [{ roleId: cid, allow: 0, deny: Permission.SEND_MESSAGES }],
      });
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, { id: id(), body: sealed() }),
      ).toBe(403);
      expect(await status(a, 'GET', `/v1/channels/${text}/messages`, member.token)).toBe(200);
    });

    it('messages: author edits, moderators pin and delete, everyone reacts', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const mid = id();
      await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, { id: mid, body: sealed() });
      expect(await status(a, 'PATCH', `/v1/messages/${mid}`, owner.token, { body: sealed() })).toBe(403);
      const edited = sealed();
      expect(await status(a, 'PATCH', `/v1/messages/${mid}`, member.token, { body: edited })).toBe(200);
      expect(await status(a, 'PUT', `/v1/messages/${mid}/pin`, member.token)).toBe(403);
      expect(await status(a, 'PUT', `/v1/messages/${mid}/pin`, owner.token)).toBe(200);
      const tag = randomBytes(16).toString('hex');
      for (const t of [owner.token, member.token]) {
        expect(await status(a, 'PUT', `/v1/messages/${mid}/reactions/${tag}`, t, { emoji: sealed() })).toBe(
          200,
        );
      }
      const list = async (q = '') =>
        (
          await a.inject({
            method: 'GET',
            url: `/v1/channels/${text}/messages${q}`,
            headers: auth(owner.token),
          })
        ).json().messages;
      const [msg] = await list();
      expect(msg.body).toBe(edited);
      expect(msg.editedAt).not.toBeNull();
      expect(msg.pinned).toBe(true);
      expect(msg.reactions[0].users.sort()).toEqual([owner.riverId, member.riverId].sort());
      expect(await list('?pinned=1')).toHaveLength(1);
      await status(a, 'DELETE', `/v1/messages/${mid}/reactions/${tag}`, member.token);
      expect((await list())[0].reactions[0].users).toEqual([owner.riverId]);
      expect(await status(a, 'DELETE', `/v1/messages/${mid}`, owner.token)).toBe(200);
      expect(await list()).toEqual([]);
    });

    it('flags key rotation when someone is removed; exactly one rotation wins', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const check = sealed();
      const code = (
        await a.inject({
          method: 'POST',
          url: `/v1/communities/${cid}/invites`,
          headers: auth(owner.token),
          payload: { check },
        })
      ).json().code;
      const member = await user(a);
      const joined = await a.inject({
        method: 'POST',
        url: '/v1/invites/join',
        headers: auth(member.token),
        payload: { code, profile: sealed() },
      });
      expect(joined.json()).toMatchObject({ inviteCheck: check, keyEpoch: 0, rotationNeeded: false });
      const other = await join(a, owner.token, cid);
      await status(a, 'DELETE', `/v1/communities/${cid}/members/${other.riverId}`, owner.token);
      let c = await fetchCommunity(a, owner.token, cid);
      expect(c).toMatchObject({ keyEpoch: 0, rotationNeeded: true });
      const first = await a.inject({
        method: 'POST',
        url: `/v1/communities/${cid}/epoch`,
        headers: auth(member.token),
        payload: { from: 0 },
      });
      const second = await a.inject({
        method: 'POST',
        url: `/v1/communities/${cid}/epoch`,
        headers: auth(owner.token),
        payload: { from: 0 },
      });
      expect(first.json()).toEqual({ epoch: 1 });
      expect(second.statusCode).toBe(409);
      c = await fetchCommunity(a, owner.token, cid);
      expect(c).toMatchObject({ keyEpoch: 1, rotationNeeded: false });
      // Non-members cannot rotate.
      expect(await status(a, 'POST', `/v1/communities/${cid}/epoch`, other.token, { from: 1 })).toBe(404);
    });

    it('members can leave; only the owner can delete the community', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      expect(await status(a, 'DELETE', `/v1/communities/${cid}`, member.token)).toBe(403);
      expect(await status(a, 'POST', `/v1/communities/${cid}/leave`, member.token)).toBe(200);
      expect(await status(a, 'POST', `/v1/communities/${cid}/leave`, owner.token)).toBe(400);
      expect(await status(a, 'DELETE', `/v1/communities/${cid}`, owner.token)).toBe(200);
      expect(
        (await a.inject({ method: 'GET', url: '/v1/communities', headers: auth(owner.token) })).json()
          .communities,
      ).toEqual([]);
    });

    it('categories group channels; layout moves them atomically; hidden channels hide their category', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text, voice } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const cat = id();
      const secretCat = id();
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/categories`, member.token, {
          id: cat,
          name: sealed(),
        }),
      ).toBe(403);
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/categories`, owner.token, {
          id: cat,
          name: sealed(),
        }),
      ).toBe(201);
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/categories`, owner.token, {
          id: secretCat,
          name: sealed(),
        }),
      ).toBe(201);
      // A private channel inside the second category: @everyone cannot view it.
      const secret = id();
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/channels`, owner.token, {
          id: secret,
          kind: 'text',
          name: sealed(),
          parentId: secretCat,
          overwrites: [{ roleId: cid, allow: 0, deny: Permission.VIEW_CHANNELS }],
        }),
      ).toBe(201);
      // Unknown category is refused.
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/channels`, owner.token, {
          id: id(),
          kind: 'text',
          name: sealed(),
          parentId: id(),
        }),
      ).toBe(400);

      const layout = {
        categories: [
          { id: secretCat, position: 0 },
          { id: cat, position: 1 },
        ],
        channels: [
          { id: voice, position: 0, parentId: cat },
          { id: text, position: 1, parentId: cat },
        ],
      };
      expect(await status(a, 'PUT', `/v1/communities/${cid}/layout`, member.token, layout)).toBe(403);
      expect(await status(a, 'PUT', `/v1/communities/${cid}/layout`, owner.token, layout)).toBe(200);
      expect(
        await status(a, 'PUT', `/v1/communities/${cid}/layout`, owner.token, {
          categories: [],
          channels: [{ id: text, position: 0, parentId: id() }],
        }),
      ).toBe(400);

      const mine = await fetchCommunity(a, owner.token, cid);
      expect(mine.categories.map((k) => k.id)).toEqual([secretCat, cat]);
      expect(mine.channels.find((c) => c.id === voice)).toMatchObject({ parentId: cat, position: 0 });
      expect(mine.channels.find((c) => c.id === text)).toMatchObject({ parentId: cat, position: 1 });

      const theirs = await fetchCommunity(a, member.token, cid);
      expect(theirs.channels.map((c) => c.id)).not.toContain(secret);
      expect(theirs.categories.map((k) => k.id)).toEqual([cat]);

      // Deleting a category leaves its channels uncategorised.
      expect(await status(a, 'DELETE', `/v1/categories/${cat}`, member.token)).toBe(403);
      expect(await status(a, 'PATCH', `/v1/categories/${cat}`, owner.token, { name: sealed() })).toBe(200);
      expect(await status(a, 'DELETE', `/v1/categories/${cat}`, owner.token)).toBe(200);
      const after = await fetchCommunity(a, owner.token, cid);
      expect(after.categories.map((k) => k.id)).toEqual([secretCat]);
      expect(after.channels.find((c) => c.id === text)?.parentId).toBeNull();
    });

    it('timeouts take away talking, not reading, and respect the hierarchy', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const mod = await join(a, owner.token, cid);
      const member = await join(a, owner.token, cid);
      const modRole = await role(a, owner.token, cid, Permission.MODERATE_MEMBERS);
      await assign(a, owner.token, cid, mod.riverId, [modRole.rid]);
      const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const url = (who: string) => `/v1/communities/${cid}/members/${who}/timeout`;

      expect(await status(a, 'PUT', url(member.riverId), member.token, { until: soon })).toBe(403);
      expect(await status(a, 'PUT', url(owner.riverId), mod.token, { until: soon })).toBe(403);
      expect(
        await status(a, 'PUT', url(member.riverId), mod.token, {
          until: new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString(),
        }),
      ).toBe(400);
      expect(
        await status(a, 'PUT', url(member.riverId), mod.token, {
          until: new Date(Date.now() - 1000).toISOString(),
        }),
      ).toBe(400);
      expect(await status(a, 'PUT', url(member.riverId), mod.token, { until: soon })).toBe(200);

      // Timed out: can read, cannot post or react.
      expect(await status(a, 'GET', `/v1/channels/${text}/messages`, member.token)).toBe(200);
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, { id: id(), body: sealed() }),
      ).toBe(403);
      expect(
        (await fetchCommunity(a, owner.token, cid)).members.find((m) => m.riverId === member.riverId),
      ).toMatchObject({ timeoutUntil: soon });

      expect(await status(a, 'PUT', url(member.riverId), mod.token, { until: null })).toBe(200);
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, { id: id(), body: sealed() }),
      ).toBe(201);
    });

    it('records an audit log that only permitted members can read', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const helper = await role(a, owner.token, cid, Permission.KICK_MEMBERS);
      await assign(a, owner.token, cid, member.riverId, [helper.rid]);
      await status(a, 'PATCH', `/v1/channels/${text}`, owner.token, { name: sealed() });
      expect(await status(a, 'GET', `/v1/communities/${cid}/audit`, member.token)).toBe(403);
      const res = await a.inject({
        method: 'GET',
        url: `/v1/communities/${cid}/audit`,
        headers: auth(owner.token),
      });
      expect(res.statusCode).toBe(200);
      const actions = (res.json().entries as Array<{ action: string; actor: string; target: string }>).map(
        (e) => e.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'member.join',
          'role.create',
          'member.roles',
          'channel.update',
          'invite.create',
        ]),
      );
      // Newest first, and nothing in it is content: only IDs and numbers.
      expect(actions[0]).toBe('channel.update');
      expect(JSON.stringify(res.json())).not.toMatch(/profile|body|meta/);
    });

    it("channels can follow their category's permissions until given their own", async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const cat = id();
      await status(a, 'POST', `/v1/communities/${cid}/categories`, owner.token, { id: cat, name: sealed() });
      const inside = id();
      await status(a, 'POST', `/v1/communities/${cid}/channels`, owner.token, {
        id: inside,
        kind: 'text',
        name: sealed(),
        parentId: cat,
      });
      let mine = await fetchCommunity(a, owner.token, cid);
      expect(mine.channels.find((c) => c.id === inside)).toMatchObject({ synced: true, overwrites: [] });

      // Hiding the category from @everyone hides its synced channel.
      const hidden = [{ roleId: cid, allow: 0, deny: Permission.VIEW_CHANNELS }];
      expect(await status(a, 'PATCH', `/v1/categories/${cat}`, member.token, { overwrites: hidden })).toBe(
        403,
      );
      expect(await status(a, 'PATCH', `/v1/categories/${cat}`, owner.token, { overwrites: hidden })).toBe(
        200,
      );
      expect((await fetchCommunity(a, member.token, cid)).channels.map((c) => c.id)).not.toContain(inside);
      mine = await fetchCommunity(a, owner.token, cid);
      expect(mine.categories.find((k) => k.id === cat)?.overwrites).toEqual(hidden);

      // Giving the channel its own permissions unsyncs it; syncing again restores the category's.
      await status(a, 'PATCH', `/v1/channels/${inside}`, owner.token, { overwrites: [] });
      expect((await fetchCommunity(a, member.token, cid)).channels.map((c) => c.id)).toContain(inside);
      expect((await fetchCommunity(a, owner.token, cid)).channels.find((c) => c.id === inside)?.synced).toBe(
        false,
      );
      await status(a, 'PATCH', `/v1/channels/${inside}`, owner.token, { synced: true });
      expect((await fetchCommunity(a, member.token, cid)).channels.map((c) => c.id)).not.toContain(inside);
    });

    it('serves a page for friend links opened in a browser', async () => {
      const a = await start();
      const page = await a.inject({ method: 'GET', url: '/add' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('paste it anywhere in River');
      expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('threads: start one from a message, reply in it, keep it out of the channel, archive it', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      const root = id();
      await status(a, 'POST', `/v1/channels/${text}/messages`, member.token, { id: root, body: sealed() });
      expect(await status(a, 'POST', `/v1/messages/${root}/thread`, member.token, { name: sealed() })).toBe(
        201,
      );
      expect(await status(a, 'POST', `/v1/messages/${root}/thread`, owner.token, { name: sealed() })).toBe(
        409,
      );
      const reply = id();
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, owner.token, {
          id: reply,
          body: sealed(),
          threadId: root,
        }),
      ).toBe(201);
      // No threads inside threads.
      expect(await status(a, 'POST', `/v1/messages/${reply}/thread`, owner.token, { name: sealed() })).toBe(
        400,
      );

      const channel = (
        await a.inject({ method: 'GET', url: `/v1/channels/${text}/messages`, headers: auth(owner.token) })
      ).json().messages as Array<{ id: string; thread: { count: number; creator: string } | null }>;
      expect(channel.map((m) => m.id)).toEqual([root]);
      expect(channel[0]!.thread).toMatchObject({ count: 1, creator: member.riverId });
      const thread = (
        await a.inject({ method: 'GET', url: `/v1/threads/${root}/messages`, headers: auth(member.token) })
      ).json().messages as Array<{ id: string; threadId: string }>;
      expect(thread).toEqual([expect.objectContaining({ id: reply, threadId: root })]);

      // The creator archives it; then only managers can post there.
      const outsider = await join(a, owner.token, cid);
      expect(await status(a, 'PATCH', `/v1/threads/${root}`, outsider.token, { archived: true })).toBe(403);
      expect(await status(a, 'PATCH', `/v1/threads/${root}`, member.token, { archived: true })).toBe(200);
      expect(
        await status(a, 'POST', `/v1/channels/${text}/messages`, outsider.token, {
          id: id(),
          body: sealed(),
          threadId: root,
        }),
      ).toBe(403);
      // Deleting the starting message removes the whole thread.
      expect(await status(a, 'DELETE', `/v1/messages/${root}`, member.token)).toBe(200);
      expect(await status(a, 'GET', `/v1/threads/${root}/messages`, owner.token)).toBe(404);
    });

    it('slowmode and announcement channels', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const member = await join(a, owner.token, cid);
      expect(await status(a, 'PATCH', `/v1/channels/${text}`, owner.token, { slowmode: 60 })).toBe(200);
      const send = (token: string) =>
        a.inject({
          method: 'POST',
          url: `/v1/channels/${text}/messages`,
          headers: auth(token),
          payload: { id: id(), body: sealed() },
        });
      expect((await send(member.token)).statusCode).toBe(201);
      const second = await send(member.token);
      expect(second.statusCode).toBe(429);
      expect(second.json().error.message).toMatch(/Slowmode is on: you can send again in \d+s/);
      // People who manage the channel are not slowed down.
      expect((await send(owner.token)).statusCode).toBe(201);
      expect((await send(owner.token)).statusCode).toBe(201);

      await status(a, 'PATCH', `/v1/channels/${text}`, owner.token, { slowmode: 0, announcement: true });
      expect((await send(member.token)).statusCode).toBe(403);
      expect((await send(owner.token)).statusCode).toBe(201);
      const listed = (await fetchCommunity(a, member.token, cid)).channels.find((c) => c.id === text)!;
      expect([listed.announcement, listed.slowmode]).toEqual([true, 0]);
    });

    it('voice channels turn people away when full, except those who may move members', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, voice } = await createCommunity(a, owner.token);
      const first = await join(a, owner.token, cid);
      const second = await join(a, owner.token, cid);
      expect(await status(a, 'PATCH', `/v1/channels/${voice}`, owner.token, { userLimit: 1 })).toBe(200);
      expect(
        (await fetchCommunity(a, first.token, cid)).channels.find((c) => c.id === voice)?.userLimit,
      ).toBe(1);

      await a.listen({ host: '127.0.0.1', port: 0 });
      const { port } = a.server.address() as { port: number };
      const connect = async (token: string) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
        const events: Array<{ t: string; code?: string; participants?: string[] }> = [];
        ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        ws.send(JSON.stringify({ t: 'auth', token }));
        await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));
        return { ws, events };
      };
      const one = await connect(first.token);
      one.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      await vi.waitFor(() =>
        expect(one.events.some((e) => e.t === 'voice' && e.participants?.length === 1)).toBe(true),
      );

      const two = await connect(second.token);
      two.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      await vi.waitFor(() => expect(two.events).toContainEqual({ t: 'error', code: 'voice_full' }));

      const boss = await connect(owner.token);
      boss.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      await vi.waitFor(() =>
        expect(boss.events.some((e) => e.t === 'voice' && e.participants?.length === 2)).toBe(true),
      );
      for (const c of [one, two, boss]) c.ws.close();
    });
    it('soundboard: managers add sounds, people in voice who may speak play them, with a cooldown', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, voice } = await createCommunity(a, owner.token);
      const guest = await join(a, owner.token, cid);
      const sid = id();
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/sounds`, guest.token, { id: id(), data: sealed() }),
      ).toBe(403);
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/sounds`, owner.token, { id: sid, data: sealed() }),
      ).toBe(201);
      expect(await status(a, 'PATCH', `/v1/sounds/${sid}`, guest.token, { data: sealed() })).toBe(403);
      expect(await status(a, 'PATCH', `/v1/sounds/${sid}`, owner.token, { data: sealed() })).toBe(200);
      const listed = (
        await a.inject({ method: 'GET', url: `/v1/communities/${cid}/sounds`, headers: auth(guest.token) })
      ).json();
      expect(soundsResponseSchema.parse(listed).sounds.map((x) => x.id)).toEqual([sid]);

      await a.listen({ host: '127.0.0.1', port: 0 });
      const { port } = a.server.address() as { port: number };
      type Ev = { t: string; code?: string; from?: string; soundId?: string };
      const connect = async (token: string) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
        const events: Ev[] = [];
        ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        ws.send(JSON.stringify({ t: 'auth', token }));
        await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));
        return { ws, events };
      };
      const boss = await connect(owner.token);
      const other = await connect(guest.token);
      // Not in voice yet.
      other.ws.send(JSON.stringify({ t: 'voice.sound', soundId: sid }));
      await vi.waitFor(() => expect(other.events).toContainEqual({ t: 'error', code: 'not_in_call' }));
      boss.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      other.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      await vi.waitFor(() => expect(boss.events.some((e) => e.t === 'voice')).toBe(true));
      await new Promise((r) => setTimeout(r, 100));
      other.ws.send(JSON.stringify({ t: 'voice.sound', soundId: sid }));
      await vi.waitFor(() =>
        expect(boss.events).toContainEqual(
          expect.objectContaining({ t: 'voice.sound', from: guest.riverId, soundId: sid }),
        ),
      );
      other.ws.send(JSON.stringify({ t: 'voice.sound', soundId: sid }));
      await vi.waitFor(() => expect(other.events).toContainEqual({ t: 'error', code: 'slow_down' }));
      boss.ws.send(JSON.stringify({ t: 'voice.sound', soundId: id() }));
      await vi.waitFor(() => expect(boss.events).toContainEqual({ t: 'error', code: 'not_found' }));
      // Server-muted people cannot play sounds.
      boss.ws.send(JSON.stringify({ t: 'voice.moderate', target: guest.riverId, serverMuted: true }));
      await new Promise((r) => setTimeout(r, 2600));
      other.ws.send(JSON.stringify({ t: 'voice.sound', soundId: sid }));
      await vi.waitFor(() => expect(other.events).toContainEqual({ t: 'error', code: 'forbidden' }));
      expect(await status(a, 'DELETE', `/v1/sounds/${sid}`, owner.token)).toBe(200);
      for (const c of [boss, other]) c.ws.close();
    }, 15_000);

    it('stages: the audience joins muted, raises hands, and moderators invite them to speak', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, voice } = await createCommunity(a, owner.token);
      const guest = await join(a, owner.token, cid);
      expect(await status(a, 'PATCH', `/v1/channels/${voice}`, owner.token, { stage: true })).toBe(200);
      await a.listen({ host: '127.0.0.1', port: 0 });
      const { port } = a.server.address() as { port: number };
      type St = { serverMuted?: boolean; handRaised?: boolean };
      type Ev = { t: string; code?: string; channelId?: string; states?: Record<string, St> };
      const connect = async (token: string) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
        const events: Ev[] = [];
        ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        ws.send(JSON.stringify({ t: 'auth', token }));
        await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));
        return { ws, events };
      };
      const stateOf = (events: Ev[], id: string) =>
        events.filter((e) => e.t === 'voice' && e.channelId === voice).at(-1)?.states?.[id];
      const boss = await connect(owner.token);
      const other = await connect(guest.token);
      boss.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      other.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      await vi.waitFor(() => expect(stateOf(boss.events, guest.riverId)?.serverMuted).toBe(true));
      expect(stateOf(boss.events, owner.riverId)?.serverMuted).toBe(false);
      const hand = (up: boolean) =>
        other.ws.send(
          JSON.stringify({
            t: 'voice.state',
            muted: false,
            deafened: false,
            streaming: false,
            handRaised: up,
          }),
        );
      hand(true);
      await vi.waitFor(() => expect(stateOf(boss.events, guest.riverId)?.handRaised).toBe(true));
      // Members cannot invite themselves.
      other.ws.send(JSON.stringify({ t: 'voice.moderate', target: guest.riverId, speaker: true }));
      await vi.waitFor(() => expect(other.events).toContainEqual({ t: 'error', code: 'forbidden' }));
      boss.ws.send(JSON.stringify({ t: 'voice.moderate', target: guest.riverId, speaker: true }));
      await vi.waitFor(() =>
        expect(stateOf(other.events, guest.riverId)).toMatchObject({ serverMuted: false, handRaised: false }),
      );
      // Speakers cannot raise a hand; back to the audience.
      hand(true);
      boss.ws.send(JSON.stringify({ t: 'voice.moderate', target: guest.riverId, speaker: false }));
      await vi.waitFor(() =>
        expect(stateOf(boss.events, guest.riverId)).toMatchObject({ serverMuted: true, handRaised: false }),
      );
      // Leaving the stage for a normal voice channel lifts the audience mute.
      const lounge = id();
      expect(
        await status(a, 'POST', `/v1/communities/${cid}/channels`, owner.token, {
          id: lounge,
          kind: 'voice',
          name: sealed(),
        }),
      ).toBe(201);
      other.ws.send(JSON.stringify({ t: 'voice.join', channelId: lounge }));
      await vi.waitFor(() =>
        expect(
          other.events.filter((e) => e.t === 'voice' && e.channelId === lounge).at(-1)?.states?.[
            guest.riverId
          ]?.serverMuted,
        ).toBe(false),
      );
      for (const c of [boss, other]) c.ws.close();
    });

    it('server mute and deafen need Mute members, follow the hierarchy, and stick through a rejoin', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, voice } = await createCommunity(a, owner.token);
      const guest = await join(a, owner.token, cid);
      await a.listen({ host: '127.0.0.1', port: 0 });
      const { port } = a.server.address() as { port: number };
      type Ev = {
        t: string;
        code?: string;
        states?: Record<string, { serverMuted?: boolean; serverDeafened?: boolean }>;
      };
      const connect = async (token: string) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
        const events: Ev[] = [];
        ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        ws.send(JSON.stringify({ t: 'auth', token }));
        await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));
        ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        return { ws, events };
      };
      const boss = await connect(owner.token);
      const other = await connect(guest.token);
      const stateOf = (events: Ev[], id: string) =>
        events.filter((e) => e.t === 'voice').at(-1)?.states?.[id];
      await vi.waitFor(() => expect(stateOf(boss.events, guest.riverId)).toBeDefined());
      // A member cannot deafen the owner.
      other.ws.send(JSON.stringify({ t: 'voice.moderate', target: owner.riverId, serverDeafened: true }));
      await vi.waitFor(() => expect(other.events).toContainEqual({ t: 'error', code: 'forbidden' }));
      boss.ws.send(JSON.stringify({ t: 'voice.moderate', target: guest.riverId, serverDeafened: true }));
      await vi.waitFor(() => expect(stateOf(other.events, guest.riverId)?.serverDeafened).toBe(true));
      other.ws.send(JSON.stringify({ t: 'voice.leave' }));
      other.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
      await vi.waitFor(() =>
        expect(stateOf(boss.events, guest.riverId)).toMatchObject({
          serverDeafened: true,
          serverMuted: false,
        }),
      );
      boss.ws.send(JSON.stringify({ t: 'voice.moderate', target: guest.riverId, serverDeafened: false }));
      await vi.waitFor(() => expect(stateOf(other.events, guest.riverId)?.serverDeafened).toBe(false));
      for (const c of [boss, other]) c.ws.close();
    });

    describe('voice survives dropped connections', () => {
      type Ev = {
        t: string;
        code?: string;
        participants?: string[];
        states?: Record<string, { reconnecting?: boolean }>;
        online?: boolean;
        riverId?: string;
      };
      const setup = async (voiceGraceMs: number) => {
        const a = await start({ voiceGraceMs });
        const owner = await user(a);
        const { cid, voice } = await createCommunity(a, owner.token);
        const guest = await join(a, owner.token, cid);
        await a.listen({ host: '127.0.0.1', port: 0 });
        const { port } = a.server.address() as { port: number };
        const connect = async (token: string) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
          const events: Ev[] = [];
          ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
          await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
          });
          ws.send(JSON.stringify({ t: 'auth', token }));
          await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));
          return { ws, events };
        };
        const lastVoice = (events: Ev[]) => events.filter((e) => e.t === 'voice').at(-1);
        return { owner, guest, cid, voice, connect, lastVoice };
      };

      it('keeps the seat (marked reconnecting) and resumes it when the app rejoins', async () => {
        const { owner, guest, voice, connect, lastVoice } = await setup(5_000);
        const host = await connect(owner.token);
        let member = await connect(guest.token);
        host.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        member.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        await vi.waitFor(() => expect(lastVoice(host.events)?.participants).toHaveLength(2));

        member.ws.close(); // the tunnel dropped
        await vi.waitFor(() =>
          expect(lastVoice(host.events)?.states?.[guest.riverId]?.reconnecting).toBe(true),
        );
        expect(lastVoice(host.events)?.participants).toContain(guest.riverId);
        // Nobody is announced offline for a brief drop.
        expect(host.events.some((e) => e.t === 'presence' && e.online === false)).toBe(false);

        member = await connect(guest.token);
        member.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        await vi.waitFor(() =>
          expect(lastVoice(host.events)?.states?.[guest.riverId]?.reconnecting).toBeFalsy(),
        );
        // The seat was never given up in between.
        const seen = host.events.filter((e) => e.t === 'voice').map((e) => e.participants?.length);
        expect(seen.slice(seen.indexOf(2))).not.toContain(1);
        for (const c of [host, member]) c.ws.close();
      });

      it('gives the seat up when the app does not come back in time', async () => {
        const { owner, guest, voice, connect, lastVoice } = await setup(200);
        const host = await connect(owner.token);
        const member = await connect(guest.token);
        host.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        member.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        await vi.waitFor(() => expect(lastVoice(host.events)?.participants).toHaveLength(2));
        member.ws.close();
        await vi.waitFor(() => expect(lastVoice(host.events)?.participants).toEqual([owner.riverId]));
        host.ws.close();
      });

      it('relays voice frames only to people in the same voice channel, within limits', async () => {
        const { owner, guest, voice, connect } = await setup(5_000);
        const stranger = await user(app);
        const host = await connect(owner.token);
        const member = await connect(guest.token);
        const other = await connect(stranger.token);
        const binary = (ws: WebSocket) => {
          const got: Uint8Array[] = [];
          ws.binaryType = 'arraybuffer';
          const prev = ws.onmessage;
          ws.onmessage = (m) => {
            if (m.data instanceof ArrayBuffer) got.push(new Uint8Array(m.data));
            else prev?.call(ws, m);
          };
          return got;
        };
        const atMember = binary(member.ws);
        const atOther = binary(other.ws);
        const atHost = binary(host.ws);
        // Not in voice yet: nothing is forwarded.
        host.ws.send(encodeRelayOut([guest.riverId], new Uint8Array([1, 2, 3])));
        host.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        member.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        await vi.waitFor(() =>
          expect(host.events.filter((e) => e.t === 'voice').at(-1)?.participants).toHaveLength(2),
        );

        const payload = new Uint8Array([9, 8, 7, 6]);
        host.ws.send(encodeRelayOut([guest.riverId, stranger.riverId, owner.riverId], payload));
        await vi.waitFor(() => expect(atMember).toHaveLength(1));
        expect(decodeRelayIn(atMember[0]!)).toEqual({ sender: owner.riverId, payload });
        // Too big: dropped.
        const big = new Uint8Array(2 + 16 + MAX_RELAY_PAYLOAD + 1);
        big.set(encodeRelayOut([guest.riverId], new Uint8Array(1)).subarray(0, 18));
        host.ws.send(big);
        // A flood is thinned out, not a reason to close the connection.
        for (let i = 0; i < RELAY_BURST + 200; i++) host.ws.send(encodeRelayOut([guest.riverId], payload));
        await new Promise((r) => setTimeout(r, 300));
        expect(atMember.length).toBeGreaterThan(RELAY_BURST - 10);
        expect(atMember.length).toBeLessThan(RELAY_BURST + 150);
        expect(host.ws.readyState).toBe(WebSocket.OPEN);
        expect(atOther).toHaveLength(0);
        expect(atHost).toHaveLength(0);
        for (const c of [host, member, other]) c.ws.close();
      });

      it('relays voice between the members of a private call room only', async () => {
        const { owner, guest, connect } = await setup(5_000);
        const stranger = await user(app);
        const a = await connect(owner.token);
        const b = await connect(guest.token);
        const c = await connect(stranger.token);
        const inbox = (ws: WebSocket) => {
          const got: Uint8Array[] = [];
          ws.binaryType = 'arraybuffer';
          const prev = ws.onmessage;
          ws.onmessage = (m) => {
            if (m.data instanceof ArrayBuffer) got.push(new Uint8Array(m.data));
            else prev?.call(ws, m);
          };
          return got;
        };
        const atB = inbox(b.ws);
        const atC = inbox(c.ws);
        const room = 'r'.repeat(32);
        a.ws.send(JSON.stringify({ t: 'call.room', room }));
        b.ws.send(JSON.stringify({ t: 'call.room', room }));
        c.ws.send(JSON.stringify({ t: 'call.room', room: 's'.repeat(32) }));
        await new Promise((r) => setTimeout(r, 100));
        a.ws.send(encodeRelayOut([guest.riverId, stranger.riverId], new Uint8Array([1])));
        await vi.waitFor(() => expect(atB).toHaveLength(1));
        b.ws.send(JSON.stringify({ t: 'call.room', room: null }));
        await new Promise((r) => setTimeout(r, 100));
        a.ws.send(encodeRelayOut([guest.riverId], new Uint8Array([2])));
        await new Promise((r) => setTimeout(r, 200));
        expect(atB).toHaveLength(1);
        expect(atC).toHaveLength(0);
        for (const x of [a, b, c]) x.ws.close();
      });

      it('presence: invisible looks offline, idle and do-not-disturb show to others', async () => {
        const { owner, guest, cid, connect } = await setup(5_000);
        const watcher = await connect(owner.token);
        const memberOf = async () =>
          (await fetchCommunity(app, owner.token, cid)).members.find((m) => m.riverId === guest.riverId)!;

        // Connecting invisible: never announced online, offline in the member list.
        const ghost = new WebSocket(
          `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/v1/ws`,
        );
        await new Promise((r) => (ghost.onopen = r));
        ghost.send(JSON.stringify({ t: 'auth', token: guest.token, status: 'invisible' }));
        await new Promise((r) => setTimeout(r, 200));
        expect(
          watcher.events.some((e) => e.t === 'presence' && e.riverId === guest.riverId && e.online),
        ).toBe(false);
        expect((await memberOf()).online).toBe(false);

        ghost.send(JSON.stringify({ t: 'presence.set', status: 'dnd' }));
        await vi.waitFor(() =>
          expect(watcher.events.filter((e) => e.t === 'presence').at(-1)).toMatchObject({
            riverId: guest.riverId,
            online: true,
            status: 'dnd',
          }),
        );
        expect(await memberOf()).toMatchObject({ online: true, status: 'dnd' });

        ghost.send(JSON.stringify({ t: 'presence.set', status: 'online' }));
        await vi.waitFor(() =>
          expect(watcher.events.filter((e) => e.t === 'presence').at(-1)).toEqual({
            t: 'presence',
            riverId: guest.riverId,
            online: true,
          }),
        );
        ghost.send(JSON.stringify({ t: 'presence.set', status: 'invisible' }));
        await vi.waitFor(() =>
          expect(watcher.events.filter((e) => e.t === 'presence').at(-1)).toMatchObject({ online: false }),
        );
        ghost.close();
        watcher.ws.close();
      });

      it('leaving on purpose frees the seat at once', async () => {
        const { owner, guest, voice, connect, lastVoice } = await setup(60_000);
        const host = await connect(owner.token);
        const member = await connect(guest.token);
        host.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        member.ws.send(JSON.stringify({ t: 'voice.join', channelId: voice }));
        await vi.waitFor(() => expect(lastVoice(host.events)?.participants).toHaveLength(2));
        member.ws.send(JSON.stringify({ t: 'voice.leave' }));
        await vi.waitFor(() => expect(lastVoice(host.events)?.participants).toEqual([owner.riverId]));
        for (const c of [host, member]) c.ws.close();
      });
    });
  });
  describe('attachments', () => {
    const blob = (n = 1024): Buffer => randomBytes(16 + n + 32);
    const upload = (a: FastifyInstance, token: string, body: Buffer = blob()) =>
      a.inject({
        method: 'POST',
        url: '/v1/attachments',
        headers: { ...auth(token), 'content-type': 'application/octet-stream' },
        payload: body,
      });

    it('stores encrypted blobs, links them to messages and serves them to members', async () => {
      const a = await start();
      const owner = await user(a);
      const { text } = await createCommunity(a, owner.token);
      const body = blob();
      const up = await upload(a, owner.token, body);
      expect(up.statusCode).toBe(201);
      const { id: blobId } = up.json();
      const mid = id();
      const sent = await a.inject({
        method: 'POST',
        url: `/v1/channels/${text}/messages`,
        headers: auth(owner.token),
        payload: { id: mid, body: sealed(), attachments: [blobId] },
      });
      expect(sent.statusCode).toBe(201);
      expect(sent.json().attachments).toEqual([blobId]);
      const msgs = (
        await a.inject({ method: 'GET', url: `/v1/channels/${text}/messages`, headers: auth(owner.token) })
      ).json().messages;
      expect(msgs[0].attachments).toEqual([blobId]);
      const got = await a.inject({
        method: 'GET',
        url: `/v1/attachments/${blobId}`,
        headers: auth(owner.token),
      });
      expect(got.statusCode).toBe(200);
      expect(got.rawPayload.equals(body)).toBe(true);
      // A blob can be used once only.
      const again = await a.inject({
        method: 'POST',
        url: `/v1/channels/${text}/messages`,
        headers: auth(owner.token),
        payload: { id: id(), body: sealed(), attachments: [blobId] },
      });
      expect(again.statusCode).toBe(400);
      // Deleting the message deletes the blob.
      await a.inject({ method: 'DELETE', url: `/v1/messages/${mid}`, headers: auth(owner.token) });
      await a.collectAttachments();
      expect(
        (await a.inject({ method: 'GET', url: `/v1/attachments/${blobId}`, headers: auth(owner.token) }))
          .statusCode,
      ).toBe(404);
    });

    it('requires a session, the octet-stream type and a plausible size', async () => {
      const a = await start();
      const owner = await user(a);
      expect(
        (
          await a.inject({
            method: 'POST',
            url: '/v1/attachments',
            headers: { 'content-type': 'application/octet-stream' },
            payload: blob(),
          })
        ).statusCode,
      ).toBe(401);
      expect((await upload(a, owner.token, randomBytes(50))).statusCode).toBe(400);
      expect(
        (
          await a.inject({
            method: 'POST',
            url: '/v1/attachments',
            headers: { ...auth(owner.token), 'content-type': 'application/json' },
            payload: JSON.stringify({ x: 1 }),
          })
        ).statusCode,
      ).toBe(415);
      expect((await upload(a, owner.token, randomBytes(26 * 1024 * 1024))).statusCode).toBe(413);
    });

    it('cannot attach other people’s uploads, and ATTACH_FILES is enforced', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid, text } = await createCommunity(a, owner.token);
      const code = (
        await a.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(owner.token) })
      ).json().code;
      const member = await user(a);
      await a.inject({
        method: 'POST',
        url: '/v1/invites/join',
        headers: auth(member.token),
        payload: { code, profile: sealed() },
      });
      const ownersBlob = (await upload(a, owner.token)).json().id;
      const stolen = await a.inject({
        method: 'POST',
        url: `/v1/channels/${text}/messages`,
        headers: auth(member.token),
        payload: { id: id(), body: sealed(), attachments: [ownersBlob] },
      });
      expect(stolen.statusCode).toBe(400);
      await a.inject({
        method: 'PATCH',
        url: `/v1/roles/${cid}`,
        headers: auth(owner.token),
        payload: { permissions: DEFAULT_EVERYONE & ~Permission.ATTACH_FILES },
      });
      const mine = (await upload(a, member.token)).json().id;
      const denied = await a.inject({
        method: 'POST',
        url: `/v1/channels/${text}/messages`,
        headers: auth(member.token),
        payload: { id: id(), body: sealed(), attachments: [mine] },
      });
      expect(denied.statusCode).toBe(403);
    });

    it('keeps direct-message files for the mailbox lifetime, then deletes them', async () => {
      const a = await start();
      const owner = await user(a);
      const res = await a.inject({
        method: 'POST',
        url: '/v1/attachments?retain=dm',
        headers: { ...auth(owner.token), 'content-type': 'application/octet-stream' },
        payload: blob(),
      });
      const blobId = res.json().id;
      const get = async () =>
        (await a.inject({ method: 'GET', url: `/v1/attachments/${blobId}`, headers: auth(owner.token) }))
          .statusCode;
      await database.db
        .updateTable('attachments')
        .set({ created_at: new Date(Date.now() - 48 * 3600_000).toISOString() })
        .execute();
      await a.collectAttachments();
      expect(await get()).toBe(200);
      await database.db
        .updateTable('attachments')
        .set({ retain_until: new Date(Date.now() - 1000).toISOString() })
        .execute();
      await a.collectAttachments();
      expect(await get()).toBe(404);
    });

    it('garbage-collects uploads never attached to a message', async () => {
      const a = await start();
      const owner = await user(a);
      const blobId = (await upload(a, owner.token)).json().id;
      await database.db
        .updateTable('attachments')
        .set({ created_at: new Date(Date.now() - 48 * 3600_000).toISOString() })
        .execute();
      await a.collectAttachments();
      expect(
        (await a.inject({ method: 'GET', url: `/v1/attachments/${blobId}`, headers: auth(owner.token) }))
          .statusCode,
      ).toBe(404);
    });
  });
});
