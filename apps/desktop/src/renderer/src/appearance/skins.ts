import { msg } from '../../../shared/i18n/index.ts';
/**
 * Skins (1.0.46): River's design languages, after Specter's (martex-dev/specter):
 * Specter, Neon, Aurora, Terminal, Paper, Synthwave, Blueprint, Brutal, Retro,
 * Holo and Glitch — plus Luxury, Corporate and Nature. A skin decides the
 * personality (typography, geometry, materials, frame, decoration, message
 * layout) and owns a family of palettes. Decorations CSS can't express as
 * tokens live in styles/skins.css under html[data-decor="…"].
 */

export type UiFont =
  | 'segoe'
  | 'bahnschrift'
  | 'grotesque'
  | 'tahoma'
  | 'inter'
  | 'manrope'
  | 'plex'
  | 'exo'
  | 'grotesk'
  | 'hyperlegible'
  | 'mono';
export type DisplayFont =
  | 'same'
  | 'segoe-display'
  | 'sitka'
  | 'bahnschrift'
  | 'din-condensed'
  | 'heavy'
  | 'tahoma'
  | 'orbitron'
  | 'playfair'
  | 'grotesk'
  | 'exo'
  | 'vt323'
  | 'plex';
export type MonoFont = 'cascadia' | 'jetbrains' | 'fira' | 'plex-mono' | 'vt323';
export type MessageStyle = 'flat' | 'bubbles' | 'cards' | 'terminal' | 'compact';
export type Pattern =
  'none' | 'grid' | 'dots' | 'lines' | 'scanlines' | 'noise' | 'stars' | 'blueprint' | 'waves';
export type Backdrop = 'solid' | 'gradient' | 'aurora' | 'mesh';
export type ButtonShape = 'pill' | 'rounded' | 'square' | 'cut';
export type AvatarShape = 'circle' | 'rounded' | 'square' | 'hexagon';
export type TabStyle = 'pill' | 'underline' | 'block';

export interface Skin {
  id: string;
  name: string;
  tagline: string;
  /** Expressive or professional — the browser can filter by it. */
  direction: 'expressive' | 'professional';
  fonts: { ui: UiFont; display: DisplayFont; mono: MonoFont };
  /** Corner radius of panels and cards (px, before the person's rounding setting). */
  radius: number;
  /** Corner radius of buttons and inputs (px). */
  control: number;
  buttons: ButtonShape;
  avatars: AvatarShape;
  borderWidth: number;
  /** 0–1: how much panels let the backdrop through. */
  glass: number;
  blur: number;
  /** 0–1: luminous accents. */
  glow: number;
  shadow: 'none' | 'soft' | 'deep' | 'hard' | 'glow';
  /** 0–1: gradient strength on primary buttons and the backdrop. */
  gradient: number;
  pattern: Pattern;
  patternStrength: number;
  backdrop: Backdrop;
  headings: 'normal' | 'uppercase' | 'display';
  headingTracking: number;
  messageStyle: MessageStyle;
  tabs: TabStyle;
  /** 'floating': panels sit apart on the backdrop with rounded corners (Aurora, Synthwave, Holo). */
  frame: 'flush' | 'floating';
  /** Hook for skin-only decoration in skins.css. */
  decor: string;
  /** Spacing scale (1 = default). */
  spacing: number;
}

const base: Omit<Skin, 'id' | 'name' | 'tagline' | 'direction' | 'fonts' | 'decor'> = {
  radius: 6,
  control: 6,
  buttons: 'rounded',
  avatars: 'circle',
  borderWidth: 1,
  glass: 0,
  blur: 0,
  glow: 0,
  shadow: 'soft',
  gradient: 0,
  pattern: 'none',
  patternStrength: 0,
  backdrop: 'solid',
  headings: 'normal',
  headingTracking: 0,
  messageStyle: 'flat',
  tabs: 'pill',
  frame: 'flush',
  spacing: 1,
};

