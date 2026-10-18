import {
  MAX_THEME_CODE,
  sharedThemeSchema,
  type ColorRole,
  type CustomTheme,
  type DesignSettings,
  type SharedTheme,
} from '../../../shared/design.ts';
import { themeById, THEMES } from './themes.ts';

/**
 * Theme codes (2.18): a theme travels as a short line of text — `river-theme:` and the theme's
 * name, base theme and changed colours as JSON, base64url-encoded. Anyone can paste it into
 * Appearance → Colours. It is only data: read with zod, colours must be #rrggbb, the base must be
 * one of River's own themes, and nothing in it is ever run or fetched.
 */
export const THEME_CODE_PREFIX = 'river-theme:';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** The built-in theme a design's theme starts from, and every colour changed on top of it. */
export function themeOf(design: DesignSettings): {
  base: string;
  colors: Partial<Record<ColorRole, string>>;
} {
  const mine = design.customThemes.find((c) => c.id === design.theme);
  const base = mine ? mine.base : themeById(design.theme) ? design.theme : THEMES[0]!.id;
  return { base, colors: { ...(mine?.colors ?? {}), ...design.prefs.colors } };
}

/** The code for the theme in use (with the colours changed on it), under a name. */
export function themeCode(design: DesignSettings, name: string): string {
  const { base, colors } = themeOf(design);
  const shared: SharedTheme = {
    kind: 'river-theme',
    v: 1,
    name: name.trim().slice(0, 48) || (themeById(base)?.name ?? 'Shared theme'),
    base,
    colors,
  };
  return THEME_CODE_PREFIX + toBase64Url(JSON.stringify(shared));
}

export type ThemeCodeResult = { ok: true; theme: SharedTheme } | { ok: false; error: string };

/** Reads a pasted theme code (alone, or anywhere in a pasted message or link). */
export function parseThemeCode(text: string): ThemeCodeResult {
  const at = text.indexOf(THEME_CODE_PREFIX);
  if (at < 0) return { ok: false, error: 'That is not a River theme code (it starts with river-theme:).' };
  const code = /^[A-Za-z0-9_-]*/.exec(text.slice(at + THEME_CODE_PREFIX.length))![0];
  if (!code || code.length > MAX_THEME_CODE)
    return { ok: false, error: 'That theme code is incomplete or too long.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(code));
  } catch {
    return { ok: false, error: 'That theme code is damaged. Ask for it again.' };
  }
  const result = sharedThemeSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: 'That theme code is damaged or from a newer River.' };
  if (!themeById(result.data.base))
    return { ok: false, error: 'That theme is based on a theme this River does not have. Update River.' };
  return { ok: true, theme: result.data };
}

/** A pasted theme as one of your own themes (same colours as an existing one: that one is reused). */
export function addSharedTheme(
  design: DesignSettings,
  shared: SharedTheme,
  id: string,
  now: string,
): { design: DesignSettings; theme: CustomTheme } {
  const same = design.customThemes.find(
    (c) => c.base === shared.base && JSON.stringify(c.colors) === JSON.stringify(shared.colors),
  );
  if (same) return { design: { ...design, theme: same.id }, theme: same };
  const theme: CustomTheme = {
    id,
    name: shared.name,
    base: shared.base,
    colors: shared.colors,
    createdAt: now,
  };
  const customThemes = [...design.customThemes, theme].slice(-100);
  const skin = themeById(shared.base)?.skin ?? design.skin;
  return {
    design: {
      ...design,
      skin,
      theme: id,
      customThemes,
      prefs: { ...design.prefs, colors: {}, mode: 'theme' },
      activeProfile: null,
    },
    theme,
  };
}
