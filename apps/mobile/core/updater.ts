import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANIFEST_FILENAME,
  ReleaseVerificationError,
  SIGNATURE_FILENAME,
  channelAccepts,
  channelOfVersion,
  isNewerVersion,
  verifyManifest,
  type ReleaseChannel,
  type ReleaseFileEntry,
  type ReleaseManifest,
  type TrustedKey,
} from '@river/release';
import type { UpdateStatus } from '../../desktop/src/shared/ipc.ts';
import type { Logger } from '../../desktop/src/main/logger.ts';
import { RELEASE_DOWNLOAD_BASE, RELEASE_REPO } from '../../desktop/src/main/updater/verify-download.ts';
import { fill, type Vars } from '../../desktop/src/shared/i18n/index.ts';

/** Says a message in River's language (main.ts passes it); English without it. */
type Say = (text: string, vars?: Vars) => string;

/**
 * River for Android updates itself from GitHub Releases, with the desktop's
 * trust rules:
 *
 *  - the release manifest must be signed by a River Ed25519 release key built
 *    into this app (the same verifier as the desktop, @river/release);
 *  - only a strictly newer version on the user's channel is taken (no
 *    downgrades, no pre-releases unless the user chose Beta or Nightly);
 *  - the APK for this phone's processor must match the signed SHA-256 and size;
 *  - its Android signing certificate must be the one River is installed with,
 *    or Android could not install it as an update anyway (early releases were
 *    signed with one-off preview keys): then the user is told, honestly, that
 *    only a fresh install gets this version.
 *
 * Android's own installer (PackageInstaller) does the install and always asks
 * the user to confirm. The app shell downloads (GitHub's release downloads do
 * not allow cross-origin requests from the core's WebView) and computes the
 * SHA-256 with the platform's MessageDigest; this file decides.
 */

