import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RiverProtocol, generateKeyPair, sign, type ProtocolStorage, type StoreKind } from '@river/crypto';
import { DEFAULT_EVERYONE, Permission, deviceListMessage, keyBundleResponseSchema } from '@river/protocol';
import { buildApp, type AppDeps } from '../src/app.ts';
import { Hub, type HubSocket } from '../src/communities/hub.ts';
import { loadConfig } from '../src/config.ts';
import { migrateToLatest, openDatabase, type RiverDatabase } from '../src/db/database.ts';
import { auth, b64, registerUser } from './helpers.ts';

/** Regression tests for the server audit (authorization, delivery, realtime lifecycle, races). */

let app: FastifyInstance;
let database: RiverDatabase;

afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function start(
  env: Record<string, string> = {},
  deps: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  database = openDatabase('sqlite::memory:');
  await migrateToLatest(database.db);
  app = await buildApp({
    config: loadConfig({
      RIVER_LOG_LEVEL: 'silent',
      RIVER_RATE_LIMIT_PER_MINUTE: '100000',
      RIVER_ATTACHMENT_DIR: join(tmpdir(), `river-blobs-${Math.random().toString(36).slice(2)}`),
      ...env,
    }),
    database,
    ...deps,
  });
  return app;
}

const id = (): string => randomBytes(16).toString('base64url');
const sealed = (): string => randomBytes(40).toString('base64');
const body = Buffer.from('x'.repeat(40)).toString('base64');

function memory(): ProtocolStorage {
  const map = new Map<string, Uint8Array>();
  return {
    get: (k: StoreKind, key) => map.get(`${k}:${key}`) ?? null,
    put: (k, key, v) => void map.set(`${k}:${key}`, new Uint8Array(v)),
    delete: (k, key) => void map.delete(`${k}:${key}`),
    count: (k) => [...map.keys()].filter((x) => x.startsWith(`${k}:`)).length,
  };
}

type User = Awaited<ReturnType<typeof registerUser>>;

async function status(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: object,
): Promise<number> {
  return (await app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) }))
    .statusCode;
}

