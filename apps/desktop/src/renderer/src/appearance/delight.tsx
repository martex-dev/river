import { useEffect, type CSSProperties, type ReactElement } from 'react';
import { create } from 'zustand';

/**
 * Little moments of delight (2.18): reactions burst out of their chip, a double-tapped message
 * gets a big heart, like Instagram. Purely visual, never in the way (no pointer events, hidden
 * from screen readers), and nothing at all with reduced motion or Calm mode.
 */

/** No decorative motion: the system or River asked for reduced motion, or Calm mode is on. */
export function quiet(root: { dataset: DOMStringMap } = document.documentElement): boolean {
  return root.dataset.motion === 'reduced' || root.dataset.calm === 'on';
}

interface Particle {
  dx: number;
  dy: number;
  r: number;
  s: number;
  d: number;
}

export interface Burst {
  id: number;
  x: number;
  y: number;
  emoji: string;
  big: boolean;
  particles: Particle[];
}

const useBursts = create<{ bursts: Burst[] }>(() => ({ bursts: [] }));
let next = 0;
const BURST_MS = 1100;

/** Where the pieces of a burst fly: a ring around the start, a little upwards, deterministic in tests. */
export function burstParticles(count: number, big: boolean, random: () => number = Math.random): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const dist = (big ? 70 : 34) + random() * (big ? 60 : 26);
    return {
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist - (big ? 40 : 18)),
      r: Math.round((random() - 0.5) * 80),
      s: Math.round((0.55 + random() * 0.6) * 100) / 100,
      d: Math.round(random() * 90),
    };
  });
}

/** A burst of `emoji` at a point on the screen (`big`: the double-tap heart). */
export function burst(emoji: string, x: number, y: number, big = false): void {
  if (quiet()) return;
  const id = ++next;
  const particles = burstParticles(big ? 12 : 7, big);
  useBursts.setState((s) => ({ bursts: [...s.bursts.slice(-5), { id, x, y, emoji, big, particles }] }));
  window.setTimeout(
    () => useBursts.setState((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })),
    BURST_MS + 200,
  );
}

/** The emoji a reaction chip shows (its glyph's text or picture's alt text). */
function chipEmoji(chip: Element): string {
  const glyph = chip.querySelector('.reaction__emoji');
  const img = glyph?.querySelector('img');
  return (img?.getAttribute('alt') || glyph?.textContent || '').trim().slice(0, 16);
}

/**
 * Bursts from a reaction chip as you add your reaction (a chip of yours being taken back stays
 * still). Listens on the whole page, so every list of messages gets it.
 */
export function installReactionBursts(doc: Document = document): () => void {
  const onClick = (e: MouseEvent): void => {
    const chip = (e.target as Element | null)?.closest?.('.msg .reaction');
    if (!chip || chip.classList.contains('reaction--add') || chip.classList.contains('is-mine')) return;
    const emoji = chipEmoji(chip);
    if (!emoji) return;
    const r = chip.getBoundingClientRect();
    burst(emoji, r.left + Math.min(16, r.width / 2), r.top + r.height / 2);
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}

/** Mounted once at the app root (with the celebrations). */
export function Bursts(): ReactElement | null {
  const bursts = useBursts((s) => s.bursts);
  useEffect(() => installReactionBursts(), []);
  if (bursts.length === 0) return null;
  return (
    <div className="bursts" aria-hidden="true">
      {bursts.map((b) => (
        <div
          key={b.id}
          className={`burst-fx ${b.big ? 'burst-fx--big' : ''}`}
          style={{ left: b.x, top: b.y } as CSSProperties}
        >
          {b.big && <span className="burst-fx__hero">{b.emoji}</span>}
          {b.particles.map((p, i) => (
            <span
              key={i}
              className="burst-fx__piece"
              style={
                {
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                  '--r': `${p.r}deg`,
                  '--s': String(p.s),
                  '--d': `${p.d}ms`,
                } as CSSProperties
              }
            >
              {b.emoji}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
