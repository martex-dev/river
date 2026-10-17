import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nullLogger } from '../src/main/logger.ts';
import { SettingsStore } from '../src/main/settings-store.ts';
import { IPC } from '../src/shared/ipc.ts';
import type { Settings } from '../src/shared/settings.ts';

vi.mock('electron', () => ({
  BrowserWindow: {},
  app: {},
  dialog: {},
  ipcMain: { handle: () => undefined, on: () => undefined },
  shell: {},
  desktopCapturer: {},
}));

const { broadcastSettings } = await import('../src/main/ipc.ts');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-settings-broadcast-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('settings changes reach the UI', () => {
  it('sends every change on the settings channel, including River’s own', () => {
    const store = new SettingsStore(join(dir, 'settings.json'), nullLogger);
    const sent: Array<[string, Settings]> = [];
    let destroyed = false;
    const target = {
      isDestroyed: () => destroyed,
      send: (channel: string, s: Settings) => sent.push([channel, s]),
    };
    const off = broadcastSettings(target as never, store);
    // The phone core turns app lock off when the phone has no screen lock.
    store.update({ system: { appLock: false } });
    expect(sent).toHaveLength(1);
    expect(sent[0]![0]).toBe(IPC.settingsChanged);
    expect(sent[0]![1].system.appLock).toBe(false);
    // Hosting turned on start-at-login by itself.
    store.update({ system: { startAtLogin: true } });
    expect(sent[1]![1].system.startAtLogin).toBe(true);
    // A window that is gone is not written to.
    destroyed = true;
    store.update({ system: { closeToTray: false } });
    expect(sent).toHaveLength(2);
    off();
    destroyed = false;
    store.update({ system: { closeToTray: true } });
    expect(sent).toHaveLength(2);
  });
});
