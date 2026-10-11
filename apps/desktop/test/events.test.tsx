import { describe, expect, it } from 'vitest';
import { eventPhase, toLocalInput, whenLabel } from '../src/renderer/src/community/ui/Events.tsx';

const at = (iso: string) => Date.parse(iso);
const ev = { startsAt: '2026-10-11T18:00:00.000Z', endsAt: '2026-10-11T19:00:00.000Z' };

describe('event times', () => {
  it('knows upcoming, live and past', () => {
    expect(eventPhase(ev, at('2026-10-11T17:00:00Z'))).toBe('upcoming');
    expect(eventPhase(ev, at('2026-10-11T18:30:00Z'))).toBe('live');
    expect(eventPhase(ev, at('2026-10-11T19:00:00Z'))).toBe('past');
  });

  it('says when, in plain words', () => {
    expect(whenLabel(ev, at('2026-10-11T17:50:00Z'))).toBe('Starts in 10 min');
    expect(whenLabel(ev, at('2026-10-11T18:10:00Z'))).toMatch(/^Happening now · until /);
    expect(whenLabel(ev, at('2026-10-11T20:00:00Z'))).toMatch(/^Ended /);
  });

  it('round-trips through a date-time field in local time', () => {
    const local = toLocalInput(ev.startsAt);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(local).toISOString()).toBe(ev.startsAt);
  });
});
