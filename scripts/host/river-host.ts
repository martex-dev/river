/**
 * River Host: keeps a River server and its public tunnel running on this PC.
 *
 * Started at sign-in (see install-host.ps1). It runs the server from a pinned
 * release copy with its data in a permanent folder, opens a Cloudflare quick
 * tunnel, tells the server its new public address (the server then publishes
 * a signed "this is where I am now" note so members' apps can follow), and
 * restarts anything that stops. Only Node built-ins: it runs without a build.
 *
 *   node river-host.ts [path/to/host.json]
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface HostConfig {
  /** The release copy of River the server runs from (a git worktree at a release tag). */
  appDir: string;
  /** Where the database and attachments live; never inside appDir. */
  dataDir: string;
  port: number;
  cloudflared: string;
  /**
   * Public relay for signed "this is my new address" notes, so members' apps can follow the
   * server after a restart; empty string turns it off.
   */
  beaconRelay: string;
  /** Extra server settings, e.g. RIVER_RATE_LIMIT_PER_MINUTE. */
  env: Record<string, string>;
}

const configPath = resolve(process.argv[2] ?? join(dirname(process.argv[1] ?? '.'), 'host.json'));
const home = dirname(configPath);
const defaults: HostConfig = {
  appDir: join(home, 'app'),
  dataDir: join(home, 'data'),
  port: 8790,
  cloudflared: 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  beaconRelay: 'https://ntfy.sh',
  env: {},
};
/** Windows PowerShell writes a byte-order mark; JSON.parse does not accept one. */
const withoutBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const config: HostConfig = existsSync(configPath)
  ? {
      ...defaults,
      ...(JSON.parse(withoutBom(readFileSync(configPath, 'utf8'))) as Partial<HostConfig>),
    }
  : defaults;

const logDir = join(home, 'logs');
mkdirSync(logDir, { recursive: true });
mkdirSync(config.dataDir, { recursive: true });
const log = (line: string): void => {
  const text = `${new Date().toISOString()} ${line}\n`;
  process.stdout.write(text);
  append('host.log', text);
};

const local = `http://127.0.0.1:${config.port}`;
/** Lets only this process tell the server its address; new every start, never written down. */
const hostToken = randomBytes(32).toString('hex');
let publicUrl: string | null = null;
let stopping = false;
const children = new Set<ChildProcess>();

/** Writes what is running where, for River's Host panel and for people. */
function writeStatus(extra: Record<string, unknown> = {}): void {
  writeFileSync(
    join(home, 'status.json'),
    JSON.stringify(
      { pid: process.pid, local, publicUrl, updatedAt: new Date().toISOString(), ...extra },
      null,
      2,
    ),
  );
}

/** Appends to a log file; a full disk or a locked file must never stop hosting. */
function append(file: string, text: string): void {
  try {
    appendFileSync(join(logDir, file), text);
  } catch {
    // logging must never stop hosting
  }
}

/**
 * Runs a child process forever: restarts it with growing pauses if it exits. A program that
 * cannot be started at all (cloudflared not installed at that path) is retried the same way and
 * logged; before, its 'error' event went unhandled and took River Host down with it.
 */
function keepRunning(
  name: string,
  start: () => ChildProcess,
  onLine?: (line: string) => void,
  onStarted?: () => void,
): void {
  let delay = 2000;
  const launch = (): void => {
    if (stopping) return;
    const child = start();
    children.add(child);
    const startedAt = Date.now();
    let ended = false;
    const restart = (why: string): void => {
      if (ended) return;
      ended = true;
      children.delete(child);
      if (stopping) return;
      // A process that ran for a while gets a fresh, short pause next time.
      if (Date.now() - startedAt > 60_000) delay = 2000;
      log(`${name} ${why}; restarting in ${Math.round(delay / 1000)}s`);
      setTimeout(launch, delay);
      delay = Math.min(delay * 2, 60_000);
    };
    const read = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        append(`${name}.log`, `${line}\n`);
        onLine?.(line);
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.on('error', (err) => restart(`could not start (${err.message})`));
    child.on('exit', (code) => restart(`stopped (code ${code})`));
    if (child.pid !== undefined) {
      log(`${name} started (pid ${child.pid})`);
      onStarted?.();
    }
  };
  launch();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Whether `base` answers River's health check (a hung server or tunnel counts as no). */
async function healthy(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(10_000) })).ok;
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<void> {
  while (!(await healthy(local))) await sleep(1000);
}

/** Tells the server its public address; the server signs and publishes it for members. */
async function announce(): Promise<void> {
  if (!publicUrl) return;
  try {
    const res = await fetch(`${local}/v1/instance/address`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({ url: publicUrl }),
    });
    const body = res.ok ? ((await res.json()) as { published?: boolean }) : null;
    log(
      res.ok
        ? `announced ${publicUrl}${body?.published ? ' (members will follow automatically)' : ' (relay unreachable; will retry)'}`
        : `server did not take the address (HTTP ${res.status})`,
    );
  } catch (err) {
    log(`could not announce the address: ${(err as Error).message}`);
  }
}

/**
 * A new quick-tunnel name takes a few seconds to resolve, and asking too early gets a "no such
 * name" that members' computers then remember for a minute: announce it once it answers.
 */
async function announceWhenRoutable(url: string): Promise<void> {
  await sleep(8000);
  const deadline = Date.now() + 90_000;
  while (publicUrl === url && Date.now() < deadline) {
    if (await healthy(url)) {
      if (publicUrl === url) await announce();
      return;
    }
    await sleep(2000);
  }
  if (publicUrl === url) {
    log(`public address ${url} did not answer yet; announcing it anyway`);
    await announce();
  }
}

keepRunning(
  'server',
  () =>
    spawn(process.execPath, ['src/main.ts'], {
      cwd: join(config.appDir, 'apps', 'server'),
      env: {
        ...process.env,
        RIVER_PORT: String(config.port),
        RIVER_TRUST_PROXY: 'true',
        RIVER_DATABASE_URL: `sqlite:${join(config.dataDir, 'river.sqlite')}`,
        RIVER_ATTACHMENT_DIR: join(config.dataDir, 'attachments'),
        RIVER_HOST_TOKEN: hostToken,
        ...(config.beaconRelay ? { RIVER_BEACON_RELAY: config.beaconRelay } : {}),
        ...config.env,
      },
      windowsHide: true,
    }),
  undefined,
  // A restarted server has forgotten its public address: tell it again once it answers.
  () => void waitForServer().then(() => announce()),
);

void waitForServer().then(() => {
  log(`server answering on ${local}`);
  writeStatus();
  keepRunning(
    'tunnel',
    () =>
      spawn(config.cloudflared, ['tunnel', '--url', local, '--protocol', 'http2', '--no-autoupdate'], {
        windowsHide: true,
      }),
    (line) => {
      const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line)?.[0];
      if (found && found !== publicUrl) {
        publicUrl = found;
        log(`public address: ${publicUrl}`);
        writeStatus();
        void announceWhenRoutable(found);
      }
    },
  );
  // Notes on the relay expire after a while: repeat the announcement regularly.
  setInterval(() => void announce(), 4 * 60 * 60 * 1000);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    log('stopping');
    for (const child of children) child.kill();
    process.exit(0);
  });
}
log(`River Host starting (config ${configPath})`);
