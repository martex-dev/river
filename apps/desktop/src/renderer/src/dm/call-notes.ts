import type { CallView } from '../../../shared/dm.ts';

/** "5 min", "1 h 2 min", "40 s". */
export function duration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** The line shown in a conversation for a call (1.0.29). */
export function callNote(c: Pick<CallView, 'direction' | 'video' | 'answered' | 'durationSec'>): string {
  const icon = c.video ? '📹' : '📞';
  const kind = c.video ? 'Video call' : 'Call';
  if (!c.answered)
    return c.direction === 'in' ? `${icon} Missed ${kind.toLowerCase()}` : `${icon} ${kind} — no answer`;
  return `${icon} ${kind} · ${duration(c.durationSec)}`;
}

/** Calls that started after `after` (exclusive) and up to `before` (inclusive); null means open-ended. */
export function callsBetween(calls: CallView[], after: string | null, before: string | null): CallView[] {
  return calls
    .filter((c) => (after === null || c.startedAt > after) && (before === null || c.startedAt <= before))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
