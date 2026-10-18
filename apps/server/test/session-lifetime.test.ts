import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, sign } from '@river/crypto';
import {
  challengeResponseSchema,
  deviceListMessage,
  sessionMessage,
  sessionResponseSchema,
} from '@river/protocol';
import { renewSession } from '../src/accounts/auth-store.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';
import { auth, b64, registerUser } from './helpers.ts';

let app: FastifyInstance | undefined;
let database: RiverDatabase | undefined;
let clock = new Date('2026-10-18T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_ATTACHMENT_DIR: join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`),
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '10000',
      ...env,
    }),
    database,
    now: () => clock,
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  await database?.close();
  app = undefined;
  database = undefined;
  clock = new Date('2026-10-18T12:00:00.000Z');
});

async function signIn(a: FastifyInstance, riverId: string, deviceId: number, key: Uint8Array) {
  const chal = Buffer.from(
    challengeResponseSchema.parse(
      (await a.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose: 'session' } })).json(),
    ).challenge,
    'base64',
  );
  return a.inject({
    method: 'POST',
    url: '/v1/auth/session',
    payload: {
      riverId,
      deviceId,
      challenge: b64(chal),
      signature: b64(sign(key, sessionMessage(chal, riverId, deviceId))),
    },
  });
}

const me = async (a: FastifyInstance, token: string): Promise<number> =>
  (await a.inject({ method: 'GET', url: '/v1/accounts/me', headers: auth(token) })).statusCode;

describe('session lifetime and sign-out (2.20)', () => {
  it('a session renewed while in use still ends at its absolute lifetime; signing in again works', async () => {
    const a = await start({ RIVER_SESSION_TTL_HOURS: '24', RIVER_SESSION_MAX_DAYS: '2' });
    const user = await registerUser(a);
    const { token } = sessionResponseSchema.parse(
      (await signIn(a, user.riverId, 1, user.device.privateKey)).json(),
    );
    // Kept in use (the realtime connection renews it): alive well past one lifetime of 24 hours.
    for (let i = 0; i < 3; i++) {
      clock = new Date(clock.getTime() + 13 * HOUR);
      await renewSession(database!.db, token, clock, 24 * HOUR);
      expect(await me(a, token)).toBe(200);
    }
    // 52 hours after sign-in: past the two-day limit, however recently it was renewed.
    clock = new Date(clock.getTime() + 13 * HOUR);
    await renewSession(database!.db, token, clock, 24 * HOUR);
    expect(await me(a, token)).toBe(401);
    // Renewing never pushed the expiry past the absolute end.
    const row = await database!.db
      .selectFrom('sessions')
      .select(['expires_at', 'not_after'])
      .executeTakeFirst();
    if (row) expect(row.expires_at <= row.not_after!).toBe(true);
    // The app signs in again with its device key, without asking anyone.
    const again = await signIn(a, user.riverId, 1, user.device.privateKey);
    expect(again.statusCode).toBe(200);
    expect(await me(a, sessionResponseSchema.parse(again.json()).token)).toBe(200);
  });

  it('sign-out ends the session and its realtime connection at once; unknown tokens are answered alike', async () => {
    const a = await start();
    const user = await registerUser(a);
    const other = sessionResponseSchema.parse(
      (await signIn(a, user.riverId, 1, user.device.privateKey)).json(),
    ).token;

    await a.listen({ host: '127.0.0.1', port: 0 });
    const { port } = a.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
    const events: Array<{ t: string }> = [];
    let closedWith: number | null = null;
    ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
    ws.onclose = (e) => (closedWith = e.code);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.send(JSON.stringify({ t: 'auth', token: user.token }));
    await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));

    const out = await a.inject({ method: 'DELETE', url: '/v1/sessions/current', headers: auth(user.token) });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ ok: true });
    expect(await me(a, user.token)).toBe(401);
    await vi.waitFor(() => expect(closedWith).toBe(4401));
    // The device's other session is untouched.
    expect(await me(a, other)).toBe(200);
    // Signing out again, with a made-up token or with none: the same answer.
    for (const headers of [auth(user.token), auth('A'.repeat(43)), auth('nope'), {}]) {
      const res = await a.inject({ method: 'DELETE', url: '/v1/sessions/current', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    }
  });

  it('removing a device from the signed device list ends its sessions', async () => {
    const a = await start();
    const user = await registerUser(a);
    const phone = generateKeyPair();
    const list = (version: number, withPhone: boolean) => {
      const bytes = Buffer.from(
        JSON.stringify({
          version,
          riverId: user.riverId,
          devices: [
            {
              deviceId: 1,
              authKey: b64(user.device.publicKey),
              registrationId: user.identity.registrationId,
              addedAt: clock.toISOString(),
            },
            ...(withPhone
              ? [
                  {
                    deviceId: 2,
                    authKey: b64(phone.publicKey),
                    registrationId: 4242,
                    addedAt: clock.toISOString(),
                  },
                ]
              : []),
          ],
        }),
      );
      return {
        deviceList: b64(bytes),
        deviceListSignature: b64(sign(user.identity.privateKey, deviceListMessage(bytes))),
      };
    };
    const put = (version: number, withPhone: boolean) =>
      a.inject({
        method: 'PUT',
        url: '/v1/accounts/me/devices',
        headers: auth(user.token),
        payload: list(version, withPhone),
      });
    expect((await put(2, true)).statusCode).toBe(200);
    const phoneToken = sessionResponseSchema.parse(
      (await signIn(a, user.riverId, 2, phone.privateKey)).json(),
    ).token;
    expect(await me(a, phoneToken)).toBe(200);
    expect((await put(3, false)).json().removed).toEqual([2]);
    expect(await me(a, phoneToken)).toBe(401);
    expect(await me(a, user.token)).toBe(200);
  });
});
