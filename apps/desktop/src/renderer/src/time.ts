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
