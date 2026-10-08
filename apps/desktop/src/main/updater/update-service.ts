import {
  UPDATER_CHANNEL_NAME,
  channelAccepts,
  channelOfVersion,
  isNewerVersion,
  type ReleaseChannel,
} from '@river/release/channels';
import type { UpdateStatus } from '../../shared/ipc.ts';
import type { Logger } from '../logger.ts';

/** The subset of electron-updater's AppUpdater River relies on (lets tests use a fake). */
export interface UpdaterLike {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (p: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (e: { version: string; downloadedFile: string }) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  /** Synchronous install used from the app's quit handler (absent on macOS/Squirrel). */
  install?(isSilent?: boolean, isForceRunAfter?: boolean): boolean;
}

export interface UpdatePreferences {
  channel: ReleaseChannel;
  autoDownload: boolean;
  installOnQuit: boolean;
}

export interface UpdateServiceDeps {
  updater: UpdaterLike;
  currentVersion: string;
  /** 'auto' installs verified updates; 'manual' (unsigned macOS) only points the user to the download. */
  mode: 'auto' | 'manual';
  preferences: () => UpdatePreferences;
  /** Throws if the downloaded file is not part of a correctly signed release for `version`. */
  verifyDownload: (version: string, filePath: string) => Promise<void>;
  log: Logger;
  now?: () => Date;
}

/**
 * Drives electron-updater with River's policy:
 *  - never auto-downloads before River's own checks (channel + strictly newer),
 *  - never installs anything that has not passed Ed25519 manifest verification,
 *  - never downgrades, even though electron-updater enables that when a channel is set.
 */
export class UpdateService {
  private status: UpdateStatus = { state: 'idle' };
  private readonly listeners = new Set<(s: UpdateStatus) => void>();
  private verifiedVersion: string | null = null;
  private pendingVersion: string | null = null;

  private readonly deps: UpdateServiceDeps;

