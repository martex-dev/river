import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN,
  DEFAULT_DESIGN_PREFS,
  designExportSchema,
  designSettingsSchema,
  type DesignSettings,
} from '../src/shared/design.ts';
import { DEFAULT_SETTINGS, settingsSchema, upgradeSettings } from '../src/shared/settings.ts';
import { contrast, ensureContrast } from '../src/renderer/src/appearance/color.ts';
import { catalog, resolveDesign } from '../src/renderer/src/appearance/engine.ts';
import { SKINS } from '../src/renderer/src/appearance/skins.ts';
import { THEMES, themesOf } from '../src/renderer/src/appearance/themes.ts';

const withTheme = (theme: string, prefs: Partial<DesignSettings['prefs']> = {}): DesignSettings => ({
  ...DEFAULT_DESIGN,
  theme,
  prefs: { ...DEFAULT_DESIGN_PREFS, ...prefs },
});

describe('skin and theme catalog', () => {
  it('has many skins, each with at least five themes, and unique ids', () => {
    expect(SKINS.length).toBeGreaterThanOrEqual(12);
    for (const skin of SKINS) expect(themesOf(skin.id).length).toBeGreaterThanOrEqual(5);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(THEMES.every((t) => SKINS.some((s) => s.id === t.skin))).toBe(true);
    expect(THEMES.length).toBeGreaterThanOrEqual(80);
  });

  it('includes both expressive and professional skins, and light and dark themes', () => {
    expect(SKINS.some((s) => s.direction === 'expressive')).toBe(true);
    expect(SKINS.some((s) => s.direction === 'professional')).toBe(true);
    expect(THEMES.filter((t) => t.mode === 'light').length).toBeGreaterThan(15);
  });

  it('has no River skin any more; Specter is only the look before a skin is chosen', () => {
    expect(SKINS.some((s) => s.id === 'river')).toBe(false);
    const r = resolveDesign(DEFAULT_DESIGN);
    expect(r.theme.id).toBe('specter-specter');
    expect(DEFAULT_DESIGN.chosen).toBe(false);
  });

  it('carries every Specter skin with six palettes each', () => {
    for (const id of [
      'specter',
      'neon',
      'aurora',
      'terminal',
      'paper',
      'synthwave',
      'blueprint',
      'brutal',
      'retro',
      'holo',
      'glitch',
    ])
      expect(themesOf(id)).toHaveLength(6);
  });
});

