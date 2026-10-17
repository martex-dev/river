import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Permission, auditResponseSchema, communitySchema, invitesResponseSchema } from '@river/protocol';
import type { RiverDatabase } from '../src/db/database.ts';
import { auth, registerUser, startServer } from './helpers.ts';

/** Regression tests for the community management audit (2.10.13). */

let app: FastifyInstance;
let database: RiverDatabase;

afterEach(async () => {
  await app?.close();
  await database?.close();
});

const id = (): string => randomBytes(16).toString('base64url');
const sealed = (): string => randomBytes(40).toString('base64');
type User = Awaited<ReturnType<typeof registerUser>>;

async function start(): Promise<void> {
  ({ app, database } = await startServer());
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: object,
): Promise<{ status: number; json: () => unknown }> {
  const res = await app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });
  return { status: res.statusCode, json: () => res.json() };
}
const status = async (...args: Parameters<typeof call>): Promise<number> => (await call(...args)).status;

async function setup() {
  await start();
  const owner = await registerUser(app);
  const cid = id();
  const text = id();
  const res = await call('POST', '/v1/communities', owner.token, {
    id: cid,
    meta: sealed(),
    profile: sealed(),
    channels: [{ id: text, kind: 'text', name: sealed() }],
  });
  expect(res.status).toBe(201);
  const join = async (): Promise<User> => {
    const m = await registerUser(app);
    const code = (
      (await call('POST', `/v1/communities/${cid}/invites`, owner.token)).json() as { code: string }
    ).code;
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
  const view = async (token: string) =>
    communitySchema.parse(
      (
        (await call('GET', '/v1/communities', token)).json() as { communities: Array<{ id: string }> }
      ).communities.find((c) => c.id === cid),
    );
  const channel = async (over: object = {}): Promise<string> => {
    const ch = id();
    expect(
      await status('POST', `/v1/communities/${cid}/channels`, owner.token, {
        id: ch,
        kind: 'text',
        name: sealed(),
        ...over,
      }),
    ).toBe(201);
    return ch;
  };
  const category = async (overwrites?: object[]): Promise<string> => {
    const k = id();
    expect(
      await status('POST', `/v1/communities/${cid}/categories`, owner.token, { id: k, name: sealed() }),
    ).toBe(201);
    if (overwrites)
      expect(await status('PATCH', `/v1/categories/${k}`, owner.token, { overwrites })).toBe(200);
    return k;
  };
  return { owner, cid, text, join, role, view, channel, category };
}

describe('private categories stay private', () => {
  it('channels synced to a deleted category keep its permissions', async () => {
    const c = await setup();
    const member = await c.join();
    const secret = await c.category([{ roleId: c.cid, allow: 0, deny: Permission.VIEW_CHANNELS }]);
    const inside = await c.channel({ parentId: secret });
    expect((await c.view(member.token)).channels.map((x) => x.id)).not.toContain(inside);
    expect(await status('DELETE', `/v1/categories/${secret}`, c.owner.token)).toBe(200);
    const after = (await c.view(c.owner.token)).channels.find((x) => x.id === inside)!;
    expect(after).toMatchObject({ parentId: null, synced: false });
    expect(after.overwrites).toEqual([{ roleId: c.cid, allow: 0, deny: Permission.VIEW_CHANNELS }]);
    expect((await c.view(member.token)).channels.map((x) => x.id)).not.toContain(inside);
  });

  it('moving a synced channel out (full layout, relative move or channel edit) keeps its permissions', async () => {
    const c = await setup();
    const member = await c.join();
    const secret = await c.category([{ roleId: c.cid, allow: 0, deny: Permission.VIEW_CHANNELS }]);
    const open = await c.category();
    const a = await c.channel({ parentId: secret });
    const b = await c.channel({ parentId: secret });
    const d = await c.channel({ parentId: secret });
    expect(
      await status('PUT', `/v1/communities/${c.cid}/layout`, c.owner.token, {
        categories: [],
        channels: [{ id: a, position: 0, parentId: null }],
      }),
    ).toBe(200);
    expect(
      await status('PUT', `/v1/communities/${c.cid}/layout/move`, c.owner.token, {
        kind: 'channel',
        id: b,
        parentId: open,
        afterId: null,
      }),
    ).toBe(200);
    expect(await status('PATCH', `/v1/channels/${d}`, c.owner.token, { parentId: null })).toBe(200);
    const theirs = (await c.view(member.token)).channels.map((x) => x.id);
    for (const ch of [a, b, d]) expect(theirs).not.toContain(ch);
    const mine = await c.view(c.owner.token);
    expect(mine.channels.find((x) => x.id === b)).toMatchObject({ parentId: open, synced: false });
  });
});

describe('relative channel moves', () => {
  it('place a channel among all channels, hidden ones included, checking only the moved one', async () => {
    const c = await setup();
    const manager = await c.join();
    await c.role(Permission.MANAGE_CHANNELS | Permission.VIEW_CHANNELS, manager);
    const k = await c.category();
    // A hidden channel the manager cannot see or manage, first in the category.
    const hidden = await c.channel({
      parentId: k,
      overwrites: [{ roleId: c.cid, allow: 0, deny: Permission.VIEW_CHANNELS | Permission.MANAGE_CHANNELS }],
    });
    const x = await c.channel({ parentId: k });
    const y = await c.channel({ parentId: k });
    // Before: hidden, x, y.
    expect(
      await status('PUT', `/v1/communities/${c.cid}/layout`, c.owner.token, {
        categories: [],
        channels: [
          { id: hidden, position: 0, parentId: k },
          { id: x, position: 1, parentId: k },
          { id: y, position: 2, parentId: k },
        ],
      }),
    ).toBe(200);
    // y to the top, as the manager: allowed although the hidden channel shifts too.
    expect(
      await status('PUT', `/v1/communities/${c.cid}/layout/move`, manager.token, {
        kind: 'channel',
        id: y,
        parentId: k,
        afterId: null,
      }),
    ).toBe(200);
    const order = (await c.view(c.owner.token)).channels
      .filter((ch) => ch.parentId === k)
      .sort((p, q) => p.position - q.position)
      .map((ch) => ch.id);
    expect(order).toEqual([y, hidden, x]);
    // The hidden channel itself cannot be moved by the manager.
    expect(
      await status('PUT', `/v1/communities/${c.cid}/layout/move`, manager.token, {
        kind: 'channel',
        id: hidden,
        parentId: k,
        afterId: x,
      }),
    ).toBe(403);
    // Unknown neighbours and categories are refused.
    expect(
      await status('PUT', `/v1/communities/${c.cid}/layout/move`, c.owner.token, {
        kind: 'channel',
        id: x,
        parentId: k,
        afterId: c.text,
      }),
    ).toBe(400);
    const k2 = await c.category();
    expect(
      await status('PUT', `/v1/communities/${c.cid}/layout/move`, c.owner.token, {
        kind: 'category',
        id: k2,
        afterId: null,
      }),
    ).toBe(200);
    expect((await c.view(c.owner.token)).categories.map((x2) => x2.id)).toEqual([k2, k]);
  });
});

describe('role order', () => {
  it('reorders roles below you atomically and refuses anything at or above you', async () => {
    const c = await setup();
    const admin = await c.join();
    // New roles go in just above @everyone: the first one made ends up highest.
    const adminRole = await c.role(Permission.MANAGE_ROLES, admin);
    const mid = await c.role(0);
    const low = await c.role(0);
    const positions = async () =>
      Object.fromEntries((await c.view(c.owner.token)).roles.map((r) => [r.id, r.position]));
    const before = await positions();
    expect(before[adminRole]).toBeGreaterThan(before[mid]!);
    // Swap the two lower roles.
    expect(
      await status('PUT', `/v1/communities/${c.cid}/role-order`, admin.token, {
        roles: [
          { id: low, position: before[mid]! },
          { id: mid, position: before[low]! },
        ],
      }),
    ).toBe(200);
    let now = await positions();
    expect([now[low], now[mid]]).toEqual([before[mid], before[low]]);
    // One step refused (own role) → nothing applied.
    expect(
      await status('PUT', `/v1/communities/${c.cid}/role-order`, admin.token, {
        roles: [
          { id: low, position: before[low]! },
          { id: adminRole, position: before[mid]! },
        ],
      }),
    ).toBe(403);
    expect(await positions()).toEqual(now);
    // Two roles on one position are refused.
    expect(
      await status('PUT', `/v1/communities/${c.cid}/role-order`, admin.token, {
        roles: [{ id: low, position: now[mid]! }],
      }),
    ).toBe(400);
    // Deleting a role closes the gap.
    expect(await status('DELETE', `/v1/roles/${low}`, c.owner.token)).toBe(200);
    now = await positions();
    const sorted = Object.entries(now)
      .filter(([rid]) => rid !== c.cid)
      .map(([, p]) => p)
      .sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2]);
  });
});

