import type { CustomTheme, DesignPrefs, DesignSettings } from '../../../shared/design.ts';
import { DEFAULT_DESIGN, DEFAULT_DESIGN_PREFS, designImage } from '../../../shared/design.ts';
import { channels, contrast, ensureContrast, inkOn, mix, rgba, saturate } from './color.ts';
import { FONT_STACKS, SKINS, skinById, type Pattern, type Skin } from './skins.ts';
import { THEMES, themeById, themesOf, type Theme } from './themes.ts';

/**
 * The theme engine (1.0.45): skin + theme + the person's adjustments → CSS
 * custom properties on <html> and a few data-* attributes for structure.
 * Pure function of its input, so previews and the live app use the same code.
 */

export interface Resolved {
  skin: Skin;
  theme: Theme;
  /** CSS custom properties (names start with --). */
  vars: Record<string, string>;
  /** data-* attributes for <html> (without the data- prefix). */
  attrs: Record<string, string>;
  mode: 'light' | 'dark';
}

const SEMANTIC = {
  dark: { ok: '#3ee08f', warn: '#ffb547', danger: '#ff5c7a', info: '#6aa8ff' },
  light: { ok: '#1a7f37', warn: '#b45309', danger: '#c62828', info: '#1d4ed8' },
};

/** A custom theme is its base theme with the person's colours on top. */
function baseTheme(
  id: string,
  custom: CustomTheme[],
): { theme: Theme; colors: Partial<Record<string, string>> } {
  const mine = custom.find((c) => c.id === id);
  if (mine) {
    const base = themeById(mine.base) ?? THEMES[0]!;
    return { theme: { ...base, id: mine.id, name: mine.name }, colors: mine.colors };
  }
  return { theme: themeById(id) ?? themeById(DEFAULT_DESIGN.theme) ?? THEMES[0]!, colors: {} };
}

/** "Light"/"dark" preference: the first sibling theme in the same skin with that mode. */
function withMode(theme: Theme, mode: DesignPrefs['mode'], systemDark: boolean): Theme {
  const want = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  if (want === 'theme' || want === theme.mode) return theme;
  return themesOf(theme.skin).find((t) => t.mode === want) ?? theme;
}

function patternImage(pattern: Pattern, ink: string, accent: string, strength: number): string {
  const s = Math.max(0, Math.min(2, strength));
  if (pattern === 'none' || s === 0) return 'none';
  const a = (x: number): string => rgba(ink, x * s);
  switch (pattern) {
    case 'grid':
      return `linear-gradient(${a(0.045)} 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, ${a(0.045)} 1px, transparent 1px) 0 0 / 28px 28px`;
    case 'blueprint':
      return `linear-gradient(${rgba(accent, 0.09 * s)} 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(90deg, ${rgba(accent, 0.09 * s)} 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(${a(0.03)} 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, ${a(0.03)} 1px, transparent 1px) 0 0 / 24px 24px`;
    case 'dots':
      return `radial-gradient(${a(0.09)} 1px, transparent 1.6px) 0 0 / 18px 18px`;
    case 'lines':
      return `repeating-linear-gradient(135deg, ${a(0.04)} 0 1px, transparent 1px 12px)`;
    case 'scanlines':
      return `repeating-linear-gradient(0deg, ${a(0.035)} 0 1px, transparent 1px 3px)`;
    case 'stars':
      return [
        [12, 18],
        [72, 42],
        [38, 80],
        [88, 12],
        [55, 60],
        [25, 45],
        [80, 85],
        [5, 70],
      ]
        .map(
          ([x, y], i) =>
            `radial-gradient(${i % 3 === 0 ? 1.4 : 1}px ${i % 3 === 0 ? 1.4 : 1}px at ${x}% ${y}%, ${a(0.5)}, transparent)`,
        )
        .join(', ')
        .concat(' 0 0 / 260px 260px');
    case 'noise': {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 ${(0.07 * s).toFixed(3)} 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`;
      return `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/</g, '%3C').replace(/>/g, '%3E').replace(/ /g, '%20')}")`;
    }
    case 'waves': {
      const col = encodeURIComponent(rgba(ink, 0.06 * s));
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='60'><path d='M0 30 Q 30 10 60 30 T 120 30 T 180 30 T 240 30' fill='none' stroke='${col}' stroke-width='1'/></svg>`;
      return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/ /g, '%20').replace(/'/g, '%27')}") 0 0 / 240px 60px`;
    }
  }
}

