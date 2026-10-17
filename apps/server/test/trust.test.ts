import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, sign } from '@river/crypto';
import { challengeResponseSchema, deleteAccountMessage } from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';
import { auth, b64, registerUser } from './helpers.ts';

/** Server-side parts of the 2.11 trust audit: usernames, deleted River IDs, link slots. */

let app: FastifyInstance;
let database: RiverDatabase;
let clock = new Date();
afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function start(): Promise<void> {
  clock = new Date();
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({ RIVER_LOG_LEVEL: 'silent', RIVER_RATE_LIMIT_PER_MINUTE: '10000' }),
    database,
    now: () => clock,
  });
}

const setUsername = (token: string, username: string) =>
  app.inject({ method: 'PUT', url: '/v1/accounts/me/username', headers: auth(token), payload: { username } });

async function deleteAccount(u: Awaited<ReturnType<typeof registerUser>>): Promise<void> {
  const challenge = challengeResponseSchema.parse(
    (await app.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose: 'session' } })).json(),
  ).challenge;
  const signature = b64(
    sign(u.device.privateKey, deleteAccountMessage(Buffer.from(challenge, 'base64'), u.riverId, 1)),
  );
  const res = await app.inject({
    method: 'DELETE',
    url: '/v1/accounts/me',
    headers: auth(u.token),
    payload: { challenge, deviceId: 1, signature },
  });
  expect(res.statusCode).toBe(200);
}

describe('usernames given up are held for their owner', () => {
  it('a changed username stays yours for 30 days; then anyone may take it', async () => {
    await start();
    const alice = await registerUser(app);
    const mallory = await registerUser(app);
    expect((await setUsername(alice.token, 'alice')).statusCode).toBe(200);
    expect((await setUsername(alice.token, 'alice.new')).statusCode).toBe(200);
    expect((await setUsername(mallory.token, 'alice')).statusCode).toBe(409);
    // Alice may take it back.
    expect((await setUsername(alice.token, 'alice')).statusCode).toBe(200);
    expect((await setUsername(alice.token, 'alice.new')).statusCode).toBe(200);
    // 30 days later.
    await database.db
      .updateTable('username_holds')
      .set({ until: new Date(clock.getTime() - 1000).toISOString() })
      .execute();
    expect((await setUsername(mallory.token, 'alice')).statusCode).toBe(200);
  });
});

describe('deleted River IDs', () => {
  it('come back only with their identity key; their username is held meanwhile', async () => {
    await start();
    const alice = await registerUser(app);
    const mallory = await registerUser(app);
    expect((await setUsername(alice.token, 'alice')).statusCode).toBe(200);
    await deleteAccount(alice);

    // Someone else cannot register Alice's River ID under a new key...
    const impostor = { ...createIdentity(), riverId: alice.riverId };
    await expect(registerUser(app, { identity: impostor })).rejects.toThrow(/409/);
    // ...nor take her username right away.
    expect((await setUsername(mallory.token, 'alice')).statusCode).toBe(409);

    // Alice herself (same identity key, e.g. after the operator removed the account) can.
    const back = await registerUser(app, { identity: alice.identity });
    expect(back.riverId).toBe(alice.riverId);
    expect((await setUsername(back.token, 'alice')).statusCode).toBe(200);
  });
});

describe('link slots', () => {
  const hello = {
    authKey: b64(createIdentity().publicKey),
    registrationId: 777,
    linkKey: b64(createIdentity().publicKey),
    deviceName: 'Test phone',
  };
  const mac = 'A'.repeat(43);
  const slot = (n: number): string => `ReServedSlot${String(n).padStart(10, '0')}`;
  const reserve = (token: string, id: string) =>
    app.inject({ method: 'POST', url: `/v1/link/${id}/reserve`, headers: auth(token) });
  const answer = (id: string) =>
    app.inject({ method: 'PUT', url: `/v1/link/${id}`, payload: { hello, mac } });

  it('a new account holds two at a time (a retry replaces an unanswered one); older accounts three', async () => {
    await start();
    const user = await registerUser(app);
    expect((await reserve(user.token, slot(1))).statusCode).toBe(201);
    expect((await answer(slot(1))).statusCode).toBe(201);
    expect((await reserve(user.token, slot(2))).statusCode).toBe(201);
    // Trying again replaces the code nobody answered.
    expect((await reserve(user.token, slot(3))).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/v1/link/${slot(2)}` })).statusCode).toBe(404);
    expect((await answer(slot(3))).statusCode).toBe(201);
    expect((await reserve(user.token, slot(4))).statusCode).toBe(429);
    // An account from an earlier day is no longer new.
    await database.db.updateTable('accounts').set({ created_on: '2026-10-01' }).execute();
    expect((await reserve(user.token, slot(4))).statusCode).toBe(201);
  });

  it('throwaway accounts from one address cannot use up the slots', async () => {
    await start();
    let refused = 0;
    for (let n = 0; n < 10; n++) {
      const throwaway = await registerUser(app);
      const res = await reserve(throwaway.token, slot(100 + n));
      if (res.statusCode === 429) refused += 1;
      else expect(res.statusCode).toBe(201);
    }
    expect(refused).toBe(4);
  });
});
