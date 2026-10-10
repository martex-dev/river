import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * River Host (1.0.8–1.0.10) ran the server as a separate program set up with
 * scripts/host/install-host.ps1, keeping its data in ~/RiverHost/data. Hosting
 * is now built into River; this finds such a setup so River can take over —
 * with the community's data — when the user turns hosting on.
 */
export interface LegacyHost {
  home: string;
  dataDir: string;
  /** Process id of the running runner (river-host.ts), if it is running. */
  pid: number | null;
}

/** Windows PowerShell writes a byte-order mark; JSON.parse does not accept one. */
const withoutBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(withoutBom(readFileSync(path, 'utf8')));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function findLegacyHost(homeDir: string): LegacyHost | null {
  const home = join(homeDir, 'RiverHost');
  const config = readJson(join(home, 'host.json'));
  if (!config) return null;
  const dataDir = typeof config.dataDir === 'string' ? config.dataDir : join(home, 'data');
  const status = readJson(join(home, 'status.json'));
  const pid = typeof status?.pid === 'number' && Number.isInteger(status.pid) ? status.pid : null;
  return { home, dataDir, pid };
}

/**
 * True only if `pid` is River Host's runner right now. Process ids are reused
 * after a restart, so the command line is checked — River must never stop an
 * unrelated program that happens to have the old id.
 */
export async function legacyRunning(
  legacy: LegacyHost,
  commandLine: (pid: number) => Promise<string | null>,
): Promise<boolean> {
  if (legacy.pid === null) return false;
  const cmd = await commandLine(legacy.pid).catch(() => null);
  return cmd !== null && cmd.includes('river-host.ts');
}

export interface RetireDeps {
  platform: NodeJS.Platform;
  /** Runs a program and resolves when it exits (whatever the exit code). */
  run(command: string, args: string[]): Promise<void>;
  commandLine(pid: number): Promise<string | null>;
  kill(pid: number): void;
  sleep(ms: number): Promise<void>;
}

/**
 * Stops River Host (its runner, server and tunnel) and removes its sign-in
 * task, so the two never fight over the same data. Its folder is left as it
 * is: it stays a backup until the user deletes it.
 */
export async function retireLegacyHost(legacy: LegacyHost, deps: RetireDeps): Promise<void> {
  if (deps.platform === 'win32') await deps.run('schtasks.exe', ['/Delete', '/TN', 'River Host', '/F']);
  if (!(await legacyRunning(legacy, deps.commandLine))) return;
  const pid = legacy.pid!;
  if (deps.platform === 'win32') await deps.run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  // Elsewhere the runner stops its server and tunnel itself when it gets SIGTERM.
  else deps.kill(pid);
  for (let i = 0; i < 20 && (await legacyRunning(legacy, deps.commandLine)); i++) await deps.sleep(250);
  // Give the database a moment to be released by the stopped server.
  await deps.sleep(1000);
}

/**
 * Copies River Host's data (database and attachments) into River's own
 * hosting folder. Never overwrites: if River already hosts something there,
 * nothing is copied.
 */
export function adoptLegacyData(legacy: LegacyHost, dataDir: string): boolean {
  if (!existsSync(join(legacy.dataDir, 'river.sqlite'))) return false;
  if (existsSync(join(dataDir, 'river.sqlite'))) return false;
  cpSync(legacy.dataDir, dataDir, { recursive: true, errorOnExist: true, force: false });
  return true;
}
