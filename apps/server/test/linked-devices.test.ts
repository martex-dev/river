import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, sign } from '@river/crypto';
import { challengeResponseSchema, deviceListMessage, sessionMessage, type DeviceList } from '@river/protocol';
import type { RiverDatabase } from '../src/db/database.ts';
import { auth, b64, registerUser, startServer } from './helpers.ts';

let app: FastifyInstance;
let database: RiverDatabase;

beforeEach(async () => {
  ({ app, database } = await startServer());
});

afterEach(async () => {
  await app.close();
  await database.close();
});

type User = Awaited<ReturnType<typeof registerUser>>;

function listOf(user: User, version: number, extra: DeviceList['devices'] = []): DeviceList {
  return {
    version,
    riverId: user.riverId,
    devices: [
      {
        deviceId: 1,
        authKey: b64(user.device.publicKey),
        registrationId: user.identity.registrationId,
        addedAt: new Date().toISOString(),
      },
      ...extra,
    ],
  };
}

function signed(user: User, list: DeviceList, signer = user.identity.privateKey) {
  const bytes = Buffer.from(JSON.stringify(list));
  return { deviceList: b64(bytes), deviceListSignature: b64(sign(signer, deviceListMessage(bytes))) };
}

async function signIn(riverId: string, deviceId: number, key: Uint8Array): Promise<number> {
  return (await session(riverId, deviceId, key)).statusCode;
}

async function session(riverId: string, deviceId: number, key: Uint8Array) {
  const chal = Buffer.from(
    challengeResponseSchema.parse(
      (
        await app.inject({ method: 'POST', url: '/v1/auth/challenge', payload: { purpose: 'session' } })
      ).json(),
    ).challenge,
    'base64',
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/session',
    payload: {
      riverId,
      deviceId,
      challenge: b64(chal),
      signature: b64(sign(key, sessionMessage(chal, riverId, deviceId))),
    },
  });
  return res;
}

