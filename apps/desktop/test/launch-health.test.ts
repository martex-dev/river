import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LaunchHealth } from '../src/main/updater/launch-health.ts';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-health-'));
  file = join(dir, 'health.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('launch health', () => {
  it('flags a crash loop after three failed starts of an updated version', () => {
    new LaunchHealth(file, '1.0.1').markHealthy();
    expect(new LaunchHealth(file, '1.0.2').crashLoop).toBe(false); // first start after update
    expect(new LaunchHealth(file, '1.0.2').crashLoop).toBe(false);
    const third = new LaunchHealth(file, '1.0.2');
    expect(third.crashLoop).toBe(true);
    expect(third.current).toMatchObject({ version: '1.0.2', previousVersion: '1.0.1', starts: 3 });
    // Once it runs long enough, all is well again.
    third.markHealthy();
    expect(new LaunchHealth(file, '1.0.2').crashLoop).toBe(false);
  });

  it('a fresh install is never treated as a bad update', () => {
    for (let i = 0; i < 5; i++) expect(new LaunchHealth(file, '1.0.0').crashLoop).toBe(false);
  });

  it('survives a damaged file', () => {
    writeFileSync(file, '{not json');
    const h = new LaunchHealth(file, '1.0.3');
    expect(h.current).toMatchObject({ version: '1.0.3', starts: 1, previousVersion: null });
  });
});
