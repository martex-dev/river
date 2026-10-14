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
  backgroundImage: z
    .string()
    .max(3_000_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .nullable()
    .default(null),
  backgroundDim: unit(0, 1, 0.6),
  backgroundBlur: unit(0, 24, 0),
  animatedBackground: z.boolean().default(false),
  // --- typography ---
  uiFont: z
    .enum(['skin', 'inter', 'manrope', 'plex', 'exo', 'grotesk', 'hyperlegible', 'mono'])
    .default('skin'),
  displayFont: z
    .enum(['skin', 'same', 'orbitron', 'playfair', 'grotesk', 'exo', 'vt323', 'plex'])
    .default('skin'),
  monoFont: z.enum(['skin', 'jetbrains', 'fira', 'plex-mono', 'vt323']).default('skin'),
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
});
export type DesignSettings = z.infer<typeof designSettingsSchema>;

export const DEFAULT_SKIN = 'river';
export const DEFAULT_THEME = 'river-current';

export const DEFAULT_DESIGN: DesignSettings = {
  skin: DEFAULT_SKIN,
  theme: DEFAULT_THEME,
  prefs: DEFAULT_DESIGN_PREFS,
  customThemes: [],
  profiles: [],
  favorites: [],
  activeProfile: null,
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
