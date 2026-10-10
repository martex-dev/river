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

test('a new user hosts a community on this PC in one step, and a friend joins and chats', async () => {
  test.setTimeout(120_000);
  const hana = await open('Hana', { RIVER_DEV_LOCAL_HOSTING: 'true', RIVER_DEV_HOME: tmp('river-home-') });
  await hana.getByRole('button', { name: 'Communities', exact: true }).click();
  await hana.getByPlaceholder('e.g. The Crew').fill('Hosted Here');
  // Hosting on this PC is the default: no server address to find.
  await expect(hana.getByRole('radio', { name: /On this PC/ })).toBeChecked();
  await expect(hana.getByPlaceholder('https://river.example.org')).toHaveCount(0);
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

  // Live, encrypted chat through the server running inside Hana's River.
  await ivan.getByPlaceholder('Message #general').fill('hello from ivan');
  await ivan.keyboard.press('Enter');
  await expect(hana.locator('.chat__messages')).toContainText('hello from ivan');
  await hana.getByPlaceholder('Message #general').fill('hi ivan, this lives on my PC');
  await hana.keyboard.press('Enter');
  await expect(ivan.locator('.chat__messages')).toContainText('hi ivan, this lives on my PC');

  // Settings → Hosting shows it running, backed up, and starting with the PC.
  await hana.getByRole('button', { name: 'Settings', exact: true }).click();
  await hana.getByRole('button', { name: 'Hosting', exact: true }).click();
  await expect(hana.getByRole('switch', { name: 'Host communities on this PC' })).toBeChecked();
  await expect(hana.locator('.hosting__state')).toHaveText(/Online/);
  await expect(hana.locator('.hosting__backup')).toContainText('Last backup today');
  await hana.getByRole('button', { name: 'Back up now' }).click();
  await expect(hana.getByRole('button', { name: 'Back up now' })).toBeEnabled();
  await auditA11y(hana, 'Settings → Hosting');
  if (process.env.RIVER_SCREENSHOTS) await hana.screenshot({ path: 'test-results/hosting.png' });
  const settings = await hana.evaluate(() => window.river.settings.get());
  expect(settings.system).toEqual({ startAtLogin: true, closeToTray: true });

  // Turning it off asks first, and nothing is deleted.
  await hana.getByRole('switch', { name: 'Host communities on this PC' }).click({ force: true });
  await expect(hana.getByRole('alertdialog')).toContainText('Stop hosting?');
  await hana.getByRole('button', { name: 'Keep hosting' }).click();
  await expect(hana.getByRole('switch', { name: 'Host communities on this PC' })).toBeChecked();
});
