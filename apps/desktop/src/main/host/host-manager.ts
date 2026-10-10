import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { HostRuntime } from '../../shared/ipc.ts';
import type { Logger } from '../logger.ts';
import type { FromServerProcess, ToServerProcess } from './server-messages.ts';

/** The community server, running in its own process (see src/host/server-process.ts). */
export interface ServerHandle {
  onMessage(listener: (message: FromServerProcess) => void): void;
  onExit(listener: (code: number) => void): void;
  postMessage(message: ToServerProcess): void;
  kill(): void;
}

/** cloudflared, printing its output line by line. */
export interface TunnelHandle {
  onLine(listener: (line: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export interface HostManagerDeps {
  /** Database and attachments; permanent, never inside the app's install folder. */
  dataDir: string;
  backupsDir: string;
  preferredPort: number;
  /** Public relay for signed "this is my new address" notes; '' turns announcements off. */
  beaconRelay: string;
  spawnServer(env: Record<string, string>): ServerHandle;
  /** Finds or downloads the tunnel tool; reports download progress 0–1. */
  ensureTunnelTool(onProgress: (fraction: number) => void): Promise<string>;
  spawnTunnel(binary: string, localUrl: string): TunnelHandle;
  fetch: typeof fetch;
  log: Logger;
  now?: () => Date;
  /**
   * Development and end-to-end tests only: no tunnel; the server's address is
   * its loopback URL, reachable from this computer alone.
   */
  localOnly?: boolean;
}

const QUICK_TUNNEL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const RESTART_MIN_MS = 2_000;
const RESTART_MAX_MS = 60_000;
/** A process that ran this long gets a fresh, short pause after it stops. */
const STABLE_AFTER_MS = 60_000;
const ROUTE_TIMEOUT_MS = 90_000;
/**
 * A new quick-tunnel name needs a few seconds before it resolves. Asking too
 * early gets a "no such name" that the system then caches for about a minute.
 */
const FIRST_PROBE_MS = 8_000;
const WATCH_EVERY_MS = 60_000;
const WATCH_FAILURES = 3;
const ANNOUNCE_EVERY_MS = 4 * 60 * 60 * 1000;
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
const BACKUP_CHECK_MS = 60 * 60 * 1000;
const BACKUPS_KEPT = 7;

/**
 * Hosts communities on this PC: keeps the River server and its public tunnel
 * running, restarts them when they stop, tells members' apps where the
 * server now is, and backs the database up every day. Nothing here needs the
 * user's own (locked) River data — hosting runs from sign-in.
 */
export class HostManager {
  private readonly deps: HostManagerDeps;
  private readonly listeners = new Set<(s: HostRuntime) => void>();
  private readonly addressListeners = new Set<(url: string, instanceId: string) => void>();
  private wanted = false;
  private state: HostRuntime['state'] = 'off';
  private message: string | undefined;
  private progress: number | undefined;
  private address: string | null = null;
  private instanceId: string | null = null;
  private port: number | null = null;
  private lastBackupAt: string | null = null;

  private server: ServerHandle | null = null;
  private serverDelay = RESTART_MIN_MS;
  private tunnel: TunnelHandle | null = null;
  private tunnelDelay = RESTART_MIN_MS;
  private tunnelBinary: string | null = null;
  private hostToken = '';
  private backupSeq = 0;
  private readonly pendingBackups = new Map<number, (error?: string) => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();

  constructor(deps: HostManagerDeps) {
    this.deps = deps;
    this.lastBackupAt = this.newestBackup();
  }

  status(): HostRuntime {
    return {
      state: this.state,
      address: this.state === 'online' ? this.address : null,
      followable: this.deps.beaconRelay !== '',
      lastBackupAt: this.lastBackupAt,
      ...(this.instanceId ? { instanceId: this.instanceId } : {}),
      ...(this.progress !== undefined ? { progress: this.progress } : {}),
      ...(this.message ? { message: this.message } : {}),
    };
  }

  onStatus(listener: (s: HostRuntime) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The server as this PC reaches it directly, once it is running and identified.
   * The owner's own app uses this instead of the public tunnel: always reachable,
   * no tunnel in the path.
   */
  localServer(): { url: string; instanceId: string | null } | null {
    if (this.port === null || this.port === 0 || !this.server) return null;
    return { url: this.local(), instanceId: this.instanceId };
  }

  /** Called with each new public address once it is reachable. */
  onAddress(listener: (url: string, instanceId: string) => void): () => void {
    this.addressListeners.add(listener);
    return () => this.addressListeners.delete(listener);
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.serverDelay = RESTART_MIN_MS;
    this.tunnelDelay = RESTART_MIN_MS;
    this.set('starting');
    this.launchServer();
    this.every(ANNOUNCE_EVERY_MS, () => void this.announce());
    this.every(WATCH_EVERY_MS, () => void this.watch());
    this.every(BACKUP_CHECK_MS, () => void this.backupIfDue());
  }

  async stop(): Promise<void> {
    if (!this.wanted) return;
    this.wanted = false;
    for (const t of this.timers) clearTimeout(t);
    for (const i of this.intervals) clearInterval(i);
    this.timers.clear();
    this.intervals.clear();
    this.tunnel?.kill();
    this.tunnel = null;
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          server.kill();
          resolve();
        }, 5_000);
        server.onExit(() => {
          clearTimeout(force);
          resolve();
        });
        server.postMessage({ type: 'stop' });
      });
    }
    this.address = null;
    this.progress = undefined;
    this.set('off');
  }

  /** The network came back or the PC woke up: retry now instead of after the pause. */
  nudge(): void {
    if (!this.wanted) return;
    this.tunnelDelay = RESTART_MIN_MS;
    if (this.state !== 'online' && this.port !== null && this.tunnelBinary) this.restartTunnel();
  }

  /**
   * Calls one of the server's operator endpoints (/v1/admin/*) with the host
   * token. The token never leaves this process; the UI only gets the answers.
   */
  async operator(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    if (this.port === null || !this.server) throw new Error('Hosting is not running.');
    const res = await this.deps.fetch(`${this.local()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.hostToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
      throw new Error(typeof message === 'string' ? message : `The server answered ${res.status}.`);
    }
    return json;
  }

  /** Writes a dated copy of the database to the backups folder; keeps the newest seven. */
  async backupNow(): Promise<string> {
    const server = this.server;
    if (!server || this.port === null) throw new Error('Hosting is not running.');
    mkdirSync(this.deps.backupsDir, { recursive: true });
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const path = join(this.deps.backupsDir, `river-${stamp}.sqlite`);
    const id = ++this.backupSeq;
    await new Promise<void>((resolve, reject) => {
      this.pendingBackups.set(id, (error) => (error ? reject(new Error(error)) : resolve()));
      server.postMessage({ type: 'backup', id, path });
    });
    this.lastBackupAt = this.now().toISOString();
    this.pruneBackups();
    this.deps.log.info('host: database backed up');
    this.emit();
    return path;
  }

  // --- server -------------------------------------------------------------

  private launchServer(): void {
    if (!this.wanted) return;
    this.hostToken = randomBytes(32).toString('hex');
    const port = this.port ?? this.deps.preferredPort;
    const env: Record<string, string> = {
      RIVER_HOST: '127.0.0.1',
      RIVER_PORT: String(port),
      // Requests arrive through the tunnel on this machine; it reports the real client address.
      RIVER_TRUST_PROXY: 'true',
      RIVER_DATABASE_URL: `sqlite:${join(this.deps.dataDir, 'river.sqlite')}`,
      RIVER_ATTACHMENT_DIR: join(this.deps.dataDir, 'attachments'),
      RIVER_HOST_TOKEN: this.hostToken,
      RIVER_RATE_LIMIT_PER_MINUTE: '5000',
      RIVER_LOG_LEVEL: 'info',
      // The WebSocket library's optional native add-ons are not shipped; use its JavaScript code.
      WS_NO_BUFFER_UTIL: '1',
      WS_NO_UTF_8_VALIDATE: '1',
      ...(this.deps.beaconRelay ? { RIVER_BEACON_RELAY: this.deps.beaconRelay } : {}),
    };
    const startedAt = Date.now();
    const server = this.deps.spawnServer(env);
    this.server = server;
    let portInUse = false;
    server.onMessage((message) => {
      if (message.type === 'ready') {
        void this.serverReady(message.port);
      } else if (message.type === 'failed') {
        portInUse = message.reason === 'port-in-use';
        this.deps.log.warn(`host: server could not start (${message.reason})`);
      } else if (message.type === 'backup-done') {
        this.pendingBackups.get(message.id)?.(message.error);
        this.pendingBackups.delete(message.id);
      }
    });
    server.onExit((code) => {
      if (this.server !== server) return;
      this.server = null;
      for (const done of this.pendingBackups.values()) done('the server stopped');
      this.pendingBackups.clear();
      if (!this.wanted) return;
      if (portInUse) {
        // Something else has the port: take any free one, and point the tunnel there.
        this.port = 0;
        this.serverDelay = RESTART_MIN_MS;
      } else if (Date.now() - startedAt > STABLE_AFTER_MS) {
        this.serverDelay = RESTART_MIN_MS;
      }
      this.deps.log.warn(`host: server stopped (code ${code}); restarting`);
      this.set('reconnecting', 'Restarting the community server…');
      this.later(this.serverDelay, () => this.launchServer());
      this.serverDelay = Math.min(this.serverDelay * 2, RESTART_MAX_MS);
    });
  }

  private async serverReady(port: number): Promise<void> {
    const moved = this.port !== null && this.port !== 0 && this.port !== port;
    this.port = port;
    this.deps.log.info(`host: server answering on 127.0.0.1:${port}`);
    try {
      const res = await this.deps.fetch(`${this.local()}/v1/instance`);
      const info = (await res.json()) as { id?: unknown };
      if (typeof info.id === 'string') this.instanceId = info.id;
    } catch {
      // the address announcements below still work; the id only labels the status
    }
    void this.backupIfDue();
    if (this.deps.localOnly) {
      this.address = this.local();
      this.set('online');
      for (const l of this.addressListeners) l(this.address, this.instanceId ?? '');
      return;
    }
    if (!this.tunnel || moved) {
      this.tunnel?.kill();
      this.tunnel = null;
      await this.launchTunnel();
    } else if (this.address) {
      // Same port, tunnel still up: back online, and the new server process needs the address again.
      this.set('online');
      void this.announce();
    }
  }

  private local(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  // --- tunnel -------------------------------------------------------------

  private async launchTunnel(): Promise<void> {
    if (!this.wanted || this.tunnel || this.port === null) return;
    if (!this.tunnelBinary) {
      try {
        this.tunnelBinary = await this.deps.ensureTunnelTool((fraction) => {
          this.progress = fraction;
          this.set('preparing', 'Setting up your public address (one-time download)…');
        });
        this.progress = undefined;
      } catch (err) {
        this.progress = undefined;
        this.set('reconnecting', (err as Error).message);
        this.deps.log.warn(`host: tunnel tool unavailable: ${(err as Error).message}`);
        this.later(this.tunnelDelay, () => void this.launchTunnel());
        this.tunnelDelay = Math.min(this.tunnelDelay * 2, RESTART_MAX_MS);
        return;
      }
    }
    if (!this.wanted || this.tunnel) return;
    if (this.state !== 'online') this.set('starting', 'Opening your public address…');
    const startedAt = Date.now();
    const tunnel = this.deps.spawnTunnel(this.tunnelBinary, this.local());
    this.tunnel = tunnel;
    tunnel.onLine((line) => {
      const found = QUICK_TUNNEL.exec(line)?.[0];
      if (found && this.tunnel === tunnel) void this.waitUntilRoutable(tunnel, found);
    });
    tunnel.onExit((code) => {
      if (this.tunnel !== tunnel) return;
      this.tunnel = null;
      this.address = null;
      if (!this.wanted) return;
      if (Date.now() - startedAt > STABLE_AFTER_MS) this.tunnelDelay = RESTART_MIN_MS;
      this.deps.log.warn(`host: tunnel stopped (code ${code}); reopening`);
      this.set('reconnecting', 'Reconnecting to the internet…');
      this.later(this.tunnelDelay, () => void this.launchTunnel());
      this.tunnelDelay = Math.min(this.tunnelDelay * 2, RESTART_MAX_MS);
    });
  }

  private restartTunnel(): void {
    const tunnel = this.tunnel;
    this.tunnel = null;
    this.address = null;
    tunnel?.kill();
    void this.launchTunnel();
  }

  /** A fresh quick tunnel takes a few seconds before it routes; only then is it worth announcing. */
  private async waitUntilRoutable(tunnel: TunnelHandle, url: string): Promise<void> {
    const deadline = Date.now() + ROUTE_TIMEOUT_MS;
    await this.sleep(FIRST_PROBE_MS);
    while (this.wanted && this.tunnel === tunnel && Date.now() < deadline) {
      if (await this.reachable(url)) {
        this.address = url;
        this.tunnelDelay = RESTART_MIN_MS;
        this.deps.log.info('host: public address is reachable');
        this.set('online');
        await this.announce();
        for (const l of this.addressListeners) l(url, this.instanceId ?? '');
        return;
      }
      await this.sleep(2_000);
    }
    if (this.wanted && this.tunnel === tunnel) {
      this.deps.log.warn('host: public address never became reachable; reopening');
      this.restartTunnel();
    }
  }

  /** Quick tunnels can stop routing without exiting: reopen after repeated failures. */
  private watchFailures = 0;
  private async watch(): Promise<void> {
    if (this.state !== 'online' || !this.address) return;
    if (await this.reachable(this.address)) {
      this.watchFailures = 0;
      return;
    }
    this.watchFailures += 1;
    if (this.watchFailures >= WATCH_FAILURES) {
      this.watchFailures = 0;
      this.deps.log.warn('host: public address stopped answering; reopening');
      this.set('reconnecting', 'Reconnecting to the internet…');
      this.restartTunnel();
    }
  }

  private async reachable(url: string): Promise<boolean> {
    try {
      const res = await this.deps.fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(10_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Tells the server its public address; the server signs it and publishes it for members. */
  private async announce(): Promise<void> {
    if (!this.address || this.port === null || !this.server || this.deps.localOnly) return;
    try {
      const res = await this.deps.fetch(`${this.local()}/v1/instance/address`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.hostToken}` },
        body: JSON.stringify({ url: this.address }),
      });
      const body = res.ok ? ((await res.json()) as { published?: boolean }) : null;
      this.deps.log.info(
        res.ok
          ? `host: address announced${body?.published ? '' : ' (relay unreachable; will retry)'}`
          : `host: server refused the address (HTTP ${res.status})`,
      );
    } catch (err) {
      this.deps.log.warn(`host: could not announce the address: ${(err as Error).message}`);
    }
  }

  // --- backups ------------------------------------------------------------

  private async backupIfDue(): Promise<void> {
    const last = this.lastBackupAt ? Date.parse(this.lastBackupAt) : 0;
    if (this.now().getTime() - last < BACKUP_EVERY_MS) return;
    try {
      await this.backupNow();
    } catch (err) {
      this.deps.log.warn(`host: backup failed: ${(err as Error).message}`);
    }
  }

  private backups(): string[] {
    try {
      return readdirSync(this.deps.backupsDir)
        .filter((f) => /^river-.+\.sqlite$/.test(f))
        .sort();
    } catch {
      return [];
    }
  }

  private newestBackup(): string | null {
    const newest = this.backups().at(-1);
    if (!newest) return null;
    // river-2026-10-10T12-00-00-000Z.sqlite → 2026-10-10T12:00:00.000Z
    const m = /^river-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sqlite$/.exec(newest);
    return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
  }

  private pruneBackups(): void {
    const all = this.backups();
    for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) {
      rmSync(join(this.deps.backupsDir, old), { force: true });
    }
  }

  // --- plumbing -----------------------------------------------------------

  private set(state: HostRuntime['state'], message?: string): void {
    this.state = state;
    this.message = message;
    this.emit();
  }

  private emit(): void {
    const s = this.status();
    for (const l of this.listeners) l(s);
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private every(ms: number, fn: () => void): void {
    this.intervals.add(setInterval(fn, ms));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.later(ms, resolve));
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
