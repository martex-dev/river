import { describe, expect, it } from 'vitest';
import {
  compactDesignImages,
  DEFAULT_DESIGN,
  DEFAULT_DESIGN_PREFS,
  DEFAULT_WALLPAPER,
  designSettingsSchema,
  WALLPAPER_GRADIENTS,
  WALLPAPER_PATTERNS,
  type DesignSettings,
  type Wallpaper,
} from '../src/shared/design.ts';
import {
  DEFAULT_SETTINGS,
  settingsPatchSchema,
  settingsSchema,
  upgradeSettings,
} from '../src/shared/settings.ts';
import { ACCENTS, accentReadout, companionAccent } from '../src/renderer/src/appearance/AccentPicker.tsx';
import { contrast, fromHsl, rotateHue, toHsl } from '../src/renderer/src/appearance/color.ts';
import { resolveDesign } from '../src/renderer/src/appearance/engine.ts';
import { fitWithin } from '../src/renderer/src/appearance/photo.ts';
import {
  addSharedTheme,
  parseThemeCode,
  THEME_CODE_PREFIX,
  themeCode,
} from '../src/renderer/src/appearance/share.ts';
import { THEMES } from '../src/renderer/src/appearance/themes.ts';
import {
  channelKey,
  colorsOf,
  dmKey,
  patternSvg,
  READABLE,
  readableBehindText,
  wallpaperFor,
  wallpaperLayers,
  withChatWallpaper,
  worstContrast,
} from '../src/renderer/src/appearance/wallpaper.ts';

const PHOTO = `data:image/jpeg;base64,${'A'.repeat(400)}`;
const OTHER_PHOTO = `data:image/jpeg;base64,${'B'.repeat(400)}`;
const design = (theme: string, prefs: Partial<DesignSettings['prefs']> = {}): DesignSettings => ({
  ...DEFAULT_DESIGN,
  theme,
  prefs: { ...DEFAULT_DESIGN_PREFS, ...prefs },
});
const colorsFor = (theme: string) => {
  const r = resolveDesign(design(theme));
  return colorsOf(r.vars, r.mode);
};

describe('looks settings (2.18)', () => {
  it('older settings gain no wallpaper, rounded bubbles, no chat wallpapers and Calm mode off', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, Record<string, unknown>>;
    const prefs = old.design!.prefs as Record<string, unknown>;
    delete prefs.wallpaper;
    delete prefs.bubbles;
    delete old.design!.chatWallpapers;
    delete old.appearance!.calm;
    const s = settingsSchema.parse(upgradeSettings(old));
    expect(s.design.prefs.wallpaper).toEqual(DEFAULT_WALLPAPER);
    expect(s.design.prefs.wallpaper.kind).toBe('none');
    expect(s.design.prefs.bubbles).toBe('rounded');
    expect(s.design.chatWallpapers).toEqual({});
    expect(s.appearance.calm).toBe(false);
  });

  it('accepts Calm mode and chat wallpapers in a patch, and refuses bad ones', () => {
    expect(settingsPatchSchema.safeParse({ appearance: { calm: true } }).success).toBe(true);
    const ok = {
      ...DEFAULT_DESIGN,
      chatWallpapers: { [dmKey('peer-1')]: { kind: 'pattern', pattern: 'space' } },
    };
    expect(designSettingsSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { 'not a chat': { kind: 'gradient' } },
      { [channelKey('c1')]: { kind: 'video' } },
      { [channelKey('c1')]: { kind: 'solid', color: 'red' } },
      { [channelKey('c1')]: { kind: 'photo', photo: 'https://example.com/a.jpg' } },
      { [channelKey('c1')]: { kind: 'photo', blur: 99 } },
    ])
      expect(designSettingsSchema.safeParse({ ...DEFAULT_DESIGN, chatWallpapers: bad }).success).toBe(false);
  });

  it('keeps each wallpaper photo once, wherever it is used', () => {
    const d: DesignSettings = {
      ...design('specter-specter', { wallpaper: { ...DEFAULT_WALLPAPER, kind: 'photo', photo: PHOTO } }),
      chatWallpapers: {
        [dmKey('a')]: { ...DEFAULT_WALLPAPER, kind: 'photo', photo: PHOTO },
        [dmKey('b')]: { ...DEFAULT_WALLPAPER, kind: 'photo', photo: OTHER_PHOTO },
        [channelKey('c')]: { ...DEFAULT_WALLPAPER, kind: 'pattern' },
      },
    };
    const out = compactDesignImages(d);
    expect(Object.keys(out.images)).toHaveLength(2);
    expect(out.prefs.wallpaper.photo).toMatch(/^image:/);
    expect(out.chatWallpapers[dmKey('a')]!.photo).toBe(out.prefs.wallpaper.photo);
    expect(out.chatWallpapers[dmKey('b')]!.photo).not.toBe(out.prefs.wallpaper.photo);
    expect(out.chatWallpapers[channelKey('c')]!.photo).toBeNull();
    // A chat that stops using a photo lets it go.
    const later = compactDesignImages({
      ...out,
      chatWallpapers: { ...out.chatWallpapers, [dmKey('b')]: DEFAULT_WALLPAPER },
    });
    expect(Object.keys(later.images)).toHaveLength(1);
    expect(designSettingsSchema.safeParse(later).success).toBe(true);
  });
});

