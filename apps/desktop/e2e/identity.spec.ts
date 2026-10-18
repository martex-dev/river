import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { auditA11y } from './axe.ts';
import { TEST_NAME, launchRiver, openSettings } from './launch.ts';

const userData = mkdtempSync(join(tmpdir(), 'river-e2e-identity-'));
test.afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test('first run creates an identity whose private key never reaches the UI', async () => {
  const { app, page } = await launchRiver(userData, { completeOnboarding: false });
  // 2.14: one screen — a name (and an optional photo), then Get started. Nothing technical on it.
  await expect(page.getByRole('heading', { name: 'Welcome to River' })).toBeVisible();
  await expect(page.locator('.onboarding')).not.toContainText(/https?:\/\/|key pair|fingerprint/i);
  await expect(page.getByRole('button', { name: 'Add a photo (optional)' })).toBeVisible();
  await auditA11y(page, 'First run');
  if (process.env.RIVER_SCREENSHOTS) await page.screenshot({ path: 'test-results/onboarding.png' });
  await page.getByLabel('Your name').fill(`  ${TEST_NAME}  `);
  await page.getByRole('button', { name: /Get started/ }).click();
  // No username, fingerprint or skin step: River is open.
  await page.waitForSelector('.workspace', { timeout: 30_000 });

  const info = await page.evaluate(() => window.river.identity.get());
  expect(info).not.toBeNull();
  expect(Object.keys(info!).sort()).toEqual(['createdAt', 'displayName', 'fingerprint', 'riverId', 'words']);
  expect(info!.displayName).toBe(TEST_NAME);
  expect(info!.fingerprint).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
  expect(info!.words).toHaveLength(16);

  // A second identity cannot be created over the first.
  const second = await page.evaluate(async () => {
    try {
      await window.river.identity.create('Mallory');
      return 'created';
    } catch {
      return 'refused';
    }
  });
  expect(second).toBe('refused');

  await expect(page.locator('.user-panel')).toContainText(TEST_NAME);
  // The look is offered, not forced: keeping it makes the card go for good.
  const look = page.getByRole('region', { name: 'Pick your look' });
  await expect(look).toBeVisible();
  await look.getByRole('button', { name: 'Keep this one' }).click();
  await expect(look).toHaveCount(0);
  await expect
    .poll(async () => (await page.evaluate(() => window.river.settings.get())).design.chosen)
    .toBe(true);
  await openSettings(page, 'Security');
  await expect(page.locator('.identity-card .fingerprint__hex')).toHaveAttribute(
    'aria-label',
    `Fingerprint ${info!.fingerprint}`,
  );
  const row = page.locator('.board__row', { hasText: 'Identity' }).first();
  await expect(row.locator('.board__value')).toContainText(info!.fingerprint.slice(0, 9));
  if (process.env.RIVER_SCREENSHOTS) await page.screenshot({ path: 'test-results/security-identity.png' });
  await app.close();

  // The identity survives a restart unchanged.
  const again = await launchRiver(userData);
  await expect(again.page.locator('.onboarding')).toHaveCount(0);
  const after = await again.page.evaluate(() => window.river.identity.get());
  expect(after).toEqual(info);
  await again.app.close();
});
