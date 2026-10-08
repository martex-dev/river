# River design language

River's look is original: dark, calm, precise — a private network at night.
It borrows no layout, iconography or branding from other products.

## Principles

1. **Quiet confidence.** Dark surfaces, one luminous accent gradient (teal → blue → violet), lots of space.
2. **Honest signals.** Status colours mean exactly one thing each:
   green = active protection, outlined blue = planned, amber = needs attention,
   red = danger, grey = inactive/not applicable.
3. **Glass, sparingly.** Translucent panels (`.glass`) over a soft gradient
   backdrop; never glass on glass on glass.
4. **Motion with purpose.** Short (140–480 ms) ease-out / spring transitions;
   every animation is disabled by reduced motion (OS setting or
   Settings → Appearance).
5. **Technical where it helps.** Fingerprints, key IDs and versions use the
   monospace face and are grouped in 4s for reading aloud.

## Tokens

Defined in `apps/desktop/src/renderer/src/styles/tokens.css`:
backgrounds `--bg-0..2`, surfaces `--surface*`, borders `--border*`, text
`--text`, `--text-dim`, `--text-faint`, accent `--accent`, `--accent-2`,
`--accent-grad`, status `--ok`, `--warn`, `--danger`, `--planned`, `--inactive`,
radii `--radius-s/m/l`, motion `--ease-out`, `--ease-spring`, `--dur-*`.

Typography: Inter (UI) and JetBrains Mono (technical), both bundled locally
(SIL OFL) — River never loads fonts from the network.

## Mark

Three currents converging into one stream (`components/RiverMark.tsx`,
`apps/desktop/build/icon.svg`). Original artwork, AGPL-3.0 with the code.

## Components

Navigation rail · glass cards · status board (Security Center) · choice cards ·
toggles · toasts · network field (ambient canvas; static under reduced motion).
