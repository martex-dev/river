import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adoptLegacyData,
  findLegacyHost,
  legacyRunning,
  retireLegacyHost,
  type RetireDeps,
} from '../src/main/host/legacy-host.ts';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'river-legacy-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function install(config: object, status?: object): void {
  mkdirSync(join(home, 'RiverHost', 'data', 'attachments'), { recursive: true });
  // Written by Windows PowerShell, with a byte-order mark.
  writeFileSync(join(home, 'RiverHost', 'host.json'), `\uFEFF${JSON.stringify(config)}`);
  if (status) writeFileSync(join(home, 'RiverHost', 'status.json'), JSON.stringify(status));
}

function deps(running: Set<number>, ran: string[][]): RetireDeps {
  return {
    platform: 'win32',
    run: async (cmd, args) => {
      ran.push([cmd, ...args]);
      if (cmd === 'taskkill.exe') running.clear();
    },
    commandLine: async (pid) => (running.has(pid) ? 'node.exe C:/RiverHost/river-host.ts host.json' : null),
    kill: () => running.clear(),
    sleep: async () => undefined,
  };
}

describe('legacy River Host', () => {
  it('is not found when it was never installed', () => {
    expect(findLegacyHost(home)).toBeNull();
  });

  it('reads its data folder and runner id, even with a byte-order mark', () => {
    install({ dataDir: 'D:/Hosting/data' }, { pid: 4242 });
    expect(findLegacyHost(home)).toEqual({
      home: join(home, 'RiverHost'),
      dataDir: 'D:/Hosting/data',
      pid: 4242,
    });
  });

  it('only counts as running if that process really is river-host.ts', async () => {
    install({}, { pid: 4242 });
    const legacy = findLegacyHost(home)!;
    expect(await legacyRunning(legacy, async () => 'node.exe river-host.ts')).toBe(true);
    // After a restart the id may belong to something else entirely.
    expect(await legacyRunning(legacy, async () => 'C:/Games/game.exe')).toBe(false);
    expect(await legacyRunning(legacy, async () => null)).toBe(false);
  });

  it('removes the sign-in task and stops the runner with its server and tunnel', async () => {
    install({}, { pid: 4242 });
    const ran: string[][] = [];
    await retireLegacyHost(findLegacyHost(home)!, deps(new Set([4242]), ran));
    expect(ran).toEqual([
      ['schtasks.exe', '/Delete', '/TN', 'River Host', '/F'],
      ['taskkill.exe', '/PID', '4242', '/T', '/F'],
    ]);
  });

  it('never stops a process that only reuses the old id', async () => {
    install({}, { pid: 4242 });
    const ran: string[][] = [];
    await retireLegacyHost(findLegacyHost(home)!, deps(new Set(), ran));
    expect(ran.map((r) => r[0])).toEqual(['schtasks.exe']);
  });

  it('copies the community data into River once, never over existing data', () => {
    install({});
    const legacyData = join(home, 'RiverHost', 'data');
    writeFileSync(join(legacyData, 'river.sqlite'), 'db');
    writeFileSync(join(legacyData, 'river.sqlite-wal'), 'wal');
    writeFileSync(join(legacyData, 'attachments', 'blob'), 'file');
    const target = join(home, 'River', 'host', 'data');

    expect(adoptLegacyData(findLegacyHost(home)!, target)).toBe(true);
    expect(readFileSync(join(target, 'river.sqlite-wal'), 'utf8')).toBe('wal');
    expect(existsSync(join(target, 'attachments', 'blob'))).toBe(true);
    // The old folder stays as a backup.
    expect(existsSync(join(legacyData, 'river.sqlite'))).toBe(true);

    writeFileSync(join(legacyData, 'river.sqlite'), 'newer');
    expect(adoptLegacyData(findLegacyHost(home)!, target)).toBe(false);
    expect(readFileSync(join(target, 'river.sqlite'), 'utf8')).toBe('db');
  });
});
