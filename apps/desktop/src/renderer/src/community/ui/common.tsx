import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { msg, tr } from '../../i18n.ts';
import { createPortal } from 'react-dom';
import { placeWithin, pushOverlay, safeInsets, visibleBox } from '../../components/overlays.ts';
import { menuItems, nextMenuItem, restoreFocus, trapTab } from '../../components/focus.ts';
import { phoneShellActive } from '../../phone/mode.ts';
import type { CommunityView, MemberView } from '../../../../shared/ipc.ts';
import { highlight, languageOf } from './highlight.ts';
import {
  favoriteEmoji,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
  toggleFavoriteEmoji,
  useEmojiIndex,
} from '../emoji-data.ts';
import { openMessageLink } from '../message-link.ts';
import { openLinkSheet } from '../../components/link-sheet-store.ts';
import { shortLink } from '../../components/message-kinds.ts';
import { useCommunity } from '../store.ts';

// ---- helpers -------------------------------------------------------------------------------------

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export const can = (perms: number, p: number): boolean => (perms & p) === p;

/** Stable pleasant colour for people without an avatar. */
export function hueOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Relative luminance (WCAG) of an HSL colour; s and l from 0 to 1. */
function luminanceOf(h: number, s: number, l: number): number {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

/** Someone's picture colour when they have none: their own hue, dark enough for white initials (WCAG AA). */
export function avatarColor(id: string): string {
  const h = hueOf(id);
  let l = 42;
  while (l > 20 && 1.05 / (luminanceOf(h, 0.55, l / 100) + 0.05) < 4.6) l -= 2;
  return `hsl(${h} 55% ${l}%)`;
}

export function memberOf(community: CommunityView | null | undefined, id: string): MemberView | undefined {
  return community?.members.find((m) => m.riverId === id);
}

export function nameOf(community: CommunityView | null | undefined, id: string): string {
  return memberOf(community, id)?.name ?? 'Someone';
}

// ---- avatar --------------------------------------------------------------------------------------

export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export const PRESENCE_LABEL: Record<Presence, string> = {
  online: msg('Online'),
  idle: msg('Idle'),
  dnd: msg('Do Not Disturb'),
  offline: msg('Offline'),
};

/** How a member appears: offline, or online / idle / do not disturb. */
export function presenceOf(m: Pick<MemberView, 'online' | 'status'>): Presence {
  return m.online ? (m.status ?? 'online') : 'offline';
}

/** "🎮 Playing late tonight" — a member's custom status, if any. */
export function CustomStatus({ member }: { member: Pick<MemberView, 'customStatus'> }): ReactElement | null {
  const c = member.customStatus;
  if (!c) return null;
  return (
    <span className="custom-status" title={`${c.emoji} ${c.text}`.trim()}>
      {c.emoji && <span className="custom-status__emoji">{c.emoji}</span>}
      {c.text}
    </span>
  );
}

/** True when the user asked for less motion and this picture is an animated GIF (1.0.34, 1.0.38). */
export function holdStill(src: string): boolean {
  return src.startsWith('data:image/gif') && document.documentElement.dataset.motion === 'reduced';
}

/**
 * The first frame of an animated picture, for people who asked for less motion.
 * With `size`, a square cover crop (avatars); without, the picture's own shape.
 */
export function StillPicture(props: {
  src: string;
  size?: number;
  className?: string;
  label?: string;
}): ReactElement {
  const { src, size } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const bytes = Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    void createImageBitmap(new Blob([bytes], { type: 'image/gif' }))
      .then((bitmap) => {
        const canvas = ref.current;
        if (alive && canvas) {
          if (size === undefined) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          } else {
            // Cover the square like object-fit: cover.
            const side = Math.min(bitmap.width, bitmap.height);
            canvas
              .getContext('2d')
              ?.drawImage(
                bitmap,
                (bitmap.width - side) / 2,
                (bitmap.height - side) / 2,
                side,
                side,
                0,
                0,
                canvas.width,
                canvas.height,
              );
          }
        }
        bitmap.close();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [src, size]);
  const px = size === undefined ? undefined : Math.round(size * (window.devicePixelRatio || 1));
  return (
    <canvas
      ref={ref}
      width={px}
      height={px}
      className={props.className}
      {...(props.label
        ? { role: 'img', 'aria-label': props.label, title: props.label }
        : { 'aria-hidden': true })}
    />
  );
}

export function Avatar(props: {
  id: string;
  name: string;
  avatar?: string | null;
  size?: number;
  status?: Presence | null;
  speaking?: boolean;
}): ReactElement {
  const size = props.size ?? 32;
  return (
    <span
      className={`avatar ${props.speaking ? 'is-speaking' : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {props.avatar ? (
        holdStill(props.avatar) ? (
          <StillPicture src={props.avatar} size={size} />
        ) : (
          <img src={props.avatar} alt="" draggable={false} />
        )
      ) : (
        <span className="avatar__fallback" style={{ background: avatarColor(props.id) }}>
          {initials(props.name)}
        </span>
      )}
      {props.status && (
        <span
          className={`avatar__status avatar__status--${props.status}`}
          role="img"
          aria-label={tr(PRESENCE_LABEL[props.status])}
          title={tr(PRESENCE_LABEL[props.status])}
        />
      )}
    </span>
  );
}

// ---- modal ----------------------------------------------------------------------------------------

/**
 * Closes this overlay on Escape (or the phone's Back button) only while it is the topmost one
 * (components/overlays.ts), so one key press never closes a dialog and the menu above it at once.
 */
export function useOverlayLayer(onClose: () => void): void {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    const layer = pushOverlay(() => latest.current());
    return () => layer.remove();
  }, []);
}

/**
 * Dialogs, menus and pickers render into <body> (2.10.12): not inside a message, whose swipe
 * transform would move them and whose touch gestures would also fire under them, and above
 * everything else on screen (a full-screen call too). Open ones are registered here so a panel
 * knows what was opened from inside it (a picker from a menu stays "inside" it).
 */
interface Layer {
  parent: number | null;
  kind: 'popover' | 'modal';
  el(): HTMLElement | null;
  close(): void;
}
const layers = new Map<number, Layer>();
let layerIds = 0;
const LayerParent = createContext<number | null>(null);

function ancestorsOf(id: number | null): Set<number> {
  const out = new Set<number>();
  for (let at = id; at !== null && !out.has(at); at = layers.get(at)?.parent ?? null) out.add(at);
  return out;
}

/** True when `target` is inside layer `id` or anything opened from it. */
function insideLayer(id: number, target: Node): boolean {
  for (const [other, layer] of layers) {
    if ((other === id || ancestorsOf(layer.parent).has(id)) && layer.el()?.contains(target)) return true;
  }
  return false;
}

function useLayer(kind: Layer['kind'], el: () => HTMLElement | null, onClose: () => void): number {
  const parent = useContext(LayerParent);
  const [id] = useState(() => ++layerIds);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useLayoutEffect(() => {
    if (kind === 'popover') {
      // One menu at a time: opening one closes the others, except the ones it was opened from.
      const keep = ancestorsOf(parent);
      for (const [other, layer] of [...layers]) {
        if (layer.kind === 'popover' && !keep.has(other)) layer.close();
      }
    }
    layers.set(id, { parent, kind, el, close: () => latest.current() });
    return () => {
      layers.delete(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return id;
}

/** The control that was just clicked (to tell which button opened a popover). */
let lastClick: { target: Element; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof Element) lastClick = { target: e.target, at: performance.now() };
    },
    true,
  );
}

/** Swallows the click that follows a press on `el` (that press closed the popover `el` opens). */
function swallowClickOn(el: Element): void {
  const done = (): void => {
    window.removeEventListener('click', stop, true);
    window.clearTimeout(timer);
  };
  const stop = (e: MouseEvent): void => {
    done();
    if (!el.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const timer = window.setTimeout(done, 800);
  window.addEventListener('click', stop, true);
}

export function Modal(props: {
  title?: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
  full?: boolean;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useOverlayLayer(props.onClose);
  const id = useLayer('modal', () => ref.current, props.onClose);
  // Keyboard (2.13.1): the dialog takes the focus (unless a field in it already did), Tab stays
  // inside it, and closing it gives the focus back to what had it before.
  useEffect(() => {
    const root = ref.current;
    const card = cardRef.current;
    if (!root || !card) return;
    const previous = document.activeElement;
    if (!card.contains(document.activeElement)) card.focus({ preventScroll: true });
    // Native, not React's: keys in a menu opened from this dialog (another portal) are its own.
    const onKey = (e: KeyboardEvent): void => {
      if (trapTab(card, e)) e.preventDefault();
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      restoreFocus(previous, root);
    };
  }, []);
  return createPortal(
    <LayerParent.Provider value={id}>
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onMouseDown={props.onClose}
      >
        <div
          ref={cardRef}
          tabIndex={-1}
          className={`modal__card ${props.wide ? 'modal__card--wide' : ''} ${props.full ? 'modal__card--full' : ''} ${props.className ?? ''}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {props.title && (
            <header className="modal__head">
              <h2>{props.title}</h2>
              <button className="icon-btn" aria-label="Close" onClick={props.onClose}>
                <XIcon />
              </button>
            </header>
          )}
          {props.children}
        </div>
      </div>
    </LayerParent.Provider>,
    document.body,
  );
}

// ---- popover / context menu ----------------------------------------------------------------------

/**
 * A floating panel at a screen position. It stays inside the visible screen (above the phone's
 * keyboard, clear of the notch), scrolls when taller than that, and closes on Escape, a press
 * outside it (pressing the button that opened it closes it too), scrolling what is under it, or
 * another menu opening.
 */
export function Popover(props: {
  x: number;
  y: number;
  onClose(): void;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>({
    left: props.x,
    top: props.y,
  });
  const latest = useRef(props.onClose);
  useEffect(() => {
    latest.current = props.onClose;
  });
  useOverlayLayer(props.onClose);
  const id = useLayer('popover', () => ref.current, props.onClose);
  // The button that opened this popover (clicked just now), if any.
  const anchor = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (lastClick && performance.now() - lastClick.at < 300) {
      anchor.current = lastClick.target.closest('button, [role="button"], a');
    }
  }, []);
  useLayoutEffect(() => {
    const place = (): void => {
      const el = ref.current;
      if (!el) return;
      const view = visibleBox();
      const insets = safeInsets();
      // Measure at the tallest it may be, then place it.
      el.style.maxHeight = `${placeWithin(0, 0, { width: 0, height: 0 }, view, insets).maxHeight}px`;
      // Its own size, not the one it has while its opening animation scales it.
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const next = placeWithin(props.x, props.y, size, view, insets);
      el.style.maxHeight = `${next.maxHeight}px`;
      setPos((p) =>
        p.left === next.left && p.top === next.top && p.maxHeight === next.maxHeight ? p : next,
      );
    };
    place();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    // A menu that grows (a section opening inside it, e.g. "Mute ▸") stays on the screen.
    const grow = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    if (ref.current) grow?.observe(ref.current);
    return () => {
      vv?.removeEventListener('resize', place);
      grow?.disconnect();
    };
  }, [props.x, props.y]);
  // Keyboard (2.13.1): a menu's first item takes the focus (computers; a field that focused itself
  // keeps it), and closing gives the focus back to the button or field that had it.
  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement;
    if (el && !el.contains(document.activeElement) && !phoneShellActive()) {
      menuItems(el)[0]?.focus({ preventScroll: true });
    }
    return () => restoreFocus(previous, el);
  }, []);
  useEffect(() => {
    const openedAt = performance.now();
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (insideLayer(id, target)) return;
      // A press on the button that opened it closes it, and that button's click must not reopen it.
      if (anchor.current?.isConnected && anchor.current.contains(target)) swallowClickOn(anchor.current);
      latest.current();
    };
    // Only the reader scrolling away closes it (wheel, finger): not River scrolling the chat to a
    // new message, an image loading, or the phone keyboard opening (2.10.13).
    const onUserScroll = (e: Event): void => {
      // Settling in (focus, layout) right after opening is not the reader scrolling away.
      if (performance.now() - openedAt < 300) return;
      const target = e.target;
      if (target instanceof Node && insideLayer(id, target)) return;
      latest.current();
    };
    const t = window.setTimeout(() => {
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('wheel', onUserScroll, { capture: true, passive: true });
      window.addEventListener('touchmove', onUserScroll, { capture: true, passive: true });
    });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onUserScroll, true);
      window.removeEventListener('touchmove', onUserScroll, true);
    };
  }, [id]);
  return createPortal(
    <LayerParent.Provider value={id}>
      <div
        ref={ref}
        className={`popover ${props.className ?? ''}`}
        style={pos}
        role="menu"
        onKeyDown={(e) => {
          // Up, Down, Home and End move between the menu's items (not inside a text field).
          if (!(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'menuitem') return;
          const next = nextMenuItem(menuItems(e.currentTarget), e.target, e.key);
          if (!next) return;
          e.preventDefault();
          next.focus();
        }}
      >
        {props.children}
      </div>
    </LayerParent.Provider>,
    document.body,
  );
}

