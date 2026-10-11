import { describe, expect, it } from 'vitest';
import data from 'emojibase-data/en/compact.json';
import codes from 'emojibase-data/en/shortcodes/github.json';
import { buildIndex, replaceShortcodes, searchEmoji } from '../src/renderer/src/community/emoji-data.ts';

const index = buildIndex(
  data as Parameters<typeof buildIndex>[0],
  codes as unknown as Record<string, string | string[]>,
);

describe('emoji', () => {
  it('has the full set in categories, without skin-tone components', () => {
    expect(index.all.length).toBeGreaterThan(1500);
    expect(index.groups.map((g) => g.name)).not.toContain('Components');
    expect(index.groups[0]!.items[0]!.emoji).toBe('😀');
  });

  it('finds by shortcode first, then names and keywords', () => {
    expect(searchEmoji(index, 'joy')[0]!.emoji).toBe('😂');
    expect(searchEmoji(index, ':fire:')[0]!.emoji).toBe('🔥');
    expect(searchEmoji(index, 'pizza').map((e) => e.emoji)).toContain('🍕');
    expect(searchEmoji(index, 'lol').map((e) => e.emoji)).toContain('😂');
    expect(searchEmoji(index, 'zzzzqq')).toEqual([]);
  });

  it('turns :shortcodes: into emoji when sending, but not inside code or when unknown', () => {
    expect(replaceShortcodes('nice :fire: :+1: :nope:', index)).toMatch(/^nice 🔥 👍️? :nope:$/u);
    expect(replaceShortcodes('`:fire:` and ```\n:fire:\n```', index)).toBe('`:fire:` and ```\n:fire:\n```');
    expect(replaceShortcodes('10:30:45', index)).toBe('10:30:45');
  });
});
