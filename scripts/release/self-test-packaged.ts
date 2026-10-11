/**
 * Runs `River --self-test` against the packaged (unpacked) app that
 * electron-builder produced, so CI and releases prove the installed build can
 * start: native modules load, the encrypted database opens, keys can be made
 * and the interface renders. Usage: node scripts/release/self-test-packaged.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const release = resolve(import.meta.dirname, '../../apps/desktop/release');

function binary(): string {
  if (process.platform === 'win32') return join(release, 'win-unpacked', 'River.exe');
  if (process.platform === 'darwin') {
    // Release builds make both Intel and Apple-silicon apps: test the one this Mac runs natively
    // (an Intel app under Rosetta can take minutes to start the first time).
    const dirs = readdirSync(release).filter((d) => d.startsWith('mac') && existsSync(join(release, d, 'River.app')));
    const native = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    const dir = dirs.find((d) => d === native) ?? dirs[0];
    if (!dir) throw new Error('no packaged River.app found');
    return join(release, dir, 'River.app', 'Contents', 'MacOS', 'River');
  }
  return join(release, 'linux-unpacked', 'river');
}

const exe = binary();
if (!existsSync(exe)) throw new Error(`packaged app not found at ${exe}`);
const report = join(tmpdir(), `river-self-test-${Date.now()}.json`);
const run = spawnSync(exe, [`--self-test=${report}`], { stdio: 'inherit', timeout: 240_000 });
if (run.error) throw run.error;
if (!existsSync(report)) throw new Error(`self-test wrote no report (exit ${run.status})`);
const result = JSON.parse(readFileSync(report, 'utf8')) as {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string; optional?: boolean }>;
};
for (const c of result.checks)
  console.log(`${c.ok ? 'ok  ' : c.optional ? 'warn' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
if (!result.ok || run.status !== 0) {
  console.error('Packaged self-test failed.');
  process.exit(1);
}
console.log('Packaged self-test passed.');