describe('chat wallpapers', () => {
  const every = (): Wallpaper[] => [
    ...WALLPAPER_PATTERNS.flatMap((pattern) =>
      WALLPAPER_GRADIENTS.slice(0, 4).map((gradient) => ({
        ...DEFAULT_WALLPAPER,
        kind: 'pattern' as const,
        pattern,
        gradient,
        strength: 1,
      })),
    ),
    ...WALLPAPER_GRADIENTS.map((gradient) => ({ ...DEFAULT_WALLPAPER, kind: 'gradient' as const, gradient })),
    ...['#000000', '#ffffff', '#808080', '#ff0000', '#00ffcc'].map((color) => ({
      ...DEFAULT_WALLPAPER,
      kind: 'solid' as const,
      color,
    })),
    { ...DEFAULT_WALLPAPER, kind: 'pattern', pattern: 'hearts', color: '#ffffff', strength: 1 },
    { ...DEFAULT_WALLPAPER, kind: 'pattern', pattern: 'space', color: '#000000', strength: 1 },
  ];

  it('keeps every text colour readable (WCAG AA) on every wallpaper in every theme, light and dark', () => {
    let measured = 0;
    for (const theme of THEMES) {
      const c = colorsFor(theme.id);
      // The theme's own conversation colour is the floor: a wallpaper is never worse than it.
      const floor = Math.min(READABLE, worstContrast(c.base, c));
      for (const w of every()) {
        const layers = wallpaperLayers(w, c);
        expect(layers.samples.length).toBeGreaterThan(0);
        for (const sample of layers.samples) {
          const worst = worstContrast(sample, c);
          if (worst < floor - 0.05)
            throw new Error(`${theme.id} ${w.kind}/${w.pattern}/${w.gradient}: ${worst.toFixed(2)}:1`);
          measured++;
        }
      }
    }
    expect(measured).toBeGreaterThan(10_000);
    expect(THEMES.some((t) => t.mode === 'light') && THEMES.some((t) => t.mode === 'dark')).toBe(true);
  });

  it('draws gradients and doodles in the theme’s own light or dark colours', () => {
    const light = colorsFor('corporate-professional-light');
    const dark = colorsFor('specter-specter');
    expect(light.mode).toBe('light');
    expect(dark.mode).toBe('dark');
    const w: Wallpaper = { ...DEFAULT_WALLPAPER, kind: 'gradient', gradient: 'lagoon' };
    expect(wallpaperLayers(w, light).background).not.toBe(wallpaperLayers(w, dark).background);
    const doodles = wallpaperLayers({ ...w, kind: 'pattern' }, dark);
    expect(doodles.background).toContain('data:image/svg+xml');
    expect(doodles.background).toContain(encodeURIComponent(dark.accent));
  });

  it('shows the doodles clearly enough to be seen in most themes', () => {
    let visible = 0;
    for (const theme of THEMES) {
      const bg = wallpaperLayers({ ...DEFAULT_WALLPAPER, kind: 'pattern' }, colorsFor(theme.id)).background;
      const opacity = Number(
        /stroke-opacity%3D'([\d.]+)'/.exec(bg)?.[1] ??
          /stroke-opacity='([\d.]+)'/.exec(decodeURIComponent(bg))?.[1],
      );
      if (opacity >= 0.06) visible++;
    }
    expect(visible / THEMES.length).toBeGreaterThan(0.9);
  });

  it('shows nothing for none, and a covered photo with backing plates for a photo', () => {
    const c = colorsFor('specter-specter');
    expect(wallpaperLayers(DEFAULT_WALLPAPER, c)).toMatchObject({ kind: 'none', background: 'none' });
    const photo = wallpaperLayers({ ...DEFAULT_WALLPAPER, kind: 'photo', photo: PHOTO, dim: 0 }, c, PHOTO);
    expect(photo.plate).toBe(true);
    expect(photo.background).toContain(PHOTO);
    // Never the bare photo: at least 15% of the conversation colour lies over it.
    expect(photo.background).toMatch(/rgba\(\d+, \d+, \d+, 0\.15\)/);
    // Not loaded (yet): the theme gradient, no plate needed.
    expect(wallpaperLayers({ ...DEFAULT_WALLPAPER, kind: 'photo' }, c).plate).toBe(false);
  });

  it('draws the same seamless doodle tile every time, with no quotes that would break the CSS', () => {
    for (const pattern of WALLPAPER_PATTERNS) {
      const svg = patternSvg(pattern, '#123456', 0.2);
      expect(svg).toBe(patternSvg(pattern, '#123456', 0.2));
      expect(svg).not.toContain('"');
      expect(svg.match(/<path /g)!.length).toBeGreaterThanOrEqual(25);
      expect(svg).toContain("stroke='#123456'");
    }
  });

  it('softens a solid colour that would make text unreadable', () => {
    const c = colorsFor('specter-specter');
    const softened = readableBehindText('#f2f2f2', c);
    expect(softened).not.toBe('#f2f2f2');
    expect(worstContrast(softened, c)).toBeGreaterThanOrEqual(READABLE);
    expect(readableBehindText(c.base, c)).toBe(c.base);
  });

  it('gives a chat its own wallpaper and takes it back', () => {
    const d = design('specter-specter', {
      wallpaper: { ...DEFAULT_WALLPAPER, kind: 'gradient', gradient: 'dusk' },
    });
    const key = channelKey('3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71');
    expect(wallpaperFor(d, key).gradient).toBe('dusk');
    const own = withChatWallpaper(d, key, { ...DEFAULT_WALLPAPER, kind: 'pattern', pattern: 'paws' });
    expect(wallpaperFor(own, key).pattern).toBe('paws');
    expect(wallpaperFor(own, dmKey('someone-else')).gradient).toBe('dusk');
    expect(withChatWallpaper(own, key, null).chatWallpapers).toEqual({});
    expect(withChatWallpaper(d, 'bad key', DEFAULT_WALLPAPER)).toBe(d);
  });

  it('shrinks photos to at most 1600 px and never enlarges them', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 5000, 1600)).toEqual({ width: 320, height: 1600 });
  });
});

