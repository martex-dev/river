import { Fragment, createElement, type ReactNode } from 'react';
import {
  resolveLanguage as resolveFor,
  systemLanguage,
  translate,
  translatePlural,
  type Language,
  type Vars,
} from '../../shared/i18n/index.ts';
import { useRiver } from './store.ts';

/**
 * Languages (1.0.27) in the interface. The texts and the rules live in shared/i18n, so River's
 * main process (notifications) and the phone's core speak the same language as the page. English
 * text is the key: tr('Settings'), tr('{name} is typing…', { name }), trn('{count} members', n).
 */
export {
  LANGUAGES,
  languageInfo,
  msg,
  textDirection,
  translate,
  translatePlural,
  type Language,
} from '../../shared/i18n/index.ts';

/** The language in use for a setting ("system", the default, follows the computer's language). */
export function resolveLanguage(setting: string | undefined, system = systemLanguage()): Language {
  return resolveFor(setting, system);
}

/** The language River speaks right now. */
export function currentLanguage(): Language {
  return resolveLanguage(useRiver.getState().settings?.appearance?.language);
}

/** The language River speaks, in a component; re-renders when it changes. */
export function useLanguage(): Language {
  return resolveLanguage(useRiver((r) => r.settings?.appearance?.language));
}

/** Translate in a component; re-renders when the language changes. */
export function useT(): (text: string, vars?: Vars) => string {
  const lang = useLanguage();
  return (text, vars) => translate(lang, text, vars);
}

/** Translate outside hooks (menus, labels). App re-renders everything when the language changes. */
export function tr(text: string, vars?: Vars): string {
  return translate(currentLanguage(), text, vars);
}

/** A counted text: trn('{count} members', 3) → "3 members", "3 члена", "3 участника". */
export function trn(key: string, count: number, vars?: Vars): string {
  return translatePlural(currentLanguage(), key, count, vars);
}

/**
 * A translated text with elements in it, where each language puts them:
 * rich(translated, { name: <strong>{name}</strong> }) for a text like "Synced with {name}.".
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return createElement(Fragment, { key: i }, name && Object.hasOwn(parts, name) ? parts[name] : piece);
  });
}