describe('invites and the audit log', () => {
  it('used up invites are not listed as active', async () => {
    const c = await setup();
    await call('POST', `/v1/communities/${c.cid}/invites`, c.owner.token);
    await call('POST', `/v1/communities/${c.cid}/invites`, c.owner.token);
    const list = async () =>
      invitesResponseSchema.parse(
        (await call('GET', `/v1/communities/${c.cid}/invites`, c.owner.token)).json(),
      ).invites;
    const all = await list();
    expect(all).toHaveLength(2);
    await database.db.updateTable('invites').set({ uses: 100 }).where('id', '=', all[0]!.id).execute();
    expect((await list()).map((i) => i.id)).toEqual([all[1]!.id]);
  });

  it('pages entries that share a timestamp without skipping any', async () => {
    const c = await setup();
    const at = '2026-01-01T00:00:00.000Z';
    const rows = Array.from({ length: 150 }, (_, i) => ({
      id: `e${String(i).padStart(4, '0')}`,
      community_id: c.cid,
      actor: c.owner.riverId,
      action: 'channel.update',
      target: null,
      details: '{}',
      created_at: at,
    }));
    await database.db.insertInto('audit_log').values(rows).execute();
    const page = async (q: string) =>
      auditResponseSchema
        .parse((await call('GET', `/v1/communities/${c.cid}/audit${q}`, c.owner.token)).json())
        .entries.filter((e) => e.at === at);
    const first = await page('');
    const last = first.at(-1)!;
    const second = await page(`?before=${encodeURIComponent(last.at)}&beforeId=${last.id}`);
    const seen = new Set([...first, ...second].map((e) => e.id));
    expect(seen.size).toBe(150);
  });
});
