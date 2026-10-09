import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { RiverProtocol, type ProtocolStorage, type StoreKind } from '@river/crypto';
import { keyBundleResponseSchema, mailboxResponseSchema } from '@river/protocol';
import type { RiverDatabase } from '../src/db/database.ts';
import { auth, registerUser, startServer } from './helpers.ts';

let app: FastifyInstance;
let database: RiverDatabase;

afterEach(async () => {
  await app?.close();
  await database?.close();
});

function memory(): ProtocolStorage {
  const map = new Map<string, Uint8Array>();
  return {
    get: (k: StoreKind, id) => map.get(`${k}:${id}`) ?? null,
    put: (k, id, v) => void map.set(`${k}:${id}`, new Uint8Array(v)),
    delete: (k, id) => void map.delete(`${k}:${id}`),
    count: (k) => [...map.keys()].filter((x) => x.startsWith(`${k}:`)).length,
  };
}

async function client(a: FastifyInstance) {
  const user = await registerUser(a);
  const protocol = new RiverProtocol({ ...user.identity, deviceId: 1 }, memory());
  return { ...user, protocol };
}

async function upload(a: FastifyInstance, c: Awaited<ReturnType<typeof client>>, oneTime = 3) {
  return a.inject({
    method: 'PUT',
    url: '/v1/keys',
    headers: auth(c.token),
    payload: c.protocol.generatePreKeys({ oneTime, rotate: true }),
  });
}

