import { msg } from '../../../shared/i18n/index.ts';
import {
  CHAT_KEY,
  DEFAULT_WALLPAPER,
  MAX_CHAT_WALLPAPERS,
  type DesignSettings,
  type Wallpaper,
  type WallpaperGradient,
  type WallpaperPattern,
} from '../../../shared/design.ts';
import { contrast, mix, rgba } from './color.ts';

/**
 * Chat wallpapers (2.18): Telegram-like doodles, soft gradients, a solid colour or your own
 * photo behind the messages. Everything is drawn here from the theme's colours (CSS gradients
 * and small SVG tiles as data: URLs — nothing is downloaded), so every wallpaper has a light and
 * a dark version. Pure functions: the live app, the Appearance preview and the tests share them.
 *
 * Readability: every colour a wallpaper puts behind text is kept at least READABLE (4.6:1)
 * against the theme's text, secondary text and accent text — River moves it towards the
 * conversation colour until it is. A photo cannot be measured, so messages over a photo get a
 * backing plate (see looks.css) and the photo is always partly covered by the conversation colour.
 */

/** The contrast every wallpaper colour keeps with each kind of text (WCAG AA is 4.5:1). */
export const READABLE = 4.6;

/** The theme colours a wallpaper is drawn from (CSS custom properties of a resolved design). */
export interface WallpaperColors {
  base: string;
  text: string;
  dim: string;
  faint: string;
  accent: string;
  accent2: string;
  accentText: string;
  mode: 'light' | 'dark';
}

export function colorsOf(vars: Record<string, string>, mode: 'light' | 'dark'): WallpaperColors {
  return {
    base: vars['--layer-2'] ?? '#1e1f22',
    text: vars['--text'] ?? '#f2f3f5',
    dim: vars['--text-dim'] ?? '#b5bac1',
    faint: vars['--text-faint'] ?? '#949ba4',
    accent: vars['--accent'] ?? '#5865f2',
    accent2: vars['--accent-2'] ?? '#eb459e',
    accentText: vars['--accent-text'] ?? vars['--accent'] ?? '#5865f2',
    mode,
  };
}

/** The lowest contrast any of the theme's text colours has on `bg`. */
export function worstContrast(bg: string, c: WallpaperColors): number {
  return Math.min(
    contrast(c.text, bg),
    contrast(c.dim, bg),
    contrast(c.faint, bg),
    contrast(c.accentText, bg),
  );
}

/** Moves a colour towards the conversation colour until all text on it stays readable. */
export function readableBehindText(color: string, c: WallpaperColors, ratio = READABLE): string {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const out = t === 0 ? color : mix(color, c.base, t);
    if (worstContrast(out, c) >= ratio) return out;
  }
  return c.base;
}

// ---- gradients ----------------------------------------------------------------------------------

/** Three stops per gradient, for light and for dark themes ('theme' is drawn from the accents). */
const GRADIENT_STOPS: Record<Exclude<WallpaperGradient, 'theme'>, { light: string[]; dark: string[] }> = {
  dawn: { light: ['#fde2e4', '#fad2e1', '#e2ece9'], dark: ['#2b1d2a', '#3b2433', '#1d2a2a'] },
  lagoon: { light: ['#d8f3f0', '#cde7f7', '#e6f7d9'], dark: ['#0f2a2e', '#11263a', '#16301f'] },
  dusk: { light: ['#e7dcfb', '#f6d9ec', '#dbe4fb'], dark: ['#211a3a', '#2e1a33', '#141f3a'] },
  mint: { light: ['#dcf5e3', '#eef9d6', '#d4f1ee'], dark: ['#13281c', '#1d2a14', '#102826'] },
  peach: { light: ['#ffe5d0', '#ffd9d9', '#fff1c9'], dark: ['#33221a', '#331c1f', '#302914'] },
  ocean: { light: ['#d6e6ff', '#d3f0ff', '#e3dcff'], dark: ['#0f1c36', '#0d2633', '#1a1736'] },
  berry: { light: ['#f8d7ea', '#e9d6fb', '#ffd9e1'], dark: ['#33142a', '#26173a', '#36151f'] },
  forest: { light: ['#e0eedb', '#e9e5cf', '#d6e7df'], dark: ['#15241a', '#24231a', '#112320'] },
  mono: { light: ['#eef0f3', '#e3e6ea', '#f6f7f9'], dark: ['#18191c', '#202226', '#141517'] },
};

