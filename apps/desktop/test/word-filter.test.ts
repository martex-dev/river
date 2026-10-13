import { describe, expect, it } from 'vitest';
import { findFiltered, normalize, parseWords, readFilter } from '../src/shared/word-filter.ts';

describe('word filter', () => {
  it('matches whole words, ignoring case, accents and look-alikes', () => {
    const words = ['spam', 'free money'];
    expect(findFiltered('This is SPAM!', words)).toBe('spam');
    expect(findFiltered('get sp4m now', words)).toBe('spam');
    expect(findFiltered('Spâm here', words)).toBe('spam');
    expect(findFiltered('free   money inside', words)).toBe('free money');
    expect(findFiltered('spammer and spamspam', words)).toBeNull();
    expect(findFiltered('nothing to see', words)).toBeNull();
  });

  it('works for other alphabets', () => {
    expect(findFiltered('това е глупост', ['глупост'])).toBe('глупост');
    expect(findFiltered('глупостта', ['глупост'])).toBeNull();
  });

  it('parses a moderator’s list and reads stored filters safely', () => {
    expect(parseWords('spam, Spam\n free money ,,\n')).toEqual(['spam', 'free money']);
    expect(readFilter({ words: ['a', 5], mode: 'block' })).toEqual({ words: ['a'], mode: 'block' });
    expect(readFilter({ words: [], mode: 'block' })).toBeNull();
    expect(readFilter('nope')).toBeNull();
    expect(normalize('H3LL0')).toBe('hello');
  });
});