export const LATEST_DOWNLOAD_BASE = `https://github.com/${RELEASE_REPO}/releases/latest/download`;
/** Pre-release channels look for the newest release (the "latest" link only knows stable ones). */
export const RELEASES_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=15`;
export const FIRST_CHECK_DELAY_MS = 20_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_RELEASE_LIST_BYTES = 4 * 1024 * 1024;

/** Build.SUPPORTED_ABIS names → the suffix of River's APK for that processor (release.yml). */
export const APK_ABIS: Readonly<Record<string, string>> = {
  'arm64-v8a': 'arm64',
  'armeabi-v7a': 'arm32',
  x86_64: 'x86_64',
};

/** The last digit of each APK's versionCode (android/app/build.gradle) → its processor type. */
const VERSION_CODE_ABI: Readonly<Record<number, string>> = { 1: 'armeabi-v7a', 2: 'arm64-v8a', 3: 'x86_64' };

export function apkName(version: string, abi: string): string | null {
  const suffix = Object.hasOwn(APK_ABIS, abi) ? APK_ABIS[abi] : undefined;
  return suffix ? `River-${version}-android-${suffix}.apk` : null;
}

/** The processor type of the APK River is installed from, or null when unknown. */
export function installedAbi(versionCode: number | null | undefined): string | null {
  if (typeof versionCode !== 'number' || !Number.isSafeInteger(versionCode) || versionCode < 0) return null;
  return VERSION_CODE_ABI[versionCode % 10] ?? null;
}

/**
 * The signed release file for this phone: the processor type River is installed for first (another
 * type's APK has a different version code), then the phone's own order of preference.
 */
export function pickApk(
  manifest: Pick<ReleaseManifest, 'version' | 'files'>,
  abis: readonly string[],
  current?: string | null,
): { abi: string; file: ReleaseFileEntry } | null {
  const order = current && abis.includes(current) ? [current, ...abis.filter((a) => a !== current)] : abis;
  for (const abi of order) {
    const name = apkName(manifest.version, abi);
    const file = name ? manifest.files.find((f) => f.name === name) : undefined;
    if (file) return { abi, file };
  }
  return null;
}

/** SHA-256 (hex) of signing certificates: the current signer(s), and the rotation history. */
export interface Signers {
  current: string[];
  history: string[];
}

const HEX_DIGEST = /^[0-9a-f]{64}$/;
const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && HEX_DIGEST.test(x)) : [];
const cleanSigners = (v: unknown): Signers | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as { current?: unknown; history?: unknown };
  return { current: cleanList(o.current), history: cleanList(o.history) };
};

/**
 * Whether Android can install the downloaded APK over this one: the same signer, or (one signer
 * with key rotation) a new key whose proven history includes the installed one. 'unknown' when
 * either side could not be read; Android checks again itself and refuses a mismatch.
 */
export function signingDecision(
  installed: Signers | null,
  apk: Signers | null,
): 'same' | 'different' | 'unknown' {
  if (!installed || !apk || installed.current.length === 0 || apk.current.length === 0) return 'unknown';
  if (installed.current.length > 1 || apk.current.length > 1) {
    const a = new Set(installed.current);
    const b = new Set(apk.current);
    return a.size === b.size && [...a].every((x) => b.has(x)) ? 'same' : 'different';
  }
  const mine = installed.current[0]!;
  return apk.current[0] === mine || apk.history.includes(mine) ? 'same' : 'different';
}

/** True when `version` is a River release this install should update to. */
export function wantedVersion(version: string, current: string, channel: ReleaseChannel): boolean {
  let releaseChannel: ReleaseChannel;
  try {
    releaseChannel = channelOfVersion(version);
  } catch {
    return false;
  }
  return isNewerVersion(version, current) && channelAccepts(channel, releaseChannel);
}

/**
 * The newest release in a GitHub release list that this install wants, or null. The list is not
 * trusted: whatever it names must still come with a manifest signed for exactly that version.
 */
export function pickNewestRelease(list: unknown, channel: ReleaseChannel, current: string): string | null {
  if (!Array.isArray(list)) return null;
  let best: string | null = null;
  for (const r of list as Array<{ tag_name?: unknown; draft?: unknown } | null>) {
    if (!r || r.draft === true || typeof r.tag_name !== 'string' || !r.tag_name.startsWith('v')) continue;
    const version = r.tag_name.slice(1);
    if (!wantedVersion(version, current, channel)) continue;
    if (best === null || isNewerVersion(version, best)) best = version;
  }
  return best;
}

export function reinstallMessage(version: string, t: Say = fill): string {
  return t(
    'River {version} is signed with a different key than the River installed on this phone (early Android builds were signed with one-off preview keys), so Android cannot install it as an update. To get it, uninstall River and install the new version from the download page. Uninstalling deletes River’s data on this phone — your identity, messages and settings — unless you make a backup first in Settings → Backup.',
    { version },
  );
}

/** What the app shell answers (UpdateOps.java; tests/mobile fake it). */
interface DeviceAnswer {
  abis?: unknown;
  versionCode?: unknown;
}
interface DownloadAnswer {
  size?: unknown;
  sha256?: unknown;
}
interface SignersAnswer {
  installed?: unknown;
  apk?: unknown;
  packageName?: unknown;
  ownPackage?: unknown;
}
interface InstallAnswer {
  status?: unknown;
  message?: unknown;
}

export interface AndroidUpdaterDeps {
  currentVersion: string;
  preferences: () => { channel: ReleaseChannel; autoDownload: boolean };
  /** The app shell's asks (host.ts). */
  ask: <T>(kind: string, args: Record<string, unknown>) => Promise<T>;
  /** Where downloads go, inside River's own storage (the shell refuses anything else). */
  dir: string;
  trustedKeys: readonly TrustedKey[];
  log: Logger;
  now?: () => Date;
  /** How often download progress is asked for. */
  progressMs?: number;
  /** How long "installing" waits for Android's answer before Install can be tapped again. */
  installWaitMs?: number;
  /** Messages in River's language; English without it. */
  t?: Say;
}

/**
 * Android may never answer an install (2.11.2): its confirmation could not open (River was in the
 * background) or was left behind a notification. After this long the update shows as ready again.
 */
export const INSTALL_WAIT_MS = 2 * 60 * 1000;

const BUSY = new Set<UpdateStatus['state']>(['checking', 'downloading', 'verifying', 'installing', 'ready']);

/** Thrown with a code that picks the message the user sees. */
class UpdateFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class AndroidUpdateService {
  private status: UpdateStatus = { state: 'idle' };
  private readonly listeners = new Set<(s: UpdateStatus) => void>();
  private readonly deps: AndroidUpdaterDeps;
  /** The newest wanted release and the APK for this phone, once a check found one. */
  private found: { version: string; abi: string; file: ReleaseFileEntry } | null = null;
  /** A downloaded, verified APK waiting for the user. */
  private verified: { version: string; path: string } | null = null;
  /** A version known to be signed with another key: not downloaded again. */
  private mismatched: string | null = null;
  private installRun = 0;

  constructor(deps: AndroidUpdaterDeps) {
    this.deps = deps;
  }

  /** Clears downloads of earlier runs (an installed update's APK is no longer needed). */
  start(): void {
    try {
      rmSync(this.deps.dir, { recursive: true, force: true });
    } catch (err) {
      this.deps.log.warn(`Could not clear old update downloads: ${(err as Error).message}`);
    }
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  onStatus(listener: (s: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<UpdateStatus> {
    if (BUSY.has(this.status.state)) return this.status;
    this.setStatus({ state: 'checking' });
    try {
      const manifest = await this.fetchManifest();
      if (!manifest) {
        this.setStatus({ state: 'up-to-date', checkedAt: this.now() });
        return this.status;
      }
      const version = manifest.version;
      if (this.verified?.version === version) {
        this.setStatus({ state: 'ready', version });
        return this.status;
      }
      if (this.mismatched === version) {
        this.setStatus({
          state: 'reinstall-needed',
          version,
          message: reinstallMessage(version, this.deps.t),
        });
        return this.status;
      }
      const device = await this.deps.ask<DeviceAnswer | null>('update.device', {});
      const abis = Array.isArray(device?.abis)
        ? device.abis.filter((a): a is string => typeof a === 'string')
        : [];
      const apk = pickApk(manifest, abis, installedAbi(device?.versionCode as number | undefined));
      if (!apk) {
        throw new UpdateFailure(
          'no-apk',
          `Release ${version} has no APK for ${abis.join(', ') || 'this phone'}`,
        );
      }
      this.found = { version, ...apk };
      this.deps.log.info(`Update ${version} available (${apk.abi})`);
      if (this.deps.preferences().autoDownload) await this.download();
      else this.setStatus({ state: 'available', version });
    } catch (err) {
      this.fail(err, 'check-failed');
    }
    return this.status;
  }

  /**
   * The Settings and toast "install" action. With an update found but not downloaded yet (automatic
   * downloads off) it downloads and verifies it; with a verified update it opens Android's installer.
   */
  async install(): Promise<void> {
    if (this.status.state === 'available') {
      await this.download();
      return;
    }
    const ready = this.verified;
    if (!ready || (this.status.state !== 'ready' && this.status.state !== 'installing')) {
      throw new Error('No verified update is ready to install');
    }
    const run = ++this.installRun;
    const { version, path } = ready;
    this.deps.log.info(`Installing verified update ${version}`);
    this.setStatus({ state: 'installing', version });
    const waiting = setTimeout(() => {
      if (run !== this.installRun || this.status.state !== 'installing') return;
      this.deps.log.warn(`No answer from Android's installer for ${version}: ready to try again`);
      this.setStatus({ state: 'ready', version });
    }, this.deps.installWaitMs ?? INSTALL_WAIT_MS);
    let answer: InstallAnswer | null;
    try {
      answer = await this.deps.ask<InstallAnswer | null>('update.install', { path });
    } catch (err) {
      if (run === this.installRun) this.fail(err, 'install-failed');
      return;
    } finally {
      clearTimeout(waiting);
    }
    // Tapped again meanwhile: the newer attempt decides.
    if (run !== this.installRun) return;
    const message = typeof answer?.message === 'string' ? answer.message : '';
    switch (answer?.status) {
      case 'permission-needed':
        this.setStatus({ state: 'ready', version, needsPermission: true });
        break;
      case 'aborted':
        this.setStatus({ state: 'ready', version });
        break;
      case 'conflict':
        this.reinstallNeeded(version, path);
        break;
      case 'success':
        // Android replaces River now; the new version starts fresh.
        break;
      default:
        this.fail(
          new UpdateFailure('install-failed', message || 'Android did not install the update'),
          'install-failed',
        );
    }
  }

  private async fetchManifest(): Promise<ReleaseManifest | null> {
    const { currentVersion: current, log } = this.deps;
    const channel = this.deps.preferences().channel;
    let expected: string | null = null;
    if (channel !== 'stable') {
      try {
        const listPath = join(this.deps.dir, 'releases.json');
        await this.fetchTo(RELEASES_API_URL, listPath, MAX_RELEASE_LIST_BYTES);
        expected = pickNewestRelease(JSON.parse(readFileSync(listPath, 'utf8')), channel, current);
      } catch (err) {
        // The stable "latest" release still works without the list.
        log.warn(`Could not list releases: ${(err as Error).message}`);
      }
    }
    const base = expected
      ? `${RELEASE_DOWNLOAD_BASE}/v${encodeURIComponent(expected)}`
      : LATEST_DOWNLOAD_BASE;
    const manifestPath = join(this.deps.dir, MANIFEST_FILENAME);
    const signaturePath = join(this.deps.dir, SIGNATURE_FILENAME);
    await this.fetchTo(`${base}/${MANIFEST_FILENAME}`, manifestPath, MAX_METADATA_BYTES);
    await this.fetchTo(`${base}/${SIGNATURE_FILENAME}`, signaturePath, MAX_METADATA_BYTES);
    let manifest: ReleaseManifest;
    try {
      manifest = verifyManifest(
        readFileSync(manifestPath),
        readFileSync(signaturePath),
        this.deps.trustedKeys,
      );
    } catch (err) {
      if (err instanceof ReleaseVerificationError)
        throw new UpdateFailure('manifest-unverified', err.message);
      throw err;
    }
    if (expected && manifest.version !== expected) {
      throw new UpdateFailure(
        'manifest-unverified',
        `Signed manifest is for ${manifest.version}, expected ${expected}`,
      );
    }
    if (!wantedVersion(manifest.version, current, channel)) {
      log.info(`Ignoring ${manifest.version} on channel ${channel}`);
      return null;
    }
    return manifest;
  }

  private async fetchTo(url: string, path: string, max: number): Promise<{ size: number; sha256: string }> {
    mkdirSync(this.deps.dir, { recursive: true });
    const got = await this.deps.ask<DownloadAnswer | null>('update.download', { url, path, max });
    if (!got || typeof got.size !== 'number' || typeof got.sha256 !== 'string') {
      throw new Error('The download did not complete');
    }
    return { size: got.size, sha256: got.sha256.toLowerCase() };
  }

  private async download(): Promise<void> {
    const found = this.found;
    if (!found) return;
    const { version, file } = found;
    const path = join(this.deps.dir, file.name);
    this.setStatus({ state: 'downloading', version, percent: 0 });
    const url = `${RELEASE_DOWNLOAD_BASE}/v${encodeURIComponent(version)}/${encodeURIComponent(file.name)}`;
    const progress = setInterval(
      () => void this.progress(path, version, file.size),
      this.deps.progressMs ?? 500,
    );
    let got: { size: number; sha256: string };
    try {
      got = await this.fetchTo(url, path, file.size);
    } catch (err) {
      this.discard(path);
      this.fail(err, 'download-failed');
      return;
    } finally {
      clearInterval(progress);
    }
    this.setStatus({ state: 'verifying', version });
    try {
      if (got.size !== file.size || got.sha256 !== file.sha256) {
        throw new UpdateFailure(
          'verification-failed',
          `${file.name} does not match the signed release manifest`,
        );
      }
      const signers = await this.deps.ask<SignersAnswer | null>('update.signers', { path });
      if (
        typeof signers?.packageName === 'string' &&
        typeof signers.ownPackage === 'string' &&
        signers.packageName !== signers.ownPackage
      ) {
        throw new UpdateFailure('verification-failed', `${file.name} is not River (${signers.packageName})`);
      }
      const decision = signingDecision(cleanSigners(signers?.installed), cleanSigners(signers?.apk));
      if (decision === 'different') {
        this.reinstallNeeded(version, path);
        return;
      }
      this.deps.log.info(`Update ${version} verified (signer: ${decision})`);
    } catch (err) {
      this.discard(path);
      this.fail(err, 'verification-failed');
      return;
    }
    this.verified = { version, path };
    this.setStatus({ state: 'ready', version });
  }

  private async progress(path: string, version: string, size: number): Promise<void> {
    let answer: { received?: unknown } | null;
    try {
      answer = await this.deps.ask<{ received?: unknown } | null>('update.progress', { path });
    } catch {
      return;
    }
    const received = typeof answer?.received === 'number' ? answer.received : 0;
    const percent = size > 0 ? Math.min(100, Math.max(0, Math.round((received / size) * 100))) : 0;
    const s = this.status;
    if (s.state === 'downloading' && s.version === version && s.percent !== percent) {
      this.setStatus({ state: 'downloading', version, percent });
    }
  }

  private reinstallNeeded(version: string, path: string): void {
    this.deps.log.warn(`Update ${version} is signed with another Android key; a fresh install is needed`);
    this.mismatched = version;
    if (this.verified?.version === version) this.verified = null;
    this.discard(path);
    this.setStatus({ state: 'reinstall-needed', version, message: reinstallMessage(version, this.deps.t) });
  }

  private discard(path: string): void {
    try {
      rmSync(path, { force: true });
    } catch {
      // cleared at the next start
    }
  }

  private fail(err: unknown, fallback: string): void {
    const code = err instanceof UpdateFailure ? err.code : fallback;
    const raw = err instanceof Error ? err.message : String(err);
    this.deps.log.error(`Update ${code}: ${raw}`);
    this.setStatus({ state: 'error', message: friendlyMessage(code, raw, this.deps.t), code });
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}

function friendlyMessage(code: string, raw: string, t: Say = fill): string {
  switch (code) {
    case 'manifest-unverified':
      return t(
        'River found an update whose signature did not verify, so it was not downloaded. Your current version is unchanged.',
      );
    case 'verification-failed':
      return t(
        'An update was downloaded but did not match River’s signed release, so it was not installed. Your current version is unchanged.',
      );
    case 'no-apk':
      return t(
        'The newest River release has no download for this phone’s processor. Your current version is unchanged.',
      );
    case 'download-failed':
      return t('The update download failed. River will try again later.');
    case 'install-failed':
      return raw && !/^Android did not/.test(raw)
        ? t('Android did not install the update ({reason}). Your current version is unchanged.', {
            reason: raw,
          })
        : t('Android did not install the update. Your current version is unchanged.');
    default:
      return /net|host|timeout|timed out|connect|resolve|HTTP/i.test(raw)
        ? t('Could not reach the update server. River will try again later.')
        : t('Checking for updates failed. River will try again later.');
  }
}
