import { describe, expect, it } from 'vitest';
import { swipeTarget } from '../../apps/mobile/ui/swipe.ts';

const W = 400;
const swipe = (x0: number, x1: number, dy = 0, ms = 200) => ({ x0, y0: 300, x1, y1: 300 + dy, ms });

describe('phone swipes', () => {
  it('right on the conversation opens the list; left on the list closes it', () => {
    expect(swipeTarget('main', swipe(40, 200), W)).toBe('nav');
    expect(swipeTarget('nav', swipe(300, 100), W)).toBe('main');
  });

  it('ignores scrolling, short, slow and wrong-way swipes', () => {
    expect(swipeTarget('main', swipe(40, 200, 120), W)).toBeNull(); // mostly vertical
    expect(swipeTarget('main', swipe(40, 90), W)).toBeNull(); // too short
    expect(swipeTarget('main', swipe(40, 300, 0, 1500), W)).toBeNull(); // too slow
    expect(swipeTarget('main', swipe(300, 100), W)).toBeNull(); // already on the conversation
    expect(swipeTarget('nav', swipe(40, 200), W)).toBeNull();
  });

  it('opening the list starts on the left part of the screen', () => {
    expect(swipeTarget('main', swipe(300, 399), W)).toBeNull();
  });
});
