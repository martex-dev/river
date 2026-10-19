import { languageInfo, type Language } from './languages.ts';
import type { Dictionary, PluralForms } from './types.ts';
import { EN_PLURALS } from './locales/en.ts';
import { BG } from './locales/bg.ts';
import { DE } from './locales/de.ts';
import { ES } from './locales/es.ts';
import { FR } from './locales/fr.ts';
import { IT } from './locales/it.ts';
import { PL } from './locales/pl.ts';
import { PT_BR } from './locales/pt-BR.ts';
import { RU } from './locales/ru.ts';
import { TR } from './locales/tr.ts';
import { UK } from './locales/uk.ts';
// The community screens' texts, every language side by side (community sweep).
import { COMMUNITY } from './locales/community.ts';

export * from './languages.ts';
export type { Dictionary, PluralForms } from './types.ts';
export { EN_PLURALS } from './locales/en.ts';

/**
 * River's texts in every language (1.0.27). The English text is the key: a translation that is
 * missing falls back to English, so nothing is ever blank (i18n.test.ts lists what is missing).
 * Texts are written with placeholders — "{name} is typing…" — that `translate` fills in; counted
 * texts ("{count} new messages") have a form for each plural category of the language
 * (Intl.PluralRules): Russian, Ukrainian and Polish have three, most others two.
 */
export const DICTIONARIES: Record<Language, Dictionary> = {
  en: EN_PLURALS,
  bg: { ...BG, ...COMMUNITY.bg },
  de: { ...DE, ...COMMUNITY.de },
  es: { ...ES, ...COMMUNITY.es },
  fr: { ...FR, ...COMMUNITY.fr },
  it: { ...IT, ...COMMUNITY.it },
  pl: { ...PL, ...COMMUNITY.pl },
  'pt-BR': { ...PT_BR, ...COMMUNITY['pt-BR'] },
  ru: { ...RU, ...COMMUNITY.ru },
  tr: { ...TR, ...COMMUNITY.tr },
  uk: { ...UK, ...COMMUNITY.uk },
};

export type Vars = Record<string, string | number>;

/** Fills "{name}"-style placeholders; ones without a value stay as they are. */
export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : all,
  );
}

/** Marks a text for translation where it is written down, to be translated where it is shown. */
export function msg<T extends string>(text: T): T {
  return text;
}

export function translate(lang: Language, text: string, vars?: Vars): string {
  const found = DICTIONARIES[lang][text];
  return fill(typeof found === 'string' && found ? found : text, vars);
}

const rules = new Map<string, Intl.PluralRules>();
function pluralRules(locale: string): Intl.PluralRules {
  let r = rules.get(locale);
  if (!r) rules.set(locale, (r = new Intl.PluralRules(locale)));
  return r;
}

/** The form of a counted text for `count`, falling back to the "other" form, then to English. */
function pluralForm(forms: PluralForms, category: Intl.LDMLPluralRule): string {
  return forms[category] || forms.other;
}

/**
 * A counted text: `key` is its English "other" form ("{count} new messages"); {count} and any
 * other placeholders are filled in.
 */
export function translatePlural(lang: Language, key: string, count: number, vars?: Vars): string {
  const all = { count, ...vars };
  const own = DICTIONARIES[lang][key];
  if (own && typeof own === 'object') {
    return fill(pluralForm(own, pluralRules(languageInfo(lang).locale).select(count)), all);
  }
  const english = EN_PLURALS[key];
  if (english && typeof english === 'object')
    return fill(pluralForm(english, pluralRules('en').select(count)), all);
  return fill(key, all);
}

/** The computer's or phone's language, where there is one to ask (the renderer, the phone's core). */
export function systemLanguage(): string {
  const nav = (globalThis as { navigator?: { language?: string } }).navigator;
  return nav?.language || 'en';
}
