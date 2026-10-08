import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../src/main/logger.ts';
import { SettingsStore } from '../src/main/settings-store.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'river-settings-'));
  file = join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SettingsStore', () => {
  it('starts with private defaults', () => {
    const s = new SettingsStore(file, nullLogger).get();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.notifications.preview).toBe('none');
    expect(s.updates.channel).toBe('stable');
  });

  it('persists validated patches atomically', () => {
    const store = new SettingsStore(file, nullLogger);
    store.update({ updates: { channel: 'beta' }, appearance: { motion: 'reduced' } });
    expect(existsSync(`${file}.tmp`)).toBe(false);
    const reloaded = new SettingsStore(file, nullLogger).get();
    expect(reloaded.updates.channel).toBe('beta');
    expect(reloaded.updates.autoCheck).toBe(true);
    expect(reloaded.appearance.motion).toBe('reduced');
  });

  it('rejects malformed patches from the renderer', () => {
    const store = new SettingsStore(file, nullLogger);
    expect(() => store.update({ updates: { channel: 'evil' } })).toThrow();
    expect(() => store.update({ updates: { autoCheck: 'yes' } })).toThrow();
    expect(() => store.update({ unknown: true })).toThrow();
    expect(() => store.update({ updates: { channel: 'beta', extra: 1 } })).toThrow();
    expect(() => store.update(null)).toThrow();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('recovers valid sections from a damaged file and keeps a backup', () => {
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        updates: { channel: 'nightly', autoCheck: false, autoDownload: true, installOnQuit: true },
        appearance: 'broken',
      }),
    );
    const s = new SettingsStore(file, nullLogger).get();
    expect(s.updates.channel).toBe('nightly');
    expect(s.appearance).toEqual(DEFAULT_SETTINGS.appearance);
    expect(readdirSync(dir).some((n) => n.startsWith('settings.json.invalid-'))).toBe(true);
  });

  it('survives unreadable JSON', () => {
    writeFileSync(file, '{ not json');
    expect(new SettingsStore(file, nullLogger).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns copies, not internal state', () => {
    const store = new SettingsStore(file, nullLogger);
    const s = store.get();
    s.updates.channel = 'nightly';
    expect(store.get().updates.channel).toBe('stable');
    store.update({});
    expect(JSON.parse(readFileSync(file, 'utf8')).updates.channel).toBe('stable');
  });
});
