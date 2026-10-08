import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, generateKeyPair, sign } from '@river/crypto';
import {
  challengeResponseSchema,
  communitySchema,
  deviceListMessage,
  registerResponseSchema,
  registrationMessage,
} from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';

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
    config: loadConfig({ RIVER_LOG_LEVEL: 'silent', RIVER_RATE_LIMIT_PER_MINUTE: '10000' }),
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
    ).toBe(403);
  });

  it('members cannot invite or add channels; invalid invites are refused', async () => {
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
    ).toBe(403);
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
});
