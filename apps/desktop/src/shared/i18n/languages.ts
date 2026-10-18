/**
 * The languages River speaks (1.0.27; nine more in 2.21). Only the list and how a language is
 * picked live here, without the texts, so the settings schema can name them cheaply.
 */
export const LANGUAGE_IDS = ['en', 'bg', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'ru', 'tr', 'uk'] as const;

export type Language = (typeof LANGUAGE_IDS)[number];

export interface LanguageInfo {
  id: Language;
  /** The language's name in itself ("Deutsch"): the picker lists languages the way their speakers know them. */
  name: string;
  /** Its name in English, for search and for people helping someone else. */
  english: string;
  /** The locale dates and numbers are written in when River is set to this language. */
  locale: string;
  /** Writing direction. Every language so far is left-to-right; the page follows `dir` (App.tsx). */
  dir: 'ltr' | 'rtl';
  /** Translated in part: some screens are still in English. */
  beta?: boolean;
}

/** English first, then by their own names, as most apps list them. */
export const LANGUAGES: LanguageInfo[] = [
  { id: 'en', name: 'English', english: 'English', locale: 'en', dir: 'ltr' },
  { id: 'bg', name: 'Български', english: 'Bulgarian', locale: 'bg-BG', dir: 'ltr', beta: true },
  { id: 'de', name: 'Deutsch', english: 'German', locale: 'de-DE', dir: 'ltr', beta: true },
  { id: 'es', name: 'Español', english: 'Spanish', locale: 'es-ES', dir: 'ltr', beta: true },
  { id: 'fr', name: 'Français', english: 'French', locale: 'fr-FR', dir: 'ltr', beta: true },
  { id: 'it', name: 'Italiano', english: 'Italian', locale: 'it-IT', dir: 'ltr', beta: true },
  { id: 'pl', name: 'Polski', english: 'Polish', locale: 'pl-PL', dir: 'ltr', beta: true },
  {
    id: 'pt-BR',
    name: 'Português (Brasil)',
    english: 'Portuguese (Brazil)',
    locale: 'pt-BR',
    dir: 'ltr',
    beta: true,
  },
  { id: 'ru', name: 'Русский', english: 'Russian', locale: 'ru-RU', dir: 'ltr', beta: true },
  { id: 'tr', name: 'Türkçe', english: 'Turkish', locale: 'tr-TR', dir: 'ltr', beta: true },
  { id: 'uk', name: 'Українська', english: 'Ukrainian', locale: 'uk-UA', dir: 'ltr', beta: true },
];

/** Languages written right to left (by their primary subtag), for when one of them is added. */
const RTL = new Set(['ar', 'fa', 'he', 'ur', 'yi', 'ps', 'sd', 'ug', 'dv', 'ckb']);

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGE_IDS as readonly string[]).includes(value);
}

/**
 * The language in use for a setting: one River speaks, as chosen; otherwise ("system", the
 * default) the computer's or phone's own language when River speaks it — "pt-PT" gets Brazilian
 * Portuguese, "de-AT" German — else English.
 */
export function resolveLanguage(setting: string | undefined, system: string | undefined): Language {
  if (isLanguage(setting)) return setting;
  const tag = (system ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!tag) return 'en';
  const exact = LANGUAGE_IDS.find((id) => id.toLowerCase() === tag);
  if (exact) return exact;
  const primary = tag.split('-')[0];
  return LANGUAGE_IDS.find((id) => id.toLowerCase().split('-')[0] === primary) ?? 'en';
}

export function languageInfo(lang: Language): LanguageInfo {
  return LANGUAGES.find((l) => l.id === lang) ?? LANGUAGES[0]!;
}

/** "ltr" or "rtl" for a language tag (River's own or any BCP 47 tag). */
export function textDirection(tag: string): 'ltr' | 'rtl' {
  const known = LANGUAGES.find((l) => l.id === tag);
  if (known) return known.dir;
  return RTL.has(tag.toLowerCase().split(/[-_]/)[0] ?? '') ? 'rtl' : 'ltr';
}
