import { useEffect, useRef, useState, type ReactElement, type ReactNode, type TouchEvent } from 'react';
import { gestureOf, haptic } from '../components/gestures.ts';

/** One button revealed behind a row, as in Telegram's chat list. */
export interface RowAction {
  label: string;
  icon: ReactNode;
  tone: 'blue' | 'orange' | 'red' | 'gray' | 'green' | 'accent';
  run(): void;
}

const ACTION_W = 74;

/** Only one row is open at a time: opening another closes it. */
let closeOpen: (() => void) | null = null;

/** Where a row rests after the finger lifts: fully open on one side, or closed. */
export function settle(dx: number, leftW: number, rightW: number): number {
  if (dx > leftW / 2 && leftW > 0) return leftW;
  if (dx < -rightW / 2 && rightW > 0) return -rightW;
  return 0;
}

/** How far the row follows the finger: freely up to its buttons, then with resistance. */
export function follow(dx: number, leftW: number, rightW: number): number {
  if (dx > leftW) return leftW + (dx - leftW) * 0.25;
  if (dx < -rightW) return -rightW + (dx + rightW) * 0.25;
  return dx;
}

/**
 * A list row that swipes sideways to show its actions (`start`: swiping right; `end`: swiping
 * left). Scrolling the list up and down never moves it; a tap on an open row closes it.
 */
export function SwipeRow(props: {
  start?: RowAction[];
  end?: RowAction[];
  children: ReactNode;
  className?: string;
}): ReactElement {
  const start = props.start ?? [];
  const end = props.end ?? [];
  const leftW = start.length * ACTION_W;
  const rightW = end.length * ACTION_W;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touch = useRef<{ x: number; y: number; base: number; mode: 'undecided' | 'scroll' | 'swipe' } | null>(
    null,
  );
  const close = useRef(() => setDx(0));
  /** Where the row is while the finger moves (state lags a frame behind). */
  const live = useRef(0);
  useEffect(
    () => () => {
      if (closeOpen === close.current) closeOpen = null;
    },
    [],
  );

  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0];
    live.current = dx;
    touch.current =
      e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, base: dx, mode: 'undecided' } : null;
  };
  const onTouchMove = (e: TouchEvent): void => {
    const s = touch.current;
    const t = e.touches[0];
    if (!s || !t) return;
    const mx = t.clientX - s.x;
    if (s.mode === 'undecided') {
      s.mode = gestureOf(mx, t.clientY - s.y);
      if (s.mode === 'swipe') {
        setDragging(true);
        if (closeOpen && closeOpen !== close.current) closeOpen();
      }
    }
    if (s.mode === 'swipe') {
      live.current = follow(s.base + mx, leftW, rightW);
      setDx(live.current);
    }
  };
  const onTouchEnd = (): void => {
    const s = touch.current;
    touch.current = null;
    if (!s || s.mode !== 'swipe') return;
    setDragging(false);
    const next = settle(live.current, leftW, rightW);
    setDx(next);
    if (next !== 0) {
      closeOpen = close.current;
      haptic('select');
    }
  };

  return (
    <div
      className={`pswipe ${props.className ?? ''} ${dx !== 0 ? 'is-open' : ''} ${dragging ? 'is-dragging' : ''}`}
    >
      {start.length > 0 && (
        <div className="pswipe__actions pswipe__actions--start" style={{ width: Math.max(0, dx) }}>
          {start.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`pswipe__action pswipe__action--${a.tone}`}
              tabIndex={dx > 0 ? 0 : -1}
              aria-hidden={dx > 0 ? undefined : true}
              onClick={() => {
                setDx(0);
                a.run();
              }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      {end.length > 0 && (
        <div className="pswipe__actions pswipe__actions--end" style={{ width: Math.max(0, -dx) }}>
          {end.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`pswipe__action pswipe__action--${a.tone}`}
              tabIndex={dx < 0 ? 0 : -1}
              aria-hidden={dx < 0 ? undefined : true}
              onClick={() => {
                setDx(0);
                a.run();
              }}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className={`pswipe__content ${dragging ? 'is-dragging' : ''}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(e) => {
          if (dx === 0) return;
          // A tap on an open row closes it instead of opening the chat.
          e.preventDefault();
          e.stopPropagation();
          setDx(0);
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
