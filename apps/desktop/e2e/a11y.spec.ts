import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type ElectronApplication, type Page } from '@playwright/test';
import { auditA11y } from './axe.ts';
import { launchRiver } from './launch.ts';

// Automated accessibility audit (axe-core) of River's main screens.
let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'river-a11y-'));
  ({ app, page } = await launchRiver(userData));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const audit = (where: string): Promise<void> => auditA11y(page, where);

test('main screens have no serious accessibility problems', async () => {
  await audit('Home');
  for (const section of ['Messages', 'Communities', 'Social', 'Calls', 'Files', 'Friends', 'Security']) {
    await page.getByRole('button', { name: section, exact: true }).click();
    await audit(section);
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const tab of ['Updates', 'Account', 'Backup', 'Appearance', 'Notifications', 'System', 'About']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await audit(`Settings → ${tab}`);
  }
});

test('the quick switcher and the shortcuts list are accessible', async () => {
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.keyboard.press('Control+K');
  await audit('Quick switcher');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Slash');
  await audit('Keyboard shortcuts');
  await page.keyboard.press('Escape');
});
