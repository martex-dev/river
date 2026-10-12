import { describe, expect, it } from 'vitest';
import { dayRange, joinsPerWeek, summarizeActivity } from '../src/shared/insights.ts';

const now = new Date('2026-10-12T12:00:00Z');

describe('insights', () => {
  it('counts messages per day, channel and person in the period', () => {
    const msgs = [
      { channelId: 'a', sender: 'x', sentAt: '2026-10-12T09:00:00Z' },
      { channelId: 'a', sender: 'y', sentAt: '2026-10-11T09:00:00Z' },
      { channelId: 'b', sender: 'x', sentAt: '2026-10-11T10:00:00Z' },
      { channelId: 'b', sender: 'x', sentAt: '2026-09-01T10:00:00Z' },
    ];
    const s = summarizeActivity(msgs, now, 7);
    expect(s.total).toBe(3);
    expect(s.days.at(-1)).toEqual({ date: '2026-10-12', count: 1 });
    expect(s.days.at(-2)).toEqual({ date: '2026-10-11', count: 2 });
    expect(s.channels).toEqual([
      { channelId: 'a', count: 2 },
      { channelId: 'b', count: 1 },
    ]);
    expect(s.people[0]).toEqual({ riverId: 'x', count: 2 });
  });

  it('builds day ranges and weekly joins', () => {
    expect(dayRange(now, 3)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(joinsPerWeek(['2026-10-12', '2026-10-10', '2026-10-01', undefined, '2025-01-01'], now, 3)).toEqual(
      [0, 1, 2],
    );
  });
});