describe('every theme stays readable', () => {
  for (const theme of THEMES) {
    it(theme.id, () => {
      const r = resolveDesign(withTheme(theme.id));
      const base = r.vars['--layer-2']!;
      expect(contrast(r.vars['--text']!, base)).toBeGreaterThanOrEqual(7);
      // Secondary text, accents and status colours read on every surface they appear on.
      for (const surface of ['--layer-0', '--layer-1', '--layer-2', '--layer-3'])
        for (const fg of [
          '--text-dim',
          '--text-faint',
          '--accent-text',
          '--accent-2-text',
          '--ok',
          '--warn',
          '--danger',
          '--info',
        ])
          expect(contrast(r.vars[fg]!, r.vars[surface]!), `${fg} on ${surface}`).toBeGreaterThanOrEqual(4.45);
      expect(contrast(r.vars['--accent-solid-ink']!, r.vars['--accent']!)).toBeGreaterThanOrEqual(4.5);
      for (const k of ['--ok', '--warn', '--danger', '--info'])
        expect(contrast(r.vars[k]!, base)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('personalisation can never make River unreadable', () => {
  it('survives extreme settings and hostile colour choices', () => {
    for (const theme of ['specter-specter', 'paper-ivory', 'terminal-amber']) {
      const r = resolveDesign(
        withTheme(theme, {
          contrast: 0.8,
          saturation: 0,
          surfaceDepth: 2,
          borders: 0,
          colors: { text: '#777777', base: '#777777', accent: '#777777', muted: '#777777' },
        }),
      );
      const base = r.vars['--layer-2']!;
      expect(contrast(r.vars['--text']!, base)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(r.vars['--text-faint']!, base)).toBeGreaterThanOrEqual(3.5);
      expect(contrast(r.vars['--accent-text']!, base)).toBeGreaterThanOrEqual(3);
    }
  });

  it('unknown or missing themes fall back to the default instead of breaking', () => {
    const r = resolveDesign({ ...DEFAULT_DESIGN, theme: 'no-such-theme' });
    expect(r.theme.id).toBe('specter-specter');
  });

  it('light/dark preference switches to a sibling theme of the same skin', () => {
    expect(resolveDesign(withTheme('blueprint-cyanotype', { mode: 'light' })).theme.mode).toBe('light');
    expect(resolveDesign(withTheme('paper-ivory', { mode: 'dark' })).theme.skin).toBe('paper');
    const sys = resolveDesign(withTheme('blueprint-cyanotype', { mode: 'system' }), {
      systemDark: false,
      highContrast: false,
    });
    expect(sys.theme.mode).toBe('light');
  });

  it('custom themes use their own colours on top of their base', () => {
    const design: DesignSettings = {
      ...DEFAULT_DESIGN,
      theme: 'custom-a',
      customThemes: [
        {
          id: 'custom-a',
          name: 'Mine',
          base: 'neon-havoc',
          colors: { accent: '#00ff00' },
          createdAt: 'x',
        },
      ],
    };
    const r = resolveDesign(design);
    expect(r.skin.id).toBe('neon');
    expect(r.vars['--accent']).toBe('#00ff00');
    expect(catalog(design.customThemes)[0]).toMatchObject({ id: 'custom-a', custom: true });
  });

  it('ensureContrast reaches the target or the extreme', () => {
    expect(contrast(ensureContrast('#333333', '#000000', 4.5), '#000000')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ensureContrast('#eeeeee', '#ffffff', 4.5), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('design settings are data only', () => {
  it('rejects CSS or code smuggled into colours, ids and pictures', () => {
    const bad = (patch: Record<string, unknown>): boolean =>
      designSettingsSchema.safeParse({ ...DEFAULT_DESIGN, ...patch }).success;
    expect(bad({ theme: 'x; background:url(evil)' })).toBe(false);
    expect(bad({ prefs: { ...DEFAULT_DESIGN_PREFS, colors: { accent: 'red;}body{display:none' } } })).toBe(
      false,
    );
    expect(bad({ prefs: { ...DEFAULT_DESIGN_PREFS, backgroundImage: 'javascript:alert(1)' } })).toBe(false);
    expect(
      bad({ prefs: { ...DEFAULT_DESIGN_PREFS, backgroundImage: 'data:image/svg+xml;base64,PHN2Zz4=' } }),
    ).toBe(false);
    expect(bad({ prefs: { ...DEFAULT_DESIGN_PREFS, radius: 99 } })).toBe(false);
    expect(
      bad({ prefs: { ...DEFAULT_DESIGN_PREFS, backgroundImage: 'data:image/png;base64,iVBORw0KGgo=' } }),
    ).toBe(true);
  });

  it('accepts an export and refuses anything else', () => {
    const ok = {
      kind: 'river-appearance',
      version: 1,
      skin: 'river',
      theme: 'specter-specter',
      prefs: DEFAULT_DESIGN_PREFS,
    };
    expect(designExportSchema.safeParse(ok).success).toBe(true);
    expect(designExportSchema.safeParse({ ...ok, kind: 'other' }).success).toBe(false);
    expect(
      designExportSchema.safeParse({ ...ok, prefs: { ...DEFAULT_DESIGN_PREFS, glow: 'url(x)' } }).success,
    ).toBe(false);
  });

  it('settings from before skins get the default design, and missing new options get defaults', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>;
    delete old.design;
    const upgraded = settingsSchema.parse(upgradeSettings(old));
    expect(upgraded.design.theme).toBe('specter-specter');
    // Everyone (old settings included) is asked to choose a skin.
    expect(upgraded.design.chosen).toBe(false);
    const partial = {
      ...structuredClone(DEFAULT_SETTINGS),
      design: { ...DEFAULT_DESIGN, prefs: { glow: 1.5 } },
    };
    const parsed = settingsSchema.parse(upgradeSettings(partial));
    expect(parsed.design.prefs.glow).toBe(1.5);
    expect(parsed.design.prefs.messageStyle).toBe('skin');
  });
});
