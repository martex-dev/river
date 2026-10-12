import { describe, expect, it } from 'vitest';
import {
  FOREVER,
  effectiveNotify,
  inQuietHours,
  isMuted,
  newReactions,
  muteUntil,
  shouldAlert,
  silenced,
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

describe('quiet hours', () => {
  const at = (h: number, m = 0): Date => new Date(2026, 9, 12, h, m);
  const q = (start: string, end: string, enabled = true) => ({ enabled, start, end });

  it('covers a range that crosses midnight', () => {
    expect(inQuietHours(q('22:00', '08:00'), at(23))).toBe(true);
    expect(inQuietHours(q('22:00', '08:00'), at(7, 59))).toBe(true);
    expect(inQuietHours(q('22:00', '08:00'), at(8))).toBe(false);
    expect(inQuietHours(q('22:00', '08:00'), at(12))).toBe(false);
  });

  it('covers a daytime range and ignores disabled or empty ones', () => {
    expect(inQuietHours(q('09:00', '17:30'), at(17, 29))).toBe(true);
    expect(inQuietHours(q('09:00', '17:30'), at(17, 30))).toBe(false);
    expect(inQuietHours(q('09:00', '17:30', false), at(10))).toBe(false);
    expect(inQuietHours(q('09:00', '09:00'), at(9))).toBe(false);
  });

  it('silences for Do Not Disturb or quiet hours', () => {
    const base = { ...DEFAULT_SETTINGS };
    expect(silenced(base, at(12))).toBe(false);
    expect(silenced({ ...base, presence: { ...base.presence, status: 'dnd' } }, at(12))).toBe(true);
    expect(
      silenced(
        { ...base, notifications: { ...base.notifications, quietHours: q('11:00', '13:00') } },
        at(12),
      ),
    ).toBe(true);
  });
});

describe('new reactions', () => {
  it('finds reactions others added, never your own', () => {
    const prev = [{ emoji: '👍', users: ['a'] }];
    const next = [
      { emoji: '👍', users: ['a', 'b', 'me'] },
      { emoji: '🔥', users: ['c'] },
    ];
    expect(newReactions(prev, next, 'me')).toEqual([
      { emoji: '👍', user: 'b' },
      { emoji: '🔥', user: 'c' },
    ]);
    expect(newReactions(next, prev, 'me')).toEqual([]);
  });
});
