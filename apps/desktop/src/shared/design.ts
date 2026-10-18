import { z } from 'zod';

/**
 * River's design settings (1.0.45): which skin and theme, the person's own
 * adjustments on top, their custom themes and saved appearance profiles.
 *
 * Only data lives here — never CSS or code. Every value is bounded, so an
 * imported or hand-edited file can at worst look odd, never break River or run
 * anything. Unknown skin/theme ids fall back to the defaults in the renderer.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/);
const name = z.string().trim().min(1).max(48);

/** A background picture the person chose (PNG, JPEG or WebP up to 2 MB, as a data URL). */
const dataImage = z
  .string()
  .max(3_000_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
const IMAGE_KEY = /^[a-z0-9]{1,32}$/;
/** A reference to a picture kept in DesignSettings.images. */
export const IMAGE_REF = /^image:[a-z0-9]{1,32}$/;
/**
 * Pictures kept at most: one per profile (30) and the current look, plus chat wallpaper photos
 * (2.18; those are shrunk to a few hundred kilobytes before they are kept).
 */
export const MAX_DESIGN_IMAGES = 64;
/** Chat wallpaper photos kept at most (each chat may point to one; the same photo is kept once). */
export const MAX_WALLPAPER_PHOTOS = 24;

/** Colours a person may set themselves (each replaces the theme's own). */
export const COLOR_ROLES = [
  'bg',
  'surface',
  'base',
  'raised',
  'text',
  'muted',
  'accent',
  'accent2',
  'selection',
  'border',
  'focus',
  'ok',
  'warn',
  'danger',
  'info',
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const colorOverridesSchema = z.partialRecord(z.enum(COLOR_ROLES), hex);

const unit = (min: number, max: number, def: number) => z.number().min(min).max(max).default(def);

/**
 * Chat wallpapers (2.18): what shows behind the messages of a conversation or channel. Built-in
 * doodle patterns and gradients are drawn by River (CSS and SVG, nothing downloaded) in the
 * theme's colours, light or dark; a photo is the person's own and never leaves this device.
 */
export const WALLPAPER_PATTERNS = [
  'doodles',
  'hearts',
  'space',
  'leaves',
  'geometry',
  'waves',
  'music',
  'paws',
] as const;
export const WALLPAPER_GRADIENTS = [
  'theme',
  'dawn',
  'lagoon',
  'dusk',
  'mint',
  'peach',
  'ocean',
  'berry',
  'forest',
  'mono',
] as const;
export type WallpaperPattern = (typeof WALLPAPER_PATTERNS)[number];
export type WallpaperGradient = (typeof WALLPAPER_GRADIENTS)[number];

export const wallpaperSchema = z.object({
  /** 'none': the conversation's own colour (River before 2.18). */
  kind: z.enum(['none', 'pattern', 'gradient', 'solid', 'photo']).default('none'),
  pattern: z.enum(WALLPAPER_PATTERNS).default('doodles'),
  /** The colours under a pattern, or the gradient itself. */
  gradient: z.enum(WALLPAPER_GRADIENTS).default('theme'),
  /** A solid colour, or the doodles' tint (null: the accent). Kept readable behind text. */
  color: hex.nullable().default(null),
  /** The person's photo: `image:<key>` pointing into DesignSettings.images. */
  photo: z
    .union([z.string().regex(IMAGE_REF), dataImage])
    .nullable()
    .default(null),
  /** 0–1: how strongly the doodles show. */
  strength: unit(0, 1, 0.5),
  /** Photo only: blur in pixels, and how much the conversation colour covers it. */
  blur: unit(0, 24, 0),
  dim: unit(0, 0.85, 0.35),
});
export type Wallpaper = z.infer<typeof wallpaperSchema>;
export const DEFAULT_WALLPAPER: Wallpaper = wallpaperSchema.parse({});

/** A chat a wallpaper belongs to: `dm:<conversation>` or `ch:<channel>`. */
export const CHAT_KEY = /^(dm|ch):[A-Za-z0-9_.:-]{1,96}$/;
/** Chats with their own wallpaper, at most. */
export const MAX_CHAT_WALLPAPERS = 300;

export const designPrefsSchema = z.object({
  /** 'theme' follows the theme; 'light'/'dark' pick the matching sibling theme when the skin has one. */
  mode: z.enum(['theme', 'light', 'dark', 'system']).default('theme'),
  colors: colorOverridesSchema.default({}),
  // --- overall ---
  contrast: unit(0.8, 1.5, 1),
  saturation: unit(0, 1.5, 1),
  surfaceDepth: unit(0, 2, 1),
  borders: unit(0, 2, 1),
  radius: unit(0, 2, 1),
  shadows: unit(0, 2, 1),
  intensity: unit(0, 2, 1),
  // --- materials ---
  glass: unit(0, 2, 1),
  blur: unit(0, 2, 1),
  glow: unit(0, 2, 1),
  gradient: unit(0, 2, 1),
  pattern: z
    .enum(['skin', 'none', 'grid', 'dots', 'lines', 'scanlines', 'noise', 'stars', 'blueprint', 'waves'])
    .default('skin'),
  patternStrength: unit(0, 2, 1),
  // --- background ---
  background: z.enum(['skin', 'solid', 'gradient', 'aurora', 'mesh', 'image']).default('skin'),
  /**
   * The picture: `image:<key>`, pointing into DesignSettings.images, where each picture is kept
   * once however many profiles use it. (Older settings held the data URL itself, in every
   * profile; compactDesignImages moves those into `images`.)
   */
  backgroundImage: z
    .union([z.string().regex(IMAGE_REF), dataImage])
    .nullable()
    .default(null),
  backgroundDim: unit(0, 1, 0.6),
  backgroundBlur: unit(0, 24, 0),
  animatedBackground: z.boolean().default(false),
  // --- typography ---
  uiFont: z
    .enum([
      'skin',
      'segoe',
      'bahnschrift',
      'grotesque',
      'tahoma',
      'inter',
      'manrope',
      'plex',
      'exo',
      'grotesk',
      'hyperlegible',
      'mono',
    ])
    .default('skin'),
  displayFont: z
    .enum([
      'skin',
      'same',
      'segoe-display',
      'sitka',
      'bahnschrift',
      'din-condensed',
      'heavy',
      'tahoma',
      'orbitron',
      'playfair',
      'grotesk',
      'exo',
      'vt323',
      'plex',
    ])
    .default('skin'),
  monoFont: z.enum(['skin', 'cascadia', 'jetbrains', 'fira', 'plex-mono', 'vt323']).default('skin'),
  textWeight: unit(300, 600, 400),
  lineHeight: unit(1.2, 1.9, 1.45),
  letterSpacing: unit(-0.03, 0.08, 0),
  headings: z.enum(['skin', 'normal', 'uppercase', 'display']).default('skin'),
  tabularNumbers: z.boolean().default(false),
  // --- layout ---
  navSide: z.enum(['left', 'right']).default('left'),
  railSize: z.enum(['normal', 'compact']).default('normal'),
  sidebarWidth: unit(200, 340, 240),
  memberList: z.enum(['show', 'hide']).default('show'),
  memberWidth: unit(180, 320, 240),
  chatWidth: z.enum(['full', 'readable']).default('full'),
  messageStyle: z.enum(['skin', 'flat', 'bubbles', 'cards', 'terminal', 'compact']).default('skin'),
  ownMessages: z.enum(['left', 'right']).default('right'),
  avatarShape: z.enum(['skin', 'circle', 'rounded', 'square', 'hexagon']).default('skin'),
  spacing: unit(0.7, 1.4, 1),
  titlebar: z.enum(['show', 'minimal']).default('show'),
  focusMode: z.boolean().default(false),
  // --- components ---
  buttonShape: z.enum(['skin', 'pill', 'rounded', 'square', 'cut']).default('skin'),
  borderWidth: unit(0, 2, 1),
  iconSize: unit(16, 26, 20),
  iconStroke: unit(1.2, 2.6, 1.8),
  scrollbars: z.enum(['thin', 'normal', 'hidden']).default('thin'),
  badges: z.enum(['filled', 'outline', 'dot']).default('filled'),
  tabs: z.enum(['skin', 'pill', 'underline', 'block']).default('skin'),
  /** 2.18: the shape of message bubbles (phones, and the Bubbles message style on computers). */
  bubbles: z.enum(['rounded', 'square', 'outlined']).default('rounded'),
  /** 2.18: the wallpaper behind every conversation and channel (each chat may have its own). */
  wallpaper: wallpaperSchema.prefault({}),
  // --- motion ---
  motionSpeed: unit(0.5, 2, 1),
  hoverEffects: z.boolean().default(true),
  ambient: z.boolean().default(true),
});
export type DesignPrefs = z.infer<typeof designPrefsSchema>;
export const DEFAULT_DESIGN_PREFS: DesignPrefs = designPrefsSchema.parse({});

/** A theme a person made: a built-in theme with their own colours, saved under a name. */
export const customThemeSchema = z.object({
  id,
  name,
  base: id,
  colors: colorOverridesSchema,
  createdAt: z.string().max(40),
});
export type CustomTheme = z.infer<typeof customThemeSchema>;

/** Everything about how River looks, saved under a name ("Night session", "Office"). */
export const designProfileSchema = z.object({
  id,
  name,
  skin: id,
  theme: id,
  prefs: designPrefsSchema,
});
export type DesignProfile = z.infer<typeof designProfileSchema>;

export const designSettingsSchema = z.object({
  skin: id,
  theme: id,
  prefs: designPrefsSchema,
  customThemes: z.array(customThemeSchema).max(100),
  profiles: z.array(designProfileSchema).max(30),
  favorites: z.array(id).max(200),
  activeProfile: id.nullable(),
  /** 1.0.46: the person picked a skin (River asks once, before anything else). */
  chosen: z.boolean().default(false),
  /** Background pictures, each kept once; the current look and profiles point to them (`image:<key>`). */
  images: z
    .record(z.string().regex(IMAGE_KEY), dataImage)
    .refine((images) => Object.keys(images).length <= MAX_DESIGN_IMAGES, 'Too many pictures')
    .default({}),
  /** 2.18: chats with a wallpaper of their own (kept on this device only). */
  chatWallpapers: z
    .record(z.string().regex(CHAT_KEY), wallpaperSchema)
    .refine((w) => Object.keys(w).length <= MAX_CHAT_WALLPAPERS, 'Too many chat wallpapers')
    .default({}),
});
export type DesignSettings = z.infer<typeof designSettingsSchema>;

/** A short, stable key for a picture (FNV-1a, two ways): the same picture always gets the same key. */
export function imageKey(dataUrl: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < dataUrl.length; i++) {
    const c = dataUrl.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}${dataUrl.length.toString(36)}`.slice(0, 32);
}

/** The picture a background value shows: a data URL, or the one a reference points to. */
export function designImage(
  design: Pick<DesignSettings, 'images'>,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (!IMAGE_REF.test(value)) return value;
  return design.images?.[value.slice('image:'.length)] ?? null;
}

/**
 * Keeps every background picture once: pictures held in the current look or in
 * profiles move into `images` and are pointed to; pictures nothing points to any more go.
 * Before, every saved profile carried its own copy (about 2.7 MB of text each).
 */
export function compactDesignImages(design: DesignSettings): DesignSettings {
  const images: Record<string, string> = {};
  const keep = (value: string | null): string | null => {
    if (!value) return null;
    if (IMAGE_REF.test(value)) {
      const key = value.slice('image:'.length);
      const picture = design.images?.[key];
      if (!picture) return null;
      images[key] = picture;
      return value;
    }
    let key = imageKey(value);
    // Another picture with the same key (very unlikely): give this one its own.
    for (let n = 0; images[key] !== undefined && images[key] !== value; n++)
      key = `${imageKey(value).slice(0, 28)}x${n}`;
    images[key] = value;
    return `image:${key}`;
  };
  const keepPrefs = (prefs: DesignPrefs): DesignPrefs => {
    const out = { ...prefs, backgroundImage: keep(prefs.backgroundImage) };
    // Settings written before 2.18 have no wallpaper yet (the schema adds the default).
    if (prefs.wallpaper) out.wallpaper = { ...prefs.wallpaper, photo: keep(prefs.wallpaper.photo) };
    return out;
  };
  const prefs = keepPrefs(design.prefs);
  const profiles = design.profiles.map((p) => ({ ...p, prefs: keepPrefs(p.prefs) }));
  const chatWallpapers: Record<string, Wallpaper> = {};
  for (const [key, w] of Object.entries(design.chatWallpapers ?? {}))
    chatWallpapers[key] = { ...w, photo: keep(w.photo) };
  return { ...design, prefs, profiles, images, chatWallpapers };
}

/** Shown only until the person chooses a skin (River asks first). */
export const DEFAULT_SKIN = 'specter';
export const DEFAULT_THEME = 'specter-specter';

export const DEFAULT_DESIGN: DesignSettings = {
  skin: DEFAULT_SKIN,
  theme: DEFAULT_THEME,
  prefs: DEFAULT_DESIGN_PREFS,
  customThemes: [],
  profiles: [],
  favorites: [],
  activeProfile: null,
  chosen: false,
  images: {},
  chatWallpapers: {},
};

/** What an appearance export file contains (import validates against this). */
export const designExportSchema = z.object({
  kind: z.literal('river-appearance'),
  version: z.literal(1),
  skin: id,
  theme: id,
  prefs: designPrefsSchema,
  customThemes: z.array(customThemeSchema).max(100).default([]),
  profiles: z.array(designProfileSchema).max(30).default([]),
});
export type DesignExport = z.infer<typeof designExportSchema>;

/**
 * A theme shared as a short code (2.18): its name, the built-in theme it starts from and the
 * colours changed — only data, checked here before anything uses it. Nothing in it can run.
 */
export const sharedThemeSchema = z
  .object({
    kind: z.literal('river-theme'),
    v: z.literal(1),
    name,
    base: id,
    colors: colorOverridesSchema,
  })
  .strict();
export type SharedTheme = z.infer<typeof sharedThemeSchema>;
/** A theme code is never longer than this (a whole theme is well under 1 KB). */
export const MAX_THEME_CODE = 2000;
