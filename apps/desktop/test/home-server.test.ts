import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beaconMessage } from '@river/protocol';
import type { AccountStatus } from '../src/shared/ipc.ts';
import { HOME_SERVER } from '../src/shared/home-server.ts';
import { HomeAccount, HomeServerUnavailable, locateHomeServer } from '../src/main/home-server.ts';
import type { RequestJson } from '../src/main/http.ts';

const keys = generateKeyPairSync('ed25519');
const publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
const server = { instanceId: 'home-1', publicKey, relay: 'https://relay.test', topic: 'river-home' };

const note = (url: string, issuedAt: string, key = keys.privateKey, id = server.instanceId): string =>
  JSON.stringify({
    event: 'message',
    message: JSON.stringify({
      url,
      issuedAt,
      sig: sign(null, beaconMessage(id, url, issuedAt), key).toString('base64'),
    }),
  });

function deps(relayBody: string, answers: Record<string, { id: string; publicKey: string }>) {
  const fetched: string[] = [];
  return {
    fetched,
    fetchBytes: async (url: string) => {
      fetched.push(url);
      return new TextEncoder().encode(relayBody);
    },
    requestJson: (async (url: string) => {
      const origin = url.replace(/\/v1\/instance$/, '');
      const a = answers[origin];
      if (!a) throw new TypeError('fetch failed');
      return { ...a, beacon: null, address: null };
    }) as unknown as RequestJson,
    hostedHere: () => null,
    server,
  };
}

describe('River’s home server', () => {
  it('is built in with a pinned identity and announcement topic', () => {
    expect(HOME_SERVER.publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(HOME_SERVER.relay).toBe('https://ntfy.sh');
    expect(HOME_SERVER.topic).toMatch(/^river-/);
  });

  it('is found at the newest address its key signed, once that address proves who it is', async () => {
    const d = deps(
      [
        note('https://old.trycloudflare.com', '2026-10-10T08:00:00.000Z'),
        note('https://new.trycloudflare.com/', '2026-10-10T12:00:00.000Z'),
      ].join('\n'),
      { 'https://new.trycloudflare.com': { id: 'home-1', publicKey } },
    );
    expect(await locateHomeServer(d)).toBe('https://new.trycloudflare.com');
    expect(d.fetched).toEqual(['https://relay.test/river-home/json?poll=1&since=24h']);
  });

  it('ignores notes signed by anyone else', async () => {
    const forger = generateKeyPairSync('ed25519').privateKey;
    const d = deps(note('https://evil.example', '2026-10-10T13:00:00.000Z', forger), {
      'https://evil.example': { id: 'home-1', publicKey },
    });
    await expect(locateHomeServer(d)).rejects.toBeInstanceOf(HomeServerUnavailable);
  });

  it('refuses an address that answers as a different server', async () => {
    const d = deps(note('https://swapped.example', '2026-10-10T13:00:00.000Z'), {
      'https://swapped.example': { id: 'someone-else', publicKey },
    });
    await expect(locateHomeServer(d)).rejects.toBeInstanceOf(HomeServerUnavailable);
  });

  it('uses its own address on the PC that hosts it', async () => {
    const d = { ...deps('', {}), hostedHere: () => 'https://here.trycloudflare.com' };
    expect(await locateHomeServer(d)).toBe('https://here.trycloudflare.com');
    expect(d.fetched).toEqual([]);
  });
});

describe('HomeAccount', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(options: { enabled?: boolean; reachable?: boolean; chosen?: string | null } = {}) {
    let status: AccountStatus = { state: 'none' };
    const registered: string[] = [];
    let reachable = options.reachable ?? true;
    const base = deps(note('https://home.trycloudflare.com', '2026-10-10T12:00:00.000Z'), {});
    const home = new HomeAccount({
      ...base,
      requestJson: (async (url: string) => {
        if (!reachable) throw new TypeError('fetch failed');
        expect(url).toBe('https://home.trycloudflare.com/v1/instance');
        return { id: 'home-1', publicKey, beacon: null, address: null };
      }) as unknown as RequestJson,
      enabled: options.enabled ?? true,
      account: {
        status: () => status,
        register: async (url: string) => {
          registered.push(url);
          status = { state: 'registered' } as AccountStatus;
          return status;
        },
      } as never,
      ready: () => true,
      chosenServer: () => options.chosen ?? null,
      onRegistered: () => undefined,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    });
    return { home, registered, setReachable: (v: boolean) => (reachable = v) };
  }

  it('creates the account on River’s server by itself', async () => {
    const { home, registered } = setup();
    home.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(registered).toEqual(['https://home.trycloudflare.com']);
  });

  it('keeps trying every minute while the server is away, and says so', async () => {
    const { home, registered, setReachable } = setup({ reachable: false });
    const changes: boolean[] = [];
    home.onChange(() => changes.push(home.isWaiting()));
    home.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(home.isWaiting()).toBe(true);
    setReachable(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registered).toHaveLength(1);
    expect(home.isWaiting()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('leaves people who chose their own server alone', async () => {
    const { home, registered } = setup({ chosen: 'https://my.server' });
    home.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(registered).toEqual([]);
  });

  it('never touches River’s server from development builds', async () => {
    const { home, registered } = setup({ enabled: false });
    home.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(registered).toEqual([]);
    await expect(home.ensure()).rejects.toThrow(/development build/);
  });
});
