import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { nullLogger } from '../src/main/logger.ts';
import {
  UpdateService,
  type UpdatePreferences,
  type UpdaterLike,
} from '../src/main/updater/update-service.ts';
import type { UpdateStatus } from '../src/shared/ipc.ts';

/** Mimics electron-updater's behaviour, including the channel setter enabling downgrades. */
class FakeUpdater extends EventEmitter implements UpdaterLike {
  private _channel: string | null = null;
  allowPrerelease = false;
  allowDowngrade = false;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  offer: string | null = null;
  checkForUpdates = vi.fn(async () => {
    if (this.offer) this.emit('update-available', { version: this.offer });
    else this.emit('update-not-available', { version: '0.0.1' });
  });
  downloadUpdate = vi.fn(async () => {
    this.emit('download-progress', { percent: 50 });
    this.emit('update-downloaded', { version: this.offer, downloadedFile: '/tmp/River-Setup.exe' });
  });
  quitAndInstall = vi.fn();
  install = vi.fn(() => true);

  get channel(): string | null {
    return this._channel;
  }
  set channel(v: string | null) {
    this._channel = v;
    this.allowDowngrade = true;
  }
}

function setup(
  opts: Partial<UpdatePreferences> & {
    mode?: 'auto' | 'manual';
    verify?: () => Promise<void>;
    hold?: () => string | null;
  } = {},
) {
  const updater = new FakeUpdater();
  const prefs: UpdatePreferences = {
    channel: opts.channel ?? 'stable',
    autoDownload: opts.autoDownload ?? true,
    installOnQuit: opts.installOnQuit ?? true,
  };
  const verifyDownload = vi.fn(opts.verify ?? (async () => {}));
  const service = new UpdateService({
    updater,
    currentVersion: '0.0.1',
    mode: opts.mode ?? 'auto',
    preferences: () => prefs,
    verifyDownload,
    ...(opts.hold ? { installHold: opts.hold } : {}),
    log: nullLogger,
    now: () => new Date('2026-10-08T00:00:00Z'),
  });
  const seen: UpdateStatus['state'][] = [];
  service.onStatus((s) => seen.push(s.state));
  return { updater, service, prefs, verifyDownload, seen };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('UpdateService', () => {
  it('configures channels and never allows downgrades', () => {
    const { updater, service, prefs } = setup({ channel: 'beta' });
    expect(updater.channel).toBe('beta');
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);

    prefs.channel = 'nightly';
    service.applyPreferences();
    expect(updater.channel).toBe('alpha');
    expect(updater.allowDowngrade).toBe(false);

    prefs.channel = 'stable';
    service.applyPreferences();
    expect(updater.channel).toBe('latest');
    expect(updater.allowPrerelease).toBe(false);
  });

  it('downloads, verifies and becomes ready for a newer release', async () => {
    const { updater, service, verifyDownload, seen } = setup();
    updater.offer = '0.0.2';
    await service.check();
    await flush();
    expect(verifyDownload).toHaveBeenCalledWith('0.0.2', '/tmp/River-Setup.exe');
    expect(service.getStatus()).toEqual({ state: 'ready', version: '0.0.2' });
    expect(seen).toEqual(['checking', 'downloading', 'downloading', 'verifying', 'ready']);
    service.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('holds install-on-quit while the current version keeps failing to start', async () => {
    let hold: string | null = 'this version has been failing to start';
    const { updater, service } = setup({ hold: () => hold });
    updater.offer = '0.0.2';
    await service.check();
    await flush();
    expect(service.getStatus().state).toBe('ready');
    expect(service.installOnQuit()).toBe(false);
    expect(updater.install).not.toHaveBeenCalled();
    hold = null;
    expect(service.installOnQuit()).toBe(true);
  });

  it('refuses to install when signature verification fails', async () => {
    const { updater, service } = setup({
      verify: async () => {
        throw new Error('bad-signature');
      },
    });
    updater.offer = '0.0.2';
    await service.check();
    await flush();
    const status = service.getStatus();
    expect(status.state).toBe('error');
    expect(status.state === 'error' && status.code).toBe('verification-failed');
    expect(() => service.install()).toThrow(/No verified update/);
    expect(service.installOnQuit()).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.install).not.toHaveBeenCalled();
  });

  it('ignores equal or older versions even if the updater offers them', async () => {
    const { updater, service } = setup();
    for (const v of ['0.0.1', '0.0.0']) {
      updater.offer = v;
      await service.check();
      await flush();
      expect(service.getStatus().state).toBe('up-to-date');
    }
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('ignores pre-releases on the stable channel', async () => {
    const { updater, service } = setup({ channel: 'stable' });
    updater.offer = '0.0.2-beta.1';
    await service.check();
    await flush();
    expect(service.getStatus().state).toBe('up-to-date');
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('accepts a beta on the beta channel but not a nightly', async () => {
    const beta = setup({ channel: 'beta' });
    beta.updater.offer = '0.0.2-beta.1';
    await beta.service.check();
    await flush();
    expect(beta.service.getStatus().state).toBe('ready');

    const nightly = setup({ channel: 'beta' });
    nightly.updater.offer = '0.0.2-alpha.3';
    await nightly.service.check();
    await flush();
    expect(nightly.service.getStatus().state).toBe('up-to-date');
  });

  it('ignores unsupported prerelease tags', async () => {
    const { updater, service } = setup({ channel: 'nightly' });
    updater.offer = '0.0.2-rc.1';
    await service.check();
    await flush();
    expect(service.getStatus().state).toBe('up-to-date');
  });

  it('only points to the download page in manual mode (unsigned macOS)', async () => {
    const { updater, service } = setup({ mode: 'manual' });
    updater.offer = '0.0.2';
    await service.check();
    await flush();
    expect(service.getStatus()).toEqual({ state: 'manual', version: '0.0.2' });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(service.installOnQuit()).toBe(false);
  });

  it('waits for the user when automatic download is off', async () => {
    const { updater, service } = setup({ autoDownload: false });
    updater.offer = '0.0.2';
    await service.check();
    await flush();
    expect(service.getStatus()).toEqual({ state: 'available', version: '0.0.2' });
    await service.download();
    await flush();
    expect(service.getStatus().state).toBe('ready');
  });

  it('rejects a download for a different version than announced', async () => {
    const { updater, service, verifyDownload } = setup();
    updater.offer = '0.0.2';
    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('update-downloaded', { version: '0.0.3', downloadedFile: '/tmp/x' });
    });
    await service.check();
    await flush();
    expect(service.getStatus().state).toBe('error');
    expect(verifyDownload).not.toHaveBeenCalled();
  });

  it('installs on quit only when verified and allowed', async () => {
    const off = setup({ installOnQuit: false });
    off.updater.offer = '0.0.2';
    await off.service.check();
    await flush();
    expect(off.service.installOnQuit()).toBe(false);

    const on = setup({ installOnQuit: true });
    expect(on.service.installOnQuit()).toBe(false); // nothing ready yet
    on.updater.offer = '0.0.2';
    await on.service.check();
    await flush();
    expect(on.service.installOnQuit()).toBe(true);
    expect(on.updater.install).toHaveBeenCalledWith(true, false);
  });

  it('keeps a verified update ready if a later background error occurs', async () => {
    const { updater, service } = setup();
    updater.offer = '0.0.2';
    await service.check();
    await flush();
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(service.getStatus().state).toBe('ready');
  });

  it('reports friendly network errors', async () => {
    const { updater, service } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'));
    await service.check();
    const s = service.getStatus();
    expect(s.state === 'error' && s.message).toMatch(/Could not reach the update server/);
  });
});
