import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isFreshInstall } from '../../apps/mobile/core/fresh-install.ts';

const dirs: string[] = [];
const folder = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'river-fresh-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('telling a new install from an existing one (Android, 2.11.2)', () => {
  it('a phone with nothing of River is new (other apps’ files do not count)', () => {
    const d = folder();
    expect(isFreshInstall(d)).toBe(true);
    writeFileSync(join(d, 'profileinstaller_profileWrittenFor_lastUpdateTime.dat'), '');
    expect(isFreshInstall(d)).toBe(true);
  });
  it('any trace of an earlier River (even without settings or storage) is an existing install', () => {
    for (const trace of [
      'settings.json',
      'data',
      'logs',
      'attachments',
      'documents',
      'downloads',
      'updates',
    ]) {
      const d = folder();
      if (trace.includes('.')) writeFileSync(join(d, trace), '{}');
      else mkdirSync(join(d, trace));
      expect(isFreshInstall(d)).toBe(false);
    }
  });
});
