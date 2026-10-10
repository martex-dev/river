import { execFile, spawn } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { net, powerSaveBlocker, shell, utilityProcess } from 'electron';
import type { HostStatus } from '../../shared/ipc.ts';
import type { Logger } from '../logger.ts';
import type { SettingsStore } from '../settings-store.ts';
import { ensureCloudflared } from './cloudflared.ts';
import { HostManager, type ServerHandle, type TunnelHandle } from './host-manager.ts';
import {
  adoptLegacyData,
  findLegacyHost,
  legacyRunning,
  retireLegacyHost,
  type RetireDeps,
} from './legacy-host.ts';
import type { FromServerProcess } from './server-messages.ts';

export interface HostingDeps {
  userData: string;
  homeDir: string;
  settings: SettingsStore;
  log: Logger;
  /** The server identity your own account is on (pinned when it first connects). */
  pinnedId(): string | null;
  /** Your own server has a new address: follow it at once instead of waiting for the relay. */
  followOwnServer(url: string): void;
  /** Development builds only (end-to-end tests): host without a public address. */
  localOnly?: boolean;
}

const PREFERRED_PORT = 8790;
const BEACON_RELAY = 'https://ntfy.sh';
const LOG_LIMIT = 5 * 1024 * 1024;

/**
 * Hosting communities on this PC, as part of River: the HostManager plus the
 * Electron pieces it runs on (utility process, cloudflared, keep-awake), the
 * on/off setting, and taking over from the separate River Host of 1.0.8.
 */
export class Hosting {
  readonly manager: HostManager;
  private readonly deps: HostingDeps;
  private readonly root: string;
  private readonly dataDir: string;
  private legacy: HostStatus['legacy'] = 'none';
  private blocker: number | null = null;
  private readonly listeners = new Set<(s: HostStatus) => void>();

  constructor(deps: HostingDeps) {
    this.deps = deps;
    this.root = join(deps.userData, 'host');
    this.dataDir = join(this.root, 'data');
    const logs = join(this.root, 'logs');
    const bin = join(this.root, 'bin');
    this.manager = new HostManager({
      dataDir: this.dataDir,
      backupsDir: join(this.root, 'backups'),
      preferredPort: PREFERRED_PORT,
      beaconRelay: BEACON_RELAY,
      spawnServer: (env) => spawnServer(env, join(logs, 'server.log')),
      ensureTunnelTool: (onProgress) =>
        ensureCloudflared({
          dir: bin,
          platform: process.platform,
          arch: process.arch,
          env: process.env,
          // Chromium's stack, so a system proxy is honoured for the one-time download.
          fetch: ((input: string, init?: RequestInit) => net.fetch(input, init)) as typeof fetch,
          onProgress,
        }),
      spawnTunnel: (binary, localUrl) => spawnTunnel(binary, localUrl, join(logs, 'tunnel.log'), this.root),
      // Node's own fetch: requests to the local server must not pick up proxy settings.
      fetch: globalThis.fetch,
      log: deps.log,
      ...(deps.localOnly ? { localOnly: true } : {}),
    });
    this.manager.onAddress((url, instanceId) => {
      if (instanceId && instanceId === deps.pinnedId()) deps.followOwnServer(url);
    });
    this.manager.onStatus(() => this.changed());
    deps.settings.onChange((s) => {
      if (s.hosting.enabled) this.manager.start();
      else void this.manager.stop();
      this.changed();
    });
  }

  /** At app start: resume hosting if it is on, and look for an older River Host. */
  async init(): Promise<void> {
    await this.refreshLegacy();
    if (this.deps.settings.get().hosting.enabled) {
      killOrphanTunnel(this.root, this.deps.log);
      this.manager.start();
    }
    this.changed();
  }

  status(): HostStatus {
    const runtime = this.manager.status();
    return {
      ...runtime,
      enabled: this.deps.settings.get().hosting.enabled,
      yours: runtime.instanceId !== undefined && runtime.instanceId === this.deps.pinnedId(),
      legacy: this.legacy,
    };
  }

