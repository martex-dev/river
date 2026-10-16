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

  it('saves what it recovered, so the next start keeps it', () => {
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        updates: { channel: 'beta', autoCheck: false, autoDownload: true, installOnQuit: true },
        appearance: 'broken',
      }),
    );
    new SettingsStore(file, nullLogger);
    expect(existsSync(file)).toBe(true);
    const next = new SettingsStore(file, nullLogger).get();
    expect(next.updates).toMatchObject({ channel: 'beta', autoCheck: false });
  });

  it('drops keys it does not know instead of whole sections (a newer River wrote them)', () => {
    const written = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, Record<string, unknown>>;
    written.notifications = {
      ...written.notifications,
      preview: 'sender',
      soundGroups: { ...(written.notifications!.soundGroups as object), newGroup: false },
      quietHours: { enabled: true, start: '23:00', end: '07:00', weekendsOnly: true },
      futureSetting: 1,
    };
    written.voice = {
      ...written.voice,
      pushToTalkKey: 'KeyV',
      keybinds: { ...(written.voice!.keybinds as object), toggleVideoBlur: 'Ctrl+B' },
    };
    written.newSection = { anything: true };
    writeFileSync(file, JSON.stringify(written));
    const s = new SettingsStore(file, nullLogger).get();
    expect(s.notifications.preview).toBe('sender');
    expect(s.notifications.quietHours).toEqual({ enabled: true, start: '23:00', end: '07:00' });
    expect(s.notifications.soundGroups).toEqual(DEFAULT_SETTINGS.notifications.soundGroups);
    expect(s.voice.pushToTalkKey).toBe('KeyV');
    expect(s.voice.keybinds).toEqual(DEFAULT_SETTINGS.voice.keybinds);
    // Nothing was wrong with the file: no backup.
    expect(readdirSync(dir).some((n) => n.includes('.invalid-'))).toBe(false);
    // Patches from the window stay strict.
    const store = new SettingsStore(file, nullLogger);
    expect(() =>
      store.update({ notifications: { quietHours: { enabled: true, start: '23:00', end: '07:00', x: 1 } } }),
    ).toThrow();
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

  it('upgrades a settings file written by River 0.0.1 without losing anything', () => {
    // Exact shape River 0.0.1 wrote.
    const v001 = {
      schemaVersion: 1,
      updates: { channel: 'beta', autoCheck: false, autoDownload: true, installOnQuit: false },
      appearance: { motion: 'reduced' },
      notifications: { preview: 'sender' },
    };
    writeFileSync(file, JSON.stringify(v001));
    const s = new SettingsStore(file, nullLogger).get();
    expect(s).toEqual({
      ...v001,
      appearance: { ...DEFAULT_SETTINGS.appearance, motion: 'reduced' },
      // 1.0.45: skins arrived later; an old file gets River's default design.
      design: DEFAULT_SETTINGS.design,
      notifications: { ...DEFAULT_SETTINGS.notifications, preview: 'sender' },
      server: DEFAULT_SETTINGS.server,
      voice: DEFAULT_SETTINGS.voice,
      system: DEFAULT_SETTINGS.system,
      hosting: { enabled: false, keepAwake: true },
      presence: DEFAULT_SETTINGS.presence,
      rail: DEFAULT_SETTINGS.rail,
    });
    // A clean upgrade is not treated as corruption.
    expect(readdirSync(dir).some((n) => n.includes('.invalid-'))).toBe(false);
  });

  it('upgrades a 1.0.0 settings file with the new sound settings', () => {
    const v100 = {
      ...DEFAULT_SETTINGS,
      notifications: { preview: 'none', desktop: true, mode: 'mentions', sounds: false },
    };
    writeFileSync(file, JSON.stringify(v100));
    const s = new SettingsStore(file, nullLogger).get();
    expect(s.notifications).toEqual({
      ...DEFAULT_SETTINGS.notifications,
      mode: 'mentions',
      sounds: false,
    });
    expect(s.notifications.soundVolume).toBe(0.8);
  });

  it('stores a validated, normalised server address', () => {
    const store = new SettingsStore(file, nullLogger);
    store.update({ server: { url: 'https://River.Example.org/' } });
    expect(new SettingsStore(file, nullLogger).get().server.url).toBe('https://river.example.org');
    expect(() => store.update({ server: { url: 'http://river.example.org' } })).toThrow();
    store.update({ server: { url: null } });
    expect(store.get().server.url).toBeNull();
  });
});
