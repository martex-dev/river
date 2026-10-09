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
  await alice.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await apps[0]!.evaluate(({ clipboard }) => clipboard.readText())).toBe(invite);

  // Bob joins with nothing but the link (his account is created automatically).
  const bob = await open('Bob');
  await bob.getByRole('button', { name: 'Communities', exact: true }).click();
  await bob.getByPlaceholder('https://…/join#c=…&k=…').fill(invite);
  await bob.getByRole('button', { name: 'Join community' }).click();
  await expect(bob.locator('.community__title strong')).toHaveText('The Crew');
  // On small screens (e.g. macOS CI) the member list is an overlay that starts closed.
  const openMembers = async (p: typeof alice): Promise<void> => {
    if ((await p.locator('.community__members').count()) === 0) {
      await p.getByRole('button', { name: 'Member list' }).click();
    }
  };
  await openMembers(bob);
  await openMembers(alice);
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

  // Voice: clicking the Lounge joins it, and both connect directly.
  for (const p of [alice, bob]) {
    await p.locator('.channel', { hasText: 'Lounge' }).click();
  }
  await expect(alice.locator('.voice-panel')).toContainText('Voice connected');
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
            .locator('.call-audio audio')
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

  // Reactions travel encrypted and show up for the other member.
  for (const p of [alice, bob]) await p.locator('.channel', { hasText: 'general' }).click();
  const bobsMessage = (p: typeof alice) => p.locator('.msg', { hasText: 'hello from bob' });
  await bobsMessage(alice).hover();
  await bobsMessage(alice).getByTitle('React 👍').click();
  await expect(bobsMessage(bob).locator('.reaction__count')).toHaveText('1', { timeout: 15_000 });

  // Encrypted image attachment: Alice sends a picture, Bob's app decrypts and shows it.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  await alice
    .locator('.chat__composer input[type=file]')
    .setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });
  await expect(alice.locator('.pending-file')).toContainText('pixel.png');
  await alice.getByRole('button', { name: 'Send', exact: true }).click();
  const bobImage = bob.locator('.attachment-image__full').last();
  await expect(bobImage).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => bobImage.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 10_000 })
    .toBe(1);

  // Roles: Alice creates a role that may kick, and gives it to Bob.
  await alice.locator('.community__title').click();
  await alice.getByRole('menuitem', { name: 'Community settings' }).click();
  await alice.locator('.settings-tab', { hasText: 'Roles' }).click();
  await alice.getByRole('button', { name: 'Create role' }).click();
  await alice.getByLabel('Role name').fill('Crew');
  await alice.locator('.toggle-row', { hasText: 'Kick members' }).locator('input').check();
  await alice.getByRole('button', { name: 'Save changes' }).click();
  await expect(alice.locator('.role-row', { hasText: 'Crew' })).toBeVisible();
  if (process.env.RIVER_SCREENSHOTS) await alice.screenshot({ path: 'test-results/community-roles.png' });
  await alice.locator('.settings-tab', { hasText: 'Members' }).click();
  await alice.getByLabel('Add role to Bob').selectOption({ label: 'Crew' });
  await expect(alice.locator('.member-table__row', { hasText: 'Bob' })).toContainText('Crew');
  await alice.getByRole('button', { name: 'Close settings' }).click();
  await openMembers(bob);
  await expect(bob.locator('.community__members')).toContainText('Crew — 1', { timeout: 15_000 });
  if (process.env.RIVER_SCREENSHOTS) await bob.screenshot({ path: 'test-results/community-members.png' });

  // Direct messages (libsignal): Alice messages Bob from his profile card.
  await openMembers(alice);
  await alice.locator('.community__members .member', { hasText: 'Bob' }).click();
  await alice.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(alice.locator('.dms')).toBeVisible({ timeout: 15_000 });
  await alice.getByPlaceholder('Message Bob').fill('psst, a private hello');
  await alice.keyboard.press('Enter');
  await expect(alice.locator('.dm-status').last()).toHaveText(/Sent|Delivered/, { timeout: 15_000 });
  await bob.getByRole('button', { name: /^Messages/ }).click();
  await bob.locator('.dm-row', { hasText: 'Alice' }).click();
  await expect(bob.locator('.chat__messages')).toContainText('psst, a private hello', { timeout: 15_000 });
  await bob.getByRole('button', { name: 'Accept', exact: true }).click();
  await bob.getByPlaceholder('Message Alice').fill('got it, encrypted both ways');
  await bob.keyboard.press('Enter');
  await expect(alice.locator('.chat__messages')).toContainText('got it, encrypted both ways', {
    timeout: 15_000,
  });
  if (process.env.RIVER_SCREENSHOTS) await alice.screenshot({ path: 'test-results/dm.png' });

  // 1:1 call from the conversation: Alice rings, Bob accepts, audio flows, Alice hangs up.
  await alice.getByRole('button', { name: 'Start voice call' }).click();
  await expect(bob.locator('.incoming-call')).toContainText('Alice', { timeout: 15_000 });
  await bob.getByRole('button', { name: 'Accept', exact: true }).click();
  for (const p of [alice, bob]) {
    await expect(p.locator('.dm-call__status')).toContainText('Connected', { timeout: 30_000 });
    await expect
      .poll(
        () =>
          p
            .locator('.call-audio audio')
            .first()
            .evaluate((a: HTMLAudioElement) => !a.paused && a.readyState > 0),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
  }
  if (process.env.RIVER_SCREENSHOTS) await bob.screenshot({ path: 'test-results/dm-call.png' });
  await alice.getByRole('button', { name: 'Hang up' }).click();
  await expect(bob.locator('.dm-call')).toHaveCount(0, { timeout: 15_000 });
});