describe('linked devices (1.3)', () => {
  it('a removed device loses its open realtime connection at once', async () => {
    const user = await registerUser(app);
    const phone = generateKeyPair();
    const entry = {
      deviceId: 2,
      authKey: b64(phone.publicKey),
      registrationId: 4242,
      addedAt: new Date().toISOString(),
    };
    const put = (version: number, extra: DeviceList['devices']) =>
      app.inject({
        method: 'PUT',
        url: '/v1/accounts/me/devices',
        headers: auth(user.token),
        payload: signed(user, listOf(user, version, extra)),
      });
    expect((await put(2, [entry])).statusCode).toBe(200);
    const phoneToken = (await session(user.riverId, 2, phone.privateKey)).json().token as string;

    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
    const events: Array<{ t: string }> = [];
    let closedWith: number | null = null;
    ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
    ws.onclose = (e) => (closedWith = e.code);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.send(JSON.stringify({ t: 'auth', token: phoneToken }));
    await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));

    expect((await put(3, [])).json().removed).toEqual([2]);
    await vi.waitFor(() => expect(closedWith).toBe(4401));
  });

  it('advertises the capability', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/version' });
    expect(res.json().capabilities).toContain('linked-devices');
  });

  it('adds a device with a newer signed list; the new device can sign in; replays and key swaps are refused', async () => {
    const user = await registerUser(app);
    const phone = generateKeyPair();
    const added = listOf(user, 2, [
      { deviceId: 2, authKey: b64(phone.publicKey), registrationId: 4242, addedAt: new Date().toISOString() },
    ]);
    expect(await signIn(user.riverId, 2, phone.privateKey)).toBe(401);
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/accounts/me/devices',
      headers: auth(user.token),
      payload: signed(user, added),
    });
    expect(put.statusCode).toBe(200);
    expect(await signIn(user.riverId, 2, phone.privateKey)).toBe(200);

    // The same (or an older) version again: refused.
    const replay = await app.inject({
      method: 'PUT',
      url: '/v1/accounts/me/devices',
      headers: auth(user.token),
      payload: signed(user, listOf(user, 2)),
    });
    expect(replay.statusCode).toBe(409);

    // A listed device cannot get a different key.
    const other = generateKeyPair();
    const swap = await app.inject({
      method: 'PUT',
      url: '/v1/accounts/me/devices',
      headers: auth(user.token),
      payload: signed(
        user,
        listOf(user, 3, [
          {
            deviceId: 2,
            authKey: b64(other.publicKey),
            registrationId: 4242,
            addedAt: new Date().toISOString(),
          },
        ]),
      ),
    });
    expect(swap.statusCode).toBe(400);

    // Not signed by the identity key: refused.
    const forged = await app.inject({
      method: 'PUT',
      url: '/v1/accounts/me/devices',
      headers: auth(user.token),
      payload: signed(user, listOf(user, 4), user.device.privateKey),
    });
    expect(forged.statusCode).toBe(400);

    // Removing the phone: it can no longer sign in.
    const removed = await app.inject({
      method: 'PUT',
      url: '/v1/accounts/me/devices',
      headers: auth(user.token),
      payload: signed(user, listOf(user, 5)),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removed).toEqual([2]);
    expect(await signIn(user.riverId, 2, phone.privateKey)).toBe(401);

    // The device making the change must stay.
    const dropSelf = await app.inject({
      method: 'PUT',
      url: '/v1/accounts/me/devices',
      headers: auth(user.token),
      payload: signed(user, {
        version: 6,
        riverId: user.riverId,
        devices: [
          {
            deviceId: 3,
            authKey: b64(phone.publicKey),
            registrationId: 7,
            addedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(dropSelf.statusCode).toBe(400);
  });

  it('the device showing the code reserves the mailbox; strangers cannot crowd out or take slots', async () => {
    const user = await registerUser(app);
    const other = await registerUser(app);
    const hello = {
      authKey: b64(generateKeyPair().publicKey),
      registrationId: 777,
      linkKey: b64(generateKeyPair().publicKey),
      deviceName: 'Test phone',
    };
    const mac = 'A'.repeat(43);
    const id = 'ReServedSlot0123456789';
    const reserve = (token: string, slot = id) =>
      app.inject({ method: 'POST', url: `/v1/link/${slot}/reserve`, headers: auth(token) });
    expect((await app.inject({ method: 'POST', url: `/v1/link/${id}/reserve` })).statusCode).toBe(401);
    expect((await reserve(user.token)).statusCode).toBe(201);
    expect((await reserve(user.token)).statusCode).toBe(200);
    expect((await reserve(other.token)).statusCode).toBe(409);
    // The hello goes into the reserved slot, once.
    expect(
      (await app.inject({ method: 'PUT', url: `/v1/link/${id}`, payload: { hello, mac } })).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: 'PUT', url: `/v1/link/${id}`, payload: { hello, mac } })).statusCode,
    ).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/v1/link/${id}` })).json()).toMatchObject({ hello });
    // An account holds a few reservations at most.
    expect((await reserve(user.token, 'ReServedSlot0123456781')).statusCode).toBe(201);
    expect((await reserve(user.token, 'ReServedSlot0123456782')).statusCode).toBe(201);
    expect((await reserve(user.token, 'ReServedSlot0123456783')).statusCode).toBe(429);
    // Unreserved codes (older apps) are capped per network address.
    for (const n of [0, 1, 2]) {
      const res = await app.inject({
        method: 'PUT',
        url: `/v1/link/OpenSlot0000000000000${n}`,
        payload: { hello, mac },
      });
      expect(res.statusCode).toBe(201);
    }
    const crowd = await app.inject({
      method: 'PUT',
      url: '/v1/link/OpenSlot00000000000009',
      payload: { hello, mac },
    });
    expect(crowd.statusCode).toBe(429);
  });

  it('carries the hello and the sealed provisioning message through the link mailbox, once each', async () => {
    const user = await registerUser(app);
    const phone = generateKeyPair();
    const linkKey = generateKeyPair();
    const id = 'AbCdEfGhIjKlMnOpQrStUv';
    const hello = {
      authKey: b64(phone.publicKey),
      registrationId: 777,
      linkKey: b64(linkKey.publicKey),
      deviceName: 'Test phone',
    };
    const mac = 'A'.repeat(43);
    expect((await app.inject({ method: 'GET', url: `/v1/link/${id}` })).statusCode).toBe(404);
    const created = await app.inject({ method: 'PUT', url: `/v1/link/${id}`, payload: { hello, mac } });
    expect(created.statusCode).toBe(201);
    const again = await app.inject({ method: 'PUT', url: `/v1/link/${id}`, payload: { hello, mac } });
    expect(again.statusCode).toBe(409);
    const state = await app.inject({ method: 'GET', url: `/v1/link/${id}` });
    expect(state.json()).toMatchObject({ hello, mac, provision: null, deviceId: null });

    // Provisioning before the device is in the signed list: refused.
    const early = await app.inject({
      method: 'PUT',
      url: `/v1/link/${id}/provision`,
      headers: auth(user.token),
      payload: { deviceId: 2, provision: b64(Buffer.from('sealed')) },
    });
    expect(early.statusCode).toBe(400);

    await app.inject({
      method: 'PUT',
      url: '/v1/accounts/me/devices',
      headers: auth(user.token),
      payload: signed(
        user,
        listOf(user, 2, [
          { deviceId: 2, authKey: hello.authKey, registrationId: 777, addedAt: new Date().toISOString() },
        ]),
      ),
    });
    const provisioned = await app.inject({
      method: 'PUT',
      url: `/v1/link/${id}/provision`,
      headers: auth(user.token),
      payload: { deviceId: 2, provision: b64(Buffer.from('sealed')) },
    });
    expect(provisioned.statusCode).toBe(200);
    const done = (await app.inject({ method: 'GET', url: `/v1/link/${id}` })).json();
    expect(done.provision).toBe(b64(Buffer.from('sealed')));
    expect(done.deviceId).toBe(2);
    const twice = await app.inject({
      method: 'PUT',
      url: `/v1/link/${id}/provision`,
      headers: auth(user.token),
      payload: { deviceId: 2, provision: b64(Buffer.from('other')) },
    });
    expect(twice.statusCode).toBe(409);
  });
});
