import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GPU_CRASHES_BEFORE_FALLBACK,
  describeStartupError,
  readGpuState,
  recordGpuCrash,
} from '../src/main/startup-guard.ts';
import { selfTestPath } from '../src/main/self-test.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-guard-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('startup failure report', () => {
  it('names the version, platform and error, with a few stack lines', () => {
    const err = new Error('The specified module could not be found.');
    const text = describeStartupError(err, { version: '1.0.16', platform: 'win32-x64' });
    expect(text).toContain('River 1.0.16 (win32-x64) could not start.');
    expect(text).toContain('Error: The specified module could not be found.');
    expect(text.split('\n').length).toBeLessThanOrEqual(7);
  });

  it('copes with things thrown that are not errors', () => {
    expect(describeStartupError('boom', { version: '1', platform: 'x' })).toContain('Error: boom');
  });
});

describe('graphics fallback', () => {
  it('turns hardware acceleration off after repeated graphics crashes, once', () => {
    const path = join(dir, 'gpu.json');
    expect(readGpuState(path)).toEqual({ disabled: false, crashes: 0 });
    for (let i = 1; i < GPU_CRASHES_BEFORE_FALLBACK; i++) expect(recordGpuCrash(path, 'crashed')).toBe(false);
    expect(recordGpuCrash(path, 'crashed')).toBe(true);
    expect(readGpuState(path).disabled).toBe(true);
    // Already off: no more restarts.
    expect(recordGpuCrash(path, 'crashed')).toBe(false);
  });

  it('treats a damaged state file as no information', () => {
    const path = join(dir, 'gpu.json');
    writeFileSync(path, '{not json');
    expect(readGpuState(path)).toEqual({ disabled: false, crashes: 0 });
    writeFileSync(path, JSON.stringify({ disabled: 'yes', crashes: -4 }));
    expect(readGpuState(path)).toEqual({ disabled: false, crashes: 0 });
  });
});

describe('self-test flag', () => {
  it('is off unless asked for, and takes an optional report path', () => {
    expect(selfTestPath(['River.exe'])).toBeNull();
    expect(selfTestPath(['River.exe', '--self-test=C:\\r.json'])).toBe('C:\\r.json');
    expect(selfTestPath(['River.exe', '--self-test'])).toMatch(/river-self-test\.json$/);
  });
});
