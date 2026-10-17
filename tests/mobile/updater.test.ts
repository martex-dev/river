import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MANIFEST_FILENAME,
  SIGNATURE_FILENAME,
  keyIdFromPublicKey,
  rawPublicKeyOf,
  sha256Hex,
  sha512Base64,
  signManifest,
  type ReleaseChannel,
  type TrustedKey,
} from '@river/release';
import { nullLogger } from '../../apps/desktop/src/main/logger.ts';
import type { UpdateStatus } from '../../apps/desktop/src/shared/ipc.ts';
import {
  AndroidUpdateService,
  LATEST_DOWNLOAD_BASE,
  RELEASES_API_URL,
  installedAbi,
  pickApk,
  pickNewestRelease,
  signingDecision,
  wantedVersion,
} from '../../apps/mobile/core/updater.ts';

/**
 * River for Android's updater (apps/mobile/core/updater.ts) against a fake app shell: the asks
 * UpdateOps.java answers on a phone (device, download, progress, signers, install).
 */

const RELEASES = 'https://github.com/martex-dev/river/releases/download';
const CERT_A = 'a'.repeat(64);
const CERT_B = 'b'.repeat(64);
const CERT_OLD = 'c'.repeat(64);

function releaseKey(): { pem: string; trusted: TrustedKey[] } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = rawPublicKeyOf(publicKey);
  return {
    pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    trusted: [{ keyId: keyIdFromPublicKey(raw), publicKey: raw.toString('base64') }],
  };
}

/** A signed release as release.yml publishes it: manifest + .sig + the APKs. */
function release(version: string, pem: string, apks: Record<string, Buffer>) {
  const files = Object.entries(apks).map(([name, data]) => ({
    name,
    size: data.length,
    sha256: sha256Hex(data),
    sha512: sha512Base64(data),
  }));
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 1,
      product: 'river-desktop',
      version,
      channel: version.includes('-beta') ? 'beta' : version.includes('-alpha') ? 'nightly' : 'stable',
      gitCommit: '0'.repeat(40),
      createdAt: new Date().toISOString(),
      files,
    }),
  );
  const sig = Buffer.from(JSON.stringify(signManifest(manifest, pem)));
  return { manifest, sig, apks };
}

interface ShellOptions {
  urls: Map<string, Buffer>;
  abis?: string[];
  versionCode?: number;
  installed?: { current: string[]; history: string[] };
  apk?: { current: string[]; history: string[] } | null;
  packageName?: string;
  install?: Array<{ status: string; message?: string }>;
  /** Bytes written instead of what was asked for (a tampered download). */
  tamper?: (url: string, data: Buffer) => Buffer;
}

