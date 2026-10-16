/**
 * Open overlays (dialogs, menus, pickers, the image viewer), newest on top.
 *
 * Escape closes only the topmost one, not every overlay listening at once, and
 * the phone's Back button closes the topmost one first (apps/mobile/ui/phone.ts).
 * Nothing here touches the DOM until an overlay opens, so importing it is safe
 * anywhere (tests, the phone shell).
 */

interface Layer {
  id: number;
  close(): void;
}

const stack: Layer[] = [];
let nextId = 0;
let listening = false;

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.isComposing || stack.length === 0) return;
  // Before any other Escape handler (window listeners, React's): only the topmost overlay closes.
  e.stopImmediatePropagation();
  e.preventDefault();
  stack.at(-1)!.close();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', onKey, true);
}

/** Puts an overlay on top; `close` is called when Escape (or Back) should close it. Returns its removal. */
export function pushOverlay(close: () => void): {
  id: number;
  update(close: () => void): void;
  remove(): void;
} {
  listen();
  const layer: Layer = { id: ++nextId, close };
  stack.push(layer);
  return {
    id: layer.id,
    update(next) {
      layer.close = next;
    },
    remove() {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
    },
  };
}

/** Closes the topmost overlay; false when none is open. */
export function closeTopOverlay(): boolean {
  const top = stack.at(-1);
  if (!top) return false;
  top.close();
  return true;
}

export function overlayCount(): number {
  return stack.length;
}

/** True for the topmost overlay. */
export function isTopOverlay(id: number): boolean {
  return stack.at(-1)?.id === id;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Where a floating panel of `size` asked for at (x, y) goes so it stays inside the visible part of
 * the screen (`view`: the visual viewport, above the on-screen keyboard), clear of the notch and the
 * gesture bar (`insets`), `margin` px from every edge. `maxHeight` is how tall it may be at most.
 */
export function placeWithin(
  x: number,
  y: number,
  size: { width: number; height: number },
  view: Box,
  insets: Insets = NO_INSETS,
  margin = 8,
): { left: number; top: number; maxHeight: number } {
  const minLeft = view.left + insets.left + margin;
  const minTop = view.top + insets.top + margin;
  const maxRight = view.left + view.width - insets.right - margin;
  const maxBottom = view.top + view.height - insets.bottom - margin;
  const maxHeight = Math.max(80, maxBottom - minTop);
  const height = Math.min(size.height, maxHeight);
  return {
    left: Math.max(minLeft, Math.min(x, maxRight - size.width)),
    top: Math.max(minTop, Math.min(y, maxBottom - height)),
    maxHeight,
  };
}

/** The visible part of the screen: the visual viewport when there is one (it shrinks for the keyboard). */
export function visibleBox(): Box {
  const vv = window.visualViewport;
  return vv
    ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

let probe: HTMLElement | null = null;

/** The safe-area insets (notch, rounded corners, gesture bar) in px; zero on computers. */
export function safeInsets(): Insets {
  if (typeof document === 'undefined' || !document.body) return NO_INSETS;
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.append(probe);
  }
  const cs = getComputedStyle(probe);
  const px = (v: string): number => Number.parseFloat(v) || 0;
  return {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
}
