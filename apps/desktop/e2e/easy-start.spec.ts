import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { auditA11y } from './axe.ts';
import { completeFirstRun, launchRiver, openCommunities, openHome, openSettings } from './launch.ts';

// River 2.14 "Easy start": an invite link opened on a computer without River's account goes
// through the one-screen first run and straight into the community; the empty Friends page
// leads somewhere.
let server: ChildProcess;
let url = '';
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
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/main.ts'], {
    cwd: resolve(__dirname, '../../server'),
    env: {
      ...process.env,
      RIVER_PORT: String(port),
      RIVER_DATABASE_URL: `sqlite:${join(tmp('river-srv-easy-'), 'r.sqlite')}`,
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

test('an invite link opens River, asks only for a name, and lands in the community', async () => {
  test.setTimeout(120_000);
  const first = await launchRiver(tmp('river-easy-a-'), { name: 'Alice' });
  apps.push(first.app);
  const alice = first.page;
  await openSettings(alice);
  await alice.getByRole('button', { name: 'Account', exact: true }).click();
  await alice.getByPlaceholder('https://river.example.org').fill(url);
  await alice.getByRole('button', { name: 'Save', exact: true }).click();
  await alice.getByRole('button', { name: 'Create account' }).click();
  await expect(alice.locator('.account-card .chip')).toHaveText('Connected');

  // No friends yet: Friends shows how to add one and how to join a community, not an empty list.
  await openHome(alice, 'Friends');
  await expect(alice.getByLabel("Friend's username")).toBeVisible();
  await expect(alice.locator('.friends__add code')).toContainText('/add#');
  await expect(alice.getByLabel('Community invite link')).toBeVisible();
  await auditA11y(alice, 'Friends, first run');

  await openCommunities(alice);
  await alice.getByPlaceholder('e.g. The Crew').fill('Easy Club');
  await alice.getByRole('button', { name: 'Create community' }).click();
  await expect(alice.locator('.community__title strong')).toHaveText('Easy Club');
  await alice.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = (await alice.locator('.invite-box__link').innerText()).trim();
  await alice.getByRole('button', { name: 'Close', exact: true }).click();

  // Carol clicks "Open in River" on the invite page: River starts with the link.
  const second = await launchRiver(tmp('river-easy-c-'), {
    completeOnboarding: false,
    args: [`river://open?link=${encodeURIComponent(invite)}`],
  });
  apps.push(second.app);
  const carol = second.page;
  await expect(carol.getByText("You're invited to a community")).toBeVisible({ timeout: 15_000 });
  await expect(carol.locator('.onboarding')).not.toContainText('127.0.0.1');
  await auditA11y(carol, 'First run from an invite');
  await completeFirstRun(carol, 'Carol', /Join the community/);
  // One screen, then the community — no extra "Join?" question, no username or skin step.
  await expect(carol.locator('.community__title strong')).toHaveText('Easy Club', { timeout: 30_000 });
  await expect(carol.getByRole('dialog', { name: 'Join this community?' })).toHaveCount(0);
  // The link was used up by the first run: River does not offer it again.
  await carol.waitForTimeout(1000);
  await expect(carol.getByRole('dialog')).toHaveCount(0);
});
