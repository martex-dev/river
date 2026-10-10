import { createPublicKey, verify } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beaconMessage, instanceResponseSchema } from '@river/protocol';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';

let app: FastifyInstance;
let database: RiverDatabase;
afterEach(async () => {
  await app?.close();
  await database?.close();
});

const TOKEN = 'h'.repeat(40);

async function start(env: Record<string, string> = {}, relay = vi.fn(async () => new Response('ok'))) {
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_ATTACHMENT_DIR: join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`),
      ...env,
    }),
    database,
    fetch: relay as unknown as typeof fetch,
  });
  return relay;
}

const verifies = (
  publicKey: string,
  id: string,
  note: { url: string; issuedAt: string; sig: string },
): boolean =>
  verify(
    null,
    beaconMessage(id, note.url, note.issuedAt),
    createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'base64').toString('base64url') },
      format: 'jwk',
    }),
    Buffer.from(note.sig, 'base64'),
  );

describe('server identity and address notes', () => {
  it('keeps the same identity key across restarts of the app', async () => {
    await start();
    const first = instanceResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/instance' })).json(),
    );
    expect(first.beacon).toBeNull();
    await app.close();
    app = await buildApp({
      config: loadConfig({ RIVER_LOG_LEVEL: 'silent', RIVER_ATTACHMENT_DIR: tmpdir() }),
      database,
    });
    const second = instanceResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/instance' })).json(),
    );
    expect(second).toEqual(first);
  });

  it('signs and publishes its new address only for River Host on this machine', async () => {
    const relay = await start({ RIVER_BEACON_RELAY: 'https://relay.example', RIVER_HOST_TOKEN: TOKEN });
    const info = instanceResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/instance' })).json(),
    );
    expect(info.beacon).toEqual({ relay: 'https://relay.example', topic: expect.stringMatching(/^river-/) });
    const announce = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/v1/instance/address',
        headers,
        payload: { url: 'https://new-place.trycloudflare.com' },
      });

    // Through the tunnel (a proxy header), or without the token: refused.
    expect(
      (await announce({ authorization: `Bearer ${TOKEN}`, 'cf-connecting-ip': '203.0.113.9' })).statusCode,
    ).toBe(404);
    expect((await announce({ authorization: 'Bearer wrong' })).statusCode).toBe(401);
    expect(relay).not.toHaveBeenCalled();

    const res = await announce({ authorization: `Bearer ${TOKEN}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().published).toBe(true);
    // The server now reports where River Host put it.
    expect((await app.inject({ method: 'GET', url: '/v1/instance' })).json().address).toBe(
      'https://new-place.trycloudflare.com',
    );
    const [url, init] = relay.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://relay.example/${info.beacon!.topic}`);
    const note = JSON.parse(String(init.body));
    expect(note.url).toBe('https://new-place.trycloudflare.com');
    expect(verifies(info.publicKey, info.id, note)).toBe(true);
    // A tampered address does not verify.
    expect(verifies(info.publicKey, info.id, { ...note, url: 'https://evil.example' })).toBe(false);
  });

  it('has no announcement endpoint unless River Host set a token', async () => {
    await start({ RIVER_BEACON_RELAY: 'https://relay.example' });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/instance/address', payload: { url: 'https://x.org' } }))
        .statusCode,
    ).toBe(404);
  });
});