  constructor(deps: UpdateServiceDeps) {
    this.deps = deps;
    const u = deps.updater;
    u.on('update-available', (info) => void this.onAvailable(info.version));
    u.on('update-not-available', () => {
      if (this.status.state === 'checking') this.setStatus({ state: 'up-to-date', checkedAt: this.now() });
    });
    u.on('download-progress', (p) => {
      if (this.pendingVersion) {
        this.setStatus({
          state: 'downloading',
          version: this.pendingVersion,
          percent: clampPercent(p.percent),
        });
      }
    });
    u.on('update-downloaded', (e) => void this.onDownloaded(e.version, e.downloadedFile));
    u.on('error', (err) => this.fail(err.message, 'updater-error'));
    this.applyPreferences();
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  onStatus(listener: (s: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-applies channel settings. Call whenever preferences change. */
  applyPreferences(): void {
    const prefs = this.deps.preferences();
    const u = this.deps.updater;
    u.channel = UPDATER_CHANNEL_NAME[prefs.channel];
    u.allowPrerelease = prefs.channel !== 'stable';
    // Setting `channel` flips allowDowngrade on inside electron-updater; River never downgrades.
    u.allowDowngrade = false;
    u.autoDownload = false;
    // electron-updater would decide this at download time, before River's signature check.
    // River installs on quit itself, and only after verification (see installOnQuit()).
    u.autoInstallOnAppQuit = false;
  }

  async check(): Promise<UpdateStatus> {
    const busy = ['checking', 'downloading', 'verifying'];
    if (busy.includes(this.status.state) || this.status.state === 'ready') return this.status;
    this.applyPreferences();
    this.setStatus({ state: 'checking' });
    try {
      await this.deps.updater.checkForUpdates();
    } catch (err) {
      this.fail((err as Error).message, 'check-failed');
    }
    return this.status;
  }

  /** Starts the download of an available update (when automatic download is off). */
  async download(): Promise<void> {
    if (this.status.state !== 'available' || !this.pendingVersion) return;
    await this.startDownload(this.pendingVersion);
  }

  /** Restarts into the verified update. Refuses unless verification succeeded. */
  install(): void {
    if (this.status.state !== 'ready' || this.verifiedVersion === null) {
      throw new Error('No verified update is ready to install');
    }
    this.deps.log.info(`Installing verified update ${this.verifiedVersion}`);
    this.deps.updater.quitAndInstall(false, true);
  }

  /**
   * Called from the app's `quit` handler. Installs silently if a verified update
   * is waiting and the user allows install-on-quit. Returns true if started.
   */
  installOnQuit(): boolean {
    if (this.status.state !== 'ready' || this.verifiedVersion === null) return false;
    if (!this.deps.preferences().installOnQuit || this.deps.mode !== 'auto') return false;
    if (!this.deps.updater.install) return false;
    this.deps.log.info(`Installing verified update ${this.verifiedVersion} on quit`);
    return this.deps.updater.install(true, false);
  }

  private async onAvailable(version: string): Promise<void> {
    const prefs = this.deps.preferences();
    let releaseChannel: ReleaseChannel;
    try {
      releaseChannel = channelOfVersion(version);
    } catch {
      this.deps.log.warn(`Ignoring update with unsupported version string ${version}`);
      this.setStatus({ state: 'up-to-date', checkedAt: this.now() });
      return;
    }
    if (
      !isNewerVersion(version, this.deps.currentVersion) ||
      !channelAccepts(prefs.channel, releaseChannel)
    ) {
      this.deps.log.info(`Ignoring ${version} (${releaseChannel}) on channel ${prefs.channel}`);
      this.setStatus({ state: 'up-to-date', checkedAt: this.now() });
      return;
    }
    this.pendingVersion = version;
    if (this.deps.mode === 'manual') {
      this.setStatus({ state: 'manual', version });
      return;
    }
    if (prefs.autoDownload) await this.startDownload(version);
    else this.setStatus({ state: 'available', version });
  }

  private async startDownload(version: string): Promise<void> {
    this.setStatus({ state: 'downloading', version, percent: 0 });
    try {
      await this.deps.updater.downloadUpdate();
    } catch (err) {
      this.fail((err as Error).message, 'download-failed');
    }
  }

  private async onDownloaded(version: string, file: string): Promise<void> {
    if (version !== this.pendingVersion) {
      this.fail(
        `Downloaded ${version} but expected ${this.pendingVersion ?? 'nothing'}`,
        'unexpected-version',
      );
      return;
    }
    this.setStatus({ state: 'verifying', version });
    try {
      await this.deps.verifyDownload(version, file);
    } catch (err) {
      this.verifiedVersion = null;
      this.fail(
        `Update ${version} failed signature verification and will not be installed: ${(err as Error).message}`,
        'verification-failed',
      );
      return;
    }
    this.verifiedVersion = version;
    this.deps.log.info(`Update ${version} verified`);
    this.setStatus({ state: 'ready', version });
  }

  private fail(message: string, code: string): void {
    this.deps.log.error(`Update ${code}: ${message}`);
    this.pendingVersion = this.status.state === 'ready' ? this.pendingVersion : null;
    if (this.status.state === 'ready') return; // a later background error must not hide a verified update
    this.setStatus({ state: 'error', message: friendlyMessage(code, message), code });
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}

function clampPercent(p: number): number {
  return Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : 0;
}

function friendlyMessage(code: string, raw: string): string {
  switch (code) {
    case 'verification-failed':
      return 'An update was downloaded but its signature did not verify, so it was not installed. Your current version is unchanged.';
    case 'check-failed':
    case 'updater-error':
      return /net::|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN/.test(raw)
        ? 'Could not reach the update server. River will try again later.'
        : 'Checking for updates failed. River will try again later.';
    case 'download-failed':
      return 'The update download failed. River will try again later.';
    default:
      return 'The update could not be completed. Your current version is unchanged.';
  }
}
