import { useEffect, useRef, type TouchEvent } from 'react';

/**
 * Phone gestures on messages (2.8): swipe a message to the left to reply, like Telegram, and
 * hold it for its menu (iPhone does not open the menu on a long press by itself).
 */

/** How far (px) a message has to be pulled to reply; it never moves further than MAX. */
export const SWIPE_REPLY_PX = 64;
const SWIPE_MAX_PX = 88;
/** Fingers move a little while holding; more than this is a scroll or a swipe. */
const SLOP_PX = 10;
export const HOLD_MS = 450;

export type HapticKind = 'tap' | 'select' | 'success' | 'warning';

/** A short vibration on phones (Android, iPhone); nothing on computers. */
export function haptic(kind: HapticKind = 'tap'): void {
  try {
    window.river.app.haptic(kind);
  } catch {
    // not available: no vibration
  }
}

/**
 * What a finger that moved (dx, dy) from where it touched is doing: still undecided, scrolling the
 * list (mostly up or down), or pulling the message sideways.
 */
export function gestureOf(dx: number, dy: number): 'undecided' | 'scroll' | 'swipe' {
  if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return 'undecided';
  return Math.abs(dx) > 1.5 * Math.abs(dy) ? 'swipe' : 'scroll';
}

/** How far the message follows the finger: only to the left, and never further than MAX. */
export function swipeOffset(dx: number): number {
  return Math.max(-SWIPE_MAX_PX, Math.min(0, dx));
}

interface Options {
  /** Absent: the message cannot be replied to (no swipe). */
  onReply?: () => void;
  /** Absent: no menu on hold. */
  onHold?: (x: number, y: number) => void;
  /** Two quick taps (2.10.1): a quick reaction on messages. */
  onDoubleTap?: () => void;
  disabled?: boolean;
}

/** Two taps this close in time (ms) and place (px) are a double tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

interface Handlers {
  onTouchStart(e: TouchEvent<HTMLElement>): void;
  onTouchMove(e: TouchEvent<HTMLElement>): void;
  onTouchEnd(e: TouchEvent<HTMLElement>): void;
  onTouchCancel(e: TouchEvent<HTMLElement>): void;
  /** Swallows the system long-press menu right after our own hold menu opened (Android). */
  onContextMenuCapture(e: { preventDefault(): void; stopPropagation(): void }): void;
  /** Swallows the tap that ends a hold, so holding never also opens what was held. True: swallowed. */
  onClickCapture(e: { preventDefault(): void; stopPropagation(): void }): boolean;
}

export function useMessageGestures(options: Options): Handlers {
  const state = useRef<{
    x: number;
    y: number;
    mode: 'undecided' | 'scroll' | 'swipe';
    armed: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    at: number;
  } | null>(null);
  const heldAt = useRef(0);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const reset = (el: HTMLElement | null): void => {
    const s = state.current;
    if (s?.timer) clearTimeout(s.timer);
    state.current = null;
    if (el) {
      el.style.transition = 'transform 0.18s ease';
      el.style.transform = '';
      el.style.removeProperty('--swipe');
    }
  };

  return {
    onTouchStart(e) {
      const t = e.touches[0];
      if (latest.current.disabled || !t || e.touches.length !== 1) return reset(null);
      const target = e.target as HTMLElement;
      // Controls inside a message (players, links, inputs) keep their own touch handling.
      if (target.closest('input, textarea, audio, video, [role="slider"]')) return;
      const x = t.clientX;
      const y = t.clientY;
      const timer = latest.current.onHold
        ? setTimeout(() => {
            const s = state.current;
            if (!s || s.mode !== 'undecided') return;
            s.timer = null;
            heldAt.current = Date.now();
            haptic('select');
            latest.current.onHold?.(x, y);
          }, HOLD_MS)
        : null;
      state.current = { x, y, mode: 'undecided', armed: false, timer, at: Date.now() };
    },
    onTouchMove(e) {
      const s = state.current;
      const t = e.touches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (s.mode === 'undecided') {
        s.mode = gestureOf(dx, dy);
        if (s.mode === 'undecided') return;
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
        if (s.mode === 'swipe' && !latest.current.onReply) s.mode = 'scroll';
      }
      if (s.mode !== 'swipe') return;
      const el = e.currentTarget;
      const offset = swipeOffset(dx);
      el.style.transition = 'none';
      el.style.transform = offset ? `translateX(${offset}px)` : '';
      el.style.setProperty('--swipe', String(Math.min(1, -offset / SWIPE_REPLY_PX)));
      const armed = -offset >= SWIPE_REPLY_PX;
      if (armed && !s.armed) haptic('tap');
      s.armed = armed;
    },
    onTouchEnd(e) {
      const s = state.current;
      const reply = s?.mode === 'swipe' && s.armed;
      reset(e.currentTarget);
      if (reply) latest.current.onReply?.();
      // A tap (not a hold, scroll or swipe): two in a row are a double tap.
      const now = Date.now();
      if (!s || s.mode !== 'undecided' || heldAt.current >= s.at || !latest.current.onDoubleTap) return;
      const prev = lastTap.current;
      if (prev && now - prev.at < DOUBLE_TAP_MS && Math.hypot(s.x - prev.x, s.y - prev.y) < DOUBLE_TAP_PX) {
        lastTap.current = null;
        haptic('tap');
        latest.current.onDoubleTap();
      } else lastTap.current = { at: now, x: s.x, y: s.y };
    },
    onTouchCancel(e) {
      reset(e.currentTarget);
    },
    onContextMenuCapture(e) {
      if (Date.now() - heldAt.current < 1000) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onClickCapture(e) {
      if (Date.now() - heldAt.current >= 800) return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    },
  };
}
