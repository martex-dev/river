import type { CallView } from '../../../shared/dm.ts';
import { tr, trn } from '../i18n.ts';

/** "5 min", "1 h 2 min", "40 s". */
export function duration(sec: number): string {
  if (sec < 60) return trn('{count} s', sec);
  const m = Math.round(sec / 60);
  if (m < 60) return trn('{count} min', m);
  const h = Math.floor(m / 60);
  return m % 60 ? tr('{hours} h {minutes} min', { hours: h, minutes: m % 60 }) : trn('{count} h', h);
}

/** The line shown in a conversation for a call (1.0.29). */
export function callNote(
  c: Pick<CallView, 'direction' | 'video' | 'answered' | 'durationSec'> & Partial<Pick<CallView, 'outcome'>>,
): string {
  const icon = c.video ? '📹' : '📞';
  const v = c.video;
  if (!c.answered) {
    if (c.outcome === 'declined') return `${icon} ${v ? tr('Video call — declined') : tr('Call — declined')}`;
    if (c.outcome === 'failed')
      return `${icon} ${v ? tr('Video call — could not connect') : tr('Call — could not connect')}`;
    if (c.outcome === 'busy') return `${icon} ${v ? tr('Video call — busy') : tr('Call — busy')}`;
    if (c.direction === 'in') return `${icon} ${v ? tr('Missed video call') : tr('Missed call')}`;
    return `${icon} ${v ? tr('Video call — no answer') : tr('Call — no answer')}`;
  }
  const time = duration(c.durationSec);
  return `${icon} ${v ? tr('Video call · {time}', { time }) : tr('Call · {time}', { time })}`;
}

/** Calls that started after `after` (exclusive) and up to `before` (inclusive); null means open-ended. */
export function callsBetween(calls: CallView[], after: string | null, before: string | null): CallView[] {
  return calls
    .filter((c) => (after === null || c.startedAt > after) && (before === null || c.startedAt <= before))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
