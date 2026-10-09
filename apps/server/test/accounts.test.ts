import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIdentity,
  generateKeyPair,
  sign,
  verify,
  type IdentityKeys,
  type KeyPair,
} from '@river/crypto';
import {
  accountResponseSchema,
  challengeResponseSchema,
  deviceListMessage,
  parseDeviceList,
  registerResponseSchema,
  registrationMessage,
  sessionMessage,
  sessionResponseSchema,
  type DeviceList,
} from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';

const testBlobDir = (): string => join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`);

let app: FastifyInstance | undefined;
let database: RiverDatabase | undefined;
let clock = new Date('2026-10-08T12:00:00.000Z');

async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_ATTACHMENT_DIR: testBlobDir(),
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
  clock = new Date('2026-10-08T12:00:00.000Z');
});

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');

async function challenge(a: FastifyInstance, purpose: 'register' | 'session'): Promise<Buffer> {
  const res = await a.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose } });
  expect(res.statusCode).toBe(200);
  return Buffer.from(challengeResponseSchema.parse(res.json()).challenge, 'base64');
}

interface Client {
  identity: IdentityKeys;
  device: KeyPair;
  list: DeviceList;
  listBytes: Buffer;
}

function newClient(overrides: Partial<DeviceList> = {}): Client {
  const identity = createIdentity();
  const device = generateKeyPair();
  const list: DeviceList = {
    version: 1,
    riverId: identity.riverId,
    devices: [
      {
        deviceId: 1,
        authKey: b64(device.publicKey),
        registrationId: identity.registrationId,
        addedAt: clock.toISOString(),
      },
    ],
    ...overrides,
  };
  return { identity, device, list, listBytes: Buffer.from(JSON.stringify(list)) };
}

function registration(c: Client, chal: Buffer, tamper: Partial<Record<string, string | number>> = {}) {
  const message = registrationMessage(chal, c.listBytes);
  return {
    identityKey: b64(c.identity.publicKey),
    deviceId: 1,
    deviceList: b64(c.listBytes),
    deviceListSignature: b64(sign(c.identity.privateKey, deviceListMessage(c.listBytes))),
    challenge: b64(chal),
    identitySignature: b64(sign(c.identity.privateKey, message)),
    deviceSignature: b64(sign(c.device.privateKey, message)),
    ...tamper,
  };
}

async function register(a: FastifyInstance, c: Client) {
  const res = await a.inject({
    method: 'POST',
    url: '/v1/accounts',
    payload: registration(c, await challenge(a, 'register')),
  });
  return res;
}

describe('account registration', () => {
  it('registers with proof of both keys and returns a working session', async () => {
    const a = await start();
    const c = newClient();
    const res = await register(a, c);
    expect(res.statusCode).toBe(201);
    const body = registerResponseSchema.parse(res.json());
    expect(body.riverId).toBe(c.identity.riverId);

    const me = await a.inject({
      method: 'GET',
      url: '/v1/accounts/me',
      headers: { authorization: `Bearer ${body.session.token}` },
    });
    expect(me.statusCode).toBe(200);
    const account = accountResponseSchema.parse(me.json());
    // Anyone holding the identity key can verify the stored device list.
    const bytes = Buffer.from(account.deviceList, 'base64');
    expect(
      verify(
        Buffer.from(account.identityKey, 'base64'),
        deviceListMessage(bytes),
        Buffer.from(account.deviceListSignature, 'base64'),
      ),
    ).toBe(true);
    expect(parseDeviceList(bytes).devices[0]!.deviceId).toBe(1);
  });

  it('stores no token, IP or precise timestamps', async () => {
    const a = await start();
    const res = await register(a, newClient());
    const token = registerResponseSchema.parse(res.json()).session.token;
    const sessions = await database!.db.selectFrom('sessions').selectAll().execute();
    expect(JSON.stringify(sessions)).not.toContain(token);
    const accounts = await database!.db.selectFrom('accounts').select('created_on').execute();
    expect(accounts[0]!.created_on).toBe('2026-10-08');
  });

  it('rejects replayed, foreign-purpose and expired challenges', async () => {
    const a = await start();
    const c = newClient();
    const chal = await challenge(a, 'register');
    const body = registration(c, chal);
    expect((await a.inject({ method: 'POST', url: '/v1/accounts', payload: body })).statusCode).toBe(201);
    // Replay of the same request (same challenge).
    const replay = await a.inject({ method: 'POST', url: '/v1/accounts', payload: body });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('invalid_challenge');
    // A session challenge cannot be used to register.
    const other = newClient();
    const wrongPurpose = await a.inject({
      method: 'POST',
      url: '/v1/accounts',
      payload: registration(other, await challenge(a, 'session')),
    });
    expect(wrongPurpose.statusCode).toBe(401);
    // Expired.
    const late = await challenge(a, 'register');
    clock = new Date(clock.getTime() + 6 * 60 * 1000);
    const expired = await a.inject({
      method: 'POST',
      url: '/v1/accounts',
      payload: registration(other, late),
    });
    expect(expired.statusCode).toBe(401);
  });

  it('rejects bad signatures from either key', async () => {
    const a = await start();
    const c = newClient();
    const stranger = generateKeyPair();
    for (const tamper of [
      { identitySignature: b64(sign(stranger.privateKey, Buffer.from('x'))) },
      { deviceSignature: b64(sign(stranger.privateKey, Buffer.from('x'))) },
      { deviceListSignature: b64(sign(stranger.privateKey, deviceListMessage(c.listBytes))) },
    ]) {
      const res = await a.inject({
        method: 'POST',
        url: '/v1/accounts',
        payload: registration(c, await challenge(a, 'register'), tamper),
      });
      expect(res.statusCode, JSON.stringify(Object.keys(tamper))).toBe(400);
      expect(res.json().error.code).toBe('bad_signature');
    }
  });

  it('a device list signed for one challenge cannot register another identity key', async () => {
    const a = await start();
    const victim = newClient();
    const attacker = newClient({ riverId: victim.identity.riverId });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/accounts',
      payload: registration(attacker, await challenge(a, 'register'), {
        identityKey: b64(victim.identity.publicKey),
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses duplicate River IDs and malformed device lists', async () => {
    const a = await start();
    const c = newClient();
    expect((await register(a, c)).statusCode).toBe(201);
    expect((await register(a, c)).statusCode).toBe(409);
    const two = newClient();
    two.list.devices.push({ ...two.list.devices[0]!, deviceId: 2 });
    two.listBytes = Buffer.from(JSON.stringify(two.list));
    expect((await register(a, two)).statusCode).toBe(400);
    const v2 = newClient({ version: 2 });
    expect((await register(a, v2)).statusCode).toBe(400);
  });

  it('honours closed registration', async () => {
    const a = await start({ RIVER_REGISTRATION: 'closed' });
    const res = await a.inject({
      method: 'POST',
      url: '/v1/auth/challenge',
      payload: { purpose: 'register' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('registration_closed');
  });

  it('validates input strictly', async () => {
    const a = await start();
    for (const payload of [{}, { purpose: 'other' }, { purpose: 'register', extra: 1 }]) {
      expect((await a.inject({ method: 'POST', url: '/v1/auth/challenge', payload })).statusCode).toBe(400);
    }
    const res = await a.inject({ method: 'POST', url: '/v1/accounts', payload: { identityKey: 'AAAA' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('device sessions', () => {
  async function login(a: FastifyInstance, c: Client, signer = c.device.privateKey) {
    const chal = await challenge(a, 'session');
    return a.inject({
      method: 'POST',
      url: '/v1/auth/session',
      payload: {
        riverId: c.identity.riverId,
        deviceId: 1,
        challenge: b64(chal),
        signature: b64(sign(signer, sessionMessage(chal, c.identity.riverId, 1))),
      },
    });
  }

  it('logs in with the device key and expires sessions', async () => {
    const a = await start({ RIVER_SESSION_TTL_HOURS: '1' });
    const c = newClient();
    await register(a, c);
    const res = await login(a, c);
    expect(res.statusCode).toBe(200);
    const { token } = sessionResponseSchema.parse(res.json());
    const me = () =>
      a.inject({ method: 'GET', url: '/v1/accounts/me', headers: { authorization: `Bearer ${token}` } });
    expect((await me()).statusCode).toBe(200);
    clock = new Date(clock.getTime() + 61 * 60 * 1000);
    expect((await me()).statusCode).toBe(401);
  });

  it('refuses the identity key, other keys and unknown accounts alike', async () => {
    const a = await start();
    const c = newClient();
    await register(a, c);
    const wrongKey = await login(a, c, c.identity.privateKey);
    const unknown = await login(a, newClient());
    expect(wrongKey.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrongKey.json()).toEqual(unknown.json());
  });

  it('rejects missing and malformed tokens', async () => {
    const a = await start();
    for (const authorization of [undefined, 'Bearer', 'Bearer abc', `Bearer ${'A'.repeat(43)}`, 'Basic x']) {
      const res = await a.inject({
        method: 'GET',
        url: '/v1/accounts/me',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode).toBe(401);
    }
  });
});
