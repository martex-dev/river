import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { TEST_NAME, launchRiver } from './launch.ts';

const userData = mkdtempSync(join(tmpdir(), 'river-e2e-identity-'));
test.afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test('first run creates an identity whose private key never reaches the UI', async () => {
  const { app, page } = await launchRiver(userData, { completeOnboarding: false });
  await expect(page.getByRole('heading', { name: 'Welcome to River' })).toBeVisible();
  await page.getByRole('button', { name: 'Create my identity' }).click();
  await page.getByPlaceholder('e.g. Alex').fill(`  ${TEST_NAME}  `);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Creating your keys')).toBeVisible();
  await expect(page.getByRole('heading', { name: `This is you, ${TEST_NAME}` })).toBeVisible({
    timeout: 15_000,
  });
  const words = await page.locator('.fingerprint__words li').allInnerTexts();
  expect(words).toHaveLength(16);
  if (process.env.RIVER_SCREENSHOTS) await page.screenshot({ path: 'test-results/onboarding.png' });

  const info = await page.evaluate(() => window.river.identity.get());
  expect(info).not.toBeNull();
  expect(Object.keys(info!).sort()).toEqual(['createdAt', 'displayName', 'fingerprint', 'riverId', 'words']);
  expect(info!.displayName).toBe(TEST_NAME);
  expect(info!.fingerprint).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);

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

  await page.getByRole('button', { name: 'Enter River' }).click();
  await expect(page.locator('.hero__title')).toContainText(`Welcome, ${TEST_NAME}`);
  await page.getByRole('button', { name: 'Security', exact: true }).click();
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
