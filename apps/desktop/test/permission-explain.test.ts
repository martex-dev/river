import { describe, expect, it } from 'vitest';
import { Permission, computePermissions } from '@river/protocol/permissions';
import { explainPermission, type ExplainInput } from '../src/shared/permission-explain.ts';

const roles = [
  {
    id: 'every',
    name: '@everyone',
    permissions: Permission.VIEW_CHANNELS | Permission.SEND_MESSAGES,
    position: 0,
  },
  { id: 'mod', name: 'Mod', permissions: Permission.MANAGE_MESSAGES | Permission.KICK_MEMBERS, position: 2 },
  { id: 'muted', name: 'Muted', permissions: 0, position: 1 },
  { id: 'admin', name: 'Admin', permissions: Permission.ADMINISTRATOR, position: 3 },
];
const base = (over: Partial<ExplainInput> = {}): ExplainInput => ({
  ownerId: 'owner',
  everyoneRoleId: 'every',
  roles,
  member: { riverId: 'bob', roles: [] },
  ...over,
});

describe('permission explainer', () => {
  it('explains owners, roles, administrators and channel overrides', () => {
    expect(
      explainPermission(base({ member: { riverId: 'owner', roles: [] } }), Permission.BAN_MEMBERS).allowed,
    ).toBe(true);
    const kick = explainPermission(
      base({ member: { riverId: 'bob', roles: ['mod'] } }),
      Permission.KICK_MEMBERS,
    );
    expect(kick).toEqual({
      allowed: true,
      because: ['@everyone does not allow it.', 'Their role Mod allows it.'],
    });
    const channel = {
      name: 'rules',
      overwrites: [{ roleId: 'every', allow: 0, deny: Permission.SEND_MESSAGES }],
    };
    const send = explainPermission(base({ channel }), Permission.SEND_MESSAGES);
    expect(send.allowed).toBe(false);
    expect(send.because.at(-1)).toBe('In #rules, @everyone is denied it.');
    expect(
      explainPermission(
        base({ member: { riverId: 'bob', roles: ['admin'] }, channel }),
        Permission.SEND_MESSAGES,
      ).allowed,
    ).toBe(true);
  });

  it('mentions timeouts, unaccepted rules and announcement channels', () => {
    expect(
      explainPermission(
        base({ member: { riverId: 'bob', roles: [], timedOut: true } }),
        Permission.SEND_MESSAGES,
      ).because.at(-1),
    ).toBe('They are timed out.');
    expect(
      explainPermission(
        base({ member: { riverId: 'bob', roles: [], pending: true } }),
        Permission.SEND_MESSAGES,
      ).allowed,
    ).toBe(false);
    const news = { name: 'news', overwrites: [], announcement: true };
    expect(explainPermission(base({ channel: news }), Permission.SEND_MESSAGES).allowed).toBe(false);
    expect(
      explainPermission(
        base({ member: { riverId: 'bob', roles: ['mod'] }, channel: news }),
        Permission.SEND_MESSAGES,
      ).allowed,
    ).toBe(true);
  });

  it('always agrees with the real permission calculation', () => {
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const bits = [
      Permission.VIEW_CHANNELS,
      Permission.SEND_MESSAGES,
      Permission.KICK_MEMBERS,
      Permission.CONNECT,
      Permission.MANAGE_MESSAGES,
    ];
    for (let i = 0; i < 500; i++) {
      const memberRoles = ['mod', 'muted', 'admin'].filter(() => rnd(3) === 0);
      const overwrites = ['every', 'mod', 'muted']
        .filter(() => rnd(2) === 0)
        .map((roleId) => ({
          roleId,
          allow: bits[rnd(bits.length)]! * rnd(2),
          deny: bits[rnd(bits.length)]! * rnd(2),
        }));
      const bit = bits[rnd(bits.length)]!;
      const real = computePermissions({
        ownerId: 'owner',
        everyoneRoleId: 'every',
        roles,
        member: { riverId: 'bob', roles: memberRoles },
        overwrites,
      });
      const explained = explainPermission(
        base({ member: { riverId: 'bob', roles: memberRoles }, channel: { name: 'c', overwrites } }),
        bit,
      );
      expect(explained.allowed, JSON.stringify({ memberRoles, overwrites, bit })).toBe((real & bit) === bit);
    }
  });
});
