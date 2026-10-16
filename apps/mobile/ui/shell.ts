/**
 * The phone shell's decisions, apart from the page so they can be tested: what Back does, how much
 * of the screen the keyboard covers, and which tap after a long press is the one to ignore.
 */

import type { Pane } from './swipe.ts';

/** Shown above everything: while one is open, swiping does not switch panes and ☰ is hidden. */
export const OVERLAYS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '.modal',
  '.popover',
  '.lightbox',
  '.settings-overlay',
  '.story-viewer',
  '.switcher-backdrop',
  '.dm-call--full',
].join(', ');

/** Overlays that close on Escape but are not on River's overlay stack (components/overlays.ts). */
const CLOSES_ON_ESCAPE = '.settings-overlay, .story-viewer, .switcher-backdrop, .modal, .lightbox';

export interface BackEnv {
  /** Closes the topmost menu, dialog or picture (River's overlay stack); false if none is open. */
  closeTopOverlay(): boolean;
  doc: Document;
  pane: Pane;
  showList(): void;
}

/**
 * Android's Back button (MainActivity asks `window.__riverBack()`): true when River handled it,
 * false to let Android put River in the background. In order: the topmost menu or dialog closes;
 * a full-screen call shrinks back into its conversation (it keeps going); Settings, a story or
 * the quick switcher closes; a conversation goes back to the list.
 */
export function handleBack(env: BackEnv): boolean {
  if (env.closeTopOverlay()) return true;
  const doc = env.doc;
  const minimize = doc.querySelector<HTMLElement>('.dm-call--full .dm-call__min');
  if (minimize) {
    minimize.click();
    return true;
  }
  const open = doc.querySelector(CLOSES_ON_ESCAPE);
  if (open) {
    const focused = doc.activeElement;
    const target = focused instanceof HTMLElement && open.contains(focused) ? focused : doc.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }
  if (env.pane === 'main') {
    env.showList();
    return true;
  }
  return false;
}

/**
 * How many px at the bottom of the layout the on-screen keyboard covers. Where the keyboard
 * resizes the page (Android) this is 0; where it only shrinks the visual viewport (iPhone) it is
 * the keyboard's height. Small differences (toolbars, rounding) count as no keyboard.
 */
export function keyboardInset(
  layoutHeight: number,
  vv: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!vv) return 0;
  const covered = Math.round(layoutHeight - vv.height - vv.offsetTop);
  return covered > 80 ? covered : 0;
}

/** Text fields keep the system's own long press (selecting text, the loupe). */
export function isTextField(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/** How long (ms) after a long press ends its tap may still arrive. */
const SWALLOW_MS = 400;

/**
 * iPhone sends a tap when a long press ends; River opened a menu for the press, so that one tap is
 * ignored. Only that one: a new touch, or a moment passing, clears it.
 */
export class HoldTap {
  private fired = false;
  private until = 0;

  /** A finger touched the screen. */
  start(): void {
    this.fired = false;
    this.until = 0;
  }

  /** The long press opened a menu. */
  held(): void {
    this.fired = true;
  }

  /** The finger lifted (or the touch was cancelled). */
  end(now: number): void {
    if (this.fired) this.until = now + SWALLOW_MS;
    this.fired = false;
  }

  /** True for the tap to ignore (once). */
  swallow(now: number): boolean {
    if (this.fired || now < this.until) {
      this.fired = false;
      this.until = 0;
      return true;
    }
    return false;
  }
}