function fakeShell(o: ShellOptions) {
  const asks: Array<{ kind: string; args: Record<string, unknown> }> = [];
  const installs = [...(o.install ?? [{ status: 'success' }])];
  const ask = async <T>(kind: string, args: Record<string, unknown>): Promise<T> => {
    asks.push({ kind, args });
    switch (kind) {
      case 'update.device':
        return {
          abis: o.abis ?? ['arm64-v8a', 'armeabi-v7a'],
          versionCode: o.versionCode ?? 2_010_012_2,
        } as T;
      case 'update.download': {
        const url = args.url as string;
        const data = o.urls.get(url);
        if (!data) throw new Error('HTTP 404');
        if (data.length > (args.max as number)) throw new Error('the file is larger than expected');
        const written = o.tamper ? o.tamper(url, data) : data;
        writeFileSync(args.path as string, written);
        return { size: written.length, sha256: sha256Hex(written) } as T;
      }
      case 'update.progress':
        return { received: 0, total: -1 } as T;
      case 'update.signers':
        return {
          ownPackage: 'io.github.martexdev.river',
          packageName: o.packageName ?? 'io.github.martexdev.river',
          installed: o.installed ?? { current: [CERT_A], history: [CERT_A] },
          apk: o.apk === undefined ? { current: [CERT_A], history: [CERT_A] } : o.apk,
        } as T;
      case 'update.install':
        return (installs.shift() ?? { status: 'success' }) as T;
      default:
        throw new Error(`unexpected ask ${kind}`);
    }
  };
  return { ask, asks };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function service(
  shell: ReturnType<typeof fakeShell>,
  trusted: TrustedKey[],
  prefs: { channel?: ReleaseChannel; autoDownload?: boolean } = {},
  currentVersion = '2.10.12',
) {
  const dir = join(mkdtempSync(join(tmpdir(), 'river-update-')), 'updates');
  dirs.push(dir.slice(0, -'/updates'.length));
  const s = new AndroidUpdateService({
    currentVersion,
    preferences: () => ({ channel: prefs.channel ?? 'stable', autoDownload: prefs.autoDownload ?? true }),
    ask: shell.ask,
    dir,
    trustedKeys: trusted,
    log: nullLogger,
    progressMs: 5,
  });
  const states: UpdateStatus[] = [];
  s.onStatus((st) => states.push(st));
  return { s, dir, states };
}

const apk = (tag: string): Buffer => Buffer.from(`APK ${tag} `.repeat(200));

function stableRelease(version: string, pem: string) {
  const r = release(version, pem, {
    [`River-${version}-android-arm64.apk`]: apk(`${version} arm64`),
    [`River-${version}-android-arm32.apk`]: apk(`${version} arm32`),
    [`River-${version}-android-x86_64.apk`]: apk(`${version} x86_64`),
    [`River-Setup-${version}.exe`]: Buffer.from('windows'),
  });
  const urls = new Map<string, Buffer>([
    [`${LATEST_DOWNLOAD_BASE}/${MANIFEST_FILENAME}`, r.manifest],
    [`${LATEST_DOWNLOAD_BASE}/${SIGNATURE_FILENAME}`, r.sig],
    [`${RELEASES}/v${version}/${MANIFEST_FILENAME}`, r.manifest],
    [`${RELEASES}/v${version}/${SIGNATURE_FILENAME}`, r.sig],
  ]);
  for (const [name, data] of Object.entries(r.apks)) urls.set(`${RELEASES}/v${version}/${name}`, data);
  return { ...r, urls };
}

describe('Android updater: choosing the APK', () => {
  const manifest = {
    version: '2.11.0',
    files: ['arm64', 'arm32', 'x86_64'].map((s) => ({
      name: `River-2.11.0-android-${s}.apk`,
      size: 1,
      sha256: '0'.repeat(64),
      sha512: `${'A'.repeat(86)}==`,
    })),
  };

  it('maps version codes to the APK River was installed from', () => {
    expect(installedAbi(2_011_000 * 10 + 2)).toBe('arm64-v8a');
    expect(installedAbi(2_011_000 * 10 + 1)).toBe('armeabi-v7a');
    expect(installedAbi(2_011_000 * 10 + 3)).toBe('x86_64');
    // A build without ABI splits (debug, or an unknown digit).
    expect(installedAbi(2_011_000)).toBeNull();
    expect(installedAbi(undefined)).toBeNull();
  });

  it('takes the installed processor type first, then the phone’s preference', () => {
    expect(pickApk(manifest, ['arm64-v8a', 'armeabi-v7a'])?.file.name).toBe('River-2.11.0-android-arm64.apk');
    // Installed from the 32-bit APK on a 64-bit phone: stay on it (version codes differ per type).
    expect(pickApk(manifest, ['arm64-v8a', 'armeabi-v7a'], 'armeabi-v7a')?.file.name).toBe(
      'River-2.11.0-android-arm32.apk',
    );
    expect(pickApk(manifest, ['x86_64', 'x86'])?.abi).toBe('x86_64');
    // No APK for 32-bit x86, nor for unknown names.
    expect(pickApk(manifest, ['x86', 'mips', '__proto__'])).toBeNull();
    const only32 = { ...manifest, files: manifest.files.filter((f) => f.name.includes('arm32')) };
    expect(pickApk(only32, ['arm64-v8a', 'armeabi-v7a'], 'arm64-v8a')?.abi).toBe('armeabi-v7a');
  });
});

describe('Android updater: versions and channels', () => {
  it('only takes strictly newer releases on the chosen channel', () => {
    expect(wantedVersion('2.11.0', '2.10.12', 'stable')).toBe(true);
    expect(wantedVersion('2.10.12', '2.10.12', 'stable')).toBe(false);
    expect(wantedVersion('2.10.11', '2.10.12', 'stable')).toBe(false);
    expect(wantedVersion('2.11.0-beta.1', '2.10.12', 'stable')).toBe(false);
    expect(wantedVersion('2.11.0-beta.1', '2.10.12', 'beta')).toBe(true);
    expect(wantedVersion('2.11.0-alpha.1', '2.10.12', 'beta')).toBe(false);
    expect(wantedVersion('2.11.0-rc.1', '2.10.12', 'nightly')).toBe(false);
    expect(wantedVersion('not a version', '2.10.12', 'nightly')).toBe(false);
  });

  it('picks the newest wanted release from GitHub’s (untrusted) release list', () => {
    const list = [
      { tag_name: 'v2.12.0-alpha.1' },
      { tag_name: 'v2.11.0-beta.2' },
      { tag_name: 'v2.11.0-beta.3', draft: true },
      { tag_name: 'v2.10.13' },
      { tag_name: 'nightly' },
      null,
      { tag_name: 7 },
    ];
    expect(pickNewestRelease(list, 'beta', '2.10.12')).toBe('2.11.0-beta.2');
    expect(pickNewestRelease(list, 'nightly', '2.10.12')).toBe('2.12.0-alpha.1');
    expect(pickNewestRelease(list, 'stable', '2.10.12')).toBe('2.10.13');
    expect(pickNewestRelease(list, 'beta', '2.12.0')).toBeNull();
    expect(pickNewestRelease({ message: 'rate limited' }, 'beta', '2.10.12')).toBeNull();
  });
});

describe('Android updater: signing certificates', () => {
  it('installs over the same key, or a rotated key that proves the old one', () => {
    expect(
      signingDecision({ current: [CERT_A], history: [CERT_A] }, { current: [CERT_A], history: [CERT_A] }),
    ).toBe('same');
    expect(
      signingDecision(
        { current: [CERT_OLD], history: [CERT_OLD] },
        { current: [CERT_A], history: [CERT_OLD, CERT_A] },
      ),
    ).toBe('same');
  });

  it('says when a release is signed with another key (preview builds)', () => {
    expect(
      signingDecision({ current: [CERT_OLD], history: [CERT_OLD] }, { current: [CERT_A], history: [CERT_A] }),
    ).toBe('different');
    // Several signers: the sets must match.
    expect(
      signingDecision({ current: [CERT_A, CERT_B], history: [] }, { current: [CERT_B, CERT_A], history: [] }),
    ).toBe('same');
    expect(
      signingDecision({ current: [CERT_A, CERT_B], history: [] }, { current: [CERT_A], history: [CERT_A] }),
    ).toBe('different');
  });

  it('leaves it to Android when a side could not be read', () => {
    expect(signingDecision(null, { current: [CERT_A], history: [] })).toBe('unknown');
    expect(signingDecision({ current: [CERT_A], history: [] }, null)).toBe('unknown');
    expect(signingDecision({ current: [], history: [] }, { current: [CERT_A], history: [] })).toBe('unknown');
  });
});

describe('Android updater: the whole update', () => {
  it('downloads the signed APK for this phone, verifies it and hands it to Android’s installer', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({
      urls: r.urls,
      install: [{ status: 'permission-needed' }, { status: 'aborted' }, { status: 'success' }],
    });
    const { s, dir } = service(shell, trusted);
    expect(await s.check()).toEqual({ state: 'ready', version: '2.11.0' });
    const downloads = shell.asks.filter((a) => a.kind === 'update.download').map((a) => a.args.url);
    expect(downloads).toEqual([
      `${LATEST_DOWNLOAD_BASE}/${MANIFEST_FILENAME}`,
      `${LATEST_DOWNLOAD_BASE}/${SIGNATURE_FILENAME}`,
      `${RELEASES}/v2.11.0/River-2.11.0-android-arm64.apk`,
    ]);
    // Every download stays in River's update folder, with a size cap.
    for (const a of shell.asks.filter((x) => x.kind === 'update.download')) {
      expect(String(a.args.path).startsWith(dir)).toBe(true);
      expect(a.args.max).toBeGreaterThan(0);
    }
    expect(
      shell.asks.find((a) => a.kind === 'update.download' && String(a.args.url).endsWith('.apk'))?.args.max,
    ).toBe(r.apks['River-2.11.0-android-arm64.apk']!.length);
    // The signing certificate is compared before anything is installed.
    const kinds = shell.asks.map((a) => a.kind);
    expect(kinds.indexOf('update.signers')).toBeGreaterThan(-1);
    expect(kinds).not.toContain('update.install');
    // A periodic check while an update waits does not download it again.
    expect(await s.check()).toEqual({ state: 'ready', version: '2.11.0' });

    await s.install();
    const apkPath = join(dir, 'River-2.11.0-android-arm64.apk');
    expect(shell.asks.at(-1)).toEqual({ kind: 'update.install', args: { path: apkPath } });
    expect(s.getStatus()).toEqual({ state: 'ready', version: '2.11.0', needsPermission: true });
    await s.install(); // the installer was closed without an answer
    expect(s.getStatus()).toEqual({ state: 'ready', version: '2.11.0' });
    await s.install();
    expect(s.getStatus()).toEqual({ state: 'installing', version: '2.11.0' });
  });

  it('keeps the 32-bit APK for a phone that runs it', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({ urls: r.urls, versionCode: 2_010_012 * 10 + 1 });
    const { s } = service(shell, trusted);
    await s.check();
    expect(shell.asks.some((a) => String(a.args.url).endsWith('River-2.11.0-android-arm32.apk'))).toBe(true);
  });

  it('refuses an APK that does not match the signed SHA-256, and deletes it', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({
      urls: r.urls,
      tamper: (url, data) =>
        url.endsWith('.apk') ? Buffer.concat([data.subarray(0, -1), Buffer.from('X')]) : data,
    });
    const { s, dir } = service(shell, trusted);
    expect(await s.check()).toMatchObject({ state: 'error', code: 'verification-failed' });
    expect(existsSync(join(dir, 'River-2.11.0-android-arm64.apk'))).toBe(false);
    expect(shell.asks.map((a) => a.kind)).not.toContain('update.signers');
    await expect(s.install()).rejects.toThrow(/No verified update/);
    expect(shell.asks.map((a) => a.kind)).not.toContain('update.install');
  });

  it('refuses a manifest not signed by a River release key, before downloading any APK', async () => {
    const { pem } = releaseKey();
    const other = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({ urls: r.urls });
    const { s } = service(shell, other.trusted);
    expect(await s.check()).toMatchObject({ state: 'error', code: 'manifest-unverified' });
    expect(shell.asks.some((a) => String(a.args.url).endsWith('.apk'))).toBe(false);
  });

  it('refuses an APK that is another app', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({ urls: r.urls, packageName: 'com.example.other' });
    const { s } = service(shell, trusted);
    expect(await s.check()).toMatchObject({ state: 'error', code: 'verification-failed' });
  });

  it('says honestly when only a fresh install gets the update (signed with another key)', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({
      urls: r.urls,
      installed: { current: [CERT_OLD], history: [CERT_OLD] },
      apk: { current: [CERT_A], history: [CERT_A] },
    });
    const { s, dir } = service(shell, trusted);
    const status = await s.check();
    expect(status).toMatchObject({ state: 'reinstall-needed', version: '2.11.0' });
    expect(status.state === 'reinstall-needed' && status.message).toMatch(/uninstall/i);
    expect(status.state === 'reinstall-needed' && status.message).toMatch(/Settings → Backup/);
    expect(existsSync(join(dir, 'River-2.11.0-android-arm64.apk'))).toBe(false);
    await expect(s.install()).rejects.toThrow();
    expect(shell.asks.map((a) => a.kind)).not.toContain('update.install');
    // The next check does not download the same release again.
    const apkDownloads = (): number => shell.asks.filter((a) => String(a.args.url).endsWith('.apk')).length;
    expect(apkDownloads()).toBe(1);
    expect(await s.check()).toMatchObject({ state: 'reinstall-needed', version: '2.11.0' });
    expect(apkDownloads()).toBe(1);
  });

  it('turns an installer conflict into the fresh-install explanation', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    // The certificates could not be read here; Android itself refuses the update.
    const shell = fakeShell({ urls: r.urls, apk: null, install: [{ status: 'conflict' }] });
    const { s } = service(shell, trusted);
    expect(await s.check()).toEqual({ state: 'ready', version: '2.11.0' });
    await s.install();
    expect(s.getStatus()).toMatchObject({ state: 'reinstall-needed', version: '2.11.0' });
  });

  it('reports an installer failure without pretending it worked', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({
      urls: r.urls,
      install: [{ status: 'failed', message: 'INSTALL_FAILED_INSUFFICIENT_STORAGE' }],
    });
    const { s } = service(shell, trusted);
    await s.check();
    await s.install();
    expect(s.getStatus()).toMatchObject({ state: 'error', code: 'install-failed' });
    expect(s.getStatus().state === 'error' && s.getStatus()).toMatchObject({
      message: expect.stringMatching(/INSUFFICIENT_STORAGE.*unchanged/),
    });
    // Checking again offers the verified download again without fetching it twice.
    expect(await s.check()).toEqual({ state: 'ready', version: '2.11.0' });
  });

  it('is up to date when the signed release is not newer', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.10.12', pem);
    const shell = fakeShell({ urls: r.urls });
    const { s } = service(shell, trusted);
    expect(await s.check()).toMatchObject({ state: 'up-to-date' });
    expect(shell.asks.some((a) => a.kind === 'update.device')).toBe(false);
  });

  it('waits for the user when automatic downloads are off', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({ urls: r.urls });
    const { s } = service(shell, trusted, { autoDownload: false });
    expect(await s.check()).toEqual({ state: 'available', version: '2.11.0' });
    expect(shell.asks.some((a) => String(a.args.url).endsWith('.apk'))).toBe(false);
    await s.install(); // "Download update"
    expect(s.getStatus()).toEqual({ state: 'ready', version: '2.11.0' });
    expect(shell.asks.map((a) => a.kind)).not.toContain('update.install');
  });

  it('fails cleanly when the shell cannot download (no network)', async () => {
    const { trusted } = releaseKey();
    const shell = fakeShell({ urls: new Map() });
    const { s, states } = service(shell, trusted);
    expect(await s.check()).toMatchObject({
      state: 'error',
      code: 'check-failed',
      message: expect.stringMatching(/Could not reach/),
    });
    expect(states.map((x) => x.state)).toEqual(['checking', 'error']);
  });

  it('takes a pre-release on the beta channel, only with a manifest signed for exactly that version', async () => {
    const { pem, trusted } = releaseKey();
    const beta = release('2.11.0-beta.1', pem, { 'River-2.11.0-beta.1-android-arm64.apk': apk('beta') });
    const stable = stableRelease('2.10.13', pem);
    const list = Buffer.from(JSON.stringify([{ tag_name: 'v2.11.0-beta.1' }, { tag_name: 'v2.10.13' }]));
    const urls = new Map(stable.urls);
    urls.set(RELEASES_API_URL, list);
    urls.set(`${RELEASES}/v2.11.0-beta.1/${MANIFEST_FILENAME}`, beta.manifest);
    urls.set(`${RELEASES}/v2.11.0-beta.1/${SIGNATURE_FILENAME}`, beta.sig);
    urls.set(
      `${RELEASES}/v2.11.0-beta.1/River-2.11.0-beta.1-android-arm64.apk`,
      beta.apks['River-2.11.0-beta.1-android-arm64.apk']!,
    );
    expect(await service(fakeShell({ urls }), trusted, { channel: 'beta' }).s.check()).toEqual({
      state: 'ready',
      version: '2.11.0-beta.1',
    });
    // Stable ignores the list and the pre-release.
    expect(await service(fakeShell({ urls }), trusted).s.check()).toEqual({
      state: 'ready',
      version: '2.10.13',
    });
    // A list naming a version whose files are another (older) release's signed manifest is refused.
    const replay = new Map(urls);
    replay.set(`${RELEASES}/v2.11.0-beta.1/${MANIFEST_FILENAME}`, stable.manifest);
    replay.set(`${RELEASES}/v2.11.0-beta.1/${SIGNATURE_FILENAME}`, stable.sig);
    expect(await service(fakeShell({ urls: replay }), trusted, { channel: 'beta' }).s.check()).toMatchObject({
      state: 'error',
      code: 'manifest-unverified',
    });
    // Without the list (rate limited, offline), beta still gets the latest stable release.
    const noList = new Map(urls);
    noList.delete(RELEASES_API_URL);
    expect(await service(fakeShell({ urls: noList }), trusted, { channel: 'beta' }).s.check()).toEqual({
      state: 'ready',
      version: '2.10.13',
    });
  });

  it('clears old downloads when River starts', async () => {
    const { pem, trusted } = releaseKey();
    const r = stableRelease('2.11.0', pem);
    const shell = fakeShell({ urls: r.urls });
    const { s, dir } = service(shell, trusted);
    await s.check();
    expect(existsSync(join(dir, 'River-2.11.0-android-arm64.apk'))).toBe(true);
    s.start();
    expect(existsSync(dir)).toBe(false);
  });
});
