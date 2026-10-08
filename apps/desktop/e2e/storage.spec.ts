import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { TEST_PASSPHRASE, launchRiver } from './launch.ts';

const userData = mkdtempSync(join(tmpdir(), 'river-e2e-storage-'));
test.afterAll(() => rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test('creates an encrypted local database and reopens it after restart', async () => {
  const first = await launchRiver(userData);
  await first.page.getByRole('button', { name: 'Security', exact: true }).click();
  const row = first.page.locator('.board__row', { hasText: 'Encrypted local storage' });
  await expect(row.locator('.board__value')).toHaveText(/active/i);
  await first.app.close();

  const db = join(userData, 'data', 'river.db');
  expect(existsSync(db)).toBe(true);
  expect(readFileSync(db).subarray(0, 15).toString()).not.toBe('SQLite format 3');
  const keyFile = JSON.parse(readFileSync(join(userData, 'data', 'database.key'), 'utf8'));
  expect(['os-keystore', 'passphrase']).toContain(keyFile.protection);

  if (keyFile.protection === 'passphrase') {
    // No OS keyring (Linux CI): the second start must ask to unlock, and reject a wrong passphrase.
    const app = await electron.launch({
      args: [resolve(__dirname, '..'), `--user-data-dir=${userData}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    await expect(page.getByText('Unlock River')).toBeVisible();
    await page.locator('.lock input[type=password]').fill('definitely the wrong passphrase');
    await page.locator('.lock button[type=submit]').click();
    await expect(page.locator('.field__error')).toContainText('not correct');
    await page.locator('.lock input[type=password]').fill(TEST_PASSPHRASE);
    await page.locator('.lock button[type=submit]').click();
    await page.waitForSelector('.rail', { timeout: 30_000 });
    await app.close();
  } else {
    const second = await launchRiver(userData);
    await expect(second.page.locator('.lock')).toHaveCount(0);
    await second.page.getByRole('button', { name: 'Security', exact: true }).click();
    await expect(
      second.page.locator('.board__row', { hasText: 'Encrypted local storage' }).locator('.board__value'),
    ).toHaveText(/active/i);
    await second.app.close();
  }
});
