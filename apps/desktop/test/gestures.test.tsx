// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortal } from 'react-dom';
import {
  fromOverlay,
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

function Message(props: {
  onReply?: () => void;
  onHold?: (x: number, y: number) => void;
  onDoubleTap?: () => void;
  onClick?: () => void;
}) {
  const { onClickCapture, ...gestures } = useMessageGestures({
    ...(props.onReply ? { onReply: props.onReply } : {}),
    ...(props.onHold ? { onHold: props.onHold } : {}),
    ...(props.onDoubleTap ? { onDoubleTap: props.onDoubleTap } : {}),
  });
  return (
    <div data-testid="msg" {...gestures} onClickCapture={onClickCapture} onClick={props.onClick}>
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

  it('react to two quick taps in one place, not to taps far apart in time or place', () => {
    vi.useFakeTimers();
    const onDoubleTap = vi.fn();
    render(<Message onDoubleTap={onDoubleTap} />);
    const el = screen.getByTestId('msg');
    const tap = (x: number, y: number) => {
      fireEvent.touchStart(el, at(x, y));
      fireEvent.touchEnd(el, at(x, y));
    };
    tap(100, 100);
    vi.advanceTimersByTime(120);
    tap(104, 102);
    expect(onDoubleTap).toHaveBeenCalledOnce();
    tap(100, 100);
    vi.advanceTimersByTime(600);
    tap(100, 100);
    tap(100, 100);
    vi.advanceTimersByTime(100);
    tap(200, 300);
    expect(onDoubleTap).toHaveBeenCalledTimes(2);
  });

  it('swallow only the tap that ends a hold, not the next one (on the menu it opened)', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<Message onHold={() => undefined} onClick={onClick} />);
    const el = screen.getByTestId('msg');
    fireEvent.touchStart(el, at(10, 10));
    act(() => void vi.advanceTimersByTime(HOLD_MS + 10));
    fireEvent.touchEnd(el, at(10, 10));
    // No click came with that hold; the next tap is a real one.
    fireEvent.touchStart(el, at(10, 10));
    fireEvent.touchEnd(el, at(10, 10));
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('do not take two taps on a reaction or link as a double tap on the message', () => {
    vi.useFakeTimers();
    const onDoubleTap = vi.fn();
    function WithButton() {
      const { onClickCapture, ...gestures } = useMessageGestures({ onDoubleTap });
      return (
        <div data-testid="msg" {...gestures} onClickCapture={onClickCapture}>
          <button>❤️ 2</button>
        </div>
      );
    }
    render(<WithButton />);
    const button = screen.getByText('❤️ 2');
    for (let i = 0; i < 2; i++) {
      fireEvent.touchStart(button, at(20, 20));
      fireEvent.touchEnd(button, at(20, 20));
    }
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('leave touches in a menu or picture opened from the message alone', () => {
    vi.useFakeTimers();
    const onHold = vi.fn();
    const onReply = vi.fn();
    function WithPortal() {
      const { onClickCapture, ...gestures } = useMessageGestures({ onHold, onReply });
      return (
        <div data-testid="msg" {...gestures} onClickCapture={onClickCapture}>
          hello
          {createPortal(<div data-testid="viewer">picture</div>, document.body)}
        </div>
      );
    }
    render(<WithPortal />);
    const viewer = screen.getByTestId('viewer');
    fireEvent.touchStart(viewer, at(200, 100));
    fireEvent.touchMove(viewer, at(100, 102));
    fireEvent.touchEnd(viewer, at(100, 102));
    act(() => void vi.advanceTimersByTime(HOLD_MS + 10));
    expect(onReply).not.toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
    expect(fromOverlay({ target: viewer, currentTarget: screen.getByTestId('msg') })).toBe(true);
  });

  it('swallow the tap that ends a hold', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<Message onHold={() => undefined} onClick={onClick} />);
    const el = screen.getByTestId('msg');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.touchStart(el, at(10, 10));
    act(() => void vi.advanceTimersByTime(HOLD_MS + 10));
    fireEvent.touchEnd(el, at(10, 10));
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