describe('accent colours', () => {
  it('keeps text on any accent readable (WCAG AA), in light and dark themes', () => {
    const picks = [...ACCENTS.map(([hex]) => hex), '#ffff00', '#777777', '#00ff00', '#0000ff', '#ff00ff'];
    for (const theme of ['specter-specter', 'corporate-professional-light', 'paper-ivory', 'neon-cyber'])
      for (const accent of picks) {
        const d = design(theme, { colors: { accent } });
        const { ratio } = accentReadout(d);
        expect(ratio, `${theme} ${accent}`).toBeGreaterThanOrEqual(4.5);
        // Your bubbles on a phone: the accent fill with its ink.
        const r = resolveDesign(d);
        expect(contrast(r.vars['--accent-solid-ink']!, r.vars['--accent']!)).toBeGreaterThanOrEqual(4.5);
      }
  });

  it('gives a chosen accent a matching second accent, unless you chose your own', () => {
    const blue = '#3390ec';
    expect(companionAccent(blue, {})).toBe(rotateHue(blue, 38));
    expect(companionAccent('#e5484d', { accent: blue, accent2: rotateHue(blue, 38) })).toBe(
      rotateHue('#e5484d', 38),
    );
    expect(companionAccent('#e5484d', { accent: blue, accent2: '#123456' })).toBe('#123456');
  });

  it('turns hues without changing the colour otherwise', () => {
    for (const hex of ['#3390ec', '#e5484d', '#12b5a5', '#777777']) {
      const [h, s, l] = toHsl(hex);
      expect(fromHsl(h, s, l)).toBe(hex);
      expect(rotateHue(rotateHue(hex, 120), 240)).toBe(hex);
    }
  });
});

