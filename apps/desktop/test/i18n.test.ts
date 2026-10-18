import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DICTIONARIES,
  EN_PLURALS,
  LANGUAGE_IDS,
  LANGUAGES,
  fill,
  languageInfo,
  resolveLanguage,
  textDirection,
  translate,
  translatePlural,
  type Language,
} from '../src/shared/i18n/index.ts';
import { DEFAULT_SETTINGS, settingsSchema } from '../src/shared/settings.ts';

/**
 * Every text River routes through tr()/t() (or marks with msg()) and every counted text
 * (trn()/tn()/translatePlural), read from the source: what each language has to translate.
 */
function textsInSource(): { texts: Map<string, string>; counted: Map<string, string> } {
  const roots = ['../src', '../../mobile/core', '../../mobile/ui'].map((r) => join(__dirname, r));
  const q = String.raw`(['"])((?:\\.|(?!\1).)*?)\1`;
  const single = [
    new RegExp(String.raw`\b(?:tr|t|msg)\(\s*` + q, 'gs'),
    new RegExp(String.raw`\btranslate\(\s*[\w.()]+,\s*` + q, 'gs'),
  ];
  const plural = [
    new RegExp(String.raw`\b(?:trn|tn)\(\s*` + q, 'gs'),
    new RegExp(String.raw`\btranslatePlural\(\s*[\w.()]+,\s*` + q, 'gs'),
  ];
  const texts = new Map<string, string>();
  const counted = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        // The dictionaries themselves (and i18n's own helpers).
        if (name !== 'i18n' && name !== 'node_modules') walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      const source = readFileSync(path, 'utf8');
      const where = relative(join(__dirname, '..'), path);
      for (const [patterns, into] of [
        [single, texts],
        [plural, counted],
      ] as const) {
        for (const rx of patterns) {
          for (const m of source.matchAll(rx)) {
            const text = m[2]!.replace(/\\(['"\\])/g, '$1');
            if (!into.has(text)) into.set(text, where);
          }
        }
      }
    }
  };
  for (const root of roots) walk(root);
  return { texts, counted };
}

const placeholders = (text: string): string[] => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

/** The plural categories a whole count from 0 to 1000 can fall in, in a language. */
function categoriesFor(lang: Language): Intl.LDMLPluralRule[] {
  const rules = new Intl.PluralRules(languageInfo(lang).locale);
  const used = new Set<Intl.LDMLPluralRule>();
  for (let n = 0; n <= 1000; n++) used.add(rules.select(n));
  return [...used].sort();
}

const { texts, counted } = textsInSource();
const others = LANGUAGE_IDS.filter((l) => l !== 'en');

describe('languages', () => {
  it('follows the system by default, by the language River speaks, else English', () => {
    expect(DEFAULT_SETTINGS.appearance.language).toBe('system');
    expect(resolveLanguage('system', 'bg-BG')).toBe('bg');
    expect(resolveLanguage('system', 'de-DE')).toBe('de');
    expect(resolveLanguage('system', 'de-AT')).toBe('de');
    expect(resolveLanguage('system', 'pt-PT')).toBe('pt-BR');
    expect(resolveLanguage('system', 'pt_BR')).toBe('pt-BR');
    expect(resolveLanguage('system', 'uk-UA')).toBe('uk');
    expect(resolveLanguage('system', 'ja-JP')).toBe('en');
    expect(resolveLanguage(undefined, '')).toBe('en');
    expect(resolveLanguage('en', 'bg-BG')).toBe('en');
    expect(resolveLanguage('bg', 'en-US')).toBe('bg');
    expect(resolveLanguage('fr', 'ru-RU')).toBe('fr');
  });

  it('lets Settings store every language, and nothing else', () => {
    for (const id of ['system', ...LANGUAGE_IDS]) {
      const s = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, language: id } };
      expect(settingsSchema.safeParse(s).success).toBe(true);
    }
    const bad = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, language: 'xx' } };
    expect(settingsSchema.safeParse(bad).success).toBe(false);
  });

  it('lists each language in its own name, English first', () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual([...LANGUAGE_IDS]);
    expect(LANGUAGES[0]!.name).toBe('English');
    const names = Object.fromEntries(LANGUAGES.map((l) => [l.id, l.name]));
    expect(names).toMatchObject({
      bg: 'Български',
      de: 'Deutsch',
      es: 'Español',
      fr: 'Français',
      it: 'Italiano',
      pl: 'Polski',
      'pt-BR': 'Português (Brasil)',
      ru: 'Русский',
      tr: 'Türkçe',
      uk: 'Українська',
    });
    expect(new Set(LANGUAGES.map((l) => l.name)).size).toBe(LANGUAGES.length);
  });

  it('knows which way each language is written', () => {
    for (const l of LANGUAGES) expect(textDirection(l.id)).toBe('ltr');
    // Ready for right-to-left languages: the page's dir follows the language (App.tsx).
    expect(textDirection('ar')).toBe('rtl');
    expect(textDirection('he-IL')).toBe('rtl');
    expect(textDirection('fa')).toBe('rtl');
    expect(textDirection('de')).toBe('ltr');
  });

  it('translates known texts, fills placeholders, and leaves others in English', () => {
    expect(translate('bg', 'Settings')).toBe('Настройки');
    expect(translate('de', 'Settings')).toBe('Einstellungen');
    expect(translate('bg', 'Something not translated yet')).toBe('Something not translated yet');
    expect(translate('en', 'Settings')).toBe('Settings');
    expect(translate('fr', '{name} is typing…', { name: 'Ana' })).toBe('Ana écrit…');
    expect(translate('en', 'Missed call from {name}', { name: 'Bo' })).toBe('Missed call from Bo');
    expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('counts in each language’s plural forms', () => {
    const members = (lang: Language, n: number): string => translatePlural(lang, '{count} members', n);
    expect([1, 2].map((n) => members('en', n))).toEqual(['1 member', '2 members']);
    expect([1, 2].map((n) => members('bg', n))).toEqual(['1 член', '2 члена']);
    // Russian, Ukrainian and Polish: one, few and many.
    expect([1, 3, 5, 11, 21, 22, 25].map((n) => translatePlural('ru', '{count} new messages', n))).toEqual([
      '1 новое сообщение',
      '3 новых сообщения',
      '5 новых сообщений',
      '11 новых сообщений',
      '21 новое сообщение',
      '22 новых сообщения',
      '25 новых сообщений',
    ]);
    expect([1, 2, 5, 22].map((n) => members('uk', n))).toEqual([
      '1 учасник',
      '2 учасники',
      '5 учасників',
      '22 учасники',
    ]);
    expect([1, 2, 5, 12, 22].map((n) => members('pl', n))).toEqual([
      '1 członek',
      '2 członków',
      '5 członków',
      '12 członków',
      '22 członków',
    ]);
    // A counted text nobody translated still counts, in English.
    expect(translatePlural('de', '{count} things nobody wrote', 3)).toBe('3 things nobody wrote');
  });

  it('finds the texts it checks in the source', () => {
    expect(texts.size).toBeGreaterThan(400);
    expect(texts.has('Settings')).toBe(true);
    expect(texts.has('Missed call from {name}')).toBe(true);
    expect(counted.has('{count} new messages')).toBe(true);
    for (const key of counted.keys()) expect(texts.has(key), `${key} is used both ways`).toBe(false);
  });

  it.each(others)('%s has every text, with the same placeholders, none empty', (lang) => {
    const dict = DICTIONARIES[lang];
    const problems: string[] = [];
    for (const [text, where] of texts) {
      const v = dict[text];
      if (v === undefined) problems.push(`missing: ${JSON.stringify(text)} (${where})`);
      else if (typeof v !== 'string')
        problems.push(`counted forms for a plain text: ${JSON.stringify(text)}`);
      else if (!v.trim()) problems.push(`empty: ${JSON.stringify(text)}`);
      else if (placeholders(v).join() !== placeholders(text).join())
        problems.push(`placeholders differ: ${JSON.stringify(text)} → ${JSON.stringify(v)}`);
    }
    const categories = categoriesFor(lang);
    for (const [key, where] of counted) {
      const v = dict[key];
      if (!v || typeof v !== 'object') {
        problems.push(`missing counted text: ${JSON.stringify(key)} (${where})`);
        continue;
      }
      for (const c of [...categories, 'other' as const]) {
        const form = v[c];
        if (!form?.trim()) problems.push(`missing "${c}" form: ${JSON.stringify(key)}`);
        else if (placeholders(form).join() !== placeholders(key).join())
          problems.push(`placeholders differ: ${JSON.stringify(key)} (${c}) → ${JSON.stringify(form)}`);
      }
    }
    // Texts no screen uses any more (renamed or removed) go from the dictionaries too.
    for (const key of Object.keys(dict))
      if (!texts.has(key) && !counted.has(key)) problems.push(`not used anywhere: ${JSON.stringify(key)}`);
    expect(problems).toEqual([]);
  });

  it('has English singular forms with the same placeholders', () => {
    for (const [key, forms] of Object.entries(EN_PLURALS)) {
      expect(counted.has(key), key).toBe(true);
      expect(typeof forms).toBe('object');
      for (const form of Object.values(forms as object) as string[])
        expect(placeholders(form)).toEqual(placeholders(key));
    }
  });

  it('marks partial translations as beta', () => {
    expect(LANGUAGES.find((l) => l.id === 'en')?.beta).toBeUndefined();
    for (const lang of others) expect(LANGUAGES.find((l) => l.id === lang)?.beta).toBe(true);
  });
});