export const SKINS: Skin[] = [
  {
    ...base,
    id: 'specter',
    name: 'Specter',
    tagline: msg('Refined graphite. Quiet, precise, professional.'),
    direction: 'professional',
    fonts: { ui: 'segoe', display: 'segoe-display', mono: 'cascadia' },
    radius: 8,
    control: 6,
    glow: 0.15,
    gradient: 0.25,
    decor: 'specter',
  },
  {
    ...base,
    id: 'neon',
    name: 'Neon',
    tagline: msg('Gamer HUD. Angular tabs, glowing edges.'),
    direction: 'expressive',
    fonts: { ui: 'bahnschrift', display: 'bahnschrift', mono: 'cascadia' },
    radius: 3,
    control: 2,
    buttons: 'cut',
    avatars: 'hexagon',
    glow: 0.9,
    shadow: 'glow',
    gradient: 0.9,
    pattern: 'lines',
    patternStrength: 0.5,
    backdrop: 'mesh',
    headings: 'uppercase',
    headingTracking: 0.06,
    messageStyle: 'cards',
    tabs: 'underline',
    decor: 'neon',
  },
  {
    ...base,
    id: 'aurora',
    name: 'Aurora',
    tagline: msg('Frosted glass over living light. Floating everything.'),
    direction: 'expressive',
    fonts: { ui: 'segoe', display: 'segoe-display', mono: 'cascadia' },
    radius: 14,
    control: 10,
    buttons: 'pill',
    glass: 0.7,
    blur: 22,
    glow: 0.25,
    shadow: 'deep',
    gradient: 0.8,
    backdrop: 'aurora',
    headingTracking: -0.01,
    messageStyle: 'bubbles',
    frame: 'floating',
    decor: 'aurora',
    spacing: 1.05,
  },
  {
    ...base,
    id: 'terminal',
    name: 'Terminal',
    tagline: msg('Phosphor CRT. Monospace, brackets, scanlines.'),
    direction: 'professional',
    fonts: { ui: 'mono', display: 'same', mono: 'cascadia' },
    radius: 0,
    control: 0,
    buttons: 'square',
    avatars: 'square',
    glow: 0.45,
    shadow: 'none',
    pattern: 'scanlines',
    patternStrength: 0.6,
    headings: 'uppercase',
    headingTracking: 0.06,
    messageStyle: 'terminal',
    tabs: 'block',
    decor: 'terminal',
    spacing: 0.9,
  },
  {
    ...base,
    id: 'paper',
    name: 'Paper',
    tagline: msg('Editorial light. Serif type, hairlines, calm.'),
    direction: 'professional',
    fonts: { ui: 'segoe', display: 'sitka', mono: 'cascadia' },
    radius: 4,
    control: 3,
    buttons: 'square',
    shadow: 'none',
    pattern: 'noise',
    patternStrength: 0.4,
    headings: 'display',
    tabs: 'underline',
    decor: 'paper',
    spacing: 1.1,
  },
  {
    ...base,
    id: 'synthwave',
    name: 'Synthwave',
    tagline: msg('Outrun nights. Sunset gradients, neon grid, chunky tabs.'),
    direction: 'expressive',
    fonts: { ui: 'bahnschrift', display: 'bahnschrift', mono: 'cascadia' },
    radius: 10,
    control: 8,
    buttons: 'pill',
    glass: 0.1,
    blur: 8,
    glow: 0.9,
    shadow: 'glow',
    gradient: 1,
    pattern: 'grid',
    patternStrength: 0.8,
    backdrop: 'gradient',
    headings: 'uppercase',
    headingTracking: 0.08,
    messageStyle: 'bubbles',
    tabs: 'block',
    frame: 'floating',
    decor: 'synth',
  },
  {
    ...base,
    id: 'blueprint',
    name: 'Blueprint',
    tagline: msg('Technical drawing. Grid paper, dimension lines, title blocks.'),
    direction: 'professional',
    fonts: { ui: 'bahnschrift', display: 'din-condensed', mono: 'cascadia' },
    radius: 0,
    control: 0,
    buttons: 'square',
    avatars: 'square',
    borderWidth: 1.5,
    glow: 0.1,
    shadow: 'none',
    pattern: 'blueprint',
    patternStrength: 1,
    headings: 'uppercase',
    headingTracking: 0.1,
    messageStyle: 'cards',
    tabs: 'block',
    decor: 'blueprint',
    spacing: 0.95,
  },
  {
    ...base,
    id: 'brutal',
    name: 'Brutal',
    tagline: msg('Neo-brutalist. Thick borders, hard shadows, loud colour.'),
    direction: 'expressive',
    fonts: { ui: 'grotesque', display: 'heavy', mono: 'cascadia' },
    radius: 0,
    control: 0,
    buttons: 'square',
    avatars: 'square',
    borderWidth: 2.5,
    shadow: 'hard',
    headings: 'display',
    headingTracking: -0.01,
    messageStyle: 'cards',
    tabs: 'block',
    decor: 'brutal',
  },
  {
    ...base,
    id: 'retro',
    name: 'Retro',
    tagline: msg('Classic desktop. Bevelled buttons, title bars, teal wallpaper.'),
    direction: 'professional',
    fonts: { ui: 'tahoma', display: 'tahoma', mono: 'cascadia' },
    radius: 0,
    control: 0,
    buttons: 'square',
    avatars: 'square',
    shadow: 'none',
    tabs: 'block',
    decor: 'retro',
    spacing: 0.95,
  },
  {
    ...base,
    id: 'holo',
    name: 'Holo',
    tagline: msg('Iridescent chrome. Pearl surfaces, prism borders, shimmer.'),
    direction: 'expressive',
    fonts: { ui: 'segoe', display: 'segoe-display', mono: 'cascadia' },
    radius: 16,
    control: 12,
    buttons: 'pill',
    glass: 0.35,
    blur: 18,
    glow: 0.35,
    shadow: 'deep',
    gradient: 1,
    backdrop: 'aurora',
    messageStyle: 'bubbles',
    frame: 'floating',
    decor: 'holo',
    spacing: 1.05,
  },
  {
    ...base,
    id: 'glitch',
    name: 'Glitch',
    tagline: msg('Corrupted signal. RGB split, notched panels, tearing scanlines.'),
    direction: 'expressive',
    fonts: { ui: 'bahnschrift', display: 'din-condensed', mono: 'cascadia' },
    radius: 0,
    control: 0,
    buttons: 'cut',
    avatars: 'square',
    glow: 0.5,
    shadow: 'none',
    gradient: 0.5,
    pattern: 'scanlines',
    patternStrength: 0.7,
    backdrop: 'mesh',
    headings: 'uppercase',
    headingTracking: 0.06,
    messageStyle: 'cards',
    tabs: 'underline',
    decor: 'glitch',
  },
  {
    ...base,
    id: 'luxury',
    name: 'Luxury',
    tagline: msg('Quiet craftsmanship. Serif headings, precious-metal accents.'),
    direction: 'professional',
    fonts: { ui: 'manrope', display: 'playfair', mono: 'jetbrains' },
    radius: 6,
    control: 4,
    buttons: 'square',
    glow: 0.1,
    gradient: 0.35,
    backdrop: 'gradient',
    headings: 'display',
    headingTracking: 0.01,
    tabs: 'underline',
    decor: 'luxe',
    spacing: 1.15,
  },
  {
    ...base,
    id: 'corporate',
    name: 'Corporate',
    tagline: msg('Office ready. Systematic panels, clear blocks.'),
    direction: 'professional',
    fonts: { ui: 'plex', display: 'plex', mono: 'plex-mono' },
    radius: 4,
    control: 4,
    avatars: 'rounded',
    tabs: 'block',
    decor: 'corporate',
    spacing: 0.95,
  },
  {
    ...base,
    id: 'nature',
    name: 'Nature',
    tagline: msg('Atmosphere. Organic colour, soft gradients, gentle waves.'),
    direction: 'expressive',
    fonts: { ui: 'manrope', display: 'playfair', mono: 'jetbrains' },
    radius: 16,
    control: 12,
    buttons: 'pill',
    glass: 0.3,
    blur: 16,
    glow: 0.1,
    gradient: 0.5,
    pattern: 'waves',
    patternStrength: 0.6,
    backdrop: 'aurora',
    headings: 'display',
    messageStyle: 'bubbles',
    decor: 'nature',
    spacing: 1.05,
  },
];

