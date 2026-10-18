import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_DESIGN_PREFS, type DesignSettings } from '../src/shared/design.ts';
import { contrast, mix } from '../src/renderer/src/appearance/color.ts';
import { resolveDesign } from '../src/renderer/src/appearance/engine.ts';
import { THEMES } from '../src/renderer/src/appearance/themes.ts';

/** 2.19: the phone Calls tab's All | Missed shows which one is chosen, in every theme. */
describe("the Calls tab's chosen segment", () => {
  const dark = (theme: string): DesignSettings => ({
    ...DEFAULT_DESIGN,
    theme,
    prefs: { ...DEFAULT_DESIGN_PREFS, mode: 'dark' },
  });

  it('stands out at least 3:1 from its track and the panel in every dark theme', () => {
    const weak: string[] = [];
    for (const theme of THEMES) {
      const r = resolveDesign(dark(theme.id));
      if (r.theme.mode !== 'dark') continue;
      const on = r.vars['--segment-on']!;
      // The track is the text colour at 7% over the panel (phone.css --p-fill).
      const track = mix(r.vars['--layer-1']!, r.vars['--text']!, 0.07);
      if (contrast(on, track) < 3 || contrast(on, r.vars['--layer-1']!) < 3) weak.push(theme.id);
      // Its label reads on it.
      expect(contrast(r.vars['--segment-ink']!, on), theme.id).toBeGreaterThanOrEqual(4.5);
    }
    expect(weak).toEqual([]);
  });

  it('and in light themes too', () => {
    for (const theme of THEMES.filter((t) => t.mode === 'light')) {
      const r = resolveDesign({ ...DEFAULT_DESIGN, theme: theme.id, prefs: { ...DEFAULT_DESIGN_PREFS } });
      const track = mix(r.vars['--layer-1']!, r.vars['--text']!, 0.07);
      expect(contrast(r.vars['--segment-on']!, track), theme.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('is what the phone draws (not the raised grey that vanished in dark themes)', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/phone/phone.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(css).toMatch(/\.psegment__item\.is-active \{[^}]*background: var\(--segment-on\)/);
    expect(css).toMatch(/\.psegment__item\.is-active \{[^}]*color: var\(--segment-ink\)/);
  });
});
