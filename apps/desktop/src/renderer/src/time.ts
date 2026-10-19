import { isLanguage } from '../../shared/i18n/languages.ts';
import { languageInfo, resolveLanguage, tr, trn } from './i18n.ts';
import { useRiver } from './store.ts';

/**
 * The locale dates are written in (2.13.1). The computer's own, unless River is set to a language
 * the computer is not in: then that language's, so a Bulgarian River on an English computer says
 * "понеделник", not "Monday" (and an English River on a Bulgarian computer says "Monday").
 */
export function dateLocale(
  setting = useRiver.getState().settings?.appearance.language,
  system = typeof navigator === 'undefined' ? 'en' : navigator.language,
): string[] {
  // Following the system (the default): the computer's own formats, whatever its language.
  if (!isLanguage(setting)) return [];
  const lang = resolveLanguage(setting, system);
  // The computer is in that language already (en-GB for English, pt-PT for Portuguese): its own.
  const primary = (tag: string): string => tag.toLowerCase().split('-')[0] ?? '';
  return primary(system) === primary(lang) ? [] : [languageInfo(lang).locale];
}

/** 12- or 24-hour clock from Settings → Appearance (undefined: the locale decides). */
function hour12(): boolean | undefined {
  const clock = useRiver.getState().settings?.appearance.clock ?? 'system';
  return clock === 'system' ? undefined : clock === '12h';
}

/** "14:05" or "2:05 PM", as the person chose. */
export function clockTime(when: string | number | Date): string {
  const h12 = hour12();
  return new Date(when).toLocaleTimeString(dateLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    ...(h12 === undefined ? {} : { hour12: h12 }),
  });
}

/** Short date and time, with the chosen clock. */
export function clockDateTime(when: string | number | Date): string {
  const h12 = hour12();
  return new Date(when).toLocaleString(dateLocale(), {
    dateStyle: 'short',
    timeStyle: 'short',
    ...(h12 === undefined ? {} : { hour12: h12 }),
  });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date (1.0.22). */
export function relativeTime(when: string | number | Date, now = Date.now()): string {
  const t = new Date(when).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return tr('just now');
  if (s < 3600) return trn('{count} min ago', Math.floor(s / 60));
  if (s < 86_400) return trn('{count} h ago', Math.floor(s / 3600));
  if (s < 7 * 86_400) return trn('{count} days ago', Math.floor(s / 86_400));
  return new Date(t).toLocaleDateString(dateLocale());
}

/** The calendar day before `d`, at the same time (not 24 hours back, which a DST change makes wrong). */
function dayBefore(d: Date): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - 1);
  return out;
}

export function isToday(when: string | number | Date, now = new Date()): boolean {
  return new Date(when).toDateString() === now.toDateString();
}

/** "Today", "Yesterday" or the full date, for the line between days in a conversation. */
export function dayLabel(when: string | number | Date, now = new Date()): string {
  const d = new Date(when);
  if (isToday(d, now)) return tr('Today');
  if (d.toDateString() === dayBefore(now).toDateString()) return tr('Yesterday');
  return d.toLocaleDateString(dateLocale(), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** A message's time beside its author: "Today at 14:05", "Yesterday at 09:30", else date and time. */
export function messageWhen(when: string | number | Date, now = new Date()): string {
  const d = new Date(when);
  if (isToday(d, now)) return tr('Today at {time}').replace('{time}', clockTime(d));
  if (d.toDateString() === dayBefore(now).toDateString())
    return tr('Yesterday at {time}').replace('{time}', clockTime(d));
  return clockDateTime(d);
}

/** The full date and time, for a tooltip. */
export function fullWhen(when: string | number | Date): string {
  const h12 = hour12();
  return new Date(when).toLocaleString(dateLocale(), {
    dateStyle: 'full',
    timeStyle: 'short',
    ...(h12 === undefined ? {} : { hour12: h12 }),
  });
}

/** A disappearing-message time ("1 week", "5 minutes") in River's language (shared timerLabel is English). */
export function timerText(seconds: number): string {
  if (!seconds) return tr('Off');
  if (seconds % 604_800 === 0) return trn('{count} weeks', seconds / 604_800);
  if (seconds % 86_400 === 0) return trn('{count} days', seconds / 86_400);
  if (seconds % 3600 === 0) return trn('{count} hours', seconds / 3600);
  if (seconds % 60 === 0) return trn('{count} minutes', seconds / 60);
  return trn('{count} seconds', seconds);
}
