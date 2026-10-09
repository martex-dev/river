import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from 'react';
import type { CommunityView, MemberView } from '../../../../shared/ipc.ts';

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

export function memberOf(community: CommunityView | null | undefined, id: string): MemberView | undefined {
  return community?.members.find((m) => m.riverId === id);
}

export function nameOf(community: CommunityView | null | undefined, id: string): string {
  return memberOf(community, id)?.name ?? 'Someone';
}

// ---- avatar --------------------------------------------------------------------------------------

export function Avatar(props: {
  id: string;
  name: string;
  avatar?: string | null;
  size?: number;
  status?: 'online' | 'offline' | null;
  speaking?: boolean;
}): ReactElement {
  const size = props.size ?? 32;
  return (
    <span
      className={`avatar ${props.speaking ? 'is-speaking' : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
    >
      {props.avatar ? (
        <img src={props.avatar} alt="" draggable={false} />
      ) : (
        <span className="avatar__fallback" style={{ background: `hsl(${hueOf(props.id)} 55% 42%)` }}>
          {initials(props.name)}
        </span>
      )}
      {props.status && <span className={`avatar__status avatar__status--${props.status}`} />}
    </span>
  );
}

// ---- modal ----------------------------------------------------------------------------------------

export function Modal(props: {
  title?: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
  full?: boolean;
  className?: string;
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onMouseDown={props.onClose}
    >
      <div
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
  );
}

// ---- popover / context menu ----------------------------------------------------------------------

/** A floating panel at a screen position, kept on-screen, closed by outside click or Escape. */
export function Popover(props: {
  x: number;
  y: number;
  onClose(): void;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.x, top: props.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8)),
    });
  }, [props.x, props.y]);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) props.onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
    };
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown));
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [props]);
  return (
    <div ref={ref} className={`popover ${props.className ?? ''}`} style={pos} role="menu">
      {props.children}
    </div>
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

const EMOJI_GROUPS: Array<[string, string[]]> = [
  [
    'Smileys',
    '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖'.split(
      ' ',
    ),
  ],
  [
    'Gestures',
    '👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💪 🫡 👀 🧠'.split(
      ' ',
    ),
  ],
  [
    'Hearts',
    '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 ⚡'.split(' '),
  ],
  [
    'Things',
    '🎉 🎊 🎁 🏆 🥇 🎮 🎧 🎤 🎵 🎶 📷 🎥 💻 🖥️ 📱 ⌨️ 🖱️ 💡 📌 📎 🔒 🔑 🛡️ ⚙️ 🧪 🚀 ✈️ 🚗 🏠 ☕ 🍕 🍔 🍟 🍿 🍩 🍪 🍺 🍻 🥂 🍷 🌍 🌙 ☀️ 🌈 ❄️ 🌊 🌲 🌸 🐶 🐱 🦊 🐻 🐼 🐸 🐵 🦄 🐍 🐢'.split(
      ' ',
    ),
  ],
  ['Symbols', '✅ ❌ ❓ ❗ ⚠️ 🚫 ⛔ 🔴 🟢 🔵 🟡 ⬆️ ⬇️ ➡️ ⬅️ 🔁 ➕ ➖ 💤 🆗 🆕 🆒 ™️ ©️'.split(' ')],
];

export function EmojiPicker(props: { onPick(emoji: string): void }): ReactElement {
  const [group, setGroup] = useState(0);
  const current = EMOJI_GROUPS[group]!;
  return (
    <div className="emoji-picker">
      <div className="emoji-picker__tabs">
        {EMOJI_GROUPS.map(([label, list], i) => (
          <button
            key={label}
            className={`emoji-picker__tab ${i === group ? 'is-active' : ''}`}
            title={label}
            onClick={() => setGroup(i)}
          >
            {list[0]}
          </button>
        ))}
      </div>
      <div className="emoji-picker__label">{current[0]}</div>
      <div className="emoji-picker__grid">
        {current[1].map((e) => (
          <button key={e} className="emoji-picker__emoji" onClick={() => props.onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- safe message formatting ------------------------------------------------------------------------

/**
 * A small Markdown subset rendered to React elements (never HTML strings):
 * ```code blocks```, `code`, **bold**, *italic*, __underline__, ~~strike~~,
 * > quotes and @mentions.
 */
/** Roles and channels a message can mention, for highlighting and navigation. */
export interface MentionRefs {
  roles: Array<{ name: string; color: number; mine: boolean }>;
  channels: Array<{ id: string; name: string }>;
  onChannel?(id: string): void;
}

export function RichText(props: {
  text: string;
  names: string[];
  me: string | null;
  refs?: MentionRefs;
}): ReactElement {
  const blocks = props.text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.startsWith('```') && block.endsWith('```') && block.length >= 6) {
          return (
            <pre key={i} className="md-codeblock">
              <code>{block.slice(3, -3).replace(/^\w*\n/, '')}</code>
            </pre>
          );
        }
        return block.split('\n').map((line, j, lines) => {
          const quote = line.startsWith('> ');
          const content = inline(
            quote ? line.slice(2) : line,
            props.names,
            props.me,
            `${i}-${j}`,
            props.refs,
          );
          return quote ? (
            <blockquote key={`${i}-${j}`} className="md-quote">
              {content}
            </blockquote>
          ) : (
            <span key={`${i}-${j}`}>
              {content}
              {j < lines.length - 1 && <br />}
            </span>
          );
        });
      })}
    </>
  );
}

const INLINE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_|@everyone|@here|@[^\s@]+(?: [^\s@]+)?|#[\w-]+)/g;

function inline(
  text: string,
  names: string[],
  me: string | null,
  key: string,
  refs?: MentionRefs,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}-${n++}`;
    if (token.startsWith('`'))
      out.push(
        <code key={k} className="md-code">
          {token.slice(1, -1)}
        </code>,
      );
    else if (token.startsWith('**')) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('__')) out.push(<u key={k}>{token.slice(2, -2)}</u>);
    else if (token.startsWith('~~')) out.push(<s key={k}>{token.slice(2, -2)}</s>);
    else if (token.startsWith('*') || token.startsWith('_')) out.push(<em key={k}>{token.slice(1, -1)}</em>);
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
          className={`mention mention--role ${role.mine ? 'mention--me' : ''}`}
          style={role.color ? ({ '--role': hex(role.color) } as CSSProperties) : undefined}
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
