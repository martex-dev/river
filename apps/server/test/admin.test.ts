import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { sign } from '@river/crypto';
import { BANNED_UNTIL, adminOverviewSchema, challengeResponseSchema, sessionMessage } from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';
import { auth, b64, registerUser } from './helpers.ts';

const TOKEN = 'h'.repeat(40);
const host = { authorization: `Bearer ${TOKEN}` };
const id = (): string => randomBytes(16).toString('base64url');
const sealed = (): string => randomBytes(40).toString('base64');

let app: FastifyInstance;
let database: RiverDatabase;
let clock = new Date('2026-10-10T12:00:00.000Z');
afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function start(env: Record<string, string> = { RIVER_HOST_TOKEN: TOKEN }): Promise<void> {
  clock = new Date('2026-10-10T12:00:00.000Z');
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
      RIVER_ATTACHMENT_DIR: join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`),
      ...env,
    }),
    database,
    now: () => clock,
  });
}

async function community(token: string): Promise<{ cid: string; code: string }> {
  const cid = id();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/communities',
    headers: auth(token),
    payload: {
      id: cid,
      meta: sealed(),
      profile: sealed(),
      channels: [{ id: id(), kind: 'text', name: sealed() }],
    },
  });
  expect(res.statusCode).toBe(201);
  const inv = await app.inject({
    method: 'POST',
    url: `/v1/communities/${cid}/invites`,
    headers: auth(token),
  });
  return { cid, code: inv.json().code };
}

async function joinCommunity(token: string, code: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/invites/join',
    headers: auth(token),
    payload: { code, profile: sealed() },
  });
  expect(res.statusCode).toBe(200);
}

/** Signs in again with the device key, as the app does after a restart. */
async function signIn(user: Awaited<ReturnType<typeof registerUser>>) {
  const challenge = challengeResponseSchema.parse(
    (await app.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose: 'session' } })).json(),
  ).challenge;
  return app.inject({
    method: 'POST',
    url: '/v1/auth/session',
    payload: {
      riverId: user.riverId,
      deviceId: 1,
      challenge,
      signature: b64(
        sign(user.device.privateKey, sessionMessage(Buffer.from(challenge, 'base64'), user.riverId, 1)),
      ),
    },
  });
}

const overview = async () =>
  adminOverviewSchema.parse(
    (await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: host })).json(),
  );

describe('operator admin', () => {
  it('is reachable only from this machine, with the host token', async () => {
    await start();
    expect((await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: host })).statusCode).toBe(
      200,
    );
    // Through the tunnel (proxy headers) or from elsewhere it does not exist.
    for (const extra of [
      { headers: { ...host, 'x-forwarded-for': '203.0.113.9' } },
      { headers: { ...host, 'cf-connecting-ip': '203.0.113.9' } },
      { headers: host, remoteAddress: '203.0.113.9' },
    ]) {
      expect((await app.inject({ method: 'GET', url: '/v1/admin/overview', ...extra })).statusCode).toBe(404);
    }
    const wrong = await app.inject({
      method: 'GET',
      url: '/v1/admin/overview',
      headers: { authorization: `Bearer ${'x'.repeat(40)}` },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('does not exist on a server without a host token', async () => {
    await start({});
    expect((await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: host })).statusCode).toBe(
      404,
    );
  });

  it('lists every account and community with counts, never names', async () => {
    await start();
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const { cid, code } = await community(owner.token);
    await joinCommunity(member.token, code);
    const o = await overview();
    expect(o.accounts.map((a) => a.riverId).sort()).toEqual([owner.riverId, member.riverId].sort());
    expect(o.accounts.find((a) => a.riverId === member.riverId)).toMatchObject({
      devices: 1,
      communities: 1,
      online: false,
      suspendedUntil: null,
    });
    expect(o.communities).toEqual([
      expect.objectContaining({ id: cid, owner: owner.riverId, members: 2, channels: 1 }),
    ]);
  });

  it('times someone out: they are signed out, cannot sign in, and are back when it ends', async () => {
    await start();
    const user = await registerUser(app);
    const until = '2026-10-10T13:00:00.000Z';
    const res = await app.inject({
      method: 'POST',
      url: `/v1/admin/accounts/${user.riverId}/suspend`,
      headers: host,
      payload: { until, reason: 'spam' },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/communities', headers: auth(user.token) })).statusCode,
    ).toBe(401);
    const refused = await signIn(user);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toEqual({
      code: 'account_suspended',
      message: 'Your account is suspended on this River server until 2026-10-10 13:00 UTC. Reason: spam',
    });
    expect((await overview()).accounts[0]).toMatchObject({ suspendedUntil: until, suspendReason: 'spam' });

    clock = new Date('2026-10-10T13:00:01.000Z');
    expect((await signIn(user)).statusCode).toBe(200);
    expect((await overview()).accounts[0]!.suspendedUntil).toBeNull();
  });

  it('bans until lifted, and lifts the ban', async () => {
    await start();
    const user = await registerUser(app);
    await app.inject({
      method: 'POST',
      url: `/v1/admin/accounts/${user.riverId}/suspend`,
      headers: host,
      payload: { until: null },
    });
    clock = new Date('2030-01-01T00:00:00.000Z');
    const refused = await signIn(user);
    expect(refused.json().error.message).toBe('Your account has been banned from this River server.');
    expect((await overview()).accounts[0]!.suspendedUntil).toBe(BANNED_UNTIL);
    await app.inject({ method: 'POST', url: `/v1/admin/accounts/${user.riverId}/unsuspend`, headers: host });
    expect((await signIn(user)).statusCode).toBe(200);
  });

  it('refuses a timeout that ends in the past, and unknown accounts', async () => {
    await start();
    const user = await registerUser(app);
    const past = await app.inject({
      method: 'POST',
      url: `/v1/admin/accounts/${user.riverId}/suspend`,
      headers: host,
      payload: { until: '2026-10-10T11:00:00.000Z' },
    });
    expect(past.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/admin/accounts/nobody/suspend',
      headers: host,
      payload: { until: null },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('deletes an account: it leaves its communities and the ones it owns are deleted', async () => {
    await start();
    const owner = await registerUser(app);
    const leaver = await registerUser(app);
    const theirs = await community(leaver.token);
    const mine = await community(owner.token);
    await joinCommunity(leaver.token, mine.code);
    await joinCommunity(owner.token, theirs.code);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/admin/accounts/${leaver.riverId}`,
      headers: host,
    });
    expect(res.statusCode).toBe(200);
    const o = await overview();
    expect(o.accounts.map((a) => a.riverId)).toEqual([owner.riverId]);
    expect(o.communities.map((c) => c.id)).toEqual([mine.cid]);
    expect(o.communities[0]!.members).toBe(1);
    expect((await signIn(leaver)).statusCode).toBe(401);
  });

  it('deletes a community', async () => {
    await start();
    const owner = await registerUser(app);
    const { cid } = await community(owner.token);
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/admin/communities/${cid}`, headers: host })).statusCode,
    ).toBe(200);
    expect((await overview()).communities).toEqual([]);
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/admin/communities/${cid}`, headers: host })).statusCode,
    ).toBe(404);
  });
});
