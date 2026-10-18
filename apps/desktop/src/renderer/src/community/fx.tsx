import type { CSSProperties, ReactElement } from 'react';
import { create } from 'zustand';
import { Bursts, quiet } from '../appearance/delight.tsx';
import { haptic } from '../components/gestures.ts';

/**
 * Short celebrations for moments worth marking: joining or creating a
 * community, and making a new friend. Purely visual; skipped entirely when
 * the user prefers reduced motion.
 */
interface Piece {
  x: number;
  y: number;
  r: number;
  d: number;
  c: string;
  w: number;
}
interface Burst {
  id: number;
  text: string;
  pieces: Piece[];
}

const useFx = create<{ bursts: Burst[] }>(() => ({ bursts: [] }));
let next = 0;
const BURST_MS = 2400;
/** Confetti comes as strips, dots and ribbons (2.18). */
const SHAPES = ['', 'burst__piece--dot', 'burst__piece--ribbon'];
const COLORS = ['#4fe3d1', '#7d86ff', '#faa81a', '#ed4245', '#3ee08f', '#f47fff'];

/** The confetti's colours: the theme's two accents (2.18) among River's party colours. */
function confettiColors(): string[] {
  const style = document.documentElement.style;
  const theme = [style.getPropertyValue('--accent'), style.getPropertyValue('--accent-2')]
    .map((c) => c.trim())
    .filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  return [...theme, ...COLORS];
}

export function celebrate(text: string): void {
  // A phone gives a little buzz even when the confetti stays away (Calm mode, reduced motion).
  haptic('success');
  if (quiet()) return;
  const id = ++next;
  const colors = confettiColors();
  const pieces = Array.from({ length: 36 }, (_, i) => ({
    x: Math.round((Math.random() - 0.5) * 900),
    y: Math.round(-120 - Math.random() * 320),
    r: Math.round(Math.random() * 720 - 360),
    d: Math.round(Math.random() * 180),
    c: colors[i % colors.length]!,
    w: 6 + Math.round(Math.random() * 6),
  }));
  useFx.setState((s) => ({ bursts: [...s.bursts.slice(-2), { id, text, pieces }] }));
  window.setTimeout(() => useFx.setState((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })), BURST_MS);
}

export function Celebrations(): ReactElement {
  const bursts = useFx((s) => s.bursts);
  return (
    <>
      <Bursts />
      {bursts.length > 0 && (
        <div className="celebrations" aria-hidden="true">
          {bursts.map((b) => (
            <BurstView key={b.id} burst={b} />
          ))}
        </div>
      )}
    </>
  );
}

function BurstView({ burst }: { burst: Burst }): ReactElement {
  return (
    <div className="burst">
      <div className="burst__text">{burst.text}</div>
      {burst.pieces.map((p, i) => (
        <i
          key={i}
          className={`burst__piece ${SHAPES[i % SHAPES.length]}`}
          style={
            {
              '--x': `${p.x}px`,
              '--y': `${p.y}px`,
              '--r': `${p.r}deg`,
              '--d': `${p.d}ms`,
              '--c': p.c,
              '--w': `${p.w}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
