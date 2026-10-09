import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // CI machines (especially Windows and macOS runners) are much slower than a desktop.
  timeout: process.env.CI ? 180_000 : 60_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  // Each test file launches a full Electron app; run them one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
