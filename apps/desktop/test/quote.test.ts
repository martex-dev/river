import { describe, expect, it } from 'vitest';
import { quoteOf } from '../src/renderer/src/dm/quote.ts';

describe('reply privately', () => {
  it('quotes the first three lines of the message', () => {
    expect(quoteOf('one\ntwo\nthree\nfour', 'x')).toBe('> one\n> two\n> three\n');
    expect(quoteOf('  hi  ', 'x')).toBe('> hi\n');
  });
  it('says where it came from when the message has no text', () => {
    expect(quoteOf('', 'A message in Trip')).toBe('> A message in Trip\n');
  });
});