describe('theme codes', () => {
  const mine = (): DesignSettings =>
    design('paper-ivory', { colors: { accent: '#e05297', base: '#fffaf0' } });

  it('round-trips a theme as a short code, names in any language included', () => {
    const code = themeCode(mine(), 'Розова хартия 🌸');
    expect(code.startsWith(THEME_CODE_PREFIX)).toBe(true);
    expect(code.length).toBeLessThan(400);
    expect(code).toMatch(/^river-theme:[A-Za-z0-9_-]+$/);
    const parsed = parseThemeCode(`Try my theme! ${code} — enjoy`);
    expect(parsed).toEqual({
      ok: true,
      theme: {
        kind: 'river-theme',
        v: 1,
        name: 'Розова хартия 🌸',
        base: 'paper-ivory',
        colors: { accent: '#e05297', base: '#fffaf0' },
      },
    });
  });

  it('includes the colours of your own theme it is based on', () => {
    const d: DesignSettings = {
      ...mine(),
      theme: 'custom-x',
      customThemes: [
        { id: 'custom-x', name: 'X', base: 'neon-cyber', colors: { text: '#eeeeee' }, createdAt: '' },
      ],
    };
    const parsed = parseThemeCode(themeCode(d, 'X'));
    expect(parsed.ok && parsed.theme.base).toBe('neon-cyber');
    expect(parsed.ok && parsed.theme.colors).toEqual({ text: '#eeeeee', accent: '#e05297', base: '#fffaf0' });
  });

  it('refuses anything that is not exactly a theme: code, extra keys, bad colours, unknown themes', () => {
    const encode = (value: unknown): string =>
      THEME_CODE_PREFIX +
      btoa(unescape(encodeURIComponent(JSON.stringify(value))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    const good = { kind: 'river-theme', v: 1, name: 'Ok', base: 'paper-ivory', colors: {} };
    expect(parseThemeCode(encode(good)).ok).toBe(true);
    for (const bad of [
      'hello',
      `${THEME_CODE_PREFIX}`,
      `${THEME_CODE_PREFIX}!!!!`,
      `${THEME_CODE_PREFIX}${'A'.repeat(3000)}`,
      encode({ ...good, css: 'body{display:none}' }),
      encode({ ...good, colors: { accent: 'url(javascript:alert(1))' } }),
      encode({ ...good, colors: { accent: 'red' } }),
      encode({ ...good, colors: { script: '#000000' } }),
      encode({ ...good, base: 'not-a-theme' }),
      encode({ ...good, v: 2 }),
      encode({ ...good, name: '' }),
      encode([good]),
    ])
      expect(parseThemeCode(bad).ok, bad.slice(0, 60)).toBe(false);
  });

  it('adds a pasted theme once and switches to it', () => {
    const parsed = parseThemeCode(themeCode(mine(), 'Pink paper'));
    if (!parsed.ok) throw new Error(parsed.error);
    const first = addSharedTheme(DEFAULT_DESIGN, parsed.theme, 'custom-a', 'now');
    expect(first.design.theme).toBe('custom-a');
    expect(first.design.skin).toBe('paper');
    expect(first.design.customThemes).toHaveLength(1);
    expect(designSettingsSchema.safeParse(first.design).success).toBe(true);
    const again = addSharedTheme(first.design, parsed.theme, 'custom-b', 'later');
    expect(again.design.customThemes).toHaveLength(1);
    expect(again.theme.id).toBe('custom-a');
  });
});

describe('engine', () => {
  it('puts the bubble shape on <html>', () => {
    expect(resolveDesign(design('specter-specter')).attrs.bubbles).toBe('rounded');
    expect(resolveDesign(design('specter-specter', { bubbles: 'outlined' })).attrs.bubbles).toBe('outlined');
  });
});
