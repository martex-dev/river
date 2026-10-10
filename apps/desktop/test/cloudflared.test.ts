import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLOUDFLARED_ASSETS,
  CLOUDFLARED_VERSION,
  ensureCloudflared,
  installedCandidates,
} from '../src/main/host/cloudflared.ts';

const dirs: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'river-cfd-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const bytes = new TextEncoder().encode('pretend cloudflared');
const digest = createHash('sha256').update(bytes).digest('hex');
const fakeFetch = (body: Uint8Array, calls: string[] = []): typeof fetch =>
  (async (url: string) => {
    calls.push(url);
    return new Response(body, { headers: { 'content-length': String(body.byteLength) } });
  }) as unknown as typeof fetch;

describe('cloudflared', () => {
  it('pins a hash for every platform River ships on', () => {
    for (const key of ['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64']) {
      expect(CLOUDFLARED_ASSETS[key]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('looks only in system locations, never PATH', () => {
    const win = installedCandidates('win32', {
      'ProgramFiles(x86)': 'C:/Program Files (x86)',
      ProgramFiles: 'C:/Program Files',
      PATH: 'C:/evil',
    });
    expect(win).toHaveLength(2);
    expect(win.every((p) => !p.includes('evil'))).toBe(true);
  });

  it('prefers an installed copy and downloads nothing', async () => {
    const calls: string[] = [];
    const path = await ensureCloudflared({
      dir: tempDir(),
      platform: 'linux',
      arch: 'x64',
      env: {},
      fetch: fakeFetch(bytes, calls),
      exists: (p) => p === '/usr/bin/cloudflared',
    });
    expect(path).toBe('/usr/bin/cloudflared');
    expect(calls).toEqual([]);
  });

  it('downloads the pinned release, verifies it and reuses it next time', async () => {
    const dir = tempDir();
    const calls: string[] = [];
    const progress: number[] = [];
    const options = {
      dir,
      platform: 'linux' as const,
      arch: 'x64',
      env: {},
      fetch: fakeFetch(bytes, calls),
      exists: (p: string) => p.startsWith(dir) && existsSync(p),
      assets: { 'linux-x64': { file: 'cloudflared-linux-amd64', sha256: digest } },
      onProgress: (f: number) => progress.push(f),
    };
    const path = await ensureCloudflared(options);
    expect(calls).toEqual([
      `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`,
    ]);
    expect(readFileSync(path)).toEqual(Buffer.from(bytes));
    expect(progress.at(-1)).toBe(1);
    await ensureCloudflared(options);
    expect(calls).toHaveLength(1);
  });

  it('refuses a download that does not match the pinned hash and keeps nothing', async () => {
    const dir = tempDir();
    await expect(
      ensureCloudflared({
        dir,
        platform: 'linux',
        arch: 'x64',
        env: {},
        fetch: fakeFetch(new TextEncoder().encode('something else')),
        exists: (p) => p.startsWith(dir) && existsSync(p),
        assets: { 'linux-x64': { file: 'cloudflared-linux-amd64', sha256: digest } },
      }),
    ).rejects.toThrow(/fingerprint/);
    expect(existsSync(join(dir, `cloudflared-${CLOUDFLARED_VERSION}`))).toBe(false);
    expect(existsSync(join(dir, 'cloudflared-linux-amd64.part'))).toBe(false);
  });

  it('explains when there is no download for this computer', async () => {
    await expect(
      ensureCloudflared({
        dir: tempDir(),
        platform: 'freebsd',
        arch: 'x64',
        env: {},
        fetch: fakeFetch(bytes),
      }),
    ).rejects.toThrow(/Install cloudflared/);
  });
});
