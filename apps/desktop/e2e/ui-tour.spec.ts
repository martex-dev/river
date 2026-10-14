import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchRiver, openSettings } from './launch.ts';

// A tour of River's main screens with real content, saved as screenshots for design work
// (RIVER_UI_TOUR=<folder>). Skipped otherwise.
const OUT = process.env.RIVER_UI_TOUR;
test.skip(!OUT, 'set RIVER_UI_TOUR to a folder to take the tour');

let server: ChildProcess;
let url = '';
const dirs: string[] = [];
const apps: ElectronApplication[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

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

test.beforeAll(async () => {
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/main.ts'], {
    cwd: resolve(__dirname, '../../server'),
    env: {
      ...process.env,
      RIVER_PORT: String(port),
      RIVER_DATABASE_URL: `sqlite:${join(tmp('river-tour-srv-'), 'r.sqlite')}`,
      RIVER_LOG_LEVEL: 'warn',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/v1/health`)).ok) break;
    } catch {
      // starting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
});

test.afterAll(async () => {
  for (const a of apps) await a.close().catch(() => undefined);
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

async function open(name: string): Promise<{ app: ElectronApplication; page: Page }> {
  const opened = await launchRiver(tmp('river-tour-ui-'), {
    name,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  apps.push(opened.app);
  await opened.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w?.setSize(1440, 900);
    w?.center();
  });
  return opened;
}

test('tour', async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT!, { recursive: true });
  const shot = async (p: Page, name: string): Promise<void> => {
    await p.waitForTimeout(600);
    await p.screenshot({ path: join(OUT!, `${name}.png`) });
  };

  const { page: ana } = await open('Ana');
  await ana.getByRole('button', { name: 'Settings', exact: true }).click();
  await ana.getByRole('button', { name: 'Account', exact: true }).click();
  await ana.getByPlaceholder('https://river.example.org').fill(url);
  await ana.getByRole('button', { name: 'Save', exact: true }).click();
  await ana.getByRole('button', { name: 'Create account' }).click();
  await expect(ana.locator('.account-card .chip')).toHaveText('Connected');
  await ana.getByLabel('Username — how people add you').fill('ana');
  await ana.getByRole('button', { name: /Set username|Change/ }).click();
  await shot(ana, '00-settings');
  await ana.keyboard.press('Escape');

  await ana.getByRole('button', { name: 'Create or join a community' }).click();
  await shot(ana, '01-start');
  await ana.getByRole('radio', { name: /Gaming/ }).click();
  await ana.getByPlaceholder('e.g. The Crew').fill('In the trenches');
  await ana.getByRole('button', { name: 'Create community' }).click();
  await expect(ana.locator('.community__title strong')).toHaveText('In the trenches', { timeout: 20_000 });
  await ana.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = (await ana.locator('.invite-box__link').innerText()).trim();
  await shot(ana, '02-invite');
  await ana.getByRole('button', { name: 'Close', exact: true }).click();

  const { page: ben } = await open('Ben');
  await ben.getByRole('button', { name: 'Create or join a community' }).click();
  await ben.getByLabel('Invite link').fill(invite);
  await ben.getByRole('button', { name: 'Join community' }).click();
  await expect(ben.locator('.community__title strong')).toHaveText('In the trenches');

  const say = async (p: Page, text: string): Promise<void> => {
    const box = p.locator('.composer textarea, .composer [contenteditable], textarea').first();
    await box.fill(text);
    await p.keyboard.press('Enter');
  };
  await say(ana, 'Welcome to the trenches 👋');
  await say(ben, 'Glad to be here. Voice tonight?');
  await say(ana, 'Yes — 9pm in Squad 1. Bring snacks 🍿');
  await say(ben, 'Deal. I will share my screen for the plan.');
  await expect(ana.locator('.chat__messages')).toContainText('screen for the plan');
  await shot(ana, '03-community-chat');

  await ana.locator('.channel', { hasText: 'Squad 1' }).click();
  await ben.locator('.channel', { hasText: 'Squad 1' }).click();
  await expect(ana.locator('.tile', { hasText: 'Ben' })).toBeVisible({ timeout: 30_000 });
  await shot(ana, '04-voice');
  await ana
    .getByRole('button', { name: /Disconnect|Leave voice/ })
    .first()
    .click()
    .catch(() => undefined);

  await ana.getByRole('button', { name: 'Home', exact: true }).click();
  await shot(ana, '05-home-friends');
  await ana.getByRole('button', { name: 'Social', exact: true }).click();
  await shot(ana, '06-social');
  await ana.getByRole('button', { name: 'Settings', exact: true }).click();
  await ana.getByRole('button', { name: 'Voice & video', exact: true }).click();
  await shot(ana, '07-settings-voice');
  await ana.getByRole('button', { name: 'Close settings' }).click();
  await ana.getByRole('button', { name: 'In the trenches', exact: true }).click();
  await shot(ana, '08-back-in-community');

  // Skins (1.0.45): the appearance centre, then River in a theme from each skin family.
  await openSettings(ana, 'Appearance');
  await shot(ana, '09-appearance');
  const themes = (
    process.env.RIVER_UI_TOUR_THEMES ??
    'Neon District,Orbital Command,Aurora Glass,Hot Magenta,Midnight Gold,Pure White,Enterprise Blue,Control Room,Phosphor Green,Outrun,Forest Canopy,Swiss Typography,High Contrast Dark'
  )
    .split(',')
    .filter(Boolean);
  for (const [i, theme] of themes.entries()) {
    await openSettings(ana, 'Appearance');
    await ana.getByLabel('Search themes').fill(theme);
    await ana
      .getByRole('article', { name: `${theme} theme` })
      .getByRole('button', { name: 'Apply' })
      .click();
    await ana.getByRole('button', { name: 'Close settings' }).click();
    await shot(ana, `t${String(i + 1).padStart(2, '0')}-${theme.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
});
