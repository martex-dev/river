import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, DEFAULT_DESIGN_PREFS } from '../src/shared/design.ts';
import { contrast, mix } from '../src/renderer/src/appearance/color.ts';
import { resolveDesign } from '../src/renderer/src/appearance/engine.ts';
import { THEMES } from '../src/renderer/src/appearance/themes.ts';
import { ROLE_COLORS } from '../src/renderer/src/community/role-colors.ts';

/**
 * Communities in light themes (community sweep): mentions and status texts used fixed colours made
 * for dark themes (a pale lilac #c9cdff, #ffd27a, #ff6b6e), which nearly vanished on light ones.
 */
const css = readFileSync(join(__dirname, '../src/renderer/src/styles/community.css'), 'utf8');
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};
const surfaces = ['--layer-1', '--layer-2', '--layer-3'];
const resolved = THEMES.map((t) =>
  resolveDesign({ ...DEFAULT_DESIGN, theme: t.id, prefs: { ...DEFAULT_DESIGN_PREFS } }),
);

describe('mentions in every theme', () => {
  it('use the theme’s colours, not fixed dark-theme ones', () => {
    expect(css).not.toMatch(/#c9cdff|#ffd27a/i);
    expect(rule('.mention')).toContain('color: color-mix(in srgb, var(--accent-2-text) 60%, var(--text));');
    expect(rule('.mention')).toContain('background: rgb(var(--accent-2-rgb) / 0.16);');
    expect(rule('.mention--me')).toContain('color: var(--text);');
    expect(rule('.mention--role')).toContain(
      'color: color-mix(in srgb, var(--role, var(--accent-2-text)) 30%, var(--text));',
    );
    expect(rule('.mention-menu__label--role')).toContain('color-mix(in srgb, var(--role) 30%, var(--text))');
    expect(rule('.mention-menu__dot')).toContain('color: var(--text);');
    expect(rule('.mention--channel:hover')).toContain('color: var(--text);');
  });

  it('keep @names, #channels and @you above 4.5:1 on light and dark themes', () => {
    expect(resolved.some((r) => r.mode === 'light')).toBe(true);
    for (const r of resolved) {
      const v = r.vars;
      for (const layer of surfaces) {
        const name = mix(v['--accent-2-text']!, v['--text']!, 0.4);
        const on = (bg: string, alpha: number): number => contrast(name, mix(v[layer]!, bg, alpha));
        expect(on(v['--accent-2']!, 0.16), `${r.theme.id} ${layer}`).toBeGreaterThanOrEqual(4.5);
        // A #channel while hovered: the theme's text on a stronger tint (0.22).
        const hovered = mix(v[layer]!, v['--accent-2']!, 0.22);
        expect(contrast(v['--text']!, hovered), `${r.theme.id} ${layer} hover`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v['--text']!, mix(v[layer]!, v['--warn']!, 0.22))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keep role mentions readable whatever the role colour', () => {
    const colours = [...ROLE_COLORS.map((c) => `#${c.toString(16).padStart(6, '0')}`), '#000000', '#ffffff'];
    for (const r of resolved)
      for (const layer of surfaces)
        for (const role of colours) {
          const text = mix(role, r.vars['--text']!, 0.7);
          expect(
            contrast(text, mix(r.vars[layer]!, role, 0.22)),
            `${r.theme.id} ${role}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
  });
});

describe('status texts in communities', () => {
  it('use the theme’s readable status colours', () => {
    for (const [selector, token] of [
      ['.menu-item--danger', 'var(--danger)'],
      ['.btn--danger-text', 'var(--danger)'],
      ['.settings-tab--danger', 'var(--danger)'],
      ['.msg__action--danger:hover', 'var(--danger)'],
      ['.icon-btn--danger:hover:not(:disabled)', 'var(--danger)'],
      ['.channel__limit.is-full', 'var(--danger)'],
      ['.channel__nsfw', 'var(--danger)'],
      ['.call-note.is-missed', 'var(--danger)'],
      ['.report__status--open', 'var(--warn)'],
      ['.report__status--resolved', 'var(--ok)'],
      ['.msg__filter-chip', 'var(--warn)'],
      ['.member__crown', 'var(--warn)'],
      ['.file-card__text strong', 'var(--accent-text)'],
    ] as const)
      expect(rule(selector), selector).toContain(`color: ${token};`);
  });
});