export const GRADIENT_NAMES: Record<WallpaperGradient, string> = {
  theme: msg('Theme'),
  dawn: msg('Dawn'),
  lagoon: msg('Lagoon'),
  dusk: msg('Dusk'),
  mint: msg('Mint'),
  peach: msg('Peach'),
  ocean: msg('Ocean'),
  berry: msg('Berry'),
  forest: msg('Forest'),
  mono: msg('Mist'),
};

/** The gradient's stops in this theme, each readable behind text. */
export function gradientStops(g: WallpaperGradient, c: WallpaperColors, ratio = READABLE): string[] {
  const raw =
    g === 'theme'
      ? [
          mix(c.base, c.accent, c.mode === 'light' ? 0.16 : 0.2),
          mix(c.base, mix(c.accent, c.accent2, 0.5), c.mode === 'light' ? 0.1 : 0.12),
          mix(c.base, c.accent2, c.mode === 'light' ? 0.16 : 0.2),
        ]
      : GRADIENT_STOPS[g][c.mode];
  return raw.map((s) => readableBehindText(s, c, ratio));
}

function gradientCss(stops: string[]): string {
  const [a, b, d] = stops as [string, string, string];
  return `radial-gradient(120% 90% at 0% 0%, ${a}, transparent 70%), radial-gradient(110% 90% at 100% 100%, ${d}, transparent 70%), linear-gradient(160deg, ${a}, ${b} 50%, ${d})`;
}

// ---- doodle patterns ----------------------------------------------------------------------------

/** Small line drawings on a 24 × 24 grid (stroked, never filled). */
const ICON: Record<string, string> = {
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.6 6.7 19.4l1.2-6-4.5-4.1 6-.7z',
  chat: 'M4 5h16v10H10l-5 4v-4H4z',
  plane: 'M3 11l18-8-7 18-2.5-7.5zM11.5 13.5L21 3',
  note: 'M9 18a2.5 2.5 0 1 1-2.5-2.5H9V5l10-2v12a2.5 2.5 0 1 1-2.5-2.5H19',
  moon: 'M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z',
  sparkle: 'M12 3c.6 4.5 2.5 6.4 7 7-4.5.6-6.4 2.5-7 7-.6-4.5-2.5-6.4-7-7 4.5-.6 6.4-2.5 7-7z',
  ring: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z',
  leaf: 'M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l8-8',
  flower:
    'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM12 9.5C10 6 14 3.5 12 3.5S14 6 12 9.5M14.5 12c3.5-2 6 2 6 0s-2.5 2-6 0M12 14.5c2 3.5-2 6 0 6s-2-2.5 0-6M9.5 12c-3.5 2-6-2-6 0s2.5-2 6 0',
  paw: 'M12 13c-3 0-5 2.6-5 4.6S9 20 12 20s5-.4 5-2.4-2-4.6-5-4.6zM6.5 9a1.6 2 0 1 0 0 .01zM10 6a1.6 2 0 1 0 0 .01zM14 6a1.6 2 0 1 0 0 .01zM17.5 9a1.6 2 0 1 0 0 .01z',
  planet: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM3.5 15.5c2.5-3.5 14-8 17-5',
  rocket:
    'M12 3c3 2 5 6 4 11l-4 3-4-3C7 9 9 5 12 3zM10 17l-1.5 4M14 17l1.5 4M12 9.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z',
  triangle: 'M12 4.5l8 14H4z',
  square: 'M6.5 6.5h11v11h-11z',
  hexagon: 'M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z',
  plus: 'M12 5v14M5 12h14',
  smile: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM8 13.5c2 2.5 6 2.5 8 0M9 9.5v.5M15 9.5v.5',
  cup: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h2a2 2 0 0 1 0 4h-2M9 3.5v3M12.5 3.5v3',
  camera: 'M4 8h4l2-2.5h4L16 8h4v11H4zM12 10.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  lock: 'M7.5 11V8a4.5 4.5 0 0 1 9 0v3M5.5 11h13v9h-13z',
  cat: 'M5 9.5L6 4l4 3h4l4-3 1 5.5c1 2 1 4.2 0 6-1.5 3-4 4.5-7 4.5s-5.5-1.5-7-4.5c-1-1.8-1-4 0-6zM9.5 12.5v.5M14.5 12.5v.5',
  wave: 'M2 12c2.5-3.5 4.5-3.5 7 0s4.5 3.5 7 0 4.5-3.5 6-1.5',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  drop: 'M12 3.5c3.5 4.5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.5 6-11z',
};

