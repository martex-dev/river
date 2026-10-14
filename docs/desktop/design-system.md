# River design system — skins, themes and personalisation (1.0.45)

River's look is data. A **skin** is a design language; a **theme** is a palette
inside a skin; **personalisation** adjusts either. The theme engine turns the
three into CSS custom properties and `data-*` attributes on `<html>`, and every
component reads only those. Nothing about a theme is hard-coded in components.

```
skins.ts (structure) ─┐
themes.ts (palettes) ─┼─▶ engine.ts resolveDesign() ─▶ <html style="--token…" data-skin data-msg …>
settings.design ──────┘                                  ▲
 (skin, theme, prefs,                     styles/*.css read tokens; skins.css reads data-* attributes
  custom themes, profiles)
```

## Files

| File                                                                   | What it holds                                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/shared/design.ts`                                                 | The saved design settings (zod): ids, bounded numbers, hex colours. Data only — no CSS.      |
| `src/renderer/src/appearance/skins.ts`                                 | The 14 skins: fonts, geometry, materials, pattern, backdrop, message layout, decor hook      |
| `src/renderer/src/appearance/themes.ts`                                | The 107 themes, one line each: 4 surfaces, text, 2 accents, light/dark, description          |
| `src/renderer/src/appearance/engine.ts`                                | `resolveDesign()`: derives every token, guarantees contrast, builds backgrounds and patterns |
| `src/renderer/src/appearance/use-design.ts`                            | Applies the design live; caches it so startup never flashes the fallback look                |
| `src/renderer/src/appearance/editor.ts`                                | Changing the design: live preview, delayed save, try-on (Apply/Cancel)                       |
| `src/renderer/src/appearance/AppearanceCenter.tsx`, `ThemeBrowser.tsx` | Settings → Appearance                                                                        |
| `src/renderer/src/styles/tokens.css`                                   | Fallback values of every token (before the engine runs)                                      |
| `src/renderer/src/styles/skins.css`                                    | Structure from attributes: message layouts, avatars, buttons, tabs, layout, skin decorations |
| `src/renderer/src/styles/design.css`                                   | The appearance centre and theme previews                                                     |

## Tokens (what components may use)

Surfaces: `--layer-0` (frame/rail) → `--layer-1` (sidebars) → `--layer-2`
(conversation) → `--layer-3` (cards, inputs); `--layer-user`, `--layer-hover`,
`--layer-active`; legacy aliases `--bg-0..2`, `--surface*`.
Text: `--text`, `--text-dim`, `--text-faint`. Accents: `--accent`, `--accent-2`,
`--accent-3`, `--accent-grad`, `--accent-ink` (text on the gradient),
`--accent-solid-ink` (text on `--accent`), `--accent-glow`. States: `--ok`,
`--warn`, `--danger`, `--info`, `--focus`, `--selection`. Lines: `--border`,
`--border-strong`, `--border-w`. Channels for alpha: `rgb(var(--accent-rgb) / .2)`
(also `--accent-2-rgb`, `--fg-rgb`, `--shade-rgb`, `--line-rgb`, `--ok-rgb`,
`--warn-rgb`, `--danger-rgb`). Shape: `--radius-s/m/l`, `--radius-control`,
`--radius-button`. Depth: `--shadow-1`, `--shadow-pop`, `--blur`, `--glass`.
Type: `--font-ui`, `--font-display`, `--font-mono`, `--heading-font`,
`--heading-transform`, `--heading-tracking`, `--text-weight`, `--line-height`.
Layout: `--space`, `--rail-w`, `--rail-icon`, `--sidebar-w`, `--member-w`,
`--icon-size`, `--icon-stroke`. Motion: `--dur-fast`, `--dur`, `--dur-slow`.
Atmosphere: `--backdrop`, `--pattern`.

**Never write a colour literal in a component stylesheet.** Use a token, or a
channel with alpha. Shadows may use plain black.

## Attributes (structure)

`data-skin`, `data-decor`, `data-mode` (light/dark), `data-msg`
(flat/bubbles/cards/terminal/compact), `data-own`, `data-avatar`,
`data-buttons`, `data-tabs`, `data-scrollbars`, `data-badges`, `data-nav`,
`data-members`, `data-chat`, `data-titlebar`, `data-focusmode`, `data-glass`,
`data-glowing`, `data-hover`, `data-ambient`, `data-tabular`, `data-pattern`,
`data-backdrop`.

## Add a theme

Add one line to the skin's family in `themes.ts`:

```ts
['harbour', 'Harbour', 'dark', '#06090d #0b1118 #101822 #17212e #e3ecf5 #4cc9f0 #f72585', 'Night lights on the water.'],
```

Colours are: frame, sidebars, conversation, raised, text, accent, second
accent. The engine derives hover, borders, secondary text, gradients and
readable ink, and pushes any colour that would be unreadable until it passes
WCAG AA. `test/design-engine.test.ts` checks every theme automatically.

## Add a skin

1. Add a `Skin` to `SKINS` in `skins.ts` (fonts from `FONT_STACKS`, geometry,
   materials, pattern, backdrop, message layout, `decor`).
2. Add its themes (at least five) to `themes.ts`.
3. Optional: decorations CSS can't express as tokens go in `skins.css` under
   `[data-decor='your-decor']`. Keep them structural (shapes, rules, prefixes),
   never colours.
4. A new font: install the `@fontsource` package, import it in `main.tsx`, add
   it to `FONT_STACKS` and the font enums in `design.ts`. (River's security
   policy allows no web fonts.)

## Add a personalisation option

1. Add the field to `designPrefsSchema` in `design.ts` with bounds and a
   default (old settings get the default automatically).
2. Use it in `resolveDesign()` — as a token or an attribute.
3. Read the token/attribute in CSS.
4. Add the control to `AppearanceCenter.tsx` in the right section. Every
   control must change something real; no placeholders.

## Safety

- Settings, imports and custom themes are validated data: hex colours, ids
  `[a-z0-9-]`, bounded numbers, PNG/JPEG/WebP data URLs only. Nothing is ever
  inserted as CSS or executed. Unknown themes fall back to the default.
- Text is kept readable whatever the person picks (see the tests).
- Reduced motion turns off every non-essential animation, whatever the skin.

## Known limits

- Per-community or per-activity appearance (contextual themes) is not built.
- Icon families are not swappable (stroke and size are).
- Glass and blur cost GPU; they are opt-in per skin and adjustable to 0.
