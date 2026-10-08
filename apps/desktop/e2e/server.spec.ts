import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

// Desktop ↔ server integration: the real River server process and the real desktop app.
let server: ChildProcess;
let port: number;
let app: ElectronApplication;
let page: Page;
const dirs: string[] = [];

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
    s.on('error', fail);
  });
}

async function waitForHealth(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('River server did not start');
}

test.beforeAll(async () => {
  port = await freePort();
  const data = mkdtempSync(join(tmpdir(), 'river-e2e-srv-'));
  const userData = mkdtempSync(join(tmpdir(), 'river-e2e-ui-'));
  dirs.push(data, userData);
  server = spawn(process.execPath, ['src/main.ts'], {
    cwd: resolve(__dirname, '../../server'),
    env: {
      ...process.env,
      RIVER_PORT: String(port),
      RIVER_DATABASE_URL: `sqlite:${join(data, 'r.sqlite')}`,
      RIVER_LOG_LEVEL: 'warn',
    },
    stdio: 'ignore',
  });
  await waitForHealth(`http://127.0.0.1:${port}/v1/health`);

  app = await electron.launch({
    args: [resolve(__dirname, '..'), `--user-data-dir=${userData}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  });
  page = await app.firstWindow();
  await page.waitForSelector('.rail');
});

test.afterAll(async () => {
  await app?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('connects to a running River server from Settings → Server', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Server', exact: true }).click();
  const input = page.getByPlaceholder('https://river.example.org');

  await input.fill('http://river.example.org');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.locator('.field__error')).toContainText('https://');

  await input.fill(`http://127.0.0.1:${port}/`);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.locator('.server-check')).toContainText('River server reachable');
  await expect(page.locator('.server-check')).toContainText('compatible');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.river.settings.get().then((s) => s.server.url)))
    .toBe(`http://127.0.0.1:${port}`);
  if (process.env.RIVER_SCREENSHOTS) await page.screenshot({ path: 'test-results/server.png' });

  await page.getByRole('button', { name: 'Security', exact: true }).click();
  const row = page.locator('.board__row', { hasText: 'Server message access' });
  await expect(row.locator('.board__value')).toContainText(`127.0.0.1:${port}`);
});

test('reports an unreachable server', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Server', exact: true }).click();
  await page.getByPlaceholder('https://river.example.org').fill(`http://127.0.0.1:${await freePort()}`);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.locator('.server-check')).toContainText('Could not reach the server');
});
