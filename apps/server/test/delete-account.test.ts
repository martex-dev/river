import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sign } from '@river/crypto';
import { challengeResponseSchema, deleteAccountMessage } from '@river/protocol';
import type { RiverDatabase } from '../src/db/database.ts';
import { auth, b64, registerUser, startServer } from './helpers.ts';

let app: FastifyInstance | null = null;
let database: RiverDatabase | null = null;
afterEach(async () => {
  await app?.close();
  await database?.close();
  app = null;
  database = null;
});

async function challenge(a: FastifyInstance): Promise<string> {
  return challengeResponseSchema.parse(
    (await a.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose: 'session' } })).json(),
  ).challenge;
}

describe('deleting your own account', () => {
  it('needs a fresh challenge signed by a device key, then removes everything', async () => {
    ({ app, database } = await startServer());
    const a = app;
    const u = await registerUser(a);
    const del = (payload: object, token = u.token) =>
      a.inject({ method: 'DELETE', url: '/v1/accounts/me', headers: auth(token), payload });

    // A session alone is not enough.
    expect((await del({})).statusCode).toBe(400);
    // A signature from the wrong key fails.
    const c1 = await challenge(a);
    const wrong = sign(u.identity.privateKey, deleteAccountMessage(Buffer.from(c1, 'base64'), u.riverId, 1));
    expect((await del({ challenge: c1, deviceId: 1, signature: b64(wrong) })).statusCode).toBe(401);
    // The challenge cannot be reused.
    const reused = b64(
      sign(u.device.privateKey, deleteAccountMessage(Buffer.from(c1, 'base64'), u.riverId, 1)),
    );
    expect((await del({ challenge: c1, deviceId: 1, signature: reused })).statusCode).toBe(401);
    // Without a session nothing happens.
    const c2 = await challenge(a);
    const good = b64(
      sign(u.device.privateKey, deleteAccountMessage(Buffer.from(c2, 'base64'), u.riverId, 1)),
    );
    expect((await del({ challenge: c2, deviceId: 1, signature: good }, 'not-a-token')).statusCode).toBe(401);
    // The real thing.
    expect((await del({ challenge: c2, deviceId: 1, signature: good })).statusCode).toBe(200);
    expect(await database!.db.selectFrom('accounts').selectAll().execute()).toEqual([]);
    expect(await database!.db.selectFrom('devices').selectAll().execute()).toEqual([]);
    expect(
      (await a.inject({ method: 'GET', url: '/v1/accounts/me', headers: auth(u.token) })).statusCode,
    ).toBe(401);
  });
});
