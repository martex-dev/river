/**
 * River on a phone (2.12): the phone shell itself is React (desktop renderer's phone/, shown by
 * App.tsx when River runs on Android or iOS) — a tab bar and screens pushed over it, as in
 * Telegram. This file wires what only the page can: Android's Back button, the iPhone's swipe
 * from the left edge, the iPhone's long press, and the on-screen keyboard.
 *
 * Android's Back asks `window.__riverBack()`: it closes the topmost menu or dialog, then the screen
 * on top (a conversation, a channel), then goes to Chats, then leaves the app.
 */

import { closeTopOverlay } from '../../desktop/src/renderer/src/components/overlays.ts';
import { phoneBack, phonePop } from '../../desktop/src/renderer/src/phone/nav.ts';
import { handleBack, HoldTap, isTextField, keyboardInset } from './shell.ts';
import { isEdgeSwipeBack } from './swipe.ts';

declare global {
  interface Window {
    /**
     * Android's Back button: MainActivity evaluates this and takes "true" as handled (anything
     * else puts River in the background). Back sends no popstate, so this goes back itself.
     */
    __riverBack?: () => boolean;
    /** Set to 'ios' by the iOS app at document start; undefined on Android. */
    __riverPlatform?: string;
  }
}

const root = document.documentElement;
// The iOS app says so before River loads (an iPad reports a Mac's user agent); else the user agent.
if (window.__riverPlatform === 'ios' || /iPhone|iPad|iPod/.test(navigator.userAgent)) {
  root.dataset.platform = 'ios';
}

window.__riverBack = () => {
  try {
    return handleBack({ closeTopOverlay, doc: document, back: phoneBack });
  } catch {
    // Never trap Back: if anything went wrong, let Android handle it.
    return false;
  }
};

/**
 * Long-press opens River's menus (messages, chats, channels, members…), which listen for
 * "contextmenu". Android's WebView sends it on a long press; iOS does not, so River sends it there
 * itself, and the tap that ends the press is ignored.
 */
const holdTap = new HoldTap();
if (root.dataset.platform === 'ios') {
  let timer: number | undefined;
  let start: { x: number; y: number; target: EventTarget | null } | null = null;
  const cancel = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    start = null;
  };
  document.addEventListener(
    'touchstart',
    (e) => {
      cancel();
      holdTap.start();
      // Text fields keep iOS's own long press (selecting, the loupe).
      if (e.touches.length !== 1 || isTextField(e.target)) return;
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY, target: e.target };
      timer = window.setTimeout(() => {
        if (!start) return;
        const { x, y, target } = start;
        cancel();
        holdTap.held();
        target?.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
        );
      }, 500);
    },
    { passive: true },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel();
    },
    { passive: true },
  );
  const end = (): void => {
    cancel();
    holdTap.end(Date.now());
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
  document.addEventListener(
    'click',
    (e) => {
      if (!holdTap.swallow(Date.now())) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  // Swiping right from the left edge goes back, as in every iPhone app (Android has its own).
  let edge: { x: number; y: number; at: number } | null = null;
  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      edge = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
    },
    { passive: true },
  );
  document.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      const s = edge;
      edge = null;
      if (!s || !t) return;
      const swipe = { x0: s.x, y0: s.y, x1: t.clientX, y1: t.clientY, ms: Date.now() - s.at };
      if (!isEdgeSwipeBack(swipe)) return;
      try {
        // Like Back, but never leaving a tab's own page (there is nothing to go back to).
        handleBack({ closeTopOverlay, doc: document, back: phonePop });
      } catch {
        // A swipe that went wrong does nothing.
      }
    },
    { passive: true },
  );
  document.addEventListener('touchcancel', () => (edge = null), { passive: true });
}

/**
 * The keyboard: where it only covers the page (iPhone), --kb is how much of the bottom it covers,
 * so the message box, menus and dialogs stay above it (phone.css). Where it resizes the page
 * (Android) --kb stays 0.
 */
const vv = window.visualViewport;
function updateKeyboard(): void {
  const kb = keyboardInset(window.innerHeight, vv);
  root.style.setProperty('--kb', `${kb}px`);
  if (kb > 0) root.dataset.keyboard = 'open';
  else delete root.dataset.keyboard;
  // iOS pans the page to show the focused field; with the page made shorter, undo that pan.
  if (kb > 0 && vv && vv.offsetTop > 0 && root.dataset.platform === 'ios') window.scrollTo(0, 0);
}
vv?.addEventListener('resize', updateKeyboard);
vv?.addEventListener('scroll', updateKeyboard);
updateKeyboard();

export {};
