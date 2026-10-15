/**
 * River's layout on a phone, Discord-style: one pane at a time.
 *
 * - "main": the conversation (or page) fills the screen. The ☰ button at the
 *   top left opens the list.
 * - "nav": the server rail with the channel list, or Home's list of
 *   conversations. Choosing a channel, a conversation or a Home page opens it.
 *
 * Android's Back button returns from a conversation to the list (the list is
 * a history entry), then leaves the app. Nothing here changes the shared UI's
 * behaviour; it only decides which pane is shown.
 */

type Pane = 'nav' | 'main';

const root = document.documentElement;
root.dataset.pane = 'main';
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) root.dataset.platform = 'ios';

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

/**
 * Long-press opens River's menus (messages, channels, members…), which listen
 * for "contextmenu". Android's WebView sends it on a long press; iOS does not,
 * so River sends it there itself, and the tap that ends the press is ignored.
 */
if (root.dataset.platform === 'ios') {
  let timer: number | undefined;
  let start: { x: number; y: number; target: EventTarget | null } | null = null;
  let swallowClick = false;
  const cancel = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    start = null;
  };
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return cancel();
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY, target: e.target };
      timer = window.setTimeout(() => {
        if (!start) return;
        const { x, y, target } = start;
        cancel();
        swallowClick = true;
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
  document.addEventListener('touchend', cancel, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
  document.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

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
