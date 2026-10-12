import { useRiver } from './store.ts';

/** 12- or 24-hour clock from Settings → Appearance (undefined: the locale decides). */
function hour12(): boolean | undefined {
  const clock = useRiver.getState().settings?.appearance.clock ?? 'system';
  return clock === 'system' ? undefined : clock === '12h';
}

/** "14:05" or "2:05 PM", as the person chose. */
export function clockTime(when: string | number | Date): string {
  const h12 = hour12();
  return new Date(when).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    ...(h12 === undefined ? {} : { hour12: h12 }),
  });
}

/** Short date and time, with the chosen clock. */
export function clockDateTime(when: string | number | Date): string {
  const h12 = hour12();
  return new Date(when).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
    ...(h12 === undefined ? {} : { hour12: h12 }),
  });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date (1.0.22). */
export function relativeTime(when: string | number | Date, now = Date.now()): string {
  const t = new Date(when).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) {
    const d = Math.floor(s / 86_400);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  return new Date(t).toLocaleDateString();
}
