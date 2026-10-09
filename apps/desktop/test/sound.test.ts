import { describe, expect, it } from 'vitest';
import {
  SOUND_GROUP,
  SOUND_GROUPS,
  audible,
  type SoundConfig,
} from '../src/renderer/src/community/sound-rules.ts';

const config = (over: Partial<SoundConfig> = {}): SoundConfig => ({
  sounds: true,
  soundVolume: 0.8,
  soundGroups: { messages: true, voice: true, calls: true, social: true, interface: true },
  ...over,
});

describe('interface sounds', () => {
  it('every sound belongs to a known group', () => {
    for (const group of Object.values(SOUND_GROUP)) expect(SOUND_GROUPS).toContain(group);
  });

  it('respects the master switch, the volume and each group', () => {
    expect(audible('send', config())).toBe(true);
    expect(audible('send', config({ sounds: false }))).toBe(false);
    expect(audible('send', config({ soundVolume: 0 }))).toBe(false);
    const noMessages = config({ soundGroups: { ...config().soundGroups, messages: false } });
    expect(audible('send', noMessages)).toBe(false);
    expect(audible('mention', noMessages)).toBe(false);
    expect(audible('selfJoin', noMessages)).toBe(true);
  });

  it('plays by default before settings have loaded', () => {
    expect(audible('ring', undefined)).toBe(true);
  });
});