async function bundle(a: FastifyInstance, token: string, riverId: string) {
  return a.inject({ method: 'GET', url: `/v1/keys/${riverId}`, headers: auth(token) });
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('direct messages', () => {
  it('accepts only prekeys signed by the account identity key', async () => {
    ({ app, database } = await startServer());
    const alice = await client(app);
    const bob = await client(app);
    // Bob tries to upload keys signed with someone else's identity.
    const forged = alice.protocol.generatePreKeys({ oneTime: 1, rotate: true });
    expect(
      (await app.inject({ method: 'PUT', url: '/v1/keys', headers: auth(bob.token), payload: forged }))
        .statusCode,
    ).toBe(400);
    expect((await upload(app, bob, 3)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/keys', headers: auth(bob.token) })).json()).toEqual({
      preKeys: 3,
      kyberPreKeys: 3,
    });
  });

  it('hands out each one-time prekey once, then falls back to the last-resort keys', async () => {
    ({ app, database } = await startServer());
    const alice = await client(app);
    const bob = await client(app);
    await upload(app, bob, 2);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const res = keyBundleResponseSchema.parse((await bundle(app, alice.token, bob.riverId)).json());
      expect(res.devices).toHaveLength(1);
      ids.push(res.devices[0]!.preKey?.id ?? null);
    }
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[2]).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/v1/keys', headers: auth(bob.token) })).json()).toEqual({
      preKeys: 0,
      kyberPreKeys: 0,
    });
  });

  it('delivers end-to-end encrypted messages through the mailbox until acknowledged', async () => {
    ({ app, database } = await startServer());
    const alice = await client(app);
    const bob = await client(app);
    await upload(app, bob);
    const res = keyBundleResponseSchema.parse((await bundle(app, alice.token, bob.riverId)).json());
    await alice.protocol.startSession(bob.riverId, Buffer.from(res.identityKey, 'base64'), res.devices[0]!);
    const env = await alice.protocol.encrypt(bob.riverId, 1, text('meet at 8?'));
    const sent = await app.inject({
      method: 'POST',
      url: `/v1/messages/${bob.riverId}`,
      headers: auth(alice.token),
      payload: { messages: [{ deviceId: 1, registrationId: bob.identity.registrationId, ...env }] },
    });
    expect(sent.statusCode).toBe(202);

    // The server stored ciphertext only.
    const stored = JSON.stringify(await database.db.selectFrom('mailbox').selectAll().execute());
    expect(stored).not.toContain('meet at 8');

    const box = mailboxResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/messages', headers: auth(bob.token) })).json(),
    );
    expect(box.envelopes).toHaveLength(1);
    const e = box.envelopes[0]!;
    expect(e.sender).toBe(alice.riverId);
    const plain = await bob.protocol.decrypt(e.sender, e.senderDevice, e);
    expect(new TextDecoder().decode(plain)).toBe('meet at 8?');
    // Alice cannot acknowledge (delete) Bob's mail; Bob can.
    await app.inject({
      method: 'POST',
      url: '/v1/messages/ack',
      headers: auth(alice.token),
      payload: { ids: [e.id] },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/messages', headers: auth(bob.token) })).json().envelopes,
    ).toHaveLength(1);
    await app.inject({
      method: 'POST',
      url: '/v1/messages/ack',
      headers: auth(bob.token),
      payload: { ids: [e.id] },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/messages', headers: auth(bob.token) })).json().envelopes,
    ).toEqual([]);
  });

  it('refuses envelopes that do not match the recipient’s devices', async () => {
    ({ app, database } = await startServer());
    const alice = await client(app);
    const bob = await client(app);
    const body = Buffer.from('x'.repeat(40)).toString('base64');
    const send = (messages: unknown[]) =>
      app.inject({
        method: 'POST',
        url: `/v1/messages/${bob.riverId}`,
        headers: auth(alice.token),
        payload: { messages },
      });
    const stale = await send([
      { deviceId: 1, registrationId: (bob.identity.registrationId + 1) % 0x3fff || 1, type: 2, body },
    ]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ stale: [1] });
    const extra = await send([
      { deviceId: 1, registrationId: bob.identity.registrationId, type: 2, body },
      { deviceId: 2, registrationId: 5, type: 2, body },
    ]);
    expect(extra.json()).toMatchObject({ extra: [2] });
  });

  it('blocks: the blocked person sees "not found" and their messages are silently dropped', async () => {
    ({ app, database } = await startServer());
    const alice = await client(app);
    const bob = await client(app);
    await upload(app, bob);
    await app.inject({ method: 'PUT', url: `/v1/blocks/${alice.riverId}`, headers: auth(bob.token) });
    expect((await app.inject({ method: 'GET', url: '/v1/blocks', headers: auth(bob.token) })).json()).toEqual(
      {
        blocked: [alice.riverId],
      },
    );
    expect((await bundle(app, alice.token, bob.riverId)).statusCode).toBe(404);
    const body = Buffer.from('x'.repeat(40)).toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/messages/${bob.riverId}`,
      headers: auth(alice.token),
      payload: { messages: [{ deviceId: 1, registrationId: bob.identity.registrationId, type: 2, body }] },
    });
    expect(res.statusCode).toBe(202);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/messages', headers: auth(bob.token) })).json().envelopes,
    ).toEqual([]);
    await app.inject({ method: 'DELETE', url: `/v1/blocks/${alice.riverId}`, headers: auth(bob.token) });
    expect((await bundle(app, alice.token, bob.riverId)).statusCode).toBe(200);
  });

  it('does not store ephemeral envelopes and requires a session everywhere', async () => {
    ({ app, database } = await startServer());
    const alice = await client(app);
    const bob = await client(app);
    const body = Buffer.from('typing'.repeat(10)).toString('base64');
    await app.inject({
      method: 'POST',
      url: `/v1/messages/${bob.riverId}`,
      headers: auth(alice.token),
      payload: {
        ephemeral: true,
        messages: [{ deviceId: 1, registrationId: bob.identity.registrationId, type: 2, body }],
      },
    });
    expect(
      (await app.inject({ method: 'GET', url: '/v1/messages', headers: auth(bob.token) })).json().envelopes,
    ).toEqual([]);
    for (const [method, url] of [
      ['GET', '/v1/keys'],
      ['PUT', '/v1/keys'],
      ['GET', `/v1/keys/${bob.riverId}`],
      ['POST', `/v1/messages/${bob.riverId}`],
      ['GET', '/v1/messages'],
      ['GET', '/v1/blocks'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });
});
