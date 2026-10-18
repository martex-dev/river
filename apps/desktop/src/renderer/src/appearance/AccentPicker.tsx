import type { ReactElement } from 'react';
import type { DesignSettings } from '../../../shared/design.ts';
import { contrast, isHex, rotateHue } from './color.ts';
import { setPrefs } from './editor.ts';
import { resolveDesign } from './engine.ts';

/** Quick accents, like Telegram's: one tap recolours buttons, your bubbles, links and highlights. */
export const ACCENTS: ReadonlyArray<readonly [string, string]> = [
  ['#3390ec', 'Blue'],
  ['#5865f2', 'Blurple'],
  ['#8e5cf7', 'Violet'],
  ['#e05297', 'Pink'],
  ['#e5484d', 'Red'],
  ['#f2762e', 'Orange'],
  ['#e8b100', 'Gold'],
  ['#3fb950', 'Green'],
  ['#12b5a5', 'Teal'],
  ['#22a7d8', 'Sky'],
  ['#6b7280', 'Graphite'],
  ['#c2a27a', 'Sand'],
];

/** The second accent that goes with a chosen one (kept if the person picked their own). */
export function companionAccent(accent: string, colors: { accent?: string; accent2?: string }): string {
  if (!colors.accent2) return rotateHue(accent, 38);
  if (colors.accent && colors.accent2 === rotateHue(colors.accent, 38)) return rotateHue(accent, 38);
  return colors.accent2;
}

/** The contrast of text on the accent as River draws it (River nudges the fill until it reads). */
export function accentReadout(design: DesignSettings): { fill: string; ink: string; ratio: number } {
  const r = resolveDesign(design);
  const fill = r.vars['--accent']!;
  const ink = r.vars['--accent-solid-ink']!;
  return { fill, ink, ratio: contrast(ink, fill) };
}

export function AccentPicker({ design }: { design: DesignSettings }): ReactElement {
  const colors = design.prefs.colors;
  const pick = (accent: string | null): void => {
    const next = { ...colors };
    if (accent) {
      next.accent2 = companionAccent(accent, colors);
      next.accent = accent;
    } else {
      delete next.accent;
      if (colors.accent && colors.accent2 === rotateHue(colors.accent, 38)) delete next.accent2;
    }
    setPrefs(design, { colors: next });
  };
  const { fill, ink, ratio } = accentReadout(design);
  const chosen = colors.accent?.toLowerCase();
  const custom = !!chosen && !ACCENTS.some(([hex]) => hex === chosen);
  return (
    <div className="accent-picker">
      <div className="accent-picker__row" role="radiogroup" aria-label="Accent colour">
        <button
          role="radio"
          aria-checked={!chosen}
          aria-label="Theme accent"
          title="The theme’s own accent"
          className={`accent-swatch accent-swatch--theme ${!chosen ? 'is-selected' : ''}`}
          onClick={() => pick(null)}
        />
        {ACCENTS.map(([hex, name]) => (
          <button
            key={hex}
            role="radio"
            aria-checked={chosen === hex}
            aria-label={`${name} accent`}
            title={name}
            className={`accent-swatch ${chosen === hex ? 'is-selected' : ''}`}
            style={{ background: hex }}
            onClick={() => pick(hex)}
          />
        ))}
        <label
          className={`accent-swatch accent-swatch--any ${custom ? 'is-selected' : ''}`}
          title="Any colour"
          style={custom ? { background: chosen } : undefined}
        >
          <input
            type="color"
            aria-label="Any accent colour"
            value={chosen && isHex(chosen) ? chosen : fill}
            onChange={(e) => pick(e.target.value)}
          />
        </label>
      </div>
      <p className="accent-picker__check small">
        <span className="accent-picker__sample" style={{ background: fill, color: ink }}>
          Aa
        </span>
        Text on the accent: {ratio.toFixed(1)}:1 {ratio >= 4.5 ? '— readable (WCAG AA)' : ''}
        {chosen && fill.toLowerCase() !== chosen ? ' · River adjusted the shade so text reads on it.' : ''}
      </p>
    </div>
  );
}
