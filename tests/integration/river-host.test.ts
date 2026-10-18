import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * River Host (scripts/host/river-host.ts), the separate host from 1.0.8 that some PCs still run,
 * started for real with a stand-in server. It must keep running when a program it starts cannot.
 */

const SCRIPT = resolve(import.meta.dirname, '../../scripts/host/river-host.ts');

/** A stand-in for apps/server/src/main.ts: answers the health check, takes the address. */
const FAKE_SERVER = `
import { createServer } from 'node:http';
const port = Number(process.env.RIVER_PORT);
createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/health') return res.end('{"status":"ok"}');
  if (req.url === '/v1/instance/address') return res.end('{"published":false}');
  res.statusCode = 404;
  res.end('{}');
}).listen(port, '127.0.0.1');
// Ends with River Host, also when the test stops it outright.
setInterval(() => {
  try {
    process.kill(process.ppid, 0);
  } catch {
    process.exit(0);
  }
}, 300);
`;

const freePort = (): Promise<number> =>
  new Promise((done) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => done(port));
    });
  });

let dir: string;
let host: ChildProcess | null = null;

afterEach(async () => {
  const running = host;
  host = null;
  if (running && running.exitCode === null) {
    const exited = new Promise((done) => running.once('exit', done));
    running.kill();
    await exited;
  }
  // The stand-in server notices within a moment and lets go of its folder (Windows keeps it locked).
  // Best effort: a folder Windows still holds is left in the temp directory, not a failed test.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch {
    // left for the system's temp cleanup
  }
});

describe('River Host', () => {
  it('keeps hosting when the tunnel program is missing, and keeps trying it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'river-host-script-'));
    const app = join(dir, 'app');
    mkdirSync(join(app, 'apps', 'server', 'src'), { recursive: true });
    writeFileSync(join(app, 'apps', 'server', 'src', 'main.ts'), FAKE_SERVER);
    const configPath = join(dir, 'host.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        appDir: app,
        dataDir: join(dir, 'data'),
        port: await freePort(),
        cloudflared: join(dir, 'not-installed', 'cloudflared.exe'),
        beaconRelay: '',
      }),
    );
    let output = '';
    host = spawn(process.execPath, [SCRIPT, configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    host.stdout!.on('data', (c: Buffer) => (output += c.toString()));
    host.stderr!.on('data', (c: Buffer) => (output += c.toString()));
    const log = (): string =>
      existsSync(join(dir, 'logs', 'host.log')) ? readFileSync(join(dir, 'logs', 'host.log'), 'utf8') : '';
    await vi.waitFor(() => expect(log()).toMatch(/tunnel could not start/), {
      timeout: 20_000,
      interval: 200,
    });
    // Still running, and it tries again rather than giving up.
    expect(host.exitCode, output).toBeNull();
    await vi.waitFor(() => expect(log().match(/tunnel could not start/g)?.length).toBeGreaterThanOrEqual(2), {
      timeout: 20_000,
      interval: 200,
    });
    expect(host.exitCode, output).toBeNull();
  }, 60_000);
});
