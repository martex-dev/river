import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { auditA11y } from './axe.ts';
import { launchRiver } from './launch.ts';

// Hosting from inside River, with the community server bundled into the app. The public tunnel
// is left out (RIVER_DEV_LOCAL_HOSTING), so members join over this computer's loopback address —
// everything else, from the utility process to WebSocket fan-out, is the shipped code.
const dirs: string[] = [];
const apps: ElectronApplication[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

test.afterAll(async () => {
  for (const a of apps) await a.close().catch(() => undefined);
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function open(name: string, env: Record<string, string> = {}): Promise<Page> {
  const { app, page } = await launchRiver(tmp('river-host-ui-'), { name, env });
  apps.push(app);
  return page;
}

async function setUsername(page: Page, username: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByLabel('Username — how people add you').fill(username);
  await page.getByRole('button', { name: /Set username|Change/ }).click();
  await expect(page.getByText(`People can add you as @${username}`)).toBeVisible({ timeout: 20_000 });
}

test('the operator hosts River on their PC, a friend joins, and the operator manages people', async () => {
  test.setTimeout(150_000);
  const hana = await open('Hana', { RIVER_DEV_LOCAL_HOSTING: 'true', RIVER_DEV_HOME: tmp('river-home-') });
  // Hosting is not in everyone's way: it is reached from Settings → Server.
  await hana.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(hana.getByRole('button', { name: 'Hosting', exact: true })).toHaveCount(0);
  await hana.getByRole('button', { name: 'Account', exact: true }).click();
  await hana.getByRole('button', { name: 'Run a River server on this PC…' }).click();
  await hana.getByRole('switch', { name: 'Host communities on this PC' }).click({ force: true });
  await expect(hana.locator('.hosting__state')).toHaveText(/Online/, { timeout: 60_000 });
  const address = (await hana.locator('.hosting__address code').innerText()).trim();
  expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  await expect(hana.locator('.hosting__backup')).toContainText('Last backup today');
  await auditA11y(hana, 'Settings → Hosting');
  const settings = await hana.evaluate(() => window.river.settings.get());
  expect(settings.system).toEqual({ startAtLogin: true, closeToTray: true });

  // Her community lives on the server inside her own River.
  await hana.getByRole('button', { name: 'Communities', exact: true }).click();
  await hana.getByPlaceholder('e.g. The Crew').fill('Hosted Here');
  await hana.getByRole('button', { name: 'Use a different server' }).click();
  await hana.getByPlaceholder('https://river.example.org').fill(address);
  await hana.getByRole('button', { name: 'Create community' }).click();
  await expect(hana.locator('.community__title strong')).toHaveText('Hosted Here', { timeout: 60_000 });
  await hana.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = (await hana.locator('.invite-box__link').innerText()).trim();
  await hana.getByRole('button', { name: 'Close', exact: true }).click();

  const ivan = await open('Ivan');
  await ivan.getByRole('button', { name: 'Communities', exact: true }).click();
  await ivan.getByLabel('Invite link').fill(invite);
  await ivan.getByRole('button', { name: 'Join community' }).click();
  await expect(ivan.locator('.community__title strong')).toHaveText('Hosted Here');

  // Discord-style usernames: people are @names, not IDs.
  await setUsername(hana, 'hana');
  await setUsername(ivan, 'ivan');
  await hana.getByRole('button', { name: 'Communities', exact: true }).click();
  await ivan.getByRole('button', { name: 'Communities', exact: true }).click();

  // Ivan adds Hana by her @username from the Friends page.
  await ivan.getByRole('button', { name: 'Friends', exact: true }).click();
  await ivan.getByRole('tab', { name: 'Add friend' }).click();
  await ivan.getByLabel("Friend's username").fill('hana');
  await ivan.getByRole('button', { name: 'Send friend request' }).click();
  await hana.getByRole('button', { name: 'Friends', exact: true }).click();
  await hana.getByRole('tab', { name: 'Pending' }).click();
  await expect(hana.locator('.friend-row')).toContainText('Ivan');
  await hana.getByRole('button', { name: 'Communities', exact: true }).click();
  await ivan.getByRole('button', { name: 'Communities', exact: true }).click();

  // Live, encrypted chat through the server running inside Hana's River.
  await ivan.getByPlaceholder('Message #general').fill('hello from ivan');
  await ivan.keyboard.press('Enter');
  await expect(hana.locator('.chat__messages')).toContainText('hello from ivan');
  await hana.getByPlaceholder('Message #general').fill('hi ivan, this lives on my PC');
  await hana.keyboard.press('Enter');
  await expect(ivan.locator('.chat__messages')).toContainText('hi ivan, this lives on my PC');

  // Admin: only on the hosting PC. Everyone on the server, by name where Hana knows them.
  await expect(ivan.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
  await hana.getByRole('button', { name: 'Admin', exact: true }).click();
  const people = hana.getByRole('heading', { name: 'People' }).locator('..').locator('..');
  const row = people.locator('.admin__row', { hasText: '@ivan' });
  await expect(row).toBeVisible();
  await expect(people.locator('.admin__row', { hasText: '@hana' })).toContainText('You');

  // Create an account ahead of time: a sign-up link to hand out.
  await hana.getByLabel('Username for the new account').fill('recruit');
  await hana.getByRole('button', { name: 'Create account' }).click();
  await expect(hana.locator('.admin__signup-link')).toContainText('@recruit');
  await expect(hana.locator('.admin__signup-link code')).toContainText('/add#s=');
  await auditA11y(hana, 'Admin');
  if (process.env.RIVER_SCREENSHOTS) await hana.screenshot({ path: 'test-results/admin.png' });

  // A timeout signs Ivan out until it ends; ending it lets him back.
  await row.getByLabel('Time out @ivan').selectOption({ label: '1 hour' });
  await expect(row).toContainText('Timed out until');
  await row.getByRole('button', { name: 'End timeout' }).click();
  await expect(row).not.toContainText('Timed out');

  // A ban asks first and can carry a reason.
  await row.getByRole('button', { name: 'Ban' }).click();
  await hana.getByLabel('Reason (optional, shown to them)').fill('testing');
  await hana.getByRole('alertdialog').getByRole('button', { name: 'Ban' }).click();
  await expect(row).toContainText('Banned');
  await expect(row).toContainText('Reason: testing');
  await row.getByRole('button', { name: 'Unban' }).click();
  await expect(row).not.toContainText('Banned');

  // Turning hosting off asks first, and nothing is deleted.
  await hana.getByRole('button', { name: 'Settings', exact: true }).click();
  await hana.getByRole('button', { name: 'Hosting', exact: true }).click();
  await hana.getByRole('switch', { name: 'Host communities on this PC' }).click({ force: true });
  await expect(hana.getByRole('alertdialog')).toContainText('Stop hosting?');
  await hana.getByRole('button', { name: 'Keep hosting' }).click();
  await expect(hana.getByRole('switch', { name: 'Host communities on this PC' })).toBeChecked();
});