/** Gives `user` a second device (deviceId 2) that has not uploaded any keys. */
async function addDevice(user: User): Promise<number> {
  const phone = generateKeyPair();
  const bytes = Buffer.from(
    JSON.stringify({
      version: 2,
      riverId: user.riverId,
      devices: [
        {
          deviceId: 1,
          authKey: b64(user.device.publicKey),
          registrationId: user.identity.registrationId,
          addedAt: new Date().toISOString(),
        },
        {
          deviceId: 2,
          authKey: b64(phone.publicKey),
          registrationId: 4242,
          addedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/accounts/me/devices',
    headers: auth(user.token),
    payload: {
      deviceList: b64(bytes),
      deviceListSignature: b64(sign(user.identity.privateKey, deviceListMessage(bytes))),
    },
  });
  expect(res.statusCode).toBe(200);
  return 4242;
}

const send = (from: User, to: User, messages: unknown[]) =>
  app.inject({
    method: 'POST',
    url: `/v1/messages/${to.riverId}`,
    headers: auth(from.token),
    payload: { messages },
  });

describe('direct message delivery', () => {
  it('a linked device that never uploaded keys does not make the account unreachable', async () => {
    await start();
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const protocol = new RiverProtocol({ ...bob.identity, deviceId: 1 }, memory());
    await app.inject({
      method: 'PUT',
      url: '/v1/keys',
      headers: auth(bob.token),
      payload: protocol.generatePreKeys({ oneTime: 2, rotate: true }),
    });
    const phoneRegistration = await addDevice(bob);
    // GET /keys only offers device 1, so that is all a sender can write to…
    const keys = keyBundleResponseSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/v1/keys/${bob.riverId}`, headers: auth(alice.token) })
      ).json(),
    );
    expect(keys.devices.map((d) => d.deviceId)).toEqual([1]);
    // …and that is enough.
    const one = { deviceId: 1, registrationId: bob.identity.registrationId, type: 2, body };
    expect((await send(alice, bob, [one])).statusCode).toBe(202);
    // A copy for the keyless device is still accepted; a device that does not exist is not.
    expect(
      (await send(alice, bob, [one, { deviceId: 2, registrationId: phoneRegistration, type: 2, body }]))
        .statusCode,
    ).toBe(202);
    const extra = await send(alice, bob, [one, { deviceId: 3, registrationId: 1, type: 2, body }]);
    expect(extra.json()).toMatchObject({ extra: [3] });
  });

  it('a full mailbox on one device drops only that copy', async () => {
    await start({ RIVER_MAILBOX_LIMIT: '100' });
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const phoneRegistration = await addDevice(bob);
    await database.db
      .insertInto('mailbox')
      .values(
        Array.from({ length: 100 }, (_, i) => ({
          id: `fill${i}`,
          recipient: bob.riverId,
          recipient_device: 2,
          sender: alice.riverId,
          sender_device: 1,
          type: 2,
          body,
          received_at: new Date().toISOString(),
        })),
      )
      .execute();
    const both = [
      { deviceId: 1, registrationId: bob.identity.registrationId, type: 2, body },
      { deviceId: 2, registrationId: phoneRegistration, type: 2, body },
    ];
    expect((await send(alice, bob, both)).statusCode).toBe(202);
    const count = async (device: number) =>
      (
        await database.db
          .selectFrom('mailbox')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('recipient', '=', bob.riverId)
          .where('recipient_device', '=', device)
          .executeTakeFirstOrThrow()
      ).n;
    expect(Number(await count(1))).toBe(1);
    expect(Number(await count(2))).toBe(100);
    // Only when every copy would be dropped is the sender told to try later.
    const full = await send(alice, bob, [both[1]]);
    expect(full.statusCode).toBe(429);
  });

  it('parallel bundle fetches never hand out the same one-time prekey', async () => {
    await start();
    const bob = await registerUser(app);
    const protocol = new RiverProtocol({ ...bob.identity, deviceId: 1 }, memory());
    await app.inject({
      method: 'PUT',
      url: '/v1/keys',
      headers: auth(bob.token),
      payload: protocol.generatePreKeys({ oneTime: 10, rotate: true }),
    });
    const askers = await Promise.all(Array.from({ length: 8 }, () => registerUser(app)));
    const bundles = await Promise.all(
      askers.map(async (a) =>
        keyBundleResponseSchema.parse(
          (
            await app.inject({ method: 'GET', url: `/v1/keys/${bob.riverId}`, headers: auth(a.token) })
          ).json(),
        ),
      ),
    );
    const pre = bundles.map((b) => b.devices[0]!.preKey!.id);
    const kyber = bundles.map((b) => b.devices[0]!.kyberPreKey.id);
    expect(new Set(pre).size).toBe(8);
    expect(new Set(kyber).size).toBe(8);
    expect((await app.inject({ method: 'GET', url: '/v1/keys', headers: auth(bob.token) })).json()).toEqual({
      preKeys: 2,
      kyberPreKeys: 2,
    });
  });

  it('caps Kyber one-time prekeys too, and never loses a last-resort key to an ID clash', async () => {
    await start();
    const bob = await registerUser(app);
    const protocol = new RiverProtocol({ ...bob.identity, deviceId: 1 }, memory());
    const kyberOnly = () => ({ ...protocol.generatePreKeys({ oneTime: 100, rotate: true }), preKeys: [] });
    const put = (payload: object) =>
      app.inject({ method: 'PUT', url: '/v1/keys', headers: auth(bob.token), payload });
    expect((await put(kyberOnly())).statusCode).toBe(200);
    expect((await put(kyberOnly())).statusCode).toBe(200);
    expect((await put(kyberOnly())).statusCode).toBe(400);

    const stored = await database.db
      .selectFrom('kyber_prekeys')
      .select('key_id')
      .where('river_id', '=', bob.riverId)
      .where('last_resort', '=', 0)
      .orderBy('key_id')
      .executeTakeFirstOrThrow();
    const next = protocol.generatePreKeys({ oneTime: 0, rotate: true });
    const clash = { ...next, kyberLastResort: { ...next.kyberLastResort, id: stored.key_id } };
    expect((await put(clash)).statusCode).toBe(200);
    const row = await database.db
      .selectFrom('kyber_prekeys')
      .selectAll()
      .where('river_id', '=', bob.riverId)
      .where('key_id', '=', stored.key_id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ last_resort: 1, public_key: next.kyberLastResort.publicKey });
  });
});

describe('races', () => {
  it('concurrent device-list updates never store an older list over a newer one', async () => {
    await start();
    const user = await registerUser(app);
    const put = (version: number) => {
      const bytes = Buffer.from(
        JSON.stringify({
          version,
          riverId: user.riverId,
          devices: [
            {
              deviceId: 1,
              authKey: b64(user.device.publicKey),
              registrationId: user.identity.registrationId,
              addedAt: new Date().toISOString(),
            },
          ],
        }),
      );
      return app.inject({
        method: 'PUT',
        url: '/v1/accounts/me/devices',
        headers: auth(user.token),
        payload: {
          deviceList: b64(bytes),
          deviceListSignature: b64(sign(user.identity.privateKey, deviceListMessage(bytes))),
        },
      });
    };
    const [newer, older] = await Promise.all([put(3), put(2)]);
    expect(newer.statusCode).toBe(200);
    expect([200, 409]).toContain(older.statusCode);
    const row = await database.db
      .selectFrom('accounts')
      .select('device_list_version')
      .where('river_id', '=', user.riverId)
      .executeTakeFirstOrThrow();
    expect(row.device_list_version).toBe(3);
  });

  it('parallel uploads cannot together exceed the storage quota', async () => {
    await start({ RIVER_ATTACHMENT_QUOTA_MB: '10', RIVER_MAX_ATTACHMENT_MB: '25' });
    const alice = await registerUser(app);
    const upload = () =>
      app.inject({
        method: 'POST',
        url: '/v1/attachments',
        headers: { ...auth(alice.token), 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(16 + 6 * 1024 * 1024 + 32),
      });
    const codes = (await Promise.all([upload(), upload(), upload()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 413, 413]);
    const index = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type = 'index'`.execute(
      database.db,
    );
    expect(index.rows.map((r) => r.name)).toContain('attachments_by_uploader');
  });
});

/** A community with a text and a voice channel; returns ids and helpers. */
async function community(owner: User) {
  const cid = id();
  const text = id();
  const voice = id();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/communities',
    headers: auth(owner.token),
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
  const join = async (): Promise<User> => {
    const m = await registerUser(app);
    const code = (
      await app.inject({ method: 'POST', url: `/v1/communities/${cid}/invites`, headers: auth(owner.token) })
    ).json().code;
    expect(await status('POST', '/v1/invites/join', m.token, { code, profile: sealed() })).toBe(200);
    return m;
  };
  const role = async (permissions: number, member?: User): Promise<string> => {
    const rid = id();
    expect(
      await status('POST', `/v1/communities/${cid}/roles`, owner.token, {
        id: rid,
        name: sealed(),
        color: 0,
        permissions,
      }),
    ).toBe(201);
    if (member)
      expect(
        await status('PUT', `/v1/communities/${cid}/members/${member.riverId}/roles`, owner.token, {
          roles: [rid],
        }),
      ).toBe(200);
    return rid;
  };
  return { cid, text, voice, join, role };
}

describe('community authorization', () => {
  it('channel and category overwrites cannot grant what the editor lacks, nor Administrator', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const manager = await c.join();
    await c.role(Permission.MANAGE_CHANNELS, manager);
    const everyone = c.cid;
    const grant = (allow: number) => [{ roleId: everyone, allow, deny: 0 }];
    // Banning is not something the manager can do, so they cannot hand it out in a channel.
    expect(
      await status('PATCH', `/v1/channels/${c.text}`, manager.token, {
        overwrites: grant(Permission.BAN_MEMBERS),
      }),
    ).toBe(403);
    expect(
      await status('POST', `/v1/communities/${c.cid}/channels`, manager.token, {
        id: id(),
        kind: 'text',
        name: sealed(),
        overwrites: grant(Permission.MANAGE_ROLES),
      }),
    ).toBe(403);
    const cat = id();
    expect(
      await status('POST', `/v1/communities/${c.cid}/categories`, manager.token, { id: cat, name: sealed() }),
    ).toBe(201);
    expect(
      await status('PATCH', `/v1/categories/${cat}`, manager.token, {
        overwrites: grant(Permission.KICK_MEMBERS),
      }),
    ).toBe(403);
    // What they hold themselves is fine.
    expect(
      await status('PATCH', `/v1/channels/${c.text}`, manager.token, {
        overwrites: grant(Permission.SEND_MESSAGES),
      }),
    ).toBe(200);
    // Administrator never goes into an overwrite, not even from the owner.
    expect(
      await status('PATCH', `/v1/channels/${c.text}`, owner.token, {
        overwrites: grant(Permission.ADMINISTRATOR),
      }),
    ).toBe(400);
    expect(
      await status('PATCH', `/v1/categories/${cat}`, owner.token, {
        overwrites: grant(Permission.ADMINISTRATOR),
      }),
    ).toBe(400);
    // An overwrite the owner set may be resent unchanged by the manager (editing other things).
    const owned = grant(Permission.MENTION_EVERYONE);
    expect(await status('PATCH', `/v1/channels/${c.text}`, owner.token, { overwrites: owned })).toBe(200);
    expect(await status('PATCH', `/v1/channels/${c.text}`, manager.token, { overwrites: owned })).toBe(200);
  });

  it('a legacy overwrite that already allows Administrator stays editable; adding it is still refused', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const mods = await c.role(0);
    const cat = id();
    expect(
      await status('POST', `/v1/communities/${c.cid}/categories`, owner.token, { id: cat, name: sealed() }),
    ).toBe(201);
    // Written before overwrites were checked: Administrator is already in there.
    await database.db
      .insertInto('channel_overwrites')
      .values({ channel_id: c.text, role_id: c.cid, allow: Permission.ADMINISTRATOR, deny: 0 })
      .execute();
    await database.db
      .insertInto('category_overwrites')
      .values({ category_id: cat, role_id: c.cid, allow: Permission.ADMINISTRATOR, deny: 0 })
      .execute();
    const legacy = { roleId: c.cid, allow: Permission.ADMINISTRATOR | Permission.SEND_MESSAGES, deny: 0 };
    // The editor resends the existing allow bits with the change: accepted.
    expect(await status('PATCH', `/v1/channels/${c.text}`, owner.token, { overwrites: [legacy] })).toBe(200);
    expect(await status('PATCH', `/v1/categories/${cat}`, owner.token, { overwrites: [legacy] })).toBe(200);
    // Newly granting Administrator to another role is still refused.
    const added = [legacy, { roleId: mods, allow: Permission.ADMINISTRATOR, deny: 0 }];
    expect(await status('PATCH', `/v1/channels/${c.text}`, owner.token, { overwrites: added })).toBe(400);
    expect(await status('PATCH', `/v1/categories/${cat}`, owner.token, { overwrites: added })).toBe(400);
  });

  it('a self-assignable role cannot later gain moderation permissions', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const gamer = await c.role(0);
    expect(
      await status('PUT', `/v1/communities/${c.cid}/onboarding`, owner.token, {
        onboarding: null,
        screening: false,
        selfRoles: [gamer],
      }),
    ).toBe(200);
    expect(
      await status('PATCH', `/v1/roles/${gamer}`, owner.token, { permissions: Permission.KICK_MEMBERS }),
    ).toBe(400);
    expect(
      await status('PATCH', `/v1/roles/${gamer}`, owner.token, { permissions: Permission.ADD_REACTIONS }),
    ).toBe(200);
    // A role changed behind the server's back (older versions) is refused at self-assignment.
    await database.db
      .updateTable('roles')
      .set({ permissions: Permission.BAN_MEMBERS })
      .where('id', '=', gamer)
      .execute();
    const member = await c.join();
    expect(await status('PUT', `/v1/communities/${c.cid}/self-roles`, member.token, { roles: [gamer] })).toBe(
      403,
    );
  });

  it('webhooks stop posting when their creator loses the right to manage the channel', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const manager = await c.join();
    await c.role(Permission.MANAGE_CHANNELS, manager);
    const token = randomBytes(32).toString('base64url');
    const hook = id();
    expect(
      await status('POST', `/v1/communities/${c.cid}/webhooks`, manager.token, {
        id: hook,
        channelId: c.text,
        sealed: sealed(),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      }),
    ).toBe(201);
    const post = () =>
      app.inject({
        method: 'POST',
        url: `/v1/webhooks/${hook}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { id: id(), body: sealed() },
      });
    expect((await post()).statusCode).toBe(201);
    expect(await status('DELETE', `/v1/communities/${c.cid}/members/${manager.riverId}`, owner.token)).toBe(
      200,
    );
    const after = await post();
    expect(after.statusCode).toBe(403);
    expect(after.json().error.code).toBe('webhook_disabled');
  });

  it("wrong tokens do not use up a webhook's budget; deleted channels take their webhooks along", async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const token = randomBytes(32).toString('base64url');
    const hook = id();
    const channel = id();
    expect(
      await status('POST', `/v1/communities/${c.cid}/channels`, owner.token, {
        id: channel,
        kind: 'text',
        name: sealed(),
      }),
    ).toBe(201);
    expect(
      await status('POST', `/v1/communities/${c.cid}/webhooks`, owner.token, {
        id: hook,
        channelId: channel,
        sealed: sealed(),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      }),
    ).toBe(201);
    const post = (t: string, i: number) =>
      app.inject({
        method: 'POST',
        url: `/v1/webhooks/${hook}`,
        remoteAddress: `10.1.0.${i}`,
        headers: { authorization: `Bearer ${t}` },
        payload: { id: id(), body: sealed() },
      });
    for (let i = 0; i < 40; i++) expect((await post('w'.repeat(43), i + 1)).statusCode).toBe(401);
    const good = [];
    for (let i = 0; i < 30; i++) good.push((await post(token, 100 + i)).statusCode);
    expect(good.every((s) => s === 201)).toBe(true);
    expect((await post(token, 200)).statusCode).toBe(429);

    expect(await status('DELETE', `/v1/channels/${channel}`, owner.token)).toBe(200);
    expect(await database.db.selectFrom('webhooks').selectAll().execute()).toEqual([]);
  });

  it('timed-out and pending members cannot join an existing reaction', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const member = await c.join();
    const mid = id();
    expect(
      await status('POST', `/v1/channels/${c.text}/messages`, owner.token, { id: mid, body: sealed() }),
    ).toBe(201);
    const tag = randomBytes(16).toString('hex');
    const react = (u: User) =>
      status('PUT', `/v1/messages/${mid}/reactions/${tag}`, u.token, { emoji: sealed() });
    expect(await react(owner)).toBe(200);
    expect(
      await status('PUT', `/v1/communities/${c.cid}/members/${member.riverId}/timeout`, owner.token, {
        until: new Date(Date.now() + 3600_000).toISOString(),
      }),
    ).toBe(200);
    expect(await react(member)).toBe(403);
    // Without Add reactions (not timed out), joining an existing reaction is still allowed.
    await status('PUT', `/v1/communities/${c.cid}/members/${member.riverId}/timeout`, owner.token, {
      until: null,
    });
    expect(
      await status('PATCH', `/v1/roles/${c.cid}`, owner.token, {
        permissions: DEFAULT_EVERYONE & ~Permission.ADD_REACTIONS,
      }),
    ).toBe(200);
    expect(await react(member)).toBe(200);
    // Pending (screened) members neither.
    await status('PUT', `/v1/communities/${c.cid}/onboarding`, owner.token, {
      onboarding: null,
      screening: true,
      selfRoles: [],
    });
    const fresh = await c.join();
    expect(await react(fresh)).toBe(403);
  });

  it('only members who may rotate move the key epoch, and not too often', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const member = await c.join();
    const epoch = (u: User, from: number) =>
      status('POST', `/v1/communities/${c.cid}/epoch`, u.token, { from });
    // Nothing asks for a new key: a plain member cannot force one.
    expect(await epoch(member, 0)).toBe(403);
    expect(await epoch(owner, 0)).toBe(200);
    // Screened newcomers who have not accepted the rules cannot either, even when a rotation is due.
    await status('PUT', `/v1/communities/${c.cid}/onboarding`, owner.token, {
      onboarding: null,
      screening: true,
      selfRoles: [],
    });
    const fresh = await c.join();
    const other = await c.join();
    await status('DELETE', `/v1/communities/${c.cid}/members/${other.riverId}`, owner.token);
    expect(await epoch(fresh, 1)).toBe(403);
    expect(await epoch(member, 1)).toBe(200);
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push(await epoch(owner, 2 + i));
    expect(codes).toContain(429);
  });

  it('an invite cannot be used more often than allowed, even by parallel joins', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const code = (
      await app.inject({
        method: 'POST',
        url: `/v1/communities/${c.cid}/invites`,
        headers: auth(owner.token),
      })
    ).json().code;
    await database.db.updateTable('invites').set({ max_uses: 1 }).execute();
    const people = await Promise.all([registerUser(app), registerUser(app), registerUser(app)]);
    const codes = await Promise.all(
      people.map((p) => status('POST', '/v1/invites/join', p.token, { code, profile: sealed() })),
    );
    expect(codes.sort()).toEqual([200, 404, 404]);
    const invite = await database.db.selectFrom('invites').select('uses').executeTakeFirstOrThrow();
    expect(invite.uses).toBe(1);
  });

  it('giving a role again does not bring back the end time of an expired temporary grant', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const member = await c.join();
    const vip = await c.role(0);
    await database.db
      .insertInto('member_roles')
      .values({
        community_id: c.cid,
        river_id: member.riverId,
        role_id: vip,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      })
      .execute();
    expect(
      await status('PUT', `/v1/communities/${c.cid}/members/${member.riverId}/roles`, owner.token, {
        roles: [vip],
      }),
    ).toBe(200);
    const row = await database.db
      .selectFrom('member_roles')
      .selectAll()
      .where('river_id', '=', member.riverId)
      .where('role_id', '=', vip)
      .executeTakeFirstOrThrow();
    expect(row.expires_at).toBeNull();
  });
});

describe('client addresses behind a proxy', () => {
  it('trusts X-Forwarded-For only from a proxy on this machine', async () => {
    await start({ RIVER_TRUST_PROXY: 'true', RIVER_RATE_LIMIT_PER_MINUTE: '2' });
    const hit = (remoteAddress: string, forwarded: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/health',
        remoteAddress,
        headers: { 'x-forwarded-for': forwarded },
      });
    // A client talking to the server directly cannot pick a new address per request.
    const direct = [];
    for (let i = 0; i < 3; i++) direct.push((await hit('203.0.113.9', `198.51.100.${i}`)).statusCode);
    expect(direct).toEqual([200, 200, 429]);
    // Through the local tunnel, the address it appends (the last one) is the client: a forged
    // first entry does not help either.
    const tunnel = [];
    for (let i = 0; i < 3; i++) tunnel.push((await hit('127.0.0.1', `10.9.9.${i}, 192.0.2.7`)).statusCode);
    expect(tunnel).toEqual([200, 200, 429]);
    expect((await hit('127.0.0.1', '192.0.2.8')).statusCode).toBe(200);
  });
});

describe('realtime connections', () => {
  const connect = async (port: number, token: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
    const events: Array<{ t: string; code?: string; participants?: string[] }> = [];
    let closedWith: number | null = null;
    ws.onmessage = (m) => events.push(JSON.parse(String(m.data)));
    ws.onclose = (e) => (closedWith = e.code);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.send(JSON.stringify({ t: 'auth', token }));
    await vi.waitFor(() => expect(events.some((e) => e.t === 'ready')).toBe(true));
    return { ws, events, closed: () => closedWith };
  };

  it('closes a connection whose session ends', async () => {
    await start({}, { sessionRecheckMs: 50 });
    const user = await registerUser(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const conn = await connect(port, user.token);
    await new Promise((r) => setTimeout(r, 150));
    expect(conn.closed()).toBeNull();
    await database.db.deleteFrom('sessions').execute();
    await vi.waitFor(() => expect(conn.closed()).toBe(4401));
  });

  it('keeps the session of a connected device alive instead of ending it once a day', async () => {
    await start({}, { sessionRecheckMs: 50 });
    const user = await registerUser(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const conn = await connect(port, user.token);
    // The session is near its end (less than half its lifetime left).
    const soon = new Date(Date.now() + 60_000).toISOString();
    await database.db.updateTable('sessions').set({ expires_at: soon }).execute();
    await vi.waitFor(async () => {
      const row = await database.db.selectFrom('sessions').select('expires_at').executeTakeFirstOrThrow();
      expect(row.expires_at > new Date(Date.now() + 60 * 60_000).toISOString()).toBe(true);
    });
    expect(conn.closed()).toBeNull();
  });

  it('deleting a community ends its voice calls', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const member = await c.join();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const conn = await connect(port, member.token);
    conn.ws.send(JSON.stringify({ t: 'voice.join', channelId: c.voice }));
    // Handled in order: a leave right behind a join is never overtaken by it.
    conn.ws.send(JSON.stringify({ t: 'voice.leave' }));
    conn.ws.send(JSON.stringify({ t: 'voice.join', channelId: c.voice }));
    await vi.waitFor(() =>
      expect(conn.events.some((e) => e.t === 'voice' && e.participants?.includes(member.riverId))).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 100));
    const last = conn.events.filter((e) => e.t === 'voice').at(-1);
    expect(last?.participants).toEqual([member.riverId]);
    expect(await status('DELETE', `/v1/communities/${c.cid}`, owner.token)).toBe(200);
    await vi.waitFor(() => expect(conn.events.some((e) => e.t === 'voice.disconnect')).toBe(true));
  });

  it('a socket that closes while signing in is never left in the hub', async () => {
    await start();
    const owner = await registerUser(app);
    const c = await community(owner);
    const member = await c.join();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    for (let i = 0; i < 5; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`);
      await new Promise((resolve) => (ws.onopen = resolve));
      ws.send(JSON.stringify({ t: 'auth', token: member.token }));
      ws.close();
    }
    await new Promise((r) => setTimeout(r, 300));
    const listed = (
      await app.inject({ method: 'GET', url: '/v1/communities', headers: auth(owner.token) })
    ).json().communities[0].members as Array<{ riverId: string; online: boolean }>;
    expect(listed.find((m) => m.riverId === member.riverId)?.online).toBe(false);
  });
});

