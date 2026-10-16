import { describe, expect, it } from 'vitest';
import { callClock } from '../src/renderer/src/dm/call-clock.ts';

describe('call timer', () => {
  it('shows minutes and seconds, then hours', () => {
    expect(callClock(0)).toBe('0:00');
    expect(callClock(42.9)).toBe('0:42');
    expect(callClock(725)).toBe('12:05');
    expect(callClock(3723)).toBe('1:02:03');
    expect(callClock(-5)).toBe('0:00');
  });
});
