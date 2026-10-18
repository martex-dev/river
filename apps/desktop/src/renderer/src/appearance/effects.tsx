import { useEffect, type CSSProperties, type ReactElement } from 'react';
import { create } from 'zustand';
import { isMessageEffect, type MessageEffect } from '../../../shared/dm.ts';
import { quiet } from './delight.tsx';

/**
 * Message effects (2.19): a message sent with confetti, hearts or fireworks plays them over the
 * whole screen once — for the sender as it goes, for each reader the first time they see it.
 * Decoration only: no pointer events, hidden from screen readers, and nothing at all with reduced
 * motion or Calm mode (the message itself arrives as always). The effect's name travels inside
 * the end-to-end encrypted message; apps before 2.19 ignore it.
 */

export const EFFECT_LABELS: Record<MessageEffect, { emoji: string; name: string }> = {
  confetti: { emoji: '🎉', name: 'Confetti' },
  hearts: { emoji: '❤️', name: 'Hearts' },
  fireworks: { emoji: '🎆', name: 'Fireworks' },
};

export interface EffectPiece {
  /** Where it starts across the screen, 0–100 (%). */
  x: number;
  /** Where it starts down the screen (fireworks), 0–100 (%). */
  y: number;
  /** How far it travels (px) and turns (deg). */
  dx: number;
  dy: number;
  r: number;
  /** Delay (ms) and size (px). */
  d: number;
  s: number;
  c: string;
}

const COLORS = ['#4fe3d1', '#7d86ff', '#faa81a', '#ed4245', '#3ee08f', '#f47fff', '#ffd84d'];
const HEARTS = ['❤️', '💖', '💕', '💗', '🩷'];
export const EFFECT_MS = 2600;

/** The pieces of an effect, deterministic for a given `random` (tests). */
export function effectPieces(effect: MessageEffect, random: () => number = Math.random): EffectPiece[] {
  const piece = (i: number, p: Partial<EffectPiece>): EffectPiece => ({
    x: Math.round(random() * 100),
    y: 0,
    dx: 0,
    dy: 0,
    r: 0,
    d: Math.round(random() * 600),
    s: 8,
    c: COLORS[i % COLORS.length]!,
    ...p,
  });
  switch (effect) {
    case 'confetti':
      // Falling from the top, drifting and spinning.
      return Array.from({ length: 70 }, (_, i) =>
        piece(i, {
          dx: Math.round((random() - 0.5) * 240),
          r: Math.round(random() * 900 - 450),
          s: 6 + Math.round(random() * 7),
        }),
      );
    case 'hearts':
      // Rising from the bottom.
      return Array.from({ length: 26 }, (_, i) =>
        piece(i, {
          dx: Math.round((random() - 0.5) * 160),
          r: Math.round((random() - 0.5) * 50),
          s: 22 + Math.round(random() * 22),
          d: Math.round(random() * 900),
        }),
      );
    case 'fireworks': {
      // Three bursts of sparks at different places and moments.
      const out: EffectPiece[] = [];
      for (let b = 0; b < 3; b++) {
        const x = 20 + Math.round(random() * 60);
        const y = 18 + Math.round(random() * 35);
        const d = b * 420;
        const c = COLORS[(b * 2) % COLORS.length]!;
        for (let i = 0; i < 22; i++) {
          const angle = (i / 22) * Math.PI * 2;
          const dist = 90 + random() * 70;
          out.push({
            x,
            y,
            dx: Math.round(Math.cos(angle) * dist),
            dy: Math.round(Math.sin(angle) * dist),
            r: 0,
            d,
            s: 5 + Math.round(random() * 3),
            c: i % 4 === 0 ? '#ffffff' : c,
          });
        }
      }
      return out;
    }
  }
}

interface Playing {
  id: number;
  effect: MessageEffect;
  pieces: EffectPiece[];
}

const usePlaying = create<{ playing: Playing | null }>(() => ({ playing: null }));
let next = 0;

/** Plays an effect over the screen; false (and nothing shown) with reduced motion or Calm mode. */
export function playEffect(effect: MessageEffect): boolean {
  if (quiet()) return false;
  const id = ++next;
  usePlaying.setState({ playing: { id, effect, pieces: effectPieces(effect) } });
  window.setTimeout(() => {
    if (usePlaying.getState().playing?.id === id) usePlaying.setState({ playing: null });
  }, EFFECT_MS + 700);
  return true;
}

/** Stops what is playing (tests, and nothing else needs it). */
export function stopEffect(): void {
  usePlaying.setState({ playing: null });
}

// ---- seen on this device -----------------------------------------------------------------------

const SEEN_KEY = 'river.effectsSeen';
const MAX_SEEN = 300;
/** An effect plays only for a message this recent, so a new device does not replay old ones. */
export const EFFECT_FRESH_MS = 2 * 86_400_000;
let seenCache: string[] | null = null;

function seenList(): string[] {
  if (seenCache) return seenCache;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    seenCache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    seenCache = [];
  }
  return seenCache;
}

/** Message IDs only (random, nothing about what the messages say). */
export function markEffectSeen(ids: string[]): void {
  const list = seenList();
  const fresh = ids.filter((id) => !list.includes(id));
  if (!fresh.length) return;
  seenCache = [...list, ...fresh].slice(-MAX_SEEN);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seenCache));
  } catch {
    // Private storage unavailable: remembered until River closes.
  }
}

export function effectSeen(id: string): boolean {
  return seenList().includes(id);
}

/** For tests: forget what was seen. */
export function resetEffectsSeen(): void {
  seenCache = null;
}

interface WithEffect {
  id: string;
  mine: boolean;
  sentAt: string;
  deleted?: boolean;
  effect?: string | null;
}

/**
 * The effect to play now among a conversation's messages: the newest one from someone else that
 * this device has not shown yet. Every unseen one counts as seen from now on (one effect at a time).
 */
export function effectToPlay(messages: readonly WithEffect[], now = Date.now()): MessageEffect | null {
  const unseen = messages.filter(
    (m) =>
      !m.mine &&
      !m.deleted &&
      isMessageEffect(m.effect) &&
      !effectSeen(m.id) &&
      now - Date.parse(m.sentAt) < EFFECT_FRESH_MS,
  );
  if (!unseen.length) return null;
  markEffectSeen(unseen.map((m) => m.id));
  return unseen.at(-1)!.effect as MessageEffect;
}

/**
 * Plays a received message's effect when it is first seen: while its conversation is open and
 * River is in view (a hidden window waits until you come back).
 */
export function useMessageEffects(messages: readonly WithEffect[]): void {
  useEffect(() => {
    const check = (): void => {
      if (document.visibilityState === 'hidden') return;
      const effect = effectToPlay(messages);
      if (effect) playEffect(effect);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [messages]);
}

/** Mounted once with the app's overlays. */
export function EffectLayer(): ReactElement | null {
  const playing = usePlaying((s) => s.playing);
  if (!playing) return null;
  return (
    <div
      key={playing.id}
      className={`msg-effect msg-effect--${playing.effect}`}
      aria-hidden="true"
      data-effect={playing.effect}
    >
      {playing.pieces.map((p, i) => (
        <i
          key={i}
          className="msg-effect__piece"
          style={
            {
              '--x': `${p.x}%`,
              '--y': `${p.y}%`,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--r': `${p.r}deg`,
              '--d': `${p.d}ms`,
              '--s': `${p.s}px`,
              '--c': p.c,
            } as CSSProperties
          }
        >
          {playing.effect === 'hearts' ? HEARTS[i % HEARTS.length] : null}
        </i>
      ))}
    </div>
  );
}
