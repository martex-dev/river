import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../src/main/logger.ts';
import { SettingsStore } from '../src/main/settings-store.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { IMAGE_REF, designImage } from '../src/shared/design.ts';

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
      // 2.13: no proxy, history kept, no timer for new chats.
      privacy: DEFAULT_SETTINGS.privacy,
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

  it('tells listeners about every change, also the ones River makes itself', () => {
    const store = new SettingsStore(file, nullLogger);
    const seen: boolean[] = [];
    store.onChange((s) => seen.push(s.system.appLock));
    store.update({ system: { appLock: true } });
    store.update({ system: { appLock: false } }); // e.g. the phone has no screen lock
    expect(seen).toEqual([true, false]);
  });
});

describe('background pictures', () => {
  const picture = `data:image/png;base64,${'A'.repeat(200_000)}`;
  const other = `data:image/jpeg;base64,${'B'.repeat(1000)}`;
  const profile = (id: string, backgroundImage: string | null) => ({
    id,
    name: id,
    skin: DEFAULT_SETTINGS.design.skin,
    theme: DEFAULT_SETTINGS.design.theme,
    prefs: { ...DEFAULT_SETTINGS.design.prefs, background: 'image' as const, backgroundImage },
  });

  it('are kept once however many profiles use them', () => {
    const store = new SettingsStore(file, nullLogger);
    const design = {
      ...DEFAULT_SETTINGS.design,
      prefs: { ...DEFAULT_SETTINGS.design.prefs, background: 'image' as const, backgroundImage: picture },
      profiles: Array.from({ length: 30 }, (_, i) => profile(`p-${i}`, picture)),
    };
    const saved = store.update({ design });
    expect(Object.values(saved.design.images)).toEqual([picture]);
    const ref = saved.design.prefs.backgroundImage;
    expect(ref).toMatch(IMAGE_REF);
    expect(saved.design.profiles.every((p) => p.prefs.backgroundImage === ref)).toBe(true);
    expect(designImage(saved.design, ref)).toBe(picture);
    // One copy on disk, not 31.
    expect(readFileSync(file, 'utf8').length).toBeLessThan(picture.length * 2);
  });

  it('are moved out of the profiles of an older settings file when it is read', () => {
    const older = {
      ...DEFAULT_SETTINGS,
      design: {
        ...DEFAULT_SETTINGS.design,
        prefs: { ...DEFAULT_SETTINGS.design.prefs, backgroundImage: picture },
        profiles: [profile('a', picture), profile('b', picture), profile('c', other)],
      },
    };
    delete (older.design as { images?: unknown }).images;
    writeFileSync(file, JSON.stringify(older));
    const s = new SettingsStore(file, nullLogger).get();
    expect(Object.values(s.design.images).sort()).toEqual([picture, other].sort());
    expect(designImage(s.design, s.design.profiles[2]!.prefs.backgroundImage)).toBe(other);
    expect(designImage(s.design, s.design.profiles[0]!.prefs.backgroundImage)).toBe(picture);
    // Written back in the compact form at once.
    expect(readFileSync(file, 'utf8').split(picture).length - 1).toBe(1);
  });

  it('go when nothing uses them any more', () => {
    const store = new SettingsStore(file, nullLogger);
    const first = store.update({
      design: {
        ...DEFAULT_SETTINGS.design,
        prefs: { ...DEFAULT_SETTINGS.design.prefs, backgroundImage: picture },
        profiles: [profile('a', other)],
      },
    });
    expect(Object.keys(first.design.images)).toHaveLength(2);
    const after = store.update({
      design: { ...first.design, prefs: { ...first.design.prefs, backgroundImage: null }, profiles: [] },
    });
    expect(after.design.images).toEqual({});
    // A reference to a picture that is not there shows nothing (and is dropped).
    const dangling = store.update({
      design: { ...after.design, prefs: { ...after.design.prefs, backgroundImage: 'image:nothere' } },
    });
    expect(dangling.design.prefs.backgroundImage).toBeNull();
  });
});