function backdrop(
  kind: string,
  p: { bg: string; base: string; accent: string; accent2: string; g: number },
  prefs: DesignPrefs,
): string {
  const { bg, accent, accent2, g } = p;
  if (kind === 'image' && prefs.backgroundImage) {
    const dim = rgba(bg, prefs.backgroundDim);
    return `linear-gradient(${dim}, ${dim}), url("${prefs.backgroundImage}") center / cover no-repeat`;
  }
  switch (kind) {
    case 'gradient':
      return `radial-gradient(1100px 700px at 85% -10%, ${rgba(accent2, 0.14 * g)}, transparent 60%), radial-gradient(900px 600px at 0% 110%, ${rgba(accent, 0.1 * g)}, transparent 60%), ${bg}`;
    case 'aurora':
      return `radial-gradient(900px 520px at 10% 0%, ${rgba(accent, 0.5 * g)}, transparent 65%), radial-gradient(800px 600px at 95% 20%, ${rgba(accent2, 0.45 * g)}, transparent 60%), radial-gradient(900px 500px at 50% 110%, ${rgba(mix(accent, accent2, 0.5), 0.35 * g)}, transparent 60%), ${bg}`;
    case 'mesh':
      return `conic-gradient(from 210deg at 70% 30%, ${rgba(accent, 0.16 * g)}, transparent 25%, ${rgba(accent2, 0.16 * g)} 50%, transparent 75%, ${rgba(accent, 0.16 * g)}), ${bg}`;
    default:
      return bg;
  }
}

