import { describe, expect, it } from 'vitest';
import {
  FOREVER,
  MUTE_CHOICES,
  conversationNotify,
  effectiveNotify,
  inQuietHours,
  isMuted,
  mentionsYou,
  newReactions,
  muteUntil,
  shouldAlert,
  silenced,
  textMention,
  withOverride,
} from '../src/shared/notify-rules.ts';
import { DEFAULT_SETTINGS, settingsSchema, upgradeSettings, type Settings } from '../src/shared/settings.ts';

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

describe('chats, sounds and @everyone (2.17)', () => {
  it('a chat notifies for everything by default; Nothing and mute silence it, mentions still come through a mute', () => {
    expect(conversationNotify(prefs({}, 'mentions'), 'g', now)).toEqual({
      level: 'all',
      muted: false,
      sound: 'default',
      suppressEveryone: false,
    });
    const muted = conversationNotify(prefs({ g: { level: 'default', muteUntil: FOREVER } }), 'g', now);
    expect(shouldAlert(muted, false)).toBe(false);
    expect(shouldAlert(muted, true)).toBe(true);
    const mentions = conversationNotify(prefs({ g: { level: 'mentions', muteUntil: null } }), 'g', now);
    expect(shouldAlert(mentions, false)).toBe(false);
    expect(shouldAlert(mentions, true)).toBe(true);
    expect(
      shouldAlert(conversationNotify(prefs({ g: { level: 'nothing', muteUntil: null } }), 'g', now), true),
    ).toBe(false);
  });

  it('takes the sound nearest to the message: channel, then category, then community', () => {
    const p = prefs({
      C: { level: 'default', muteUntil: null, sound: 'bell' },
      cat: { level: 'default', muteUntil: null, sound: 'pop' },
      ch: { level: 'default', muteUntil: null, sound: 'default' },
    });
    expect(effectiveNotify(p, 'C', 'ch', now, 'cat').sound).toBe('pop');
    expect(effectiveNotify(p, 'C', 'ch', now).sound).toBe('bell');
    expect(effectiveNotify(prefs({}), 'C', 'ch', now).sound).toBe('default');
    const quiet = prefs({ peer: { level: 'default', muteUntil: null, sound: 'none' } });
    expect(conversationNotify(quiet, 'peer').sound).toBe('none');
  });

  it('a community can ignore @everyone and @here, never your name or a reply to you', () => {
    const p = prefs({ C: { level: 'mentions', muteUntil: null, suppressEveryone: true } });
    const e = effectiveNotify(p, 'C', 'ch', now);
    expect(e.suppressEveryone).toBe(true);
    expect(mentionsYou(e, { mentionsMe: true, mentionKind: 'everyone' })).toBe(false);
    expect(mentionsYou(e, { mentionsMe: true, mentionKind: 'direct' })).toBe(true);
    expect(shouldAlert(e, mentionsYou(e, { mentionsMe: true, mentionKind: 'everyone' }))).toBe(false);
    const open = effectiveNotify(prefs({}), 'C', 'ch', now);
    expect(mentionsYou(open, { mentionsMe: true, mentionKind: 'everyone' })).toBe(true);
    expect(mentionsYou(open, { mentionsMe: false })).toBe(false);
  });

  it('finds mentions in group messages', () => {
    expect(textMention('hey @Alex, lunch?', ['alex'])).toBe('direct');
    expect(textMention('@everyone meeting now', ['Alex'])).toBe('everyone');
    expect(textMention('ping @here', [null])).toBe('everyone');
    expect(textMention('email me at a@here.com', ['Alex'])).toBeNull();
    expect(textMention('nothing for you', ['Alex', undefined])).toBeNull();
  });

  it('keeps sounds and @everyone in the settings file, and drops entries back at their defaults', () => {
    let o = withOverride({}, 'ch', { sound: 'chime' }, now);
    expect(o).toEqual({ ch: { level: 'default', muteUntil: null, sound: 'chime' } });
    o = withOverride(o, 'ch', { sound: 'default' }, now);
    expect(o).toEqual({});
    o = withOverride(o, 'C', { suppressEveryone: true }, now);
    expect(o.C).toEqual({ level: 'default', muteUntil: null, suppressEveryone: true });
    o = withOverride(o, 'C', { suppressEveryone: false }, now);
    expect(o).toEqual({});
  });

  it('offers mutes for an hour, 8 hours, a day and for good', () => {
    const labels = MUTE_CHOICES.map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining(['For 1 hour', 'For 8 hours', 'For 1 day', 'Until I turn it back on']),
    );
    expect(MUTE_CHOICES.find((c) => c.label === 'For 1 day')!.ms).toBe(86_400_000);
  });

  it('accepts the new keys in settings, and an older River’s file still loads', () => {
    const s = settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      notifications: {
        ...DEFAULT_SETTINGS.notifications,
        overrides: { C: { level: 'default', muteUntil: null, sound: 'harp', suppressEveryone: true } },
      },
    });
    expect(s.notifications.overrides.C!.sound).toBe('harp');
    expect(() =>
      settingsSchema.parse({
        ...DEFAULT_SETTINGS,
        notifications: {
          ...DEFAULT_SETTINGS.notifications,
          overrides: { C: { level: 'default', muteUntil: null, sound: 'siren' } },
        },
      }),
    ).toThrow();
    const { badge: _b, banners: _n, ...older } = DEFAULT_SETTINGS.notifications;
    const upgraded = settingsSchema.parse(upgradeSettings({ ...DEFAULT_SETTINGS, notifications: older }));
    expect(upgraded.notifications.badge).toBe(true);
    expect(upgraded.notifications.banners).toBe(true);
  });
});
