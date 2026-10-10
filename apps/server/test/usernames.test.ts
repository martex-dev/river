import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { sign } from '@river/crypto';
import {
  adminOverviewSchema,
  challengeResponseSchema,
  deviceListMessage,
  registrationMessage,
} from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';
import { auth, b64, registerUser } from './helpers.ts';

const TOKEN = 'h'.repeat(40);
const host = { authorization: `Bearer ${TOKEN}` };

let app: FastifyInstance;
let database: RiverDatabase;
let clock = new Date('2026-10-10T12:00:00.000Z');
afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function start(env: Record<string, string> = {}): Promise<void> {
  clock = new Date('2026-10-10T12:00:00.000Z');
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
      RIVER_HOST_TOKEN: TOKEN,
      ...env,
    }),
    database,
    now: () => clock,
  });
}

async function setUsername(token: string, username: string) {
  return app.inject({
    method: 'PUT',
    url: '/v1/accounts/me/username',
    headers: auth(token),
    payload: { username },
  });
}

const overview = async () =>
  adminOverviewSchema.parse(
    (await app.inject({ method: 'GET', url: '/v1/admin/overview', headers: host })).json(),
  );

/** Registers with a one-time sign-up code (the operator created the account). */
async function registerWithCode(code: string) {
  const user = await import('./helpers.ts');
  return user.registerUser(app, { signupCode: code });
}

describe('usernames', () => {
  it('lets you choose a username, shows it on your account, and rejects bad ones', async () => {
    await start();
    const me = await registerUser(app);
    const ok = await setUsername(me.token, 'Trench.Boss_1');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ username: 'trench.boss_1', riverId: me.riverId });

    const account = await app.inject({ method: 'GET', url: '/v1/accounts/me', headers: auth(me.token) });
    expect(account.json().username).toBe('trench.boss_1');

    for (const bad of ['ab', '.nope', 'no', 'has spaces', 'x'.repeat(40)]) {
      expect((await setUsername(me.token, bad)).statusCode).toBe(400);
    }
  });

  it('keeps usernames unique, but lets you re-set your own', async () => {
    await start();
    const a = await registerUser(app);
    const b = await registerUser(app);
    expect((await setUsername(a.token, 'crew')).statusCode).toBe(200);
    expect((await setUsername(b.token, 'crew')).statusCode).toBe(409);
    expect((await setUsername(b.token, 'CREW')).statusCode).toBe(409);
    // Re-setting your own is fine.
    expect((await setUsername(a.token, 'crew')).statusCode).toBe(200);
    expect((await setUsername(b.token, 'other')).statusCode).toBe(200);
  });

  it('finds people by username and resolves ids to usernames in bulk', async () => {
    await start();
    const a = await registerUser(app);
    const b = await registerUser(app);
    await setUsername(a.token, 'alpha');
    await setUsername(b.token, 'bravo');

    const found = await app.inject({
      method: 'GET',
      url: '/v1/users/lookup?username=@Alpha',
      headers: auth(b.token),
    });
    expect(found.json()).toEqual({ username: 'alpha', riverId: a.riverId });

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/users/lookup?username=nobody',
      headers: auth(b.token),
    });
    expect(missing.statusCode).toBe(404);

    const bulk = await app.inject({
      method: 'POST',
      url: '/v1/users/usernames',
      headers: auth(a.token),
      payload: { riverIds: [a.riverId, b.riverId, '00000000-0000-4000-8000-000000000000'] },
    });
    expect(bulk.json().usernames).toEqual({ [a.riverId]: 'alpha', [b.riverId]: 'bravo' });
  });

  it('shows usernames in the operator overview', async () => {
    await start();
    const a = await registerUser(app);
    await setUsername(a.token, 'boss');
    const o = await overview();
    expect(o.accounts[0]).toMatchObject({ riverId: a.riverId, username: 'boss' });
    expect(o.signupMode).toBe('open');
    expect(o.signups).toEqual([]);
  });
});

describe('operator-created accounts and invite-only mode', () => {
  it('creates a sign-up code with a username that the next person claims', async () => {
    await start();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/signups',
      headers: host,
      payload: { username: 'Recruit' },
    });
    expect(res.statusCode).toBe(200);
    const { code, username } = res.json();
    expect(username).toBe('recruit');
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);

    // It is held until claimed: nobody else can take the name.
    expect((await overview()).signups).toEqual([expect.objectContaining({ username: 'recruit' })]);

    const claimer = await registerWithCode(code);
    const account = await app.inject({
      method: 'GET',
      url: '/v1/accounts/me',
      headers: auth(claimer.token),
    });
    expect(account.json().username).toBe('recruit');
    // The code is one-time.
    await expect(registerWithCode(code)).rejects.toThrow();
    expect((await overview()).signups).toEqual([]);
  });

  it('refuses a sign-up code for a username that is already taken', async () => {
    await start();
    const a = await registerUser(app);
    await setUsername(a.token, 'taken');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/signups',
      headers: host,
      payload: { username: 'taken' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('in invite-only mode, only people with a code can register', async () => {
    await start();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/v1/admin/settings',
          headers: host,
          payload: { signupMode: 'invite' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await overview()).signupMode).toBe('invite');

    // No code: refused.
    await expect(registerUser(app)).rejects.toThrow();

    // With a code the operator made: allowed.
    const { code } = (
      await app.inject({
        method: 'POST',
        url: '/v1/admin/signups',
        headers: host,
        payload: { username: 'invited' },
      })
    ).json();
    const user = await registerWithCode(code);
    expect(user.riverId).toBeTruthy();
  });

  it('operator endpoints need the host token and loopback', async () => {
    await start();
    for (const call of [
      { method: 'POST' as const, url: '/v1/admin/signups', payload: { username: 'x' } },
      { method: 'PUT' as const, url: '/v1/admin/settings', payload: { signupMode: 'open' } },
    ]) {
      // No token on loopback: unauthorized. Through the tunnel (proxy header): does not exist.
      expect((await app.inject({ ...call })).statusCode).toBe(401);
      expect(
        (await app.inject({ ...call, headers: { ...host, 'x-forwarded-for': '9.9.9.9' } })).statusCode,
      ).toBe(404);
    }
  });
});

// Keep an unused import honest in strict builds.
void sign;
void b64;
void deviceListMessage;
void registrationMessage;
void challengeResponseSchema;