export function resolveDesign(
  design: DesignSettings,
  opts: { systemDark: boolean; highContrast: boolean } = { systemDark: true, highContrast: false },
): Resolved {
  const prefs: DesignPrefs = {
    ...DEFAULT_DESIGN_PREFS,
    ...design.prefs,
    // Pictures are kept once and pointed to (image:<key>): the picture itself goes into the CSS.
    backgroundImage: designImage(design, design.prefs.backgroundImage),
  };
  const picked = baseTheme(design.theme, design.customThemes);
  const theme = withMode(picked.theme, prefs.mode, opts.systemDark);
  const skin = skinById(theme.skin) ?? SKINS[0]!;
  const colors = { ...(theme.id === picked.theme.id ? picked.colors : {}), ...prefs.colors };

  const mode = theme.mode;
  const light = mode === 'light';
  const hc = opts.highContrast;

  // --- surfaces -----------------------------------------------------------------------------
  // A chosen conversation colour must leave room for readable text (a mid grey does not).
  const roomFor = (c: string): string => {
    let out = c;
    for (let t = 0.1; Math.max(contrast(out, '#ffffff'), contrast(out, '#000000')) < 8 && t <= 1; t += 0.1)
      out = mix(c, light ? '#ffffff' : '#000000', t);
    return out;
  };
  const base = roomFor(colors.base ?? theme.base);
  const depth = prefs.surfaceDepth;
  const layer = (c: string): string => mix(base, c, depth);
  const bg = colors.bg ?? layer(theme.bg);
  const surface = colors.surface ?? layer(theme.surface);
  const raised = colors.raised ?? layer(theme.raised);

  // --- text -------------------------------------------------------------------------------------
  const k = prefs.contrast * (hc ? 1.35 : 1);
  const textRaw = colors.text ?? theme.text;
  const text = ensureContrast(textRaw, base, Math.min(15, 7 * k));
  // A margin above WCAG's 4.5:1, so text also reads on hover tints and translucent overlays.
  const minor = Math.min(12, 5.4 * k);
  // Secondary text appears on every surface: readable against all of them, not just the conversation.
  const readableOn = (fg: string, ratio: number): string =>
    [base, surface, raised, bg].reduce((c, bgc) => ensureContrast(c, bgc, ratio), fg);
  // Palettes may carry their own secondary text (Specter's fg1/fg2); always kept readable.
  const dim = readableOn(theme.dim ?? mix(text, base, 0.26 / k), minor);
  const faint = readableOn(colors.muted ?? theme.faint ?? mix(text, base, 0.42 / k), minor);

  // --- accents ----------------------------------------------------------------------------------
  const sat = prefs.saturation;
  // Accents and status colours are also used as text (links, labels): readable on every surface.
  // The palette's own accents fill buttons and highlights unchanged (Brutal's loud yellow stays
  // yellow, with dark ink on it); where an accent colours text, its readable version is used.
  const accentRaw = saturate(colors.accent ?? theme.accent, sat);
  // A fill must carry readable text (white or black): nudge it only if neither quite reaches 4.5:1.
  const accent =
    contrast(inkOn(accentRaw), accentRaw) >= 4.5
      ? accentRaw
      : ensureContrast(accentRaw, inkOn(accentRaw), 4.5);
  const accent2 = saturate(colors.accent2 ?? theme.accent2, sat);
  const accentText = readableOn(accent, 4.9);
  const accent2Text = readableOn(accent2, 4.9);
  const accent3 = theme.accent3 ? readableOn(theme.accent3, 3) : mix(accent, accent2, 0.5);
  const sem = SEMANTIC[mode];
  const ok = readableOn(colors.ok ?? theme.ok ?? sem.ok, 4.9);
  const warn = readableOn(colors.warn ?? theme.warn ?? sem.warn, 4.9);
  const danger = readableOn(colors.danger ?? theme.danger ?? sem.danger, 4.9);
  const info = readableOn(colors.info ?? sem.info, 4.9);
  const g = Math.min(2, skin.gradient * prefs.gradient * prefs.intensity);
  const glow = Math.min(2, skin.glow * prefs.glow * prefs.intensity);
  const glass = Math.min(1, skin.glass * prefs.glass);
  const borderAlpha = Math.min(0.6, (light ? 0.12 : 0.09) * prefs.borders * (hc ? 2.2 : 1));
  const borderColor = colors.border ?? rgba(text, borderAlpha);
  const borderStrong = colors.border ?? rgba(text, Math.min(0.75, borderAlpha * 2));
  const hover = rgba(text, light ? 0.06 : 0.07);
  const active = colors.selection ? rgba(colors.selection, 0.28) : rgba(text, light ? 0.1 : 0.13);
  const focus = colors.focus ?? readableOn(accent, 3);
  const grad =
    g > 0.02
      ? `linear-gradient(135deg, ${accent} 0%, ${mix(accent, accent2, Math.min(1, 0.55 * g))} 55%, ${mix(accent, accent2, Math.min(1, g))} 100%)`
      : accent;
  const gradEnd = g > 0.02 ? mix(accent, accent2, Math.min(1, g)) : accent;
  // The palette's own ink on its accent (Specter's accentFg) when it reads well, else the best of black/white.
  const ink = theme.ink && !colors.accent && contrast(theme.ink, accent) >= 4.5 ? theme.ink : inkOn(accent);
  const inkGrad = contrast(ink, gradEnd) >= 3 ? ink : inkOn(gradEnd);

  // --- geometry ---------------------------------------------------------------------------------
  const r = prefs.radius;
  const control = skin.control * r;
  const panel = skin.radius * r;
  const buttons = prefs.buttonShape === 'skin' ? skin.buttons : prefs.buttonShape;
  const avatars = prefs.avatarShape === 'skin' ? skin.avatars : prefs.avatarShape;
  const sh = prefs.shadows * prefs.intensity;
  const shadow =
    skin.shadow === 'none' || sh === 0
      ? 'none'
      : skin.shadow === 'hard'
        ? `${3 * sh}px ${3 * sh}px 0 0 ${rgba(light ? '#000000' : text, light ? 0.85 : 0.35)}`
        : skin.shadow === 'glow'
          ? `0 0 ${18 * sh}px ${rgba(accent, 0.22 * Math.max(glow, 0.3))}, 0 10px 30px -18px rgba(0, 0, 0, ${0.8 * Math.min(1, sh)})`
          : skin.shadow === 'deep'
            ? `0 24px 60px -24px rgba(0, 0, 0, ${0.75 * Math.min(1.2, sh)}), 0 1px 0 ${rgba('#ffffff', light ? 0.6 : 0.05)} inset`
            : `0 10px 30px -16px rgba(0, 0, 0, ${(light ? 0.25 : 0.65) * Math.min(1.2, sh)})`;

  // --- typography -------------------------------------------------------------------------------
  const uiFont = FONT_STACKS[prefs.uiFont === 'skin' ? skin.fonts.ui : prefs.uiFont];
  const display = prefs.displayFont === 'skin' ? skin.fonts.display : prefs.displayFont;
  const displayFont = display === 'same' ? uiFont : FONT_STACKS[display];
  const monoFont = FONT_STACKS[prefs.monoFont === 'skin' ? skin.fonts.mono : prefs.monoFont];
  const headings = prefs.headings === 'skin' ? skin.headings : prefs.headings;

  // --- background & pattern ---------------------------------------------------------------------
  const pattern = prefs.pattern === 'skin' ? skin.pattern : prefs.pattern;
  const patternStrength = (prefs.pattern === 'skin' ? skin.patternStrength : 1) * prefs.patternStrength;
  const kind = prefs.background === 'skin' ? skin.backdrop : prefs.background;
  const speed = 1 / prefs.motionSpeed;
  const space = skin.spacing * prefs.spacing;

  const vars: Record<string, string> = {
    // layered surfaces (Discord-style shell)
    '--layer-0': bg,
    '--layer-1': surface,
    '--layer-2': base,
    '--layer-3': raised,
    '--layer-user': mix(bg, surface, 0.5),
    '--layer-hover': hover,
    '--layer-active': active,
    '--bg-0': bg,
    '--bg-1': surface,
    '--bg-2': base,
    '--surface': glass > 0 ? rgba(raised, 1 - 0.5 * glass) : raised,
    '--surface-strong': glass > 0 ? rgba(raised, 1 - 0.25 * glass) : mix(raised, text, light ? 0.03 : 0.04),
    '--surface-hover': hover,
    '--surface-2': mix(raised, text, light ? 0.04 : 0.05),
    '--border': borderColor,
    '--border-strong': borderStrong,
    '--text': text,
    '--text-dim': dim,
    '--text-faint': faint,
    '--muted': faint,
    '--accent': accent,
    '--accent-2': accent2,
    '--accent-3': accent3,
    '--accent-text': accentText,
    '--accent-2-text': accent2Text,
    '--accent-ink': inkGrad,
    '--accent-solid-ink': ink,
    '--accent-grad': grad,
    '--accent-glow':
      glow > 0.02 ? `0 0 ${Math.round(24 * glow)}px ${rgba(accent, 0.35 * Math.min(1, glow))}` : 'none',
    '--glow': String(glow),
    '--focus': focus,
    '--selection': colors.selection ?? rgba(accent, 0.32),
    '--ok': ok,
    '--warn': warn,
    '--danger': danger,
    '--planned': info,
    '--info': info,
    '--inactive': faint,
    // channels for rgb(var(--x-rgb) / alpha)
    '--accent-rgb': channels(accent),
    '--accent-2-rgb': channels(accent2),
    '--shade-rgb': channels(light ? mix(bg, '#000000', 0.06) : bg),
    '--fg-rgb': channels(text),
    '--line-rgb': channels(text),
    '--ok-rgb': channels(ok),
    '--warn-rgb': channels(warn),
    '--danger-rgb': channels(danger),
    // geometry
    '--radius-s': `${Math.round(control)}px`,
    '--radius-m': `${Math.round(panel)}px`,
    '--radius-l': `${Math.round(panel * 1.5)}px`,
    '--radius-control': `${Math.round(control)}px`,
    '--radius-button':
      buttons === 'pill'
        ? '999px'
        : buttons === 'square' || buttons === 'cut'
          ? '0px'
          : `${Math.round(Math.max(4, control))}px`,
    '--border-w': `${(skin.borderWidth * prefs.borderWidth).toFixed(2)}px`,
    '--shadow-1': shadow,
    '--shadow-pop':
      skin.shadow === 'hard' ? shadow : `0 16px 48px -12px rgba(0, 0, 0, ${light ? 0.28 : 0.7})`,
    '--blur': glass > 0 ? `blur(${Math.round(skin.blur * prefs.blur)}px) saturate(150%)` : 'none',
    '--glass': String(glass),
    // typography
    '--font-ui': uiFont,
    '--font-display': displayFont,
    '--font-mono': monoFont,
    '--text-weight': String(Math.round(prefs.textWeight)),
    '--line-height': String(prefs.lineHeight),
    '--letter-spacing': `${prefs.letterSpacing}em`,
    '--heading-font': headings === 'display' ? displayFont : uiFont,
    '--heading-transform': headings === 'uppercase' ? 'uppercase' : 'none',
    '--heading-tracking': `${headings === 'uppercase' ? Math.max(0.06, skin.headingTracking) : skin.headingTracking}em`,
    // layout
    '--space': String(space),
    '--rail-w': prefs.railSize === 'compact' ? '58px' : '72px',
    '--rail-icon': prefs.railSize === 'compact' ? '38px' : '48px',
    '--sidebar-w': `${Math.round(prefs.sidebarWidth)}px`,
    '--member-w': `${Math.round(prefs.memberWidth)}px`,
    '--icon-size': `${Math.round(prefs.iconSize)}px`,
    '--icon-stroke': String(prefs.iconStroke),
    // motion
    '--dur-fast': `${Math.round(140 * speed)}ms`,
    '--dur': `${Math.round(240 * speed)}ms`,
    '--dur-slow': `${Math.round(480 * speed)}ms`,
    // atmosphere
    '--backdrop': backdrop(
      kind,
      { bg, base, accent, accent2, g: Math.max(g, kind === 'aurora' ? 0.7 : 0.4) },
      prefs,
    ),
    '--backdrop-blur': `${Math.round(prefs.backgroundBlur)}px`,
    '--pattern': patternImage(pattern, text, accent, patternStrength),
  };

  const attrs: Record<string, string> = {
    skin: skin.id,
    decor: skin.decor,
    mode,
    msg: prefs.messageStyle === 'skin' ? skin.messageStyle : prefs.messageStyle,
    own: prefs.ownMessages,
    bubbles: prefs.bubbles ?? 'rounded',
    avatar: avatars,
    buttons,
    tabs: prefs.tabs === 'skin' ? skin.tabs : prefs.tabs,
    scrollbars: prefs.scrollbars,
    badges: prefs.badges,
    nav: prefs.navSide,
    members: prefs.memberList,
    chat: prefs.chatWidth,
    titlebar: prefs.titlebar,
    focusmode: prefs.focusMode ? 'on' : 'off',
    headings,
    glass: glass > 0.05 ? 'on' : 'off',
    glowing: glow > 0.2 ? 'on' : 'off',
    hover: prefs.hoverEffects ? 'on' : 'off',
    ambient: prefs.ambient && prefs.animatedBackground ? 'on' : 'off',
    tabular: prefs.tabularNumbers ? 'on' : 'off',
    pattern,
    backdrop: kind,
    frame: skin.frame,
  };
  return { skin, theme, vars, attrs, mode };
}

