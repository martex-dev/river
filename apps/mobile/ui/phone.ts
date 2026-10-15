/**
 * River's layout on a phone, Discord-style: one pane at a time.
 *
 * - "main": the conversation (or page) fills the screen. The ☰ button at the
 *   top left opens the list.
 * - "nav": the server rail with the channel list, or Home's list of
 *   conversations. Choosing a channel, a conversation or a Home page opens it.
 *
 * Android's Back button returns from a conversation to the list (the list is
 * a history entry), then leaves the app. Swiping right opens the list, left
 * closes it (swipe.ts). Nothing here changes the shared UI's
 * behaviour; it only decides which pane is shown.
 */

import { swipeTarget, type Pane } from './swipe.ts';

const root = document.documentElement;
root.dataset.pane = 'main';

function show(pane: Pane): void {
  if (root.dataset.pane === pane) return;
  root.dataset.pane = pane;
  // Opening the list adds a history entry, so Back closes it again.
  if (pane === 'nav') history.pushState({ riverPane: 'nav' }, '');
  else if ((history.state as { riverPane?: string } | null)?.riverPane === 'nav') history.back();
}

window.addEventListener('popstate', () => {
  root.dataset.pane = (history.state as { riverPane?: string } | null)?.riverPane === 'nav' ? 'nav' : 'main';
});

// Choosing something in the list opens it.
const OPENS = ['.channel__open', '.dm-row', '.home-nav__item', '.community__server', '.rail-home'].join(',');
document.addEventListener(
  'click',
  (e) => {
    if (root.dataset.pane !== 'nav') return;
    const target = e.target as Element | null;
    const hit = target?.closest(OPENS);
    if (!hit) return;
    // Servers and Home switch what the list shows; channels, conversations and pages open.
    if (hit.matches('.community__server, .rail-home')) return;
    setTimeout(() => show('main'), 0);
  },
  true,
);

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
    const pane = root.dataset.pane === 'nav' ? 'nav' : 'main';
    const next = swipeTarget(
      pane,
      { x0: touch.x, y0: touch.y, x1: t.clientX, y1: t.clientY, ms: Date.now() - touch.at },
      window.innerWidth,
    );
    touch = null;
    // Not while a menu or dialog is open.
    if (next && !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) show(next);
  },
  { passive: true },
);
document.addEventListener('touchcancel', () => (touch = null), { passive: true });

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
