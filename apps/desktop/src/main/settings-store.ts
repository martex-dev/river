import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SECTIONS,
  applySettingsPatch,
  normalizeSettings,
  pruneUnknownKeys,
  settingsPatchSchema,
  settingsSchema,
  upgradeSettings,
  type Settings,
} from '../shared/settings.ts';
import type { Logger } from './logger.ts';

/**
 * Settings persisted as JSON in the user-data directory. Holds preferences
 * only — never keys or content (those go to the encrypted database from 0.0.3).
 * Writes are atomic (temp file + rename) so a crash cannot leave a torn file.
 */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  private readonly path: string;
  private readonly log: Logger;

  constructor(path: string, log: Logger) {
    this.path = path;
    this.log = log;
    this.current = this.load();
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  /** Validates an untrusted patch (it comes from the renderer) and persists it. */
  update(patch: unknown): Settings {
    const parsed = settingsPatchSchema.parse(patch);
    this.current = applySettingsPatch(this.current, parsed);
    this.save();
    for (const l of this.listeners) l(this.get());
    return this.get();
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private load(): Settings {
    if (!existsSync(this.path)) return structuredClone(DEFAULT_SETTINGS);
    try {
      // Files written by older Rivers lack newer sections; fill them in before validating. Keys
      // this River does not know (a newer River wrote them) are dropped, not fatal.
      const raw: unknown = pruneUnknownKeys(
        settingsSchema,
        upgradeSettings(JSON.parse(readFileSync(this.path, 'utf8'))),
      );
      const result = settingsSchema.safeParse(raw);
      if (result.success) {
        const settings = normalizeSettings(result.data);
        // Older Rivers copied the background picture into every appearance profile: keep it once.
        if (JSON.stringify(settings.design) !== JSON.stringify(result.data.design)) {
          this.log.info('Settings: background pictures are now kept once');
          this.saveQuietly(settings);
        }
        return settings;
      }
      // Keep sections that are still valid instead of discarding everything.
      const merged = normalizeSettings(this.salvage(raw));
      this.log.warn('Settings file failed validation; recovered valid sections and kept a backup');
      this.backupInvalid();
      // Save what was recovered: otherwise the next start finds no file and uses defaults.
      this.saveQuietly(merged);
      return merged;
    } catch {
      this.log.warn('Settings file unreadable; using defaults and keeping a backup');
      this.backupInvalid();
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  private salvage(raw: unknown): Settings {
    const out = structuredClone(DEFAULT_SETTINGS);
    if (raw && typeof raw === 'object') {
      const r = raw as Record<string, unknown>;
      for (const key of SETTINGS_SECTIONS) {
        const section = settingsSchema.shape[key].safeParse(r[key]);
        if (section.success) (out as Record<string, unknown>)[key] = section.data;
      }
    }
    return out;
  }

  private backupInvalid(): void {
    try {
      renameSync(this.path, `${this.path}.invalid-${Date.now()}`);
    } catch {
      // ignore
    }
  }

  private save(settings: Settings = this.current): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  private saveQuietly(settings: Settings): void {
    try {
      this.save(settings);
    } catch {
      this.log.warn('Could not save recovered settings');
    }
  }
}
