import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HostManager,
  type HostManagerDeps,
  type ServerHandle,
  type TunnelHandle,
} from '../src/main/host/host-manager.ts';
import type { FromServerProcess, ToServerProcess } from '../src/main/host/server-messages.ts';
import type { HostRuntime } from '../src/shared/ipc.ts';

class FakeServer implements ServerHandle {
  readonly sent: ToServerProcess[] = [];
  private readonly messages: Array<(m: FromServerProcess) => void> = [];
  private readonly exits: Array<(code: number) => void> = [];
  killed = false;
  readonly env: Record<string, string>;
  constructor(env: Record<string, string>) {
    this.env = env;
  }
  onMessage(l: (m: FromServerProcess) => void): void {
    this.messages.push(l);
  }
  onExit(l: (code: number) => void): void {
    this.exits.push(l);
  }
  postMessage(m: ToServerProcess): void {
    this.sent.push(m);
    if (m.type === 'stop') this.exit(0);
    if (m.type === 'backup') {
      writeFileSync(m.path, 'copy');
      this.say({ type: 'backup-done', id: m.id });
    }
  }
  kill(): void {
    this.killed = true;
    this.exit(1);
  }
  say(m: FromServerProcess): void {
    for (const l of this.messages) l(m);
  }
  exit(code: number): void {
    for (const l of this.exits.splice(0)) l(code);
  }
}

class FakeTunnel implements TunnelHandle {
  private readonly lines: Array<(l: string) => void> = [];
  private readonly exits: Array<(c: number | null) => void> = [];
  killed = false;
  readonly localUrl: string;
  constructor(localUrl: string) {
    this.localUrl = localUrl;
  }
  onLine(l: (line: string) => void): void {
    this.lines.push(l);
  }
  onExit(l: (c: number | null) => void): void {
    this.exits.push(l);
  }
  kill(): void {
    this.killed = true;
    this.exit(null);
  }
  print(line: string): void {
    for (const l of this.lines) l(line);
  }
  exit(code: number | null): void {
    for (const l of this.exits.splice(0)) l(code);
  }
}

let dir: string;
let servers: FakeServer[];
let tunnels: FakeTunnel[];
let routable: Set<string>;
let announced: Array<{ url: string; auth: string | null }>;
let statuses: HostRuntime[];

const fakeFetch = (async (input: string, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/v1/instance')) return Response.json({ id: 'inst-1' });
  if (url.endsWith('/v1/instance/address')) {
    const headers = new Headers(init?.headers);
    announced.push({
      url: (JSON.parse(String(init?.body)) as { url: string }).url,
      auth: headers.get('authorization'),
    });
    return Response.json({ published: true });
  }
  if (url.endsWith('/v1/health')) {
    const origin = url.slice(0, -'/v1/health'.length);
    if (routable.has(origin)) return Response.json({ status: 'ok' });
    throw new TypeError('fetch failed');
  }
  throw new Error(`unexpected ${url}`);
}) as unknown as typeof fetch;

function manager(overrides: Partial<HostManagerDeps> = {}): HostManager {
  const m = new HostManager({
    dataDir: join(dir, 'data'),
    backupsDir: join(dir, 'backups'),
    preferredPort: 8790,
    beaconRelay: 'https://ntfy.sh',
    spawnServer: (env) => {
      const s = new FakeServer(env);
      servers.push(s);
      return s;
    },
    ensureTunnelTool: async () => '/bin/cloudflared',
    spawnTunnel: (_binary, localUrl) => {
      const t = new FakeTunnel(localUrl);
      tunnels.push(t);
      return t;
    },
    fetch: fakeFetch,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
    ...overrides,
  });
  m.onStatus((s) => statuses.push(s));
  return m;
}

/** Lets pending promises and the given amount of fake time run. */
const tick = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-10T12:00:00Z') });
  dir = mkdtempSync(join(tmpdir(), 'river-host-'));
  servers = [];
  tunnels = [];
  routable = new Set();
  announced = [];
  statuses = [];
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

