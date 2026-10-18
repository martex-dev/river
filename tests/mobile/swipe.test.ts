import { describe, expect, it } from 'vitest';
import { isEdgeSwipeBack } from '../../apps/mobile/ui/swipe.ts';

const swipe = (x0: number, x1: number, dy = 0, ms = 200) => ({ x0, y0: 300, x1, y1: 300 + dy, ms });

describe('the iPhone back swipe', () => {
  it('goes back on a swipe to the right from the left edge', () => {
    expect(isEdgeSwipeBack(swipe(4, 160))).toBe(true);
    expect(isEdgeSwipeBack(swipe(20, 120, 30))).toBe(true);
  });

  it('ignores swipes that start further in, scrolling, short, slow and leftward swipes', () => {
    expect(isEdgeSwipeBack(swipe(80, 300))).toBe(false); // a chat row's actions, not Back
    expect(isEdgeSwipeBack(swipe(4, 160, 120))).toBe(false); // mostly vertical
    expect(isEdgeSwipeBack(swipe(4, 50))).toBe(false); // too short
    expect(isEdgeSwipeBack(swipe(4, 300, 0, 1500))).toBe(false); // too slow
    expect(isEdgeSwipeBack(swipe(20, 0))).toBe(false); // the wrong way
  });
});
