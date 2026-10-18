import { describe, expect, it } from 'vitest';
import { PAD_BLOCK, padJson, paddedLength, paddedLengthCapped, padme } from '../src/padding.ts';

describe('content padding', () => {
  it('pads short content to whole 160-byte blocks', () => {
    expect(paddedLength(1)).toBe(160);
    expect(paddedLength(160)).toBe(160);
    expect(paddedLength(161)).toBe(320);
    expect(paddedLength(2560)).toBe(2560);
    // Every short message, receipt and typing signal is the same size.
    for (const n of [2, 40, 100, 159]) expect(paddedLength(n)).toBe(PAD_BLOCK);
  });

  it('pads longer content with Padmé: never shorter, at most 12 % more, few distinct sizes', () => {
    const sizes = new Set<number>();
    for (let n = 2561; n < 200_000; n += 7) {
      const p = paddedLength(n);
      expect(p).toBeGreaterThanOrEqual(n);
      expect(p).toBeLessThanOrEqual(Math.ceil(n * 1.12));
      sizes.add(p);
    }
    // ~28 000 different lengths collapse into a few hundred buckets.
    expect(sizes.size).toBeLessThan(400);
    expect(padme(9)).toBe(10);
    expect(padme(1000)).toBe(1024);
  });

  it('never pads past the cap, and leaves content already over it untouched', () => {
    expect(paddedLengthCapped(100, 120)).toBe(120);
    expect(paddedLengthCapped(100, 1000)).toBe(160);
    expect(paddedLengthCapped(5000, 4000)).toBe(5000);
    expect(padJson('{"a":1}', 7)).toHaveLength(7);
  });

  it('padded JSON parses to the same value with a plain JSON.parse (what 2.11 and 2.12 do)', () => {
    const values: unknown[] = [
      { v: 1, t: 'msg', text: 'hi' },
      { text: 'ünïcødé 🙂', n: [1, 2, 3] },
      'just a string',
      42,
      { big: 'x'.repeat(10_000) },
    ];
    for (const value of values) {
      const json = JSON.stringify(value);
      const padded = padJson(json);
      expect(padded.length).toBe(paddedLength(new TextEncoder().encode(json).length));
      expect(JSON.parse(new TextDecoder().decode(padded))).toEqual(value);
      expect(JSON.parse(Buffer.from(padded).toString('utf8'))).toEqual(value);
    }
  });

  it('hides how long a short message is', () => {
    expect(padJson(JSON.stringify({ text: 'ok' })).length).toBe(
      padJson(JSON.stringify({ text: 'a somewhat longer message, still short' })).length,
    );
  });
});
