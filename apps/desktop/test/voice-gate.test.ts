import { describe, expect, it } from 'vitest';
import { GATE_HOLD_MS, VoiceGate, levelOf } from '../src/renderer/src/community/voice-gate.ts';

describe('input sensitivity gate', () => {
  it('opens when loud enough and stays open briefly after', () => {
    const g = new VoiceGate();
    expect(g.update(0.05, 0.2, 0)).toBe(false);
    expect(g.open).toBe(false);
    expect(g.update(0.3, 0.2, 80)).toBe(true);
    expect(g.open).toBe(true);
    expect(g.update(0.05, 0.2, 80 + GATE_HOLD_MS - 1)).toBe(false);
    expect(g.update(0.05, 0.2, 80 + GATE_HOLD_MS)).toBe(true);
    expect(g.open).toBe(false);
  });

  it('uses the microphone meter scale', () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(0.05)).toBeCloseTo(0.3);
    expect(levelOf(1)).toBe(1);
  });
});
