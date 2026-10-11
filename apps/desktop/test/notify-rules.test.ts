import { describe, expect, it } from 'vitest';
import {
  FOREVER,
  effectiveNotify,
  isMuted,
  muteUntil,
  shouldAlert,
  withOverride,
} from '../src/shared/notify-rules.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';

const now = Date.parse('2026-10-11T12:00:00Z');
const prefs = (overrides: Settings['notifications']['overrides'], mode: 'all' | 'mentions' = 'all') => ({
  ...DEFAULT_SETTINGS.notifications,
  mode,
  overrides,
});

describe('notification rules', () => {
  it('channel beats community beats global', () => {
    const p = prefs({ C: { level: 'mentions', muteUntil: null }, ch: { level: 'all', muteUntil: null } });
    expect(effectiveNotify(p, 'C', 'ch', now).level).toBe('all');
    expect(effectiveNotify(p, 'C', 'other', now).level).toBe('mentions');
    expect(effectiveNotify(prefs({}, 'mentions'), 'C', 'ch', now).level).toBe('mentions');
  });

  it('muting silences messages but not mentions; Nothing silences both', () => {
    const muted = effectiveNotify(prefs({ ch: { level: 'default', muteUntil: FOREVER } }), 'C', 'ch', now);
    expect(muted.muted).toBe(true);
    expect(shouldAlert(muted, false)).toBe(false);
    expect(shouldAlert(muted, true)).toBe(true);
    const nothing = effectiveNotify(prefs({ C: { level: 'nothing', muteUntil: null } }), 'C', 'ch', now);
    expect(shouldAlert(nothing, true)).toBe(false);
  });

  it('a muted community mutes its channels; mutes expire', () => {
    const p = prefs({ C: { level: 'default', muteUntil: muteUntil(3600_000, now) } });
    expect(effectiveNotify(p, 'C', 'ch', now).muted).toBe(true);
    expect(effectiveNotify(p, 'C', 'ch', now + 3600_001).muted).toBe(false);
    expect(isMuted(p, 'C', now)).toBe(true);
  });

  it('keeps the settings file tidy: default, unmuted entries disappear', () => {
    let o = withOverride({}, 'ch', { muteUntil: FOREVER }, now);
    expect(o).toEqual({ ch: { level: 'default', muteUntil: FOREVER } });
    o = withOverride(o, 'ch', { muteUntil: null }, now);
    expect(o).toEqual({});
    o = withOverride(o, 'ch', { level: 'nothing' }, now);
    expect(o.ch!.level).toBe('nothing');
  });
});