/** Writes a resolved design onto <html>. */
/** The parts of an element the engine writes (keeps this module free of DOM types for tests). */
export interface DesignTarget {
  style: { setProperty(name: string, value: string): void; colorScheme: string };
  setAttribute(name: string, value: string): void;
}

export function applyDesign(r: Resolved, root: DesignTarget): void {
  for (const [k, v] of Object.entries(r.vars)) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(r.attrs)) root.setAttribute(`data-${k}`, v);
  root.style.colorScheme = r.mode;
}

/** Inline style for a preview element: the theme's tokens, scoped to it. */
export function previewStyle(r: Resolved): Record<string, string> {
  return r.vars;
}

/** Theme metadata the browser shows, built-in and custom. */
export interface CatalogEntry {
  id: string;
  name: string;
  skin: Skin;
  theme: Theme;
  custom: boolean;
  description: string;
}

export function catalog(custom: CustomTheme[]): CatalogEntry[] {
  const builtIn = THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    skin: skinById(t.skin) ?? SKINS[0]!,
    theme: t,
    custom: false,
    description: t.description || (skinById(t.skin) ?? SKINS[0]!).tagline,
  }));
  const mine = custom.map((c) => {
    const base = themeById(c.base) ?? THEMES[0]!;
    return {
      id: c.id,
      name: c.name,
      skin: skinById(base.skin) ?? SKINS[0]!,
      theme: { ...base, id: c.id, name: c.name },
      custom: true,
      description: `Your theme, based on ${base.name}.`,
    };
  });
  return [...mine, ...builtIn];
}
