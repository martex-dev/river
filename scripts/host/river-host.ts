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
  try {
    appendFileSync(join(logDir, 'host.log'), text);
  } catch {
    // logging must never stop hosting
  }
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

/** Runs a child process forever: restarts it with growing pauses if it exits. */
function keepRunning(name: string, start: () => ChildProcess, onLine?: (line: string) => void): void {
  let delay = 2000;
  const launch = (): void => {
    if (stopping) return;
    const child = start();
    children.add(child);
    const startedAt = Date.now();
    const read = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        appendFileSync(join(logDir, `${name}.log`), `${line}\n`);
        onLine?.(line);
      }
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.on('exit', (code) => {
      children.delete(child);
      if (stopping) return;
      // A process that ran for a while gets a fresh, short pause next time.
      if (Date.now() - startedAt > 60_000) delay = 2000;
      log(`${name} stopped (code ${code}); restarting in ${Math.round(delay / 1000)}s`);
      setTimeout(launch, delay);
      delay = Math.min(delay * 2, 60_000);
    });
    log(`${name} started (pid ${child.pid})`);
  };
  launch();
}

async function waitForServer(): Promise<void> {
  for (;;) {
    try {
      if ((await fetch(`${local}/v1/health`)).ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Tells the server its public address; the server signs and publishes it for members. */
async function announce(): Promise<void> {
  if (!publicUrl) return;
  try {
    const res = await fetch(`${local}/v1/instance/address`, {
      method: 'POST',
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

keepRunning('server', () =>
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
        // Give the tunnel a moment to route before telling anyone about it.
        setTimeout(() => void announce(), 5000);
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