  onStatus(listener: (s: HostStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Turns hosting on. An older River Host on this PC is stopped first and its
   * community data comes along, so members keep their community and history.
   * Hosting needs River running, so River also starts with the PC from now on.
   */
  async enable(): Promise<HostStatus> {
    const legacy = findLegacyHost(this.deps.homeDir);
    if (legacy) {
      await retireLegacyHost(legacy, retireDeps());
      if (adoptLegacyData(legacy, this.dataDir)) {
        this.deps.log.info('host: community data moved over from River Host');
      }
      await this.refreshLegacy();
    }
    killOrphanTunnel(this.root, this.deps.log);
    this.deps.settings.update({
      hosting: { enabled: true },
      system: { startAtLogin: true, closeToTray: true },
    });
    return this.status();
  }

  async disable(): Promise<HostStatus> {
    this.deps.settings.update({ hosting: { enabled: false } });
    await this.manager.stop();
    return this.status();
  }

  async backupNow(): Promise<HostStatus> {
    await this.manager.backupNow();
    return this.status();
  }

  async openFolder(): Promise<void> {
    mkdirSync(this.root, { recursive: true });
    await shell.openPath(this.root);
  }

  /** Before River quits: stop the server cleanly (the database is safe either way). */
  stop(): Promise<void> {
    return this.manager.stop();
  }

  private async refreshLegacy(): Promise<void> {
    const legacy = findLegacyHost(this.deps.homeDir);
    if (!legacy) this.legacy = 'none';
    else this.legacy = (await legacyRunning(legacy, commandLine)) ? 'running' : 'installed';
  }

  private changed(): void {
    const s = this.status();
    const awake = s.enabled && this.deps.settings.get().hosting.keepAwake && s.state !== 'off';
    if (awake && this.blocker === null) {
      // Stops the PC from sleeping on its own; the screen may still turn off.
      this.blocker = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!awake && this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = null;
    }
    for (const l of this.listeners) l(s);
  }
}

/** Environment for child processes: the user's, minus RIVER_* settings that are not ours to pass on. */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && !e[0].startsWith('RIVER_'),
    ),
  );
  // Windows networking needs SystemRoot and friends, so the rest of the environment stays.
  return { ...base, ...extra };
}

function spawnServer(env: Record<string, string>, logFile: string): ServerHandle {
  const child = utilityProcess.fork(join(__dirname, 'host-server.js'), [], {
    serviceName: 'River community server',
    stdio: 'pipe',
    env: childEnv(env),
  });
  const write = writer(logFile);
  child.stdout?.on('data', write);
  child.stderr?.on('data', write);
  return {
    onMessage: (listener) => child.on('message', (m: FromServerProcess) => listener(m)),
    onExit: (listener) => child.once('exit', listener),
    postMessage: (message) => child.postMessage(message),
    kill: () => void child.kill(),
  };
}

function spawnTunnel(binary: string, localUrl: string, logFile: string, root: string): TunnelHandle {
  const child = spawn(binary, ['tunnel', '--url', localUrl, '--protocol', 'http2', '--no-autoupdate'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv({}),
  });
  // If River is ever killed outright, the next start can tidy up this process.
  if (child.pid) writeFileSync(join(root, 'tunnel.pid'), String(child.pid));
  const write = writer(logFile);
  const lineListeners: Array<(line: string) => void> = [];
  const read = (chunk: Buffer): void => {
    write(chunk);
    for (const line of chunk.toString().split(/\r?\n/))
      if (line.trim()) for (const l of lineListeners) l(line);
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  let exited = false;
  const exitListeners: Array<(code: number | null) => void> = [];
  const exit = (code: number | null): void => {
    if (exited) return;
    exited = true;
    for (const l of exitListeners) l(code);
  };
  child.on('exit', exit);
  child.on('error', () => exit(null));
  return {
    onLine: (l) => lineListeners.push(l),
    onExit: (l) => exitListeners.push(l),
    kill: () => void child.kill(),
  };
}

/** A tunnel left over from a River that did not get to shut down; only ever our own cloudflared. */
function killOrphanTunnel(root: string, log: Logger): void {
  const pidFile = join(root, 'tunnel.pid');
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile, 'utf8'));
  } catch {
    return;
  }
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0) return;
  void commandLine(pid).then((cmd) => {
    if (cmd?.includes('cloudflared') && cmd.includes('--url http://127.0.0.1:')) {
      try {
        process.kill(pid);
        log.info('host: closed a tunnel left over from an earlier run');
      } catch {
        // already gone
      }
    }
  });
}

/** Appends process output to a log file, starting a fresh file past 5 MB. */
function writer(file: string): (chunk: Buffer) => void {
  mkdirSync(join(file, '..'), { recursive: true });
  return (chunk) => {
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT) renameSync(file, `${file}.1`);
      appendFileSync(file, chunk);
    } catch {
      // logging must never stop hosting
    }
  };
}

/** The full command line of a process, or null if it is not running. */
function commandLine(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve(null);
  if (process.platform === 'linux') {
    try {
      return Promise.resolve(readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() || null);
    } catch {
      return Promise.resolve(null);
    }
  }
  const [cmd, args] =
    process.platform === 'win32'
      ? [
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ],
        ]
      : ['ps', ['-o', 'command=', '-p', String(pid)]];
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      const text = String(stdout).trim();
      resolve(err || !text ? null : text);
    });
  });
}

function retireDeps(): RetireDeps {
  return {
    platform: process.platform,
    run: (command, args) =>
      new Promise((resolve) => {
        execFile(command, args, { windowsHide: true, timeout: 30_000 }, () => resolve());
      }),
    commandLine,
    kill: (pid) => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
