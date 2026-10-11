import { describe, expect, it, vi } from 'vitest';
import { AUTO_IDLE_SECONDS, PresenceTracker } from '../src/main/presence.ts';
import { readCustomStatus } from '../src/main/community/community-service.ts';
import { audible, type SoundConfig } from '../src/renderer/src/community/sound-rules.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';

const base = (over: Partial<Settings['presence']> = {}): Settings['presence'] => ({
  ...DEFAULT_SETTINGS.presence,
  ...over,
});

describe('presence', () => {
  it('turns Online into Idle after ten minutes away, but never overrides a chosen status', () => {
    let idle = 0;
    let s = base();
    const t = new PresenceTracker({ settings: () => s, idleSeconds: () => idle });
    expect(t.status()).toBe('online');
    idle = AUTO_IDLE_SECONDS;
    expect(t.status()).toBe('idle');
    s = base({ status: 'dnd' });
    expect(t.status()).toBe('dnd');
    s = base({ status: 'invisible' });
    expect(t.status()).toBe('invisible');
    s = base({ autoIdle: false });
    expect(t.status()).toBe('online');
  });

  it('a custom status disappears when it expires', () => {
    let now = Date.parse('2026-10-11T10:00:00Z');
    const s = base({ customText: 'at lunch', customEmoji: '🍕', customUntil: '2026-10-11T11:00:00Z' });
    const t = new PresenceTracker({ settings: () => s, idleSeconds: () => 0, now: () => now });
    expect(t.custom()).toEqual({ text: 'at lunch', emoji: '🍕', until: '2026-10-11T11:00:00Z' });
    now = Date.parse('2026-10-11T11:00:01Z');
    expect(t.custom()).toBeNull();
  });

  it('announces a change once, when it actually changes', () => {
    let idle = 0;
    const t = new PresenceTracker({ settings: () => base(), idleSeconds: () => idle });
    const changed = vi.fn();
    t.onChange(changed);
    t.check();
    expect(changed).not.toHaveBeenCalled();
    idle = AUTO_IDLE_SECONDS + 1;
    t.check();
    t.check();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('reads only valid, unexpired custom statuses from other people', () => {
    expect(readCustomStatus({ text: 'hi', emoji: '👋' })).toEqual({ text: 'hi', emoji: '👋' });
    expect(readCustomStatus({ text: 'old', until: '2000-01-01T00:00:00Z' })).toBeNull();
    expect(readCustomStatus({ text: 42, emoji: {} })).toBeNull();
    expect(readCustomStatus({ text: 'x'.repeat(500) })!.text).toHaveLength(128);
    expect(readCustomStatus(undefined)).toBeNull();
  });

  it('Do Not Disturb silences sounds from others but keeps your own clicks and voice sounds', () => {
    const config: SoundConfig = {
      ...DEFAULT_SETTINGS.notifications,
      quiet: true,
    };
    expect(audible('message', config)).toBe(false);
    expect(audible('mention', config)).toBe(false);
    expect(audible('ring', config)).toBe(false);
    expect(audible('send', config)).toBe(true);
    expect(audible('mute', config)).toBe(true);
    expect(audible('message', { ...config, quiet: false })).toBe(true);
  });
});
