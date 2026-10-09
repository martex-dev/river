import type { CSSProperties, ReactElement } from 'react';
import { create } from 'zustand';

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
const COLORS = ['#4fe3d1', '#7d86ff', '#faa81a', '#ed4245', '#3ee08f', '#f47fff'];

export function celebrate(text: string): void {
  if (document.documentElement.dataset.motion === 'reduced') return;
  const id = ++next;
  const pieces = Array.from({ length: 36 }, (_, i) => ({
    x: Math.round((Math.random() - 0.5) * 900),
    y: Math.round(-120 - Math.random() * 320),
    r: Math.round(Math.random() * 720 - 360),
    d: Math.round(Math.random() * 180),
    c: COLORS[i % COLORS.length]!,
    w: 6 + Math.round(Math.random() * 6),
  }));
  useFx.setState((s) => ({ bursts: [...s.bursts.slice(-2), { id, text, pieces }] }));
  window.setTimeout(() => useFx.setState((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })), BURST_MS);
}

export function Celebrations(): ReactElement | null {
  const bursts = useFx((s) => s.bursts);
  if (bursts.length === 0) return null;
  return (
    <div className="celebrations" aria-hidden="true">
      {bursts.map((b) => (
        <BurstView key={b.id} burst={b} />
      ))}
    </div>
  );
}

function BurstView({ burst }: { burst: Burst }): ReactElement {
  return (
    <div className="burst">
      <div className="burst__text">{burst.text}</div>
      {burst.pieces.map((p, i) => (
        <i
          key={i}
          className="burst__piece"
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