export const skinById = (id: string): Skin | undefined => SKINS.find((s) => s.id === id);

export const FONT_STACKS: Record<UiFont | DisplayFont | MonoFont, string> = {
  segoe: "'Segoe UI Variable Text', 'Segoe UI', 'Inter Variable', system-ui, sans-serif",
  'segoe-display': "'Segoe UI Variable Display', 'Segoe UI', 'Inter Variable', system-ui, sans-serif",
  bahnschrift: "'Bahnschrift', 'Exo 2 Variable', 'Segoe UI', 'Inter Variable', system-ui, sans-serif",
  'din-condensed': "'Bahnschrift Condensed', 'Bahnschrift', 'Arial Narrow', 'Exo 2 Variable', sans-serif",
  sitka: "'Sitka Heading', 'Sitka Display', 'Iowan Old Style', 'Playfair Display Variable', Georgia, serif",
  heavy: "'Arial Black', 'Segoe UI Black', 'Space Grotesk Variable', Impact, sans-serif",
  grotesque: "'Segoe UI', Arial, 'Helvetica Neue', 'Inter Variable', sans-serif",
  tahoma: "Tahoma, 'MS Sans Serif', 'Segoe UI', Verdana, 'Inter Variable', sans-serif",
  inter: "'Inter Variable', system-ui, sans-serif",
  manrope: "'Manrope Variable', 'Inter Variable', system-ui, sans-serif",
  plex: "'IBM Plex Sans', 'Inter Variable', system-ui, sans-serif",
  exo: "'Exo 2 Variable', 'Inter Variable', system-ui, sans-serif",
  grotesk: "'Space Grotesk Variable', 'Inter Variable', system-ui, sans-serif",
  hyperlegible: "'Atkinson Hyperlegible', 'Inter Variable', system-ui, sans-serif",
  mono: "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono Variable', Consolas, monospace",
  same: '',
  orbitron: "'Orbitron Variable', 'Exo 2 Variable', 'Inter Variable', sans-serif",
  playfair: "'Playfair Display Variable', Georgia, serif",
  vt323: "'VT323', 'JetBrains Mono Variable', monospace",
  cascadia: "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono Variable', Consolas, monospace",
  jetbrains: "'JetBrains Mono Variable', ui-monospace, monospace",
  fira: "'Fira Code Variable', 'JetBrains Mono Variable', monospace",
  'plex-mono': "'IBM Plex Mono', 'JetBrains Mono Variable', monospace",
};
