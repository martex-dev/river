// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  gestureOf,
  HOLD_MS,
  SWIPE_REPLY_PX,
  swipeOffset,
  useMessageGestures,
} from '../src/renderer/src/components/gestures.ts';

const haptics: string[] = [];
beforeEach(() => {
  haptics.length = 0;
  (window as unknown as { river: unknown }).river = { app: { haptic: (k: string) => haptics.push(k) } };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Message(props: { onReply?: () => void; onHold?: (x: number, y: number) => void }) {
  const gestures = useMessageGestures({
    ...(props.onReply ? { onReply: props.onReply } : {}),
    ...(props.onHold ? { onHold: props.onHold } : {}),
  });
  return (
    <div data-testid="msg" {...gestures}>
      hello
    </div>
  );
}

const at = (x: number, y: number) => ({
  touches: [{ clientX: x, clientY: y }],
  changedTouches: [{ clientX: x, clientY: y }],
});

describe('message gestures', () => {
  it('tell a scroll from a sideways pull', () => {
    expect(gestureOf(3, 4)).toBe('undecided');
    expect(gestureOf(-40, 5)).toBe('swipe');
    expect(gestureOf(-12, 30)).toBe('scroll');
    expect(swipeOffset(30)).toBe(0);
    expect(swipeOffset(-500)).toBeLessThan(-SWIPE_REPLY_PX);
  });

  it('reply when a message is pulled far enough to the left, with one vibration', () => {
    const onReply = vi.fn();
    render(<Message onReply={onReply} />);
    const el = screen.getByTestId('msg');
    fireEvent.touchStart(el, at(200, 100));
    fireEvent.touchMove(el, at(170, 102));
    expect(el.style.transform).toBe('translateX(-30px)');
    fireEvent.touchMove(el, at(120, 104));
    fireEvent.touchMove(el, at(110, 104));
    fireEvent.touchEnd(el, at(110, 104));
    expect(onReply).toHaveBeenCalledOnce();
    expect(haptics).toEqual(['tap']);
    expect(el.style.transform).toBe('');
  });

  it('do not reply for a short pull or a scroll', () => {
    const onReply = vi.fn();
    render(<Message onReply={onReply} />);
    const el = screen.getByTestId('msg');
    fireEvent.touchStart(el, at(200, 100));
    fireEvent.touchMove(el, at(180, 100));
    fireEvent.touchEnd(el, at(180, 100));
    fireEvent.touchStart(el, at(200, 100));
    fireEvent.touchMove(el, at(150, 220));
    fireEvent.touchEnd(el, at(150, 220));
    expect(onReply).not.toHaveBeenCalled();
  });

  it('open the menu when held still, and swallow the system menu after it', () => {
    vi.useFakeTimers();
    const onHold = vi.fn();
    render(<Message onHold={onHold} />);
    const el = screen.getByTestId('msg');
    fireEvent.touchStart(el, at(50, 60));
    act(() => void vi.advanceTimersByTime(HOLD_MS + 10));
    expect(onHold).toHaveBeenCalledWith(50, 60);
    expect(haptics).toEqual(['select']);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('do not open the menu when the finger moves', () => {
    vi.useFakeTimers();
    const onHold = vi.fn();
    render(<Message onHold={onHold} />);
    const el = screen.getByTestId('msg');
    fireEvent.touchStart(el, at(50, 60));
    fireEvent.touchMove(el, at(50, 120));
    act(() => void vi.advanceTimersByTime(HOLD_MS + 10));
    expect(onHold).not.toHaveBeenCalled();
  });
});
