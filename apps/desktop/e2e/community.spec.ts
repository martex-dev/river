import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchRiver } from './launch.ts';

// Two real River apps and a real server: create, invite, join, chat, call.
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
let server: ChildProcess;
let url = '';
const dirs: string[] = [];
const apps: ElectronApplication[] = [];

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

const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

test.beforeAll(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/main.ts'], {
    cwd: resolve(__dirname, '../../server'),
    env: {
      ...process.env,
      RIVER_PORT: String(port),
      RIVER_DATABASE_URL: `sqlite:${join(tmp('river-srv-'), 'r.sqlite')}`,
      RIVER_LOG_LEVEL: 'warn',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/v1/health`)).ok) break;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
});

test.afterAll(async () => {
  for (const a of apps) await a.close().catch(() => undefined);
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function open(name: string): Promise<Page> {
  const { app, page } = await launchRiver(tmp('river-ui-'), { name, args: FAKE_MEDIA });
  apps.push(app);
  return page;
}

test('create, invite, join, chat and call between two members', async () => {
  test.setTimeout(120_000);
  // Alice creates an account and a community.
  const alice = await open('Alice');
  await alice.getByRole('button', { name: 'Settings', exact: true }).click();
  await alice.getByRole('button', { name: 'Server', exact: true }).click();
  await alice.getByPlaceholder('https://river.example.org').fill(url);
  await alice.getByRole('button', { name: 'Save', exact: true }).click();
  await alice.getByRole('button', { name: 'Create account' }).click();
  await expect(alice.locator('.account-card .chip')).toHaveText('Connected');
  await alice.getByRole('button', { name: 'Communities', exact: true }).click();
  await alice.getByPlaceholder('e.g. The Crew').fill('The Crew');
  await alice.getByRole('button', { name: 'Create community' }).click();
  await expect(alice.locator('.community__title strong')).toHaveText('The Crew');
  await alice.getByRole('button', { name: 'Invite people' }).click();
  const invite = (await alice.locator('.invite-box__link').innerText()).trim();
  expect(invite).toMatch(/\/join#c=.+&k=.+/);
  // "Copy link" really puts the link on the clipboard.
  await alice.getByRole('button', { name: 'Copy link' }).click();
  await expect(alice.getByRole('button', { name: 'Copied ✓' })).toBeVisible();
  expect(await apps[0]!.evaluate(({ clipboard }) => clipboard.readText())).toBe(invite);

  // Bob joins with nothing but the link (his account is created automatically).
  const bob = await open('Bob');
  await bob.getByRole('button', { name: 'Communities', exact: true }).click();
  await bob.getByPlaceholder('https://…/join#c=…&k=…').fill(invite);
  await bob.getByRole('button', { name: 'Join community' }).click();
  await expect(bob.locator('.community__title strong')).toHaveText('The Crew');
  await expect(bob.locator('.community__members')).toContainText('Alice');
  await expect(alice.locator('.community__members')).toContainText('Bob');

  // Encrypted chat, live in both directions.
  await bob.getByPlaceholder('Message #general').fill('hello from bob');
  await bob.keyboard.press('Enter');
  await expect(alice.locator('.chat__messages')).toContainText('hello from bob');
  await alice.getByPlaceholder('Message #general').fill('welcome, bob');
  await alice.keyboard.press('Enter');
  await expect(bob.locator('.chat__messages')).toContainText('welcome, bob');
  if (process.env.RIVER_SCREENSHOTS) await alice.screenshot({ path: 'test-results/community-chat.png' });

  // Voice: both join the Lounge and connect directly.
  for (const p of [alice, bob]) {
    await p.locator('.channel', { hasText: 'Lounge' }).click();
    await p.getByRole('button', { name: 'Join voice' }).click();
  }
  // Starting the microphone can take a few seconds the first time.
  await expect(alice.locator('.tile', { hasText: 'Bob' })).toBeVisible({ timeout: 30_000 });
  await expect(alice.locator('.tile', { hasText: 'Bob' })).not.toContainText('connecting', {
    timeout: 30_000,
  });
  await expect(bob.locator('.tile', { hasText: 'Alice' })).not.toContainText('connecting', {
    timeout: 30_000,
  });

  // Remote audio is playing (not just attached) on both sides.
  for (const p of [alice, bob]) {
    await expect
      .poll(
        () =>
          p
            .locator('.tile audio')
            .first()
            .evaluate((a: HTMLAudioElement) => !a.paused && a.readyState > 0),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
  }

  // Camera on at Alice → Bob receives video.
  await alice.getByRole('button', { name: 'Camera on' }).click();
  await expect(bob.locator('.tile', { hasText: 'Alice' }).locator('video')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        bob
          .locator('.tile', { hasText: 'Alice' })
          .locator('video')
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      {
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
  if (process.env.RIVER_SCREENSHOTS) await bob.screenshot({ path: 'test-results/community-call.png' });

  // Screen sharing through River's own picker (headless CI machines may have nothing to capture).
  await alice.getByRole('button', { name: 'Share screen' }).click();
  await expect(alice.locator('.picker')).toBeVisible();
  if ((await alice.locator('.picker__item').count()) === 0) {
    await expect(alice.locator('.picker')).toContainText('could not find any screen');
    await alice.locator('.picker').getByRole('button', { name: 'Cancel' }).click();
  } else {
    await alice.locator('.picker__item').first().click();
    await expect(alice.getByRole('button', { name: 'Stop sharing' })).toBeVisible({ timeout: 15_000 });
    await expect(bob.locator('.tile--screen video')).toBeVisible({ timeout: 20_000 });
    // Frames are actually decoded on Bob's side (not just an empty element).
    await expect
      .poll(() => bob.locator('.tile--screen video').evaluate((v: HTMLVideoElement) => v.videoWidth), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    if (process.env.RIVER_SCREENSHOTS) await bob.screenshot({ path: 'test-results/community-screen.png' });
    await alice.getByRole('button', { name: 'Stop sharing' }).click();
  }

  await bob.getByRole('button', { name: 'Leave' }).click();
  await expect(alice.locator('.tile', { hasText: 'Bob' })).toHaveCount(0, { timeout: 15_000 });
});
