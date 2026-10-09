import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
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

async function start(): Promise<FastifyInstance> {
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_ATTACHMENT_DIR: testBlobDir(),
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
    }),
    database,
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

    it('new communities get an @everyone role with default permissions', async () => {
      const a = await start();
      const owner = await user(a);
      const { cid } = await createCommunity(a, owner.token);
      const c = await fetchCommunity(a, owner.token, cid);
      expect(c.ownerId).toBe(owner.riverId);
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
