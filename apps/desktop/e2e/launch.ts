import { resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const TEST_PASSPHRASE = 'river end-to-end test passphrase';

/**
 * Launches the built app exactly as the packaged app loads it (river:// + CSP).
 * On systems without an OS keyring (e.g. Linux CI) River first asks for a
 * passphrase or to unlock; this completes that step so tests reach the UI.
 */
export async function launchRiver(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve(__dirname, '..'), `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.rail, .lock');
  if (await page.locator('.lock').isVisible()) {
    const inputs = page.locator('.lock input[type=password]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) await inputs.nth(i).fill(TEST_PASSPHRASE);
    await page.locator('.lock button[type=submit]').click();
    await page.waitForSelector('.rail', { timeout: 30_000 });
  }
  return { app, page };
}
