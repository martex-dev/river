import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type ElectronApplication, type Page } from '@playwright/test';
import { auditA11y } from './axe.ts';
import { launchRiver, openCommunities, openHome, openSettings } from './launch.ts';

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
  for (const place of ['Social', 'Calls', 'Files', 'Friends']) {
    await openHome(page, place);
    await audit(place);
  }
  await openCommunities(page);
  await audit('Communities');
  for (const tab of [
    'Account',
    'Profile',
    'Security',
    'Backup',
    'Appearance',
    'Voice & video',
    'Notifications',
    'System',
    'Updates',
    'About',
  ]) {
    await openSettings(page, tab);
    await audit(`Settings → ${tab}`);
  }
  await page.keyboard.press('Escape');
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
