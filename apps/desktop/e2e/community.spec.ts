import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { auditA11y } from './axe.ts';
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
  await alice.getByRole('button', { name: 'Invite people' }).first().click();
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
  await bob.getByLabel('Invite link').fill(invite);
  await bob.getByRole('button', { name: 'Join community' }).click();
  await expect(bob.locator('.community__title strong')).toHaveText('The Crew');
  // A short celebration greets new members (purely visual: hidden from screen readers).
  await expect(bob.locator('.burst__text')).toHaveText('Welcome to The Crew');
  await expect(bob.locator('.celebrations')).toHaveAttribute('aria-hidden', 'true');
  if (process.env.RIVER_SCREENSHOTS) await bob.screenshot({ path: 'test-results/celebration.png' });
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
  // …and must be closed again before using the chat underneath it.
  const closeMembers = async (p: typeof alice): Promise<void> => {
    const narrow = await p.evaluate(() => window.innerWidth < 1100);
    if (narrow && (await p.locator('.community__members').count()) > 0) {
      await p.getByRole('button', { name: 'Member list' }).click();
    }
  };
  await closeMembers(bob);
  await closeMembers(alice);

  // Encrypted chat, live in both directions.
  await bob.getByPlaceholder('Message #general').fill('hello from bob');
  await bob.keyboard.press('Enter');
  await expect(alice.locator('.chat__messages')).toContainText('hello from bob');
  await alice.getByPlaceholder('Message #general').fill('welcome, bob');
  await alice.keyboard.press('Enter');
  await expect(bob.locator('.chat__messages')).toContainText('welcome, bob');
  await auditA11y(bob, 'Community text channel');
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
  await alice
    .locator('.toggle-row', { hasText: 'Show members with this role separately' })
    .locator('input')
    .check();
  await alice.getByRole('button', { name: 'Save changes' }).click();
  await expect(alice.locator('.role-row', { hasText: 'Crew' })).toBeVisible();
  await auditA11y(alice, 'Community settings → Roles');
  if (process.env.RIVER_SCREENSHOTS) await alice.screenshot({ path: 'test-results/community-roles.png' });
  await alice.locator('.settings-tab', { hasText: 'Members' }).click();
  await alice.getByLabel('Add role to Bob').selectOption({ label: 'Crew' });
  await expect(alice.locator('.member-table__row', { hasText: 'Bob' })).toContainText('Crew');
  // The audit log tells the story in words.
  await alice.locator('.settings-tab', { hasText: 'Audit log' }).click();
  await expect(alice.locator('.audit')).toContainText('Alice gave Bob Crew');
  await expect(alice.locator('.audit')).toContainText('Alice created the role Crew');
  await auditA11y(alice, 'Community settings → Audit log');
  await alice.getByRole('button', { name: 'Close settings' }).click();
  await openMembers(bob);
  await expect(bob.locator('.community__members')).toContainText('Crew — 1', { timeout: 15_000 });
  await closeMembers(bob);
  if (process.env.RIVER_SCREENSHOTS) await bob.screenshot({ path: 'test-results/community-members.png' });

  // Categories: Alice groups a new channel under one; Bob sees the (encrypted) category.
  await alice.locator('.community__title').click();
  await alice.getByRole('menuitem', { name: 'Create category' }).click();
  await alice.getByLabel('Category name').fill('Hangout');
  await alice.getByRole('button', { name: 'Create category' }).click();
  await alice.getByRole('button', { name: 'Create channel in Hangout' }).click();
  await alice.getByLabel('Channel name').fill('memes');
  await alice.getByRole('button', { name: 'Create channel', exact: true }).click();
  await expect(bob.getByRole('group', { name: 'Category Hangout' })).toContainText('memes', {
    timeout: 15_000,
  });
  await bob
    .getByRole('group', { name: 'Category Hangout' })
    .getByRole('button', { name: 'Hangout', exact: true })
    .click();
  await expect(bob.getByRole('group', { name: 'Category Hangout' })).not.toContainText('memes');
  await auditA11y(alice, 'Channel list with categories');

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
  await auditA11y(alice, 'Direct message conversation');
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

  // Group conversation: Alice creates a group with Bob from New message → New group.
  await alice.getByRole('button', { name: 'New message' }).click();
  await alice.getByRole('button', { name: /New group/ }).click();
  await alice.getByLabel('Group name').fill('Trenches crew');
  await alice.locator('.people-list .dm-row', { hasText: 'Bob' }).locator('input').check();
  await alice.getByRole('button', { name: 'Create group' }).click();
  await expect(alice.locator('.chat__head')).toContainText('Trenches crew', { timeout: 15_000 });
  await alice.getByPlaceholder('Message Trenches crew').fill('group hello');
  await alice.keyboard.press('Enter');
  await bob.locator('.dm-row', { hasText: 'Trenches crew' }).click({ timeout: 15_000 });
  await expect(bob.locator('.chat__messages')).toContainText('group hello', { timeout: 15_000 });
  // Bob already accepted Alice, so her group opens directly (no request step).
  await expect(bob.locator('.dm-request')).toHaveCount(0);
  await bob.getByPlaceholder('Message Trenches crew').fill('hi group');
  await bob.keyboard.press('Enter');
  await expect(alice.locator('.chat__messages')).toContainText('hi group', { timeout: 15_000 });
  await expect(alice.locator('.msg', { hasText: 'hi group' })).toContainText('Bob');

  // Social: Alice posts to her friends; Bob sees it and comments; Alice sees the comment.
  await alice.getByRole('button', { name: /^Social/ }).click();
  await alice.locator('.social__compose').click();
  await alice.getByPlaceholder('What do you want to share?').fill('First post on River 🌊');
  await alice.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(alice.locator('.post')).toContainText('First post on River', { timeout: 15_000 });
  await bob.getByRole('button', { name: /^Social/ }).click();
  await expect(bob.locator('.post')).toContainText('First post on River', { timeout: 15_000 });
  await bob.locator('.post').getByPlaceholder('Add a comment…').fill('Looks great!');
  await bob.locator('.post').getByRole('button', { name: 'Post', exact: true }).click();
  await expect(alice.locator('.post__comments')).toContainText('Looks great!', { timeout: 15_000 });
  await auditA11y(alice, 'Social feed');
  if (process.env.RIVER_SCREENSHOTS) await bob.screenshot({ path: 'test-results/social.png' });
});

