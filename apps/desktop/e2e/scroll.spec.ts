import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { chooseTheme, launchRiver, openHome, openSettings } from './launch.ts';

// 2.13.1: pages longer than the window scroll with the mouse wheel in every frame. The floating
// frame (Aurora, Synthwave, Holo) once clipped the page column (`overflow: hidden`), so the Admin
// page with many people and sign-ups could not be scrolled at all.
let app: ElectronApplication;
let page: Page;
const dirs: string[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

test.beforeAll(async () => {
  ({ app, page } = await launchRiver(tmp('river-scroll-'), {
    name: 'Olga',
    env: { RIVER_DEV_LOCAL_HOSTING: 'true', RIVER_DEV_HOME: tmp('river-scroll-home-') },
  }));
  // The maintainer's window: 1280×720.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.unmaximize();
    win.setContentSize(1280, 720);
  });
  // Host on this PC, so the rail shows Admin.
  await openSettings(page, 'Account');
  await page.getByRole('button', { name: 'Run a River server on this PC…' }).click();
  await page.getByRole('switch', { name: 'Host communities on this PC' }).click({ force: true });
  await expect(page.locator('.hosting__state')).toHaveText(/Online/, { timeout: 60_000 });
  // Enough sign-ups waiting to be claimed that the Admin page runs far past the window.
  for (let i = 0; i < 25; i++) {
    const made = await page.evaluate((n) => window.river.admin.createSignup(`waiting${n}`), i);
    expect(made.ok).toBe(true);
  }
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Wheels over the page column and expects it to move. */
async function expectWheelScrolls(where: string): Promise<void> {
  const content = page.locator('main.content');
  await expect(content).toBeVisible();
  const { client, height } = await content.evaluate((el) => ({
    client: el.clientHeight,
    height: el.scrollHeight,
  }));
  expect(height, `${where} runs past the window`).toBeGreaterThan(client + 200);
  await content.evaluate((el) => (el.scrollTop = 0));
  const box = (await content.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => content.evaluate((el) => el.scrollTop), { message: `${where} scrolls with the wheel` })
    .toBeGreaterThan(0);
}

test('the Admin page scrolls in a flush and in a floating frame', async () => {
  for (const [skin, palette, frame] of [
    ['Specter', 'Specter', 'flush'],
    ['Aurora', 'Borealis', 'floating'],
    ['Synthwave', 'Outrun', 'floating'],
  ] as const) {
    await chooseTheme(page, skin, palette);
    await expect(page.locator('html')).toHaveAttribute('data-frame', frame);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Admin', exact: true }).click();
    await expect(page.locator('.admin__signups')).toContainText('@waiting24');
    await expectWheelScrolls(`Admin in ${skin}`);
    // The other pages in the same column scroll the same way (Friends with a tall page of its own).
    await openHome(page, 'Friends');
    await page.locator('main.content').evaluate((el) => {
      const tall = document.createElement('div');
      tall.style.height = '3000px';
      el.append(tall);
    });
    await expectWheelScrolls(`Friends in ${skin}`);
  }
  await chooseTheme(page, 'Specter', 'Specter');
  await page.getByRole('button', { name: 'Close settings' }).click();
});
