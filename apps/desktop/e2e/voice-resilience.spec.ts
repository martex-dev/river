import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchRiver } from './launch.ts';

// River hosted on a home PC reaches members through a free tunnel whose single connection is
// dropped and re-made every one to four minutes — every member's live connection is cut at once.
// This puts a proxy in front of a real server that does the same (much more often), with several
// people in a voice channel, and checks nobody is thrown out of the call and sound keeps flowing.

const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
const CUT_EVERY_MS = Number(process.env.RIVER_CHAOS_CUT_MS ?? 15_000);
const OBSERVE_MS = Number(process.env.RIVER_CHAOS_OBSERVE_MS ?? 90_000);
const ALL = ['Ana', 'Ben', 'Cleo', 'Dan', 'Eve', 'Finn', 'Gus', 'Hana', 'Ivo', 'Jade'];
const PEOPLE = ALL.slice(0, Number(process.env.RIVER_CHAOS_PEOPLE ?? 4));

// Several River windows at once are too much for shared CI machines (the windows time out
// before the call even starts), so the stress test runs locally, or in CI with RIVER_CHAOS=1.
test.skip(!!process.env.CI && !process.env.RIVER_CHAOS, 'stress test: run locally or set RIVER_CHAOS=1');

let server: ChildProcess;
let proxy: Server;
let url = '';
let cuts = 0;
const live = new Set<Socket>();
const dirs: string[] = [];
const apps: ElectronApplication[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
    s.on('error', fail);
  });
}

test.beforeAll(async () => {
  const serverPort = await freePort();
  server = spawn(process.execPath, ['src/main.ts'], {
    cwd: resolve(__dirname, '../../server'),
    env: {
      ...process.env,
      RIVER_PORT: String(serverPort),
      RIVER_DATABASE_URL: `sqlite:${join(tmp('river-chaos-srv-'), 'r.sqlite')}`,
      RIVER_LOG_LEVEL: 'warn',
      RIVER_RATE_LIMIT_PER_MINUTE: '100000',
    },
    stdio: 'ignore',
  });
  // The "tunnel": a plain TCP pass-through that drops every connection on a timer.
  proxy = createServer((client) => {
    const upstream = connect(serverPort, '127.0.0.1');
    live.add(client);
    live.add(upstream);
    client.pipe(upstream).pipe(client);
    const end = (): void => {
      client.destroy();
      upstream.destroy();
      live.delete(client);
      live.delete(upstream);
    };
    client.on('error', end).on('close', end);
    upstream.on('error', end).on('close', end);
  });
  const proxyPort = await freePort();
  await new Promise<void>((r) => proxy.listen(proxyPort, '127.0.0.1', r));
  url = `http://127.0.0.1:${proxyPort}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${serverPort}/v1/health`)).ok) break;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
});

