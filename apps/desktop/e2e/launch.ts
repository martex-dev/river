import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export const TEST_PASSPHRASE = 'river end-to-end test passphrase';
export const TEST_NAME = 'E2E Tester';

/**
 * Launches the built app exactly as the packaged app loads it (river:// + CSP)
 * and walks through first-run steps so tests reach the main UI:
 * passphrase setup/unlock (systems without an OS keyring, e.g. Linux CI) and
 * the one-screen first run (2.14: a name, then Get started).
 */
export async function launchRiver(
  userData: string,
  options: {
    completeOnboarding?: boolean;
    name?: string;
    args?: string[];
    env?: Record<string, string>;
  } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [resolve(__dirname, '..'), `--user-data-dir=${userData}`, ...(options.args ?? [])],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      // Every test app gets its own empty home, so it can never find (or take over) a real
      // River Host on the machine running the tests.
      RIVER_DEV_HOME: mkdtempSync(join(tmpdir(), 'river-e2e-home-')),
      ...options.env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.workspace, .lock, .onboarding');
  if (await page.locator('.lock').isVisible()) {
    const inputs = page.locator('.lock input[type=password]');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) await inputs.nth(i).fill(TEST_PASSPHRASE);
    await page.locator('.lock button[type=submit]').click();
    await page.waitForSelector('.workspace, .onboarding', { timeout: 30_000 });
  }
  if (options.completeOnboarding !== false && (await page.locator('.onboarding').isVisible())) {
    await completeFirstRun(page, options.name ?? TEST_NAME);
  }
  return { app, page };
}

/** Opens Settings (the overlay), optionally on a tab: "Security", "Updates", "Account"… */
export async function openSettings(page: Page, tab?: string): Promise<void> {
  if (!(await page.locator('.settings-overlay').isVisible())) {
    // The gear sits in the user panel at the bottom of a sidebar; Admin has none, so go Home first.
    const gear = page.getByRole('button', { name: 'Settings', exact: true });
    if (!(await gear.isVisible())) await page.getByRole('button', { name: 'Home', exact: true }).click();
    await gear.click();
  }
  if (tab)
    await page.locator('.settings-overlay__nav').getByRole('button', { name: tab, exact: true }).click();
}

async function closeSettings(page: Page): Promise<void> {
  if (await page.locator('.settings-overlay').isVisible()) {
    await page.getByRole('button', { name: 'Close settings' }).click();
  }
}

/**
 * Opens the communities view: the first community in the rail, or "Create or
 * join a community" when there are none yet (as the old Communities button did).
 */
export async function openCommunities(page: Page, name?: string): Promise<void> {
  await closeSettings(page);
  const rail = page.getByRole('navigation', { name: 'Your communities' });
  if (name) {
    await rail.getByRole('button', { name, exact: true }).click();
    return;
  }
  const communities = rail.locator(
    '.community__server:not(.rail-home):not(.rail-admin):not(.community__server--add):not(.rail-folder__button)',
  );
  if ((await communities.count()) === 0) {
    await rail.getByRole('button', { name: 'Create or join a community' }).click();
  } else {
    await communities.first().click();
  }
}

/** Home (friends and direct messages), optionally one of its places: "Friends", "Social", "Calls", "Files". */
export async function openHome(page: Page, place?: string): Promise<void> {
  await closeSettings(page);
  if (!(await page.locator('.home-sidebar').isVisible())) {
    await page.getByRole('button', { name: 'Home', exact: true }).click();
  }
  if (place) await page.locator('.home-nav').getByRole('button', { name: place, exact: true }).click();
}

/** The first run (2.14): one screen — a name, then Get started — and River is open. */
export async function completeFirstRun(
  page: Page,
  name: string,
  button: RegExp = /Get started/,
): Promise<void> {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: button }).click();
  await page.waitForSelector('.workspace', { timeout: 30_000 });
}

/** Settings → Appearance → a skin, then one of its palettes. */
export async function chooseTheme(page: Page, skin: string, palette: string): Promise<void> {
  await openSettings(page, 'Appearance');
  await page.getByRole('radio', { name: `${skin} skin` }).click();
  await page.getByRole('radio', { name: `${palette} palette` }).click();
}
