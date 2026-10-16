import { describe, expect, it } from 'vitest';
import { effectiveGain, PHONE_OUTPUT_VOLUME } from '../src/renderer/src/community/voice-level.ts';

describe('voice playback level', () => {
  it('multiplies personal volume, output volume and ducking', () => {
    expect(effectiveGain(1, 1, 1)).toBe(1);
    expect(effectiveGain(2, 1, 1)).toBe(2);
    expect(effectiveGain(1.5, PHONE_OUTPUT_VOLUME, 0.5)).toBeCloseTo(1.2);
  });

  it('never goes negative and is capped so a mistake cannot blast your ears', () => {
    expect(effectiveGain(-1, 1, 1)).toBe(0);
    expect(effectiveGain(2, 2, 1)).toBe(4);
    expect(effectiveGain(2, 2, 2)).toBe(4);
  });

  it('phones default louder than computers', () => {
    expect(PHONE_OUTPUT_VOLUME).toBeGreaterThan(1);
  });
});