async function bringOnline(m: HostManager, url = 'https://one-two.trycloudflare.com'): Promise<void> {
  m.start();
  servers.at(-1)!.say({ type: 'ready', port: 8790 });
  await tick();
  routable.add(url);
  tunnels.at(-1)!.print(`INF |  ${url}  |`);
  await tick(8_000);
}

describe('HostManager', () => {
  it('starts the server with its data in the permanent folder, then opens and announces the address', async () => {
    const m = manager();
    const addresses: string[] = [];
    m.onAddress((url, id) => addresses.push(`${url} ${id}`));
    m.start();
    expect(m.status().state).toBe('starting');
    const env = servers[0]!.env;
    expect(env.RIVER_PORT).toBe('8790');
    expect(env.RIVER_HOST).toBe('127.0.0.1');
    expect(env.RIVER_DATABASE_URL).toBe(`sqlite:${join(dir, 'data', 'river.sqlite')}`);
    expect(env.RIVER_BEACON_RELAY).toBe('https://ntfy.sh');
    expect(env.RIVER_HOST_TOKEN).toMatch(/^[0-9a-f]{64}$/);

    servers[0]!.say({ type: 'ready', port: 8790 });
    await tick();
    expect(tunnels[0]!.localUrl).toBe('http://127.0.0.1:8790');

    // The address is printed before it routes: not online until it answers.
    tunnels[0]!.print('INF |  https://one-two.trycloudflare.com  |');
    await tick(8_000);
    expect(m.status().state).toBe('starting');
    routable.add('https://one-two.trycloudflare.com');
    await tick(2_000);

    expect(m.status()).toMatchObject({
      state: 'online',
      address: 'https://one-two.trycloudflare.com',
      instanceId: 'inst-1',
      followable: true,
    });
    expect(announced).toEqual([
      { url: 'https://one-two.trycloudflare.com', auth: `Bearer ${env.RIVER_HOST_TOKEN}` },
    ]);
    expect(addresses).toEqual(['https://one-two.trycloudflare.com inst-1']);
    await m.stop();
  });

  it('restarts a crashed server on the same port and tells it the address again', async () => {
    const m = manager();
    await bringOnline(m);
    servers[0]!.exit(1);
    expect(m.status().state).toBe('reconnecting');
    await tick(2_000);
    expect(servers).toHaveLength(2);
    servers[1]!.say({ type: 'ready', port: 8790 });
    await tick();
    expect(tunnels).toHaveLength(1);
    expect(announced.at(-1)).toEqual({
      url: 'https://one-two.trycloudflare.com',
      auth: `Bearer ${servers[1]!.env.RIVER_HOST_TOKEN}`,
    });
    await m.stop();
  });

  it('moves to a free port when something else holds the preferred one', async () => {
    const m = manager();
    m.start();
    servers[0]!.say({ type: 'failed', reason: 'port-in-use', message: 'EADDRINUSE' });
    servers[0]!.exit(1);
    await tick(2_000);
    expect(servers[1]!.env.RIVER_PORT).toBe('0');
    servers[1]!.say({ type: 'ready', port: 51234 });
    await tick();
    expect(tunnels[0]!.localUrl).toBe('http://127.0.0.1:51234');
    await m.stop();
  });

  it('reopens the tunnel when it stops, and announces the new address', async () => {
    const m = manager();
    await bringOnline(m);
    tunnels[0]!.exit(1);
    expect(m.status()).toMatchObject({ state: 'reconnecting', address: null });
    await tick(2_000);
    routable.add('https://three-four.trycloudflare.com');
    tunnels[1]!.print('https://three-four.trycloudflare.com');
    await tick(8_000);
    expect(m.status().address).toBe('https://three-four.trycloudflare.com');
    expect(announced.map((a) => a.url)).toEqual([
      'https://one-two.trycloudflare.com',
      'https://three-four.trycloudflare.com',
    ]);
    await m.stop();
  });

  it('reopens a tunnel that silently stopped routing', async () => {
    const m = manager();
    await bringOnline(m);
    routable.clear();
    await tick(3 * 60_000);
    expect(tunnels[0]!.killed).toBe(true);
    expect(tunnels).toHaveLength(2);
    await m.stop();
  });

  it('retries when the tunnel tool cannot be fetched (no internet yet)', async () => {
    let attempts = 0;
    const m = manager({
      ensureTunnelTool: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Could not download cloudflared (HTTP 503).');
        return '/bin/cloudflared';
      },
    });
    m.start();
    servers[0]!.say({ type: 'ready', port: 8790 });
    await tick();
    expect(m.status()).toMatchObject({ state: 'reconnecting', message: expect.stringContaining('503') });
    await tick(2_000);
    expect(tunnels).toHaveLength(1);
    await m.stop();
  });

  it('backs up once a day and keeps the newest seven copies', async () => {
    mkdirSync(join(dir, 'backups'));
    for (let d = 1; d <= 8; d++) {
      const day = String(d).padStart(2, '0');
      writeFileSync(join(dir, 'backups', `river-2026-09-${day}T00-00-00-000Z.sqlite`), 'old');
    }
    const m = manager();
    expect(m.status().lastBackupAt).toBe('2026-09-08T00:00:00.000Z');
    await bringOnline(m);
    const files = readdirSync(join(dir, 'backups')).sort();
    expect(files).toHaveLength(7);
    expect(files.at(-1)).toBe('river-2026-10-10T12-00-00-000Z.sqlite');
    expect(m.status().lastBackupAt).toBe('2026-10-10T12:00:00.000Z');
    // Not again within the day.
    await tick(60 * 60 * 1000);
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(7);
    await m.stop();
  });

  it('stops the server gracefully and closes the tunnel', async () => {
    const m = manager();
    await bringOnline(m);
    await m.stop();
    expect(servers[0]!.sent.at(-1)).toEqual({ type: 'stop' });
    expect(tunnels[0]!.killed).toBe(true);
    expect(m.status()).toMatchObject({ state: 'off', address: null });
    await tick(60_000);
    expect(servers).toHaveLength(1);
    expect(statuses.at(-1)?.state).toBe('off');
  });
});

