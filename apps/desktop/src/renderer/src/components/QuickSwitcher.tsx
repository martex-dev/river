import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { sidebarGroups } from '../../../shared/layout.ts';
import { useCommunity } from '../community/store.ts';
import { useDm } from '../dm/store.ts';
import { SECTIONS, useRiver, type Section } from '../store.ts';

interface Target {
  key: string;
  label: string;
  hint: string;
  symbol: string;
  go(): void;
}

const SECTION_LABEL: Record<Section, string> = {
  home: 'Home',
  messages: 'Messages',
  communities: 'Communities',
  social: 'Social',
  calls: 'Calls',
  files: 'Files',
  contacts: 'Friends',
  admin: 'Admin',
  security: 'Security',
  settings: 'Settings',
};

/** Everything you can jump to: channels, conversations and River's sections. */
function useTargets(): Target[] {
  const communities = useCommunity((s) => s.communities);
  const unread = useCommunity((s) => s.unread);
  const conversations = useDm((d) => d.conversations);
  const navigate = useRiver((r) => r.navigate);
  return useMemo(() => {
    const channels: Target[] = communities.flatMap((c) =>
      c.channels.map((ch) => ({
        key: `ch:${ch.id}`,
        label: ch.name,
        hint: `${c.name}${(unread[ch.id] ?? 0) > 0 || ch.unread ? ' · unread' : ''}`,
        symbol: ch.kind === 'voice' ? '🔊' : '#',
        go: () => {
          navigate('communities');
          useCommunity.getState().select(c.id, ch.id);
        },
      })),
    );
    const dms: Target[] = conversations
      .filter((c) => c.state === 'accepted' || c.state === 'request')
      .map((c) => ({
        key: `dm:${c.riverId}`,
        label: c.name,
        hint: c.kind === 'group' ? 'Group' : c.unread ? `${c.unread} unread` : 'Direct message',
        symbol: c.kind === 'group' ? '👥' : '@',
        go: () => {
          navigate('messages');
          useDm.getState().select(c.riverId);
        },
      }));
    // Admin exists only on the PC that hosts the server; it is reached from the rail there.
    const sections: Target[] = SECTIONS.filter((s) => s !== 'admin').map((s) => ({
      key: `s:${s}`,
      label: SECTION_LABEL[s],
      hint: 'Section',
      symbol: '›',
      go: () => navigate(s),
    }));
    return [...channels, ...dms, ...sections];
  }, [communities, unread, conversations, navigate]);
}

/**
 * Moves to the previous or next channel of the open community, in sidebar
 * order (only unread ones with `unreadOnly`). Returns whether it moved.
 */
function stepChannel(direction: 1 | -1, unreadOnly: boolean): boolean {
  if (useRiver.getState().section !== 'communities') return false;
  const s = useCommunity.getState();
  const community = s.communities.find((c) => c.id === s.selectedCommunity);
  if (!community) return false;
  const order = sidebarGroups(community.channels, community.categories).flatMap((g) => g.channels);
  const at = order.findIndex((c) => c.id === s.selectedChannel);
  for (let i = 1; i <= order.length; i++) {
    const next = order[(at + direction * i + order.length * 2) % order.length]!;
    if (unreadOnly && !((s.unread[next.id] ?? 0) > 0 || next.unread)) continue;
    if (next.id === s.selectedChannel) return false;
    s.selectChannel(next.id);
    return true;
  }
  return false;
}

/** Ctrl+Alt+↑/↓: the previous or next community, in the order of the community list. */
function stepCommunity(direction: 1 | -1): boolean {
  if (useRiver.getState().section !== 'communities') return false;
  const s = useCommunity.getState();
  if (s.communities.length < 2) return false;
  const at = s.communities.findIndex((c) => c.id === s.selectedCommunity);
  const next = s.communities[(at + direction + s.communities.length) % s.communities.length]!;
  s.select(next.id);
  return true;
}

/** Whether a key press is meant for a text field, button or dialog rather than the app. */
export function typingSomewhere(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !('tagName' in el)) return false;
  if (el.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  return !!el.closest?.('[role="dialog"], .modal, .popover, [role="menu"]');
}

const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];

/** The next interface size up or down. */
export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STEPS[0]!;
}

/** A popover, menu, dialog or panel is open: Esc belongs to it. */
function somethingOpen(): boolean {
  return !!document.querySelector('.modal, .popover, [role="dialog"], [role="menu"], .switcher-backdrop');
}

/** A plain character key (no Ctrl/Alt/⌘), which should go into the message box. */
export function isPrintable(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
}

/** Esc: the open channel counts as read (Shift+Esc: the whole community), and the chat jumps to the end. */
function markRead(wholeCommunity: boolean): boolean {
  if (useRiver.getState().section !== 'communities') return false;
  const s = useCommunity.getState();
  const community = s.communities.find((c) => c.id === s.selectedCommunity);
  if (!community || !s.selectedChannel) return false;
  s.markChannelsRead(wholeCommunity ? community.channels.map((c) => c.id) : [s.selectedChannel]);
  useCommunity.setState({ divider: null });
  const log = document.querySelector('.chat__messages');
  if (log) log.scrollTop = log.scrollHeight;
  return true;
}

function rank(t: Target, q: string): number {
  const label = t.label.toLowerCase();
  if (!q) return t.hint.endsWith('unread') ? 0 : 1;
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.includes(q)) return 2;
  if (t.hint.toLowerCase().includes(q)) return 3;
  return -1;
}

