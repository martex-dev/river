/**
 * River's layout on a phone, Discord-style: one pane at a time.
 *
 * - "main": the conversation (or page) fills the screen. The ☰ button at the
 *   top left opens the list.
 * - "nav": the server rail with the channel list, or Home's list of
 *   conversations. Choosing a channel, a conversation or a Home page opens it,
 *   and so does River opening one by itself (a notification, an accepted call,
 *   the quick switcher, a shared file).
 *
 * Android's Back button asks `window.__riverBack()` (shell.ts): it closes the
 * topmost menu or dialog, then returns from a conversation to the list, then
 * leaves the app. Swiping right opens the list, left closes it (swipe.ts).
 * Nothing here changes the shared UI's behaviour; it only decides which pane is
 * shown.
 */

import { closeTopOverlay } from '../../desktop/src/renderer/src/components/overlays.ts';
import { useCommunity } from '../../desktop/src/renderer/src/community/store.ts';
import { useDm } from '../../desktop/src/renderer/src/dm/store.ts';
import { useRiver } from '../../desktop/src/renderer/src/store.ts';
import { handleBack, HoldTap, isTextField, keyboardInset, OVERLAYS } from './shell.ts';
import { swipeTarget, type Pane } from './swipe.ts';

declare global {
  interface Window {
    /**
     * Android's Back button: MainActivity evaluates this and takes "true" as handled (anything
     * else puts River in the background). Back sends no popstate, so this switches panes itself.
     */
    __riverBack?: () => boolean;
    /** Set to 'ios' by the iOS app at document start; undefined on Android. */
    __riverPlatform?: string;
  }
}

const root = document.documentElement;
root.dataset.pane = 'main';
// The iOS app says so before River loads (an iPad reports a Mac's user agent); else the user agent.
if (window.__riverPlatform === 'ios' || /iPhone|iPad|iPod/.test(navigator.userAgent)) {
  root.dataset.platform = 'ios';
}

const currentPane = (): Pane => (root.dataset.pane === 'nav' ? 'nav' : 'main');

function show(pane: Pane): void {
  if (root.dataset.pane === pane) return;
  root.dataset.pane = pane;
  // Opening the list adds a history entry, so a history Back closes it again.
  if (pane === 'nav') history.pushState({ riverPane: 'nav' }, '');
  else if ((history.state as { riverPane?: string } | null)?.riverPane === 'nav') history.back();
}

window.addEventListener('popstate', () => {
  root.dataset.pane = (history.state as { riverPane?: string } | null)?.riverPane === 'nav' ? 'nav' : 'main';
});

window.__riverBack = () => {
  try {
    return handleBack({ closeTopOverlay, doc: document, pane: currentPane(), showList: () => show('nav') });
  } catch {
    // Never trap Back: if anything went wrong, let Android handle it.
    return false;
  }
};

/**
 * Long-press opens River's menus (messages, channels, members…), which listen
 * for "contextmenu". Android's WebView sends it on a long press; iOS does not,
 * so River sends it there itself, and the tap that ends the press is ignored.
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
}

// Choosing something in the list opens it. Registered after the iPhone tap guard above, so the
// tap that ends a long press (which opened the row's menu) does not open the row too.
const OPENS = ['.channel__open', '.dm-row', '.home-nav__item', '.community__server', '.rail-home'].join(',');
/** Until then, River's own selection changes are the list switching what it shows (a server, Home). */
let listSwitchUntil = 0;
document.addEventListener(
  'click',
  (e) => {
    if (root.dataset.pane !== 'nav' || e.defaultPrevented) return;
    const target = e.target as Element | null;
    const hit = target?.closest(OPENS);
    if (!hit) return;
    // Servers and Home switch what the list shows; channels, conversations and pages open.
    if (hit.matches('.community__server, .rail-home')) {
      listSwitchUntil = Date.now() + 600;
      return;
    }
    setTimeout(() => show('main'), 0);
  },
  true,
);

/** River opening something by itself (notification, call, switcher, share sheet) shows it. */
function openedByRiver(): void {
  if (root.dataset.pane !== 'nav' || Date.now() < listSwitchUntil) return;
  show('main');
}
useRiver.subscribe((s, prev) => {
  if (s.section !== prev.section) openedByRiver();
});
useDm.subscribe((s, prev) => {
  if (s.selected && s.selected !== prev.selected) openedByRiver();
});
// Picture-in-picture shows the call from the conversation pane; the list would leave it black.
new MutationObserver(() => {
  if (root.dataset.pip === 'on') show('main');
}).observe(root, { attributes: true, attributeFilter: ['data-pip'] });
useCommunity.subscribe((s, prev) => {
  if (
    (s.selectedChannel && s.selectedChannel !== prev.selectedChannel) ||
    (s.openThread && s.openThread !== prev.openThread)
  )
    openedByRiver();
});

/** Touches that belong to something else: text fields, sliders, maps, things that scroll sideways. */
function ownsHorizontalGesture(target: Element | null): boolean {
  for (let el = target; el && el !== document.documentElement; el = el.parentElement) {
    if (el.matches('input, textarea, select, video, [contenteditable="true"], [role="slider"]')) return true;
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
  }
  return false;
}

// Swipe right for the list, left to go back to the conversation.
let touch: { x: number; y: number; at: number } | null = null;
document.addEventListener(
  'touchstart',
  (e) => {
    const t = e.touches[0];
    touch =
      e.touches.length === 1 && t && !ownsHorizontalGesture(e.target as Element | null)
        ? { x: t.clientX, y: t.clientY, at: Date.now() }
        : null;
  },
  { passive: true },
);
document.addEventListener(
  'touchend',
  (e) => {
    const t = e.changedTouches[0];
    if (!touch || !t) return;
    const next = swipeTarget(
      currentPane(),
      { x0: touch.x, y0: touch.y, x1: t.clientX, y1: t.clientY, ms: Date.now() - touch.at },
      window.innerWidth,
    );
    touch = null;
    // Not while a menu, dialog, picture or full-screen call is open.
    if (next && !document.querySelector(OVERLAYS)) show(next);
  },
  { passive: true },
);
document.addEventListener('touchcancel', () => (touch = null), { passive: true });

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

const menu = document.createElement('button');
menu.className = 'phone-menu';
menu.type = 'button';
menu.setAttribute('aria-label', 'Servers and channels');
menu.innerHTML =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
menu.addEventListener('click', () => show(root.dataset.pane === 'nav' ? 'main' : 'nav'));

function mount(): void {
  if (!document.body.contains(menu)) document.body.append(menu);
}
if (document.body) mount();
else document.addEventListener('DOMContentLoaded', mount);

export {};