describe('HostManager without a tunnel (development)', () => {
  it('serves on its loopback address and announces nothing', async () => {
    const m = manager({ localOnly: true });
    const addresses: string[] = [];
    m.onAddress((url) => addresses.push(url));
    m.start();
    servers[0]!.say({ type: 'ready', port: 8790 });
    await tick();
    expect(m.status()).toMatchObject({ state: 'online', address: 'http://127.0.0.1:8790' });
    expect(tunnels).toEqual([]);
    expect(announced).toEqual([]);
    expect(addresses).toEqual(['http://127.0.0.1:8790']);
    await m.stop();
  });
});

describe('HostManager localServer (owner connects over loopback)', () => {
  it('exposes the local address and instance once the server is up and identified', async () => {
    const m = manager();
    expect(m.localServer()).toBeNull();
    m.start();
    expect(m.localServer()).toBeNull(); // not ready yet
    servers[0]!.say({ type: 'ready', port: 8790 });
    await tick();
    expect(m.localServer()).toEqual({ url: 'http://127.0.0.1:8790', instanceId: 'inst-1' });
    await m.stop();
    expect(m.localServer()).toBeNull();
  });

  it('has no local address while the chosen port is still being resolved', async () => {
    const m = manager();
    m.start();
    servers[0]!.say({ type: 'failed', reason: 'port-in-use', message: 'EADDRINUSE' });
    servers[0]!.exit(1);
    await tick(2_000);
    // Port 0 (pick any) before the server reports its real port.
    expect(m.localServer()).toBeNull();
    servers[1]!.say({ type: 'ready', port: 49999 });
    await tick();
    expect(m.localServer()).toEqual({ url: 'http://127.0.0.1:49999', instanceId: 'inst-1' });
    await m.stop();
  });
});
