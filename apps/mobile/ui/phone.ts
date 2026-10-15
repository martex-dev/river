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