test.afterAll(async () => {
  for (const a of apps) await a.close().catch(() => undefined);
  proxy?.close();
  for (const s of live) s.destroy();
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function open(name: string): Promise<Page> {
  const { app, page } = await launchRiver(tmp('river-chaos-ui-'), { name, args: FAKE_MEDIA });
  apps.push(app);
  return page;
}

/** What one person sees of the call right now. */
async function sample(
  p: Page,
): Promise<{ inCall: boolean; tiles: string[]; problems: string[]; liveAudio: number }> {
  return p.evaluate(() => {
    const panel = document.querySelector('.voice-panel');
    const tiles = [...document.querySelectorAll('.tile')].map((t) => (t.textContent ?? '').trim());
    // Remote voices actually attached and live (direct or relayed).
    const liveAudio = [...document.querySelectorAll<HTMLAudioElement>('.call-audio audio')].filter((a) => {
      const stream = a.srcObject as MediaStream | null;
      return !!stream && stream.getAudioTracks().some((t) => t.readyState === 'live') && !a.paused;
    }).length;
    return {
      inCall: Boolean(panel && /Voice connected|Reconnecting/i.test(panel.textContent ?? '')),
      tiles,
      problems: tiles.filter((t) => /connecting|reconnecting|lost/i.test(t)),
      liveAudio,
    };
  });
}

for (const mode of ['direct', 'relayed'] as const) {
  test(`a ${PEOPLE.length}-person voice call survives the connection being cut every ${CUT_EVERY_MS / 1000}s (${mode})`, async () => {
    test.setTimeout(OBSERVE_MS + 240_000);
    const pages: Page[] = [];
    for (const name of PEOPLE) pages.push(await open(`${name}-${mode}`));
    const [host, ...guests] = pages as [Page, ...Page[]];

    await host.getByRole('button', { name: 'Settings', exact: true }).click();
    await host.getByRole('button', { name: 'Account', exact: true }).click();
    await host.getByPlaceholder('https://river.example.org').fill(url);
    await host.getByRole('button', { name: 'Save', exact: true }).click();
    await host.getByRole('button', { name: 'Create account' }).click();
    await expect(host.locator('.account-card .chip')).toHaveText('Connected');
    await host.getByRole('button', { name: 'Communities', exact: true }).click();
    await host.getByPlaceholder('e.g. The Crew').fill(`Chaos ${mode}`);
    await host.getByRole('button', { name: 'Create community' }).click();
    await host.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = (await host.locator('.invite-box__link').innerText()).trim();
    await host.getByRole('button', { name: 'Close', exact: true }).click();
    for (const g of guests) {
      await g.getByRole('button', { name: 'Communities', exact: true }).click();
      await g.getByLabel('Invite link').fill(invite);
      await g.getByRole('button', { name: 'Join community' }).click();
      await expect(g.locator('.community__title strong')).toHaveText(`Chaos ${mode}`);
    }

    for (const p of pages) {
      if (mode === 'relayed') {
        await p.evaluate(() => {
          (globalThis as { __riverForceRelay?: boolean }).__riverForceRelay = true;
        });
      }
      await p.locator('.channel', { hasText: 'Lounge' }).click();
    }
    // Everyone sees everyone else, connected.
    for (const p of pages) {
      await expect
        .poll(async () => (await sample(p)).tiles.length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(PEOPLE.length - 1);
      await expect.poll(async () => (await sample(p)).problems.length, { timeout: 60_000 }).toBe(0);
    }

    // Now cut every connection on a timer, as the tunnel does, and watch.
    const timer = setInterval(() => {
      cuts += 1;
      for (const s of live) s.destroy();
    }, CUT_EVERY_MS);
    const start = Date.now();
    const report: string[] = [];
    let worstMissing = 0;
    let outOfCall = 0;
    let problemSamples = 0;
    let silentSamples = 0;
    let samples = 0;
    try {
      while (Date.now() - start < OBSERVE_MS) {
        await new Promise((r) => setTimeout(r, 3000));
        for (const [i, p] of pages.entries()) {
          const s = await sample(p);
          samples += 1;
          const missing = Math.max(0, PEOPLE.length - 1 - s.tiles.length);
          worstMissing = Math.max(worstMissing, missing);
          if (!s.inCall) outOfCall += 1;
          if (s.problems.length) problemSamples += 1;
          if (s.liveAudio < PEOPLE.length - 1) silentSamples += 1;
          if (!s.inCall || missing || s.problems.length || s.liveAudio < PEOPLE.length - 1) {
            report.push(
              `${Math.round((Date.now() - start) / 1000)}s ${PEOPLE[i]}: inCall=${s.inCall} tiles=${s.tiles.length} audio=${s.liveAudio} ${s.problems.join(' | ')}`,
            );
          }
        }
      }
    } finally {
      clearInterval(timer);
    }
    console.warn(
      `[${mode}] people=${PEOPLE.length} cuts=${cuts} samples=${samples} outOfCall=${outOfCall} problemSamples=${problemSamples} silentSamples=${silentSamples} worstMissing=${worstMissing}\n` +
        report.slice(0, 60).join('\n'),
    );
    // Nobody may be thrown out of the call by a dropped connection.
    expect(outOfCall).toBe(0);
    expect(worstMissing).toBe(0);
    // Brief "reconnecting" moments are fine; a call that is mostly broken is not.
    expect(problemSamples / samples).toBeLessThan(0.1);
    // Everyone keeps hearing everyone.
    expect(silentSamples / samples).toBeLessThan(0.05);
  });
}
