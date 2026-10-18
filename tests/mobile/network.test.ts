import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_SETTLE_MS, watchNetwork, type NetworkScope } from '../../apps/mobile/core/network.ts';

/** A WebView's window as far as network events go. */
function scope(withConnection = true) {
  const listeners = new Map<string, Set<() => void>>();
  const target = (prefix: string) => ({
    addEventListener: (type: string, fn: () => void) => {
      const key = prefix + type;
      listeners.set(key, (listeners.get(key) ?? new Set()).add(fn));
    },
    removeEventListener: (type: string, fn: () => void) => void listeners.get(prefix + type)?.delete(fn),
  });
  const navigator: NonNullable<NetworkScope['navigator']> = {
    onLine: true,
    connection: withConnection ? target('connection:') : null,
  };
  const s: NetworkScope = { ...target(''), navigator };
  const fire = (key: string): void => {
    for (const fn of listeners.get(key) ?? []) fn();
  };
  return {
    scope: s,
    navigator,
    online: () => fire('online'),
    change: () => fire('connection:change'),
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('checking the connection when the network changes (phones, 2.12)', () => {
  it('checks once the network is back, and once for a burst of changes', () => {
    const w = scope();
    const check = vi.fn();
    watchNetwork(check, w.scope);
    w.online();
    expect(check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(NETWORK_SETTLE_MS);
    expect(check).toHaveBeenCalledTimes(1);
    // Wi-Fi to mobile data: several changes in a row.
    w.change();
    vi.advanceTimersByTime(300);
    w.change();
    w.online();
    vi.advanceTimersByTime(NETWORK_SETTLE_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not check while the phone is offline', () => {
    const w = scope();
    const check = vi.fn();
    watchNetwork(check, w.scope);
    w.navigator.onLine = false;
    w.change();
    vi.advanceTimersByTime(NETWORK_SETTLE_MS);
    expect(check).not.toHaveBeenCalled();
  });

  it('works without navigator.connection (iPhone) and with no events at all (tests, Node)', () => {
    const w = scope(false);
    const check = vi.fn();
    watchNetwork(check, w.scope);
    w.online();
    vi.advanceTimersByTime(NETWORK_SETTLE_MS);
    expect(check).toHaveBeenCalledTimes(1);
    expect(() => watchNetwork(check, {})()).not.toThrow();
  });

  it('a failing check is not fatal, and stopping removes every listener and the pending check', () => {
    const w = scope();
    const check = vi.fn(() => {
      throw new Error('database closed');
    });
    const stop = watchNetwork(check, w.scope);
    w.online();
    expect(() => vi.advanceTimersByTime(NETWORK_SETTLE_MS)).not.toThrow();
    w.change();
    stop();
    vi.advanceTimersByTime(NETWORK_SETTLE_MS);
    expect(check).toHaveBeenCalledTimes(1);
    expect(w.count()).toBe(0);
  });
});