/**
 * Ctrl+K: type part of a channel, a person or a section and press Enter.
 * Also Ctrl+/ for the list of keyboard shortcuts.
 */
export function QuickSwitcher(): ReactElement | null {
  const [open, setOpen] = useState<'switcher' | 'shortcuts' | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault();
        setOpen((o) => (o === 'switcher' ? null : 'switcher'));
      } else if (mod && e.code === 'Slash') {
        e.preventDefault();
        setOpen((o) => (o === 'shortcuts' ? null : 'shortcuts'));
      } else if (mod && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (stepCommunity(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (stepChannel(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey)) e.preventDefault();
      } else if (mod && !e.altKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        // Interface size, like a browser: Ctrl+= bigger, Ctrl+− smaller, Ctrl+0 back to normal.
        e.preventDefault();
        const current = useRiver.getState().settings?.appearance.zoom ?? 1;
        const next = e.key === '0' ? 1 : nextZoom(current, e.key === '-' ? -1 : 1);
        void useRiver.getState().updateSettings({ appearance: { zoom: next } });
      } else if (mod && !e.shiftKey && e.code === 'KeyF' && useRiver.getState().section === 'communities') {
        e.preventDefault();
        useCommunity.setState({ showSearch: true });
      } else if (e.key === 'Escape' && !typingSomewhere(e.target) && !somethingOpen()) {
        // After this key press is fully handled, so other Esc handlers are never disturbed.
        const whole = e.shiftKey;
        window.setTimeout(() => markRead(whole), 0);
      } else if (isPrintable(e) && !typingSomewhere(e.target)) {
        // Start typing anywhere: the letters go into the message box, like on Discord.
        const box = document.querySelector<HTMLTextAreaElement>('.chat__composer textarea');
        if (box && !box.disabled) box.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (open === 'switcher') return <Switcher onClose={() => setOpen(null)} />;
  if (open === 'shortcuts') return <Shortcuts onClose={() => setOpen(null)} />;
  return null;
}

function Switcher({ onClose }: { onClose(): void }): ReactElement {
  const targets = useTargets();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const results = targets
    .map((t) => ({ t, r: rank(t, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, 12)
    .map((x) => x.t);
  const active = Math.min(index, Math.max(results.length - 1, 0));
  const choose = (t: Target | undefined): void => {
    if (!t) return;
    onClose();
    t.go();
  };
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div className="switcher-backdrop" onMouseDown={onClose}>
      <div
        className="switcher glass"
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="switcher__input"
          role="combobox"
          aria-expanded="true"
          aria-controls="switcher-results"
          aria-activedescendant={results[active] ? `switch-${results[active]!.key}` : undefined}
          placeholder="Where would you like to go?"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setIndex((active + d + results.length) % Math.max(results.length, 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === 'Escape') onClose();
          }}
        />
        <div className="switcher__results" id="switcher-results" role="listbox" ref={listRef}>
          {results.length === 0 && <p className="muted small switcher__empty">Nothing matches “{query}”.</p>}
          {results.map((t, i) => (
            <button
              key={t.key}
              id={`switch-${t.key}`}
              role="option"
              aria-selected={i === active}
              className={`switcher__item ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(t)}
            >
              <span className="switcher__symbol" aria-hidden="true">
                {t.symbol}
              </span>
              <span className="switcher__label">{t.label}</span>
              <span className="switcher__hint">{t.hint}</span>
            </button>
          ))}
        </div>
        <p className="switcher__tip muted small">
          ↑ ↓ to move · Enter to open · Esc to close · Ctrl+/ for all shortcuts
        </p>
      </div>
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl+K', 'Quick switcher: jump to a channel, person or section'],
  ['Ctrl+/', 'Show these shortcuts'],
  ['Alt+↑ / Alt+↓', 'Previous / next channel'],
  ['Alt+Shift+↑ / Alt+Shift+↓', 'Previous / next unread channel'],
  ['Ctrl+Alt+↑ / Ctrl+Alt+↓', 'Previous / next community'],
  ['Ctrl+F', 'Search the community'],
  ['Ctrl+= / Ctrl+− / Ctrl+0', 'Make everything bigger / smaller / normal size'],
  ['Esc', 'Mark the channel read and jump to the newest message'],
  ['Shift+Esc', 'Mark the whole community read'],
  ['Any letter', 'Start typing a message (from anywhere in the channel)'],
  ['Enter', 'Send the message'],
  ['Shift+Enter', 'New line'],
  ['↑ (empty message box)', 'Edit your last message'],
  ['Tab or Enter', 'Accept a @mention or #channel suggestion'],
  ['Esc (while writing)', 'Cancel a reply, close a dialog or panel'],
  ['Ctrl+Shift+M', 'Mute or unmute your microphone'],
  ['Ctrl+Shift+D', 'Deafen or undeafen'],
  ['Push-to-talk key', 'Talk while held (set in User settings → Voice)'],
  ['F or double-click a video', 'Fullscreen in a call'],
];

function Shortcuts({ onClose }: { onClose(): void }): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="switcher-backdrop" onMouseDown={onClose}>
      <div
        className="switcher shortcuts glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-title" className="card__title">
          Keyboard shortcuts
        </h2>
        <dl className="shortcuts__list" tabIndex={0} aria-label="Shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="shortcuts__row">
              <dt>
                {keys.split(' / ').map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' / '}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <button className="btn btn--ghost btn--small" autoFocus onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