const PATTERN_ICONS: Record<WallpaperPattern, string[]> = {
  doodles: [
    'chat',
    'plane',
    'heart',
    'star',
    'note',
    'smile',
    'lock',
    'cup',
    'camera',
    'moon',
    'sparkle',
    'cat',
  ],
  hearts: ['heart', 'sparkle', 'heart', 'ring', 'heart', 'star'],
  space: ['planet', 'star', 'moon', 'rocket', 'sparkle', 'ring'],
  leaves: ['leaf', 'flower', 'drop', 'leaf', 'sparkle', 'ring'],
  geometry: ['triangle', 'square', 'ring', 'hexagon', 'plus'],
  waves: ['wave', 'wave', 'drop', 'wave'],
  music: ['note', 'sparkle', 'wave', 'note', 'star', 'heart'],
  paws: ['paw', 'heart', 'cat', 'paw', 'star'],
};

export const PATTERN_NAMES: Record<WallpaperPattern, string> = {
  doodles: msg('Doodles'),
  hearts: msg('Hearts'),
  space: msg('Space'),
  leaves: msg('Garden'),
  geometry: msg('Shapes'),
  waves: msg('Waves'),
  music: msg('Music'),
  paws: msg('Paws'),
};

/** A small deterministic random sequence, so a pattern always looks the same. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const TILE = 300;
const CELLS = 5;

/** The SVG tile of a pattern: icons scattered on a 5 × 5 grid, turned and sized a little at random. */
export function patternSvg(pattern: WallpaperPattern, stroke: string, opacity: number): string {
  const rand = seeded(pattern);
  const icons = PATTERN_ICONS[pattern];
  const cell = TILE / CELLS;
  const parts: string[] = [];
  let n = 0;
  for (let row = 0; row < CELLS; row++)
    for (let col = 0; col < CELLS; col++) {
      const name = icons[n++ % icons.length]!;
      const size = 26 + rand() * 12;
      const x = col * cell + (cell - size) / 2 + (rand() - 0.5) * cell * 0.35 + (row % 2 ? cell / 2 : 0);
      const y = row * cell + (cell - size) / 2 + (rand() - 0.5) * cell * 0.35;
      const turn = Math.round((rand() - 0.5) * 60);
      const scale = (size / 24).toFixed(3);
      // Icons pushed past the right edge are drawn again on the left, so tiles join without seams.
      for (const dx of x + size > TILE ? [0, -TILE] : [0])
        parts.push(
          `<path transform='translate(${(x + dx).toFixed(1)} ${y.toFixed(1)}) rotate(${turn} ${(size / 2).toFixed(1)} ${(size / 2).toFixed(1)}) scale(${scale})' d='${ICON[name]}'/>`,
        );
    }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE}' height='${TILE}' viewBox='0 0 ${TILE} ${TILE}'><g fill='none' stroke='${stroke}' stroke-opacity='${opacity.toFixed(3)}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>${parts.join('')}</g></svg>`;
}

const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/**
 * How visible the doodles may be: the requested strength, lowered until a line crossing any
 * colour of the gradient still leaves the text on it readable.
 */
export function doodleOpacity(stroke: string, stops: string[], strength: number, c: WallpaperColors): number {
  let a = (c.mode === 'light' ? 0.22 : 0.26) * Math.max(0, Math.min(1, strength));
  const fails = (x: number): boolean => stops.some((s) => worstContrast(mix(s, stroke, x), c) < READABLE);
  while (a > 0.01 && fails(a)) a -= 0.01;
  return a > 0.01 && !fails(a) ? a : 0;
}

// ---- the wallpaper ------------------------------------------------------------------------------

export interface WallpaperLayers {
  kind: Wallpaper['kind'];
  /** The CSS `background` for the messages area ('none': nothing behind them). */
  background: string;
  /** Messages over it need a backing plate (a photo cannot be measured for contrast). */
  plate: boolean;
  /** Every colour this wallpaper puts behind text (empty for a photo); the tests measure these. */
  samples: string[];
}

/**
 * The background a wallpaper draws behind messages. `photo` is the picture to show (already
 * looked up, and blurred when asked); without it a photo wallpaper falls back to the theme gradient.
 */
export function wallpaperLayers(
  w: Wallpaper | null | undefined,
  c: WallpaperColors,
  photo: string | null = null,
  /** The doodle tile's size in px (smaller in the pickers' swatches). */
  tile: number = TILE,
): WallpaperLayers {
  const wp = { ...DEFAULT_WALLPAPER, ...w };
  if (wp.kind === 'none') return { kind: 'none', background: 'none', plate: false, samples: [] };
  if (wp.kind === 'photo' && photo) {
    // The conversation colour always covers it a little: text never sits on the bare photo.
    const cover = rgba(c.base, Math.max(0.15, Math.min(0.85, wp.dim)));
    return {
      kind: 'photo',
      background: `linear-gradient(${cover}, ${cover}), url("${photo}") center / cover no-repeat, ${c.base}`,
      plate: true,
      samples: [],
    };
  }
  if (wp.kind === 'solid') {
    const solid = readableBehindText(wp.color ?? mix(c.base, c.accent, 0.14), c);
    return { kind: 'solid', background: solid, plate: false, samples: [solid] };
  }
  // Under doodles the colours keep a little more room, so the lines can show.
  const stops = gradientStops(
    wp.kind === 'photo' ? 'theme' : wp.gradient,
    c,
    wp.kind === 'pattern' ? READABLE + 1 : READABLE,
  );
  if (wp.kind === 'pattern') {
    const stroke = wp.color ?? (c.mode === 'light' ? mix(c.accent, '#000000', 0.25) : c.accent);
    const opacity = doodleOpacity(stroke, stops, wp.strength, c);
    const image = svgUrl(patternSvg(wp.pattern, stroke, opacity));
    return {
      kind: 'pattern',
      background: `${image} 0 0 / ${tile}px ${tile}px, ${gradientCss(stops)}`,
      plate: false,
      samples: [...stops, ...stops.map((s) => mix(s, stroke, opacity))],
    };
  }
  return { kind: 'gradient', background: gradientCss(stops), plate: false, samples: stops };
}

// ---- per-chat wallpapers ------------------------------------------------------------------------

export const dmKey = (peer: string): string => `dm:${peer}`;
export const channelKey = (channelId: string): string => `ch:${channelId}`;

/** The wallpaper a chat shows: its own, else the app's. */
export function wallpaperFor(design: DesignSettings, key: string | null): Wallpaper {
  const own = key ? design.chatWallpapers?.[key] : undefined;
  return own ?? design.prefs.wallpaper ?? DEFAULT_WALLPAPER;
}

/** Gives a chat its own wallpaper (null: back to the app's). Unknown or too many chats are refused. */
export function withChatWallpaper(
  design: DesignSettings,
  key: string,
  wallpaper: Wallpaper | null,
): DesignSettings {
  if (!CHAT_KEY.test(key)) return design;
  const next = { ...design.chatWallpapers };
  if (wallpaper) next[key] = wallpaper;
  else delete next[key];
  if (Object.keys(next).length > MAX_CHAT_WALLPAPERS) return design;
  return { ...design, chatWallpapers: next };
}
