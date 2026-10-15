/**
 * Swiping between the two phone panes, as in Discord: a swipe to the right on
 * the conversation opens the list behind it; a swipe to the left on the list
 * goes back to the conversation. Only clear, mostly horizontal swipes count,
 * so scrolling a conversation never switches panes.
 */

export type Pane = 'nav' | 'main';

export interface Swipe {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Milliseconds from touch start to end. */
  ms: number;
}

const MIN_DISTANCE = 70;
const MAX_MS = 800;

export function swipeTarget(pane: Pane, s: Swipe, width: number): Pane | null {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  if (s.ms > MAX_MS || Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  // Opening the list starts from the left part of the screen (the right is for message actions).
  if (pane === 'main' && dx > 0 && s.x0 < width * 0.6) return 'nav';
  if (pane === 'nav' && dx < 0) return 'main';
  return null;
}
