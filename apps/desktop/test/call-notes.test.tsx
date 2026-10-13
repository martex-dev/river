import { describe, expect, it } from 'vitest';
import { callNote, callsBetween, duration } from '../src/renderer/src/dm/call-notes.ts';

const call = (startedAt: string, over = {}) => ({
  id: startedAt,
  peer: 'p',
  name: 'P',
  avatar: null,
  direction: 'in' as const,
  video: false,
  answered: true,
  durationSec: 300,
  startedAt,
  ...over,
});

describe('call notes', () => {
  it('describe calls plainly', () => {
    expect(callNote(call('a'))).toBe('📞 Call · 5 min');
    expect(callNote(call('a', { answered: false }))).toBe('📞 Missed call');
    expect(callNote(call('a', { answered: false, direction: 'out', video: true }))).toBe(
      '📹 Video call — no answer',
    );
    expect(duration(45)).toBe('45 s');
    expect(duration(3720)).toBe('1 h 2 min');
  });
  it('places calls between messages', () => {
    const calls = [call('2026-10-12T10:00'), call('2026-10-12T12:00')];
    expect(callsBetween(calls, null, '2026-10-12T11:00').map((c) => c.id)).toEqual(['2026-10-12T10:00']);
    expect(callsBetween(calls, '2026-10-12T11:00', null).map((c) => c.id)).toEqual(['2026-10-12T12:00']);
  });
});
