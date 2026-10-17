import { describe, expect, it } from 'vitest';
import { accountGone } from '../../apps/mobile/core/account-gone.ts';
import type { AccountStatus } from '../../apps/desktop/src/shared/ipc.ts';

const registered = (o: Partial<Extract<AccountStatus, { state: 'registered' }>> = {}): AccountStatus => ({
  state: 'registered',
  server: 'river.example',
  serverUrl: 'https://river.example',
  shareUrl: 'https://river.example',
  riverId: 'a',
  deviceId: 1,
  devices: 1,
  listVersion: 1,
  connection: 'online',
  username: null,
  ...o,
});

describe('dropping message notifications when the account is gone (Android, 2.11.2)', () => {
  it('signing out, a removed account or another account drops them', () => {
    expect(accountGone(registered(), { state: 'none' })).toBe(true);
    expect(accountGone(registered(), registered({ missing: true, removed: true }))).toBe(true);
    expect(accountGone(registered(), registered({ riverId: 'b' }))).toBe(true);
  });
  it('a connection change, or no account before, keeps them', () => {
    expect(accountGone(registered(), registered({ connection: 'offline' }))).toBe(false);
    expect(accountGone({ state: 'none' }, registered())).toBe(false);
    expect(accountGone(null, { state: 'none' })).toBe(false);
    expect(accountGone(registered({ missing: true }), { state: 'none' })).toBe(false);
  });
});