export function MenuItem(props: {
  onClick(): void;
  children: ReactNode;
  danger?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      className={`menu-item ${props.danger ? 'menu-item--danger' : ''}`}
      role="menuitem"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon && <span className="menu-item__icon">{props.icon}</span>}
      <span>{props.children}</span>
    </button>
  );
}

export function Toggle(props: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  help?: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <label className={`toggle-row ${props.disabled ? 'is-disabled' : ''}`}>
      <span className="toggle-row__text">
        <span className="toggle-row__label">{props.label}</span>
        {props.help && <span className="toggle-row__help">{props.help}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

// ---- emoji -----------------------------------------------------------------------------------------

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export function EmojiPicker(props: {
  onPick(emoji: string): void;
  /** The community's custom emoji, shown first (1.0.19). */
  custom?: Array<{ id: string; name: string; image: string }>;
}): ReactElement {
  const index = useEmojiIndex();
  const custom = props.custom ?? [];
  const [query, setQuery] = useState('');
  const recent = useMemo(() => recentEmoji(), []);
  const [favorites, setFavorites] = useState(() => favoriteEmoji());
  // -3: favourites, -2: the community's own emoji, -1: recently used, 0…: Unicode categories.
  const [group, setGroup] = useState(
    favorites.length > 0 ? -3 : custom.length > 0 ? -2 : recent.length > 0 ? -1 : 0,
  );
  const labelOf = (e: string): string => index?.all.find((x) => x.emoji === e)?.label ?? e;
  const favorite = (e: ReactMouseEvent, emoji: string): void => {
    e.preventDefault();
    setFavorites(toggleFavoriteEmoji(emoji));
  };
  const pick = (emoji: string): void => {
    rememberEmoji(emoji);
    props.onPick(emoji);
  };
  const q = query.trim().toLowerCase().replace(/:/g, '');
  const customMatches = q ? custom.filter((e) => e.name.toLowerCase().includes(q)) : [];
  const results = index && query ? searchEmoji(index, query) : null;
  const shown: Array<{ emoji: string; label: string }> = results
    ? results
    : group === -1
      ? recent.map((e) => ({ emoji: e, label: labelOf(e) }))
      : group === -3
        ? favorites.map((e) => ({ emoji: e, label: labelOf(e) }))
        : group === -2
          ? []
          : (index?.groups[group]?.items ?? []);
  const customShown = results ? customMatches : group === -2 ? custom : [];
  const heading = results
    ? results.length + customMatches.length
      ? `Results for “${query}”`
      : `No emoji match “${query}”`
    : group === -2
      ? 'This community'
      : group === -1
        ? 'Recently used'
        : group === -3
          ? `Favourites — ${phoneShellActive() ? 'long-press' : 'right-click'} to remove`
          : (index?.groups[group]?.name ?? 'Loading…');
  const first = customMatches[0] ? customEmojiText(customMatches[0]) : results?.[0]?.emoji;
  return (
    <div className="emoji-picker">
      <input
        className="emoji-picker__search"
        placeholder="Search emoji"
        aria-label="Search emoji"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && first) {
            e.preventDefault();
            pick(first);
          }
        }}
      />
      {!query && (
        <div className="emoji-picker__tabs" role="tablist" aria-label="Emoji categories">
          {favorites.length > 0 && (
            <button
              role="tab"
              aria-selected={group === -3}
              className={`emoji-picker__tab ${group === -3 ? 'is-active' : ''}`}
              title="Favourites"
              onClick={() => setGroup(-3)}
            >
              ⭐
            </button>
          )}
          {custom.length > 0 && (
            <button
              role="tab"
              aria-selected={group === -2}
              className={`emoji-picker__tab ${group === -2 ? 'is-active' : ''}`}
              title="This community"
              onClick={() => setGroup(-2)}
            >
              <img className="custom-emoji" src={custom[0]!.image} alt="" />
            </button>
          )}
          {recent.length > 0 && (
            <button
              role="tab"
              aria-selected={group === -1}
              className={`emoji-picker__tab ${group === -1 ? 'is-active' : ''}`}
              title="Recently used"
              onClick={() => setGroup(-1)}
            >
              🕘
            </button>
          )}
          {(index?.groups ?? []).map((g, i) => (
            <button
              key={g.name}
              role="tab"
              aria-selected={i === group}
              className={`emoji-picker__tab ${i === group ? 'is-active' : ''}`}
              title={g.name}
              onClick={() => setGroup(i)}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-picker__label">{heading}</div>
      <div className="emoji-picker__grid">
        {customShown.map((e) => (
          <button
            key={e.id}
            className="emoji-picker__emoji"
            title={`:${e.name}: — right-click to ${favorites.includes(customEmojiText(e)) ? 'unfavourite' : 'favourite'}`}
            aria-label={`:${e.name}:`}
            onClick={() => pick(customEmojiText(e))}
            onContextMenu={(ev) => favorite(ev, customEmojiText(e))}
          >
            <img className="custom-emoji" src={e.image} alt="" />
          </button>
        ))}
        {shown.map((e) => (
          <button
            key={e.emoji}
            className="emoji-picker__emoji"
            title={`${e.label} — right-click to ${favorites.includes(e.emoji) ? 'unfavourite' : 'favourite'}`}
            aria-label={`${e.label}${favorites.includes(e.emoji) ? ', favourite' : ''}`}
            onClick={() => pick(e.emoji)}
            onContextMenu={(ev) => favorite(ev, e.emoji)}
          >
            {/* Recently used and favourites may hold custom emoji too. */}
            <EmojiGlyph emoji={e.emoji} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- custom emoji (1.0.19) -------------------------------------------------------------------------

/** `<:name:id>` — a community's custom emoji in text or a reaction. */
export const CUSTOM_EMOJI = /^<a?:([A-Za-z0-9_]{2,32}):([A-Za-z0-9_-]{22})>$/;
export const customEmojiText = (e: { name: string; id: string }): string => `<:${e.name}:${e.id}>`;

/** A custom emoji's picture, from any community you are in; ":name:" while unknown. */
export function CustomEmoji({ name, id, big }: { name: string; id: string; big?: boolean }): ReactElement {
  const image = useCommunity((s) => {
    for (const list of Object.values(s.emojis)) {
      const found = list.find((e) => e.id === id);
      if (found) return found.image;
    }
    return null;
  });
  if (!image) return <span className="custom-emoji--missing">:{name}:</span>;
  if (holdStill(image))
    return (
      <StillPicture
        src={image}
        className={`custom-emoji ${big ? 'custom-emoji--big' : ''}`}
        label={`:${name}:`}
      />
    );
  return (
    <img
      className={`custom-emoji ${big ? 'custom-emoji--big' : ''}`}
      src={image}
      alt={`:${name}:`}
      title={`:${name}:`}
      draggable={false}
    />
  );
}

/** A reaction's emoji: Unicode as text, a custom one as its picture. */
export function EmojiGlyph({ emoji }: { emoji: string }): ReactElement {
  const m = CUSTOM_EMOJI.exec(emoji);
  return m ? <CustomEmoji name={m[1]!} id={m[2]!} /> : <>{emoji}</>;
}

// ---- safe message formatting ------------------------------------------------------------------------

/**
 * Discord-style Markdown rendered to React elements (never HTML strings):
 * ```lang code blocks``` (highlighted, with Copy), `code`, **bold**, *italic*,
 * __underline__, ~~strike~~, ||spoilers||, # headings, -# subtext, > quotes,
 * - and 1. lists, links and [masked](https://…) links (opened only after a
 * confirmation that shows the real address), <t:unix:F> timestamps, \escapes
 * and @mentions / #channels.
 */
/** Roles and channels a message can mention, for highlighting and navigation. */
export interface MentionRefs {
  roles: Array<{ name: string; color: number; mine: boolean; members?: number; icon?: string | null }>;
  channels: Array<{ id: string; name: string }>;
  onChannel?(id: string): void;
}

interface InlineCtx {
  names: string[];
  me: string | null;
  refs?: MentionRefs | undefined;
}

export function RichText(props: {
  text: string;
  names: string[];
  me: string | null;
  refs?: MentionRefs;
}): ReactElement {
  const ctx: InlineCtx = { names: props.names, me: props.me, refs: props.refs };
  const blocks = props.text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {blocks.map((block, i) =>
        block.startsWith('```') && block.endsWith('```') && block.length >= 6 ? (
          <CodeBlock key={i} raw={block.slice(3, -3)} />
        ) : (
          <Lines key={i} text={block} ctx={ctx} keyBase={String(i)} />
        ),
      )}
    </>
  );
}

function CodeBlock({ raw }: { raw: string }): ReactElement {
  const firstLine = /^([\w+#-]{1,20})\n/.exec(raw);
  const lang = firstLine ? languageOf(firstLine[1]!) : null;
  const code = (firstLine ? raw.slice(firstLine[0].length) : raw.replace(/^\n/, '')).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-codeblock-wrap">
      <pre className="md-codeblock">
        <code>
          {highlight(code, lang).map((t, i) =>
            t.kind === 'plain' ? (
              t.text
            ) : (
              <span key={i} className={`hl-${t.kind}`}>
                {t.text}
              </span>
            ),
          )}
        </code>
      </pre>
      <button
        type="button"
        className="md-codeblock__copy"
        aria-label="Copy code"
        onClick={() =>
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

type Line =
  | { kind: 'text' | 'quote' | 'subtext'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'ul' | 'ol'; items: string[]; start: number };

/** Groups a text block into lines, headings, quotes and lists. */
export function parseLines(text: string): Line[] {
  const out: Line[] = [];
  for (const line of text.split('\n')) {
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    const bullet = /^\s*[-*] (.+)$/.exec(line);
    const numbered = /^\s*(\d{1,4})\. (.+)$/.exec(line);
    const last = out.at(-1);
    if (heading) out.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
    else if (line.startsWith('-# ')) out.push({ kind: 'subtext', text: line.slice(3) });
    else if (line.startsWith('> ')) out.push({ kind: 'quote', text: line.slice(2) });
    else if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1]!);
      else out.push({ kind: 'ul', items: [bullet[1]!], start: 1 });
    } else if (numbered) {
      if (last?.kind === 'ol') last.items.push(numbered[2]!);
      else out.push({ kind: 'ol', items: [numbered[2]!], start: Number(numbered[1]) });
    } else out.push({ kind: 'text', text: line });
  }
  return out;
}

function Lines({ text, ctx, keyBase }: { text: string; ctx: InlineCtx; keyBase: string }): ReactElement {
  const lines = parseLines(text);
  return (
    <>
      {lines.map((line, j) => {
        const k = `${keyBase}-${j}`;
        const content = (t: string, sub = ''): ReactNode[] => inline(t, ctx, `${k}${sub}`);
        switch (line.kind) {
          case 'heading':
            return (
              <div key={k} role="heading" aria-level={line.level + 2} className={`md-h md-h${line.level}`}>
                {content(line.text)}
              </div>
            );
          case 'subtext':
            return (
              <div key={k} className="md-subtext">
                {content(line.text)}
              </div>
            );
          case 'quote':
            return (
              <blockquote key={k} className="md-quote">
                {content(line.text)}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={k} className="md-list">
                {line.items.map((it, n) => (
                  <li key={n}>{content(it, `-${n}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={k} className="md-list" start={line.start}>
                {line.items.map((it, n) => (
                  <li key={n}>{content(it, `-${n}`)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <span key={k}>
                {content(line.text)}
                {j < lines.length - 1 && lines[j + 1]!.kind === 'text' && <br />}
              </span>
            );
        }
      })}
    </>
  );
}

// #channel names in any of River's languages (Cyrillic, Greek, accented Latin): not only [\w-].
const INLINE =
  /(<a?:[A-Za-z0-9_]{2,32}:[A-Za-z0-9_-]{22}>|\\[\\*_~|`>#\-[\]()@<]|`[^`\n]+`|\|\|[^|\n]+\|\||\[[^\]\n]{1,200}\]\((?:https?:\/\/|mailto:|tel:)[^\s)]{1,2000}\)|https?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?]|mailto:[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+|tel:\+?[0-9][0-9.-]{2,30}[0-9]|<t:\d{1,12}(?::[tTdDfFR])?>|\*\*\*[^*\n]+\*\*\*|\*\*(?:[^*\n]|\*[^*\n]+\*)+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|@everyone|@here|@[^\s@]+(?: [^\s@]+)?|#[\w\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f\u0370-\u03ff\u0400-\u052f-]+)/g;

export function openLink(url: string): void {
  // A link to a River message opens it here; anything else goes to the browser (or, for mailto:
  // and tel:, the mail or phone app) after a confirmation in main, which allows only safe links.
  if (openMessageLink(url)) return;
  void window.river.links.openUrl(url);
}

/**
 * A link in a message (2.19): long web addresses show shortened, the whole address on hover and in
 * the sheet a right-click or long-press opens (gestures.ts finds links by data-link).
 */
function MessageLinkAnchor(props: { url: string; children?: ReactNode }): ReactElement {
  const shown =
    props.children ??
    (props.url.startsWith('http') ? shortLink(props.url) : props.url.replace(/^(mailto|tel):/, ''));
  return (
    <a
      href={props.url}
      className="md-link"
      data-link={props.url}
      title={props.url}
      onClick={(e) => {
        e.preventDefault();
        openLink(props.url);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openLinkSheet(props.url, e.clientX, e.clientY);
      }}
    >
      {shown}
    </a>
  );
}

function Spoiler({ children }: { children: ReactNode }): ReactElement {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`md-spoiler ${shown ? 'is-shown' : ''}`}
      role={shown ? undefined : 'button'}
      tabIndex={shown ? undefined : 0}
      aria-label={shown ? undefined : 'Spoiler, press to reveal'}
      onClick={() => setShown(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setShown(true);
        }
      }}
    >
      <span aria-hidden={!shown}>{children}</span>
    </span>
  );
}

/** <t:unix:style> as Discord renders it, in the reader's own locale and time zone. */
export function formatTimestamp(unix: number, style: string, now = Date.now()): string {
  const d = new Date(unix * 1000);
  switch (style) {
    case 't':
      return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    case 'T':
      return d.toLocaleTimeString();
    case 'd':
      return d.toLocaleDateString();
    case 'D':
      return d.toLocaleDateString(undefined, { dateStyle: 'long' });
    case 'F':
      return d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
    case 'R': {
      const secs = Math.round((unix * 1000 - now) / 1000);
      const abs = Math.abs(secs);
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      if (abs < 60) return rtf.format(secs, 'second');
      if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(secs / 3600), 'hour');
      if (abs < 86400 * 30) return rtf.format(Math.round(secs / 86400), 'day');
      if (abs < 86400 * 365) return rtf.format(Math.round(secs / (86400 * 30)), 'month');
      return rtf.format(Math.round(secs / (86400 * 365)), 'year');
    }
    default:
      return d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  }
}

function inline(text: string, ctx: InlineCtx, key: string): ReactNode[] {
  const { names, me, refs } = ctx;
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    const custom = CUSTOM_EMOJI.exec(token);
    if (custom)
      out.push(<CustomEmoji key={k} name={custom[1]!} id={custom[2]!} big={text.trim() === token} />);
    else if (token.startsWith('\\')) out.push(token.slice(1));
    else if (token.startsWith('`'))
      out.push(
        <code key={k} className="md-code">
          {token.slice(1, -1)}
        </code>,
      );
    else if (token.startsWith('||'))
      out.push(<Spoiler key={k}>{inline(token.slice(2, -2), ctx, `${k}s`)}</Spoiler>);
    else if (token.startsWith('[')) {
      const label = token.slice(1, token.indexOf(']('));
      const url = token.slice(token.indexOf('](') + 2, -1);
      out.push(
        <MessageLinkAnchor key={k} url={url}>
          {label}
        </MessageLinkAnchor>,
      );
    } else if (token.startsWith('http') || token.startsWith('mailto:') || token.startsWith('tel:')) {
      out.push(<MessageLinkAnchor key={k} url={token} />);
    } else if (token.startsWith('<t:')) {
      const [, unix, style] = /^<t:(\d+)(?::(\w))?>$/.exec(token)!;
      const date = new Date(Number(unix) * 1000);
      out.push(
        <time key={k} className="md-time" dateTime={date.toISOString()} title={date.toLocaleString()}>
          {formatTimestamp(Number(unix), style ?? 'f')}
        </time>,
      );
    } else if (token.startsWith('***'))
      out.push(
        <strong key={k}>
          <em>{inline(token.slice(3, -3), ctx, `${k}bi`)}</em>
        </strong>,
      );
    else if (token.startsWith('**'))
      out.push(<strong key={k}>{inline(token.slice(2, -2), ctx, `${k}b`)}</strong>);
    else if (token.startsWith('__')) out.push(<u key={k}>{inline(token.slice(2, -2), ctx, `${k}u`)}</u>);
    else if (token.startsWith('~~')) out.push(<s key={k}>{inline(token.slice(2, -2), ctx, `${k}x`)}</s>);
    else if (token.startsWith('*') || token.startsWith('_'))
      out.push(<em key={k}>{inline(token.slice(1, -1), ctx, `${k}i`)}</em>);
    else if (token.startsWith('#')) {
      const channel = refs?.channels.find((c) => c.name.toLowerCase() === token.slice(1).toLowerCase());
      if (channel && refs?.onChannel) {
        out.push(
          <button
            key={k}
            type="button"
            className="mention mention--channel"
            onClick={() => refs.onChannel!(channel.id)}
          >
            #{channel.name}
          </button>,
        );
      } else out.push(token);
    } else if (token.startsWith('@') && refs && mentionedRole(token.slice(1), refs)) {
      const raw = token.slice(1);
      const role = mentionedRole(raw, refs)!;
      const rest = raw.slice(role.name.length);
      out.push(
        <span
          key={k}
          tabIndex={0}
          className={`mention mention--role ${role.mine ? 'mention--me' : ''}`}
          style={role.color ? ({ '--role': hex(role.color) } as CSSProperties) : undefined}
          title={`${role.icon ? `${role.icon} ` : ''}${role.name} — a role${
            role.members !== undefined ? ` · ${role.members} member${role.members === 1 ? '' : 's'}` : ''
          }${role.mine ? ' · you have it' : ''}`}
        >
          @{role.name}
        </span>,
      );
      if (rest) out.push(rest);
    } else if (token.startsWith('@')) {
      const raw = token.slice(1);
      const special = raw === 'everyone' || raw === 'here';
      // Two-word mention only when it is a real member name; otherwise give the second word back.
      const full = names.find((nm) => nm.toLowerCase() === raw.toLowerCase());
      const single = names.find((nm) => nm.toLowerCase() === raw.split(' ')[0]!.toLowerCase());
      if (special || full) {
        const mine = special || (me !== null && raw.toLowerCase() === me.toLowerCase());
        out.push(
          <span key={k} className={`mention ${mine ? 'mention--me' : ''}`}>
            @{full ?? raw}
          </span>,
        );
      } else if (single) {
        const rest = raw.slice(single.length);
        const mine = me !== null && single.toLowerCase() === me.toLowerCase();
        out.push(
          <span key={k} className={`mention ${mine ? 'mention--me' : ''}`}>
            @{single}
          </span>,
        );
        if (rest) out.push(rest);
      } else out.push(token);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---- icons ------------------------------------------------------------------------------------------

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);
export const MicOffIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" />
  </Svg>
);
export const HeadphonesIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3" y="14" width="4" height="7" rx="1.5" />
    <rect x="17" y="14" width="4" height="7" rx="1.5" />
  </Svg>
);
export const HeadphonesOffIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4 15v-3a8 8 0 0 1 12.5-6.6M20 12v3" />
    <rect x="3" y="14" width="4" height="7" rx="1.5" />
    <rect x="17" y="14" width="4" height="7" rx="1.5" />
    <path d="M3 3l18 18" />
  </Svg>
);
export const GearIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </Svg>
);
export const HashIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18" />
  </Svg>
);
export const SpeakerIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
);
export const PinIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v8" />
  </Svg>
);
export const ReplyIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6v4" />
  </Svg>
);
export const EditIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
  </Svg>
);
export const TrashIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const SmileIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </Svg>
);
export const UserPlusIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21v-1a7 7 0 0 1 11-5.7" />
    <path d="M19 14v6M16 17h6" />
  </Svg>
);
export const UsersIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
  </Svg>
);
export const PlusIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const XIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const ChevronIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const CrownIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z" />
  </Svg>
);
export const ScreenIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
export const CameraIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </Svg>
);
export const PhoneIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  </Svg>
);
export const PhoneOffIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4.5 13.5c4.2-4 10.8-4 15 0l-1.8 2.4-3-1.1v-2.4a9 9 0 0 0-5.4 0v2.4l-3 1.1-1.8-2.4Z" />
  </Svg>
);
export const LockSmallIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const DoorIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M14 4h5v16h-5M10 12h9M7 9l-3 3 3 3" />
  </Svg>
);
export const ArrowUpIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="m6 14 6-6 6 6" />
  </Svg>
);
export const ArrowDownIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="m6 10 6 6 6-6" />
  </Svg>
);

/** The role a "@…" token names (two-word names allowed), if any. */
function mentionedRole(raw: string, refs: MentionRefs): MentionRefs['roles'][number] | undefined {
  const lower = raw.toLowerCase();
  return (
    refs.roles.find((r) => r.name.toLowerCase() === lower) ??
    refs.roles.find((r) => r.name.toLowerCase() === lower.split(' ')[0])
  );
}

/**
 * A search result's text with every match marked, trimmed to the part around
 * the first match so the hit is always visible.
 */
export function Highlight(props: { text: string; query: string; max?: number }): ReactElement {
  const max = props.max ?? 200;
  const q = props.query.trim();
  if (!q) return <>{props.text.slice(0, max)}</>;
  const lower = props.text.toLowerCase();
  const first = lower.indexOf(q.toLowerCase());
  const start = first > max / 2 ? first - Math.floor(max / 3) : 0;
  const snippet = (start > 0 ? '…' : '') + props.text.slice(start, start + max);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = snippet.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="search-hit">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
