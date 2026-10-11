import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { createIdentity } from '@river/crypto';
import { APP_ORIGIN, hardenSession, serveAppScheme, uiSession, UI_PARTITION } from './security.ts';
import { electronKeystore } from './storage/electron-keystore.ts';
import { migrateDatabase } from './storage/database.ts';
import { deriveKek, newDatabaseKey } from './storage/key-file.ts';
import { CLIENT_MIGRATIONS } from './storage/migrations.ts';

/**
 * `River --self-test=<report.json>` (1.0.16): proves an installed build can
 * actually run — native modules load, the encrypted database opens and
 * migrates, keys can be made, and the interface renders with its bridge —
 * without touching the person's own data or contacting any server. CI runs it
 * against the packaged app on every OS; support can ask people to run it.
 */

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail?: string;
  /** Informational: reported, but does not fail the test. */
  optional?: boolean;
}

export interface SelfTestReport {
  version: string;
  platform: string;
  ok: boolean;
  checks: SelfTestCheck[];
}

export function selfTestPath(argv: readonly string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--self-test'));
  if (!arg) return null;
  const value = arg.split('=')[1];
  return value && value.length > 0 ? value : join(process.cwd(), 'river-self-test.json');
}

async function check(
  checks: SelfTestCheck[],
  name: string,
  fn: () => unknown,
  optional = false,
): Promise<void> {
  try {
    const detail = await fn();
    checks.push({
      name,
      ok: true,
      ...(typeof detail === 'string' ? { detail } : {}),
      ...(optional ? { optional } : {}),
    });
  } catch (err) {
    checks.push({
      name,
      ok: false,
      detail: (err as Error).message.slice(0, 300),
      ...(optional ? { optional } : {}),
    });
  }
}

/** Runs the checks and exits with 0 (all required checks passed) or 1. */
export async function runSelfTest(reportPath: string, rendererDir: string, preload: string): Promise<never> {
  await app.whenReady();
  const checks: SelfTestCheck[] = [];
  const scratch = mkdtempSync(join(tmpdir(), 'river-self-test-'));

  await check(checks, 'encrypted database (SQLCipher) opens and migrates', () => {
    const key = newDatabaseKey();
    const { db, outcome } = migrateDatabase(join(scratch, 'test.db'), key, CLIENT_MIGRATIONS);
    db.close();
    return `schema ${outcome.to}`;
  });
  await check(checks, 'identity keys (libsignal)', () => {
    createIdentity();
  });
  await check(checks, 'passphrase protection (libsodium Argon2id)', async () => {
    await deriveKek('self-test-passphrase', Buffer.alloc(16, 1), { memory: 8192, passes: 1, parallelism: 1 });
  });
  await check(
    checks,
    'system keystore',
    () =>
      electronKeystore.usable() ? electronKeystore.name() : 'not available (River will ask for a passphrase)',
    true,
  );
  await check(checks, 'interface renders with its secure bridge', async () => {
    const ui = uiSession();
    hardenSession(ui, undefined);
    serveAppScheme(ui, rendererDir);
    const win = new BrowserWindow({
      show: false,
      webPreferences: { preload, partition: UI_PARTITION, sandbox: true, contextIsolation: true },
    });
    try {
      await win.loadURL(`${APP_ORIGIN}/index.html`);
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const ready = (await win.webContents.executeJavaScript(
          `typeof window.river === 'object' && (document.getElementById('root')?.childElementCount ?? 0) > 0`,
        )) as boolean;
        if (ready) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('the interface did not render within 15 seconds');
    } finally {
      win.destroy();
    }
  });

  const report: SelfTestReport = {
    version: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    ok: checks.every((c) => c.ok || c.optional),
    checks,
  };
  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  } catch {
    // stdout still has it
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  rmSync(scratch, { recursive: true, force: true });
  app.exit(report.ok ? 0 : 1);
  return new Promise<never>(() => undefined);
}
