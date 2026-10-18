/**
 * Going back by swiping from the left edge of the screen, as everywhere on an iPhone (2.12): a
 * clear, mostly horizontal swipe to the right that starts at the very edge closes the screen on
 * top. Swipes further in belong to the page (a chat row's actions, a message's reply swipe), and
 * scrolling never counts.
 */

export interface Swipe {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Milliseconds from touch start to end. */
  ms: number;
}

/** How far (px) from the left edge a back swipe starts. */
export const EDGE_PX = 28;
const MIN_DISTANCE = 70;
const MAX_MS = 800;

export function isEdgeSwipeBack(s: Swipe): boolean {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  if (s.ms > MAX_MS || s.x0 > EDGE_PX) return false;
  return dx >= MIN_DISTANCE && dx >= 2 * Math.abs(dy);
}
