import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchRiver } from './launch.ts';

// Runs the built app (`npm run build` first) exactly as the packaged app loads it: river://app/ with CSP.
let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'river-e2e-'));
  ({ app, page } = await launchRiver(userData));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('loads the UI from the private river:// scheme', async () => {
  expect(page.url()).toBe('river://app/index.html');
  await expect(page.locator('.hero__title')).toContainText('Welcome, E2E Tester');
  if (process.env.RIVER_SCREENSHOTS) await page.screenshot({ path: 'test-results/home.png' });
});

test('renderer has no Node.js access', async () => {
  const hasNode = await page.evaluate(
    () => typeof (globalThis as { require?: unknown }).require !== 'undefined',
  );
  expect(hasNode).toBe(false);
  const processType = await page.evaluate(() => typeof (globalThis as { process?: unknown }).process);
  expect(processType).toBe('undefined');
});

test('content security policy is served and blocks inline and remote scripts', async () => {
  // Note: Playwright's evaluate() is exempt from CSP eval checks (CDP), so check the policy itself.
  const csp = await page.evaluate(async () =>
    (await fetch('river://app/index.html')).headers.get('content-security-policy'),
  );
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).not.toContain('unsafe-inline');
  const inlineRan = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__riverInline = true';
    document.body.append(s);
    return (window as { __riverInline?: boolean }).__riverInline === true;
  });
  expect(inlineRan).toBe(false);
  const fetchBlocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return false;
    } catch {
      return true;
    }
  });
  expect(fetchBlocked).toBe(true);
});

test('navigates every section', async () => {
  // Messages is built: without an account it explains how to start.
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await expect(page.locator('.page__title')).toHaveText('Private conversations');
  for (const label of ['Social', 'Calls', 'Files', 'Contacts']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.page__title')).toHaveText(label);
    await expect(page.getByText('Nothing here works yet')).toBeVisible();
  }
});

test('Security Center never claims encryption that is not active', async () => {
  await page.getByRole('button', { name: 'Security', exact: true }).click();
  await expect(page.getByText('What is protected, right now')).toBeVisible();
  const e2ee = page.locator('.board__row', { hasText: 'End-to-end encryption' });
  await expect(e2ee.locator('.board__value')).toHaveText(/direct messages and communities/i);
  await expect(page.locator('.keylist__id').first()).toHaveText('626D B4CB B389 FC32');
  if (process.env.RIVER_SCREENSHOTS) await page.screenshot({ path: 'test-results/security.png' });
});

test('settings persist and updater reports dev-mode state', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('disabled in development builds');
  await page.getByText('Beta', { exact: true }).click();
  await expect(page.getByText('You will receive pre-release builds')).toBeVisible();
  const saved = await page.evaluate(() => window.river.settings.get());
  expect(saved.updates.channel).toBe('beta');
  if (process.env.RIVER_SCREENSHOTS) await page.screenshot({ path: 'test-results/settings.png' });

  const rejected = await page.evaluate(async () => {
    try {
      await window.river.settings.update({ updates: { channel: 'evil' } } as never);
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
});

test('blocks window.open and navigation away from River', async () => {
  const opened = await page.evaluate(() => window.open('https://example.com') !== null);
  expect(opened).toBe(false);
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(300);
  expect(page.url()).toBe('river://app/index.html');
});