describe('hub voice seats', () => {
  const socket = (): HubSocket => ({ send: () => undefined, close: () => undefined });

  it("releases a seat when the connection in the call drops, though the account's other device stays", async () => {
    const hub = new Hub({ voiceGraceMs: 30 });
    const desktop = socket();
    const phone = socket();
    hub.add('a', desktop);
    hub.add('a', phone);
    hub.joinVoice('a', 'c', 'ch', desktop);
    hub.joinRoom('a', 'room', 2, desktop);
    hub.add('b', socket());
    hub.joinRoom('b', 'room', 2);
    // The phone dropping changes nothing.
    expect(hub.remove('a', phone).held).toBeNull();
    hub.add('a', phone);
    const expired = vi.fn();
    hub.onSeatExpired = expired;
    const { offline, held } = hub.remove('a', desktop);
    expect(offline).toBe(false);
    expect(held).toEqual({ channelId: 'ch', communityId: 'c' });
    expect(hub.stateOf('a').reconnecting).toBe(true);
    await vi.waitFor(() => expect(hub.voiceChannelOf('a')).toBeNull());
    expect(expired).toHaveBeenCalledWith({ channelId: 'ch', communityId: 'c' });
    expect(hub.sharesCall('b', 'a')).toBe(false);
    hub.close();
  });

  it('keeps the seat when the app rejoins in time', async () => {
    const hub = new Hub({ voiceGraceMs: 40 });
    const desktop = socket();
    const phone = socket();
    hub.add('a', desktop);
    hub.add('a', phone);
    hub.joinVoice('a', 'c', 'ch', desktop);
    hub.remove('a', desktop);
    const again = socket();
    hub.add('a', again);
    hub.joinVoice('a', 'c', 'ch', again);
    await new Promise((r) => setTimeout(r, 80));
    expect(hub.voiceChannelOf('a')).toBe('ch');
    hub.close();
  });
});
