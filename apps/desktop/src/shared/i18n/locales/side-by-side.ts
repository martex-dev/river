import type { Language } from '../languages.ts';
import type { Dictionary, PluralForms } from '../types.ts';

export type Lang = Exclude<Language, 'en'>;

/** Texts with every language side by side, so a new text cannot miss one (the community sweep's way). */
export type SideBySide = Record<string, Record<Lang, string | PluralForms>>;

export const LANGS: Lang[] = ['bg', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'ru', 'tr', 'uk'];

/** Side-by-side tables, turned into one dictionary per language. */
export function byLanguage(...tables: SideBySide[]): Record<Lang, Dictionary> {
  return Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      Object.fromEntries(tables.flatMap((t) => Object.entries(t).map(([en, all]) => [en, all[lang]]))),
    ]),
  ) as Record<Lang, Dictionary>;
}
