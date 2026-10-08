import { resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const TEST_PASSPHRASE = 'river end-to-end test passphrase';
export const TEST_NAME = 'E2E Tester';

/**
 * Launches the built app exactly as the packaged app loads it (river:// + CSP)
 * and walks through first-run steps so tests reach the main UI:
 * passphrase setup/unlock (systems without an OS keyring, e.g. Linux CI) and
 * identity creation.
 */
export async function launchRiver(
  userData: string,
  options: { completeOnboarding?: boolean; name?: string; args?: string[] } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve(__dirname, '..'), `--user-data-dir=${userData}`, ...(options.args ?? [])],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.rail, .lock, .onboarding');
  if (await page.locator('.lock').isVisible()) {
    const inputs = page.locator('.lock input[type=password]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) await inputs.nth(i).fill(TEST_PASSPHRASE);
    await page.locator('.lock button[type=submit]').click();
    await page.waitForSelector('.rail, .onboarding', { timeout: 30_000 });
  }
  if (options.completeOnboarding !== false && (await page.locator('.onboarding').isVisible())) {
    await page.getByRole('button', { name: 'Create my identity' }).click();
    await page.getByPlaceholder('e.g. Alex').fill(options.name ?? TEST_NAME);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Enter River' }).click({ timeout: 15_000 });
    await page.waitForSelector('.rail');
  }
  return { app, page };
}