test('a brand-new user creates a community from a template in one step', async () => {
  const carol = await open('Carol');
  await carol.getByRole('button', { name: 'Communities', exact: true }).click();
  await carol.getByRole('radio', { name: /Gaming/ }).click();
  await expect(carol.getByLabel('Gaming channels')).toContainText('looking-for-group');
  await carol.getByPlaceholder('e.g. The Crew').fill('Squad Goals');
  // No account yet: the server address is asked for right here, not in Settings.
  await carol.getByPlaceholder('https://river.example.org').fill(url);
  await expect(carol.getByRole('radio', { name: /Gaming/ })).toHaveAttribute('aria-checked', 'true');
  await expect(carol.getByRole('radio', { name: /Friends/ })).toHaveAttribute('aria-checked', 'false');
  if (process.env.RIVER_SCREENSHOTS) await carol.screenshot({ path: 'test-results/start.png' });
  await carol.getByRole('button', { name: 'Create community' }).click();
  await expect(carol.locator('.community__title strong')).toHaveText('Squad Goals', { timeout: 20_000 });
  await expect(carol.getByRole('group', { name: 'Category Chat' })).toContainText('clips');
  await expect(carol.getByRole('group', { name: 'Category Voice' })).toContainText('Squad 1');
  await auditA11y(carol, 'Community created from a template');
  // An empty channel helps you break the ice.
  await carol.locator('.channel', { hasText: 'general' }).getByRole('button').first().click();
  await expect(carol.locator('.chat__welcome-actions')).toContainText("It's just you here");
  await carol.getByRole('button', { name: /Wave to say hi/ }).click();
  await expect(carol.locator('.chat__messages')).toContainText('👋');

  // Dave pastes Carol's invite anywhere in River (not in a text field) and joins from the prompt.
  await carol.getByRole('button', { name: 'Invite people' }).first().click();
  const link = (await carol.locator('.invite-box__link').innerText()).trim();
  await carol.keyboard.press('Escape');
  const dave = await open('Dave');
  await dave.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, link);
  await expect(dave.getByRole('dialog', { name: 'Join this community?' })).toContainText('127.0.0.1');
  await dave.getByRole('dialog').getByRole('button', { name: 'Join community' }).click();
  await expect(dave.locator('.community__title strong')).toHaveText('Squad Goals', { timeout: 20_000 });

  // Dave adds Carol from her member card; Carol accepts on the Friends page and both see each other.
  if ((await dave.locator('.community__members').count()) === 0) {
    await dave.getByRole('button', { name: 'Member list' }).click();
  }
  await dave.locator('.community__members .member', { hasText: 'Carol' }).click();
  await dave.getByRole('button', { name: 'Add friend' }).click();
  await expect(dave.getByText('Request sent ✓')).toBeVisible({ timeout: 15_000 });
  await dave.keyboard.press('Escape');
  // Close the member list again (on small screens it covers the chat).
  if ((await dave.locator('.community__members').count()) > 0) {
    await dave.getByRole('button', { name: 'Member list' }).click();
  }
  await carol.getByRole('button', { name: 'Friends', exact: true }).click();
  await carol.getByRole('tab', { name: /Pending/ }).click();
  const request = carol.locator('.friend-row', { hasText: 'Dave' });
  await expect(request).toContainText('Wants to be friends', { timeout: 15_000 });
  await request.getByRole('button', { name: 'Accept' }).click();
  await carol.getByRole('tab', { name: 'All' }).click();
  await expect(carol.locator('.friend-row', { hasText: 'Dave' })).toBeVisible();
  await auditA11y(carol, 'Friends');
  await carol.getByRole('tab', { name: 'Add friend' }).click();
  await expect(carol.locator('.friends__add code')).toContainText('/add#');

  // Messages that arrive while you are elsewhere get a "New messages" divider when you open the channel.
  await carol.getByRole('button', { name: 'Communities', exact: true }).click();
  await carol.getByPlaceholder('Message #general').fill('hello Dave, welcome!');
  await carol.keyboard.press('Enter');
  await expect(dave.getByRole('button', { name: 'Text channel general, unread' })).toBeVisible({
    timeout: 15_000,
  });
  await dave.getByRole('button', { name: 'Text channel general, unread' }).click();
  await expect(dave.getByRole('separator', { name: 'New messages' })).toBeVisible();
  await expect(dave.locator('.chat__new-bar')).toContainText('1 new message since');
  await dave.getByRole('button', { name: 'Mark as read' }).click();
  await expect(dave.locator('.chat__new-bar')).toHaveCount(0);
});
