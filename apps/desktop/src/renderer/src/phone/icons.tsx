import type { ReactElement, ReactNode, SVGProps } from 'react';

/** Line icons for the phone shell (2.12), drawn on a 24px grid like the system's own. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps & { children: ReactNode }): ReactElement {
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
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChatsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M12 3.5c-4.97 0-9 3.47-9 7.75 0 2.3 1.17 4.37 3.03 5.79L5.2 20.5l4.08-1.86c.87.2 1.78.31 2.72.31 4.97 0 9-3.47 9-7.7S16.97 3.5 12 3.5Z" />
  </Svg>
);

export const GroupsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.2 19.5c.5-3.1 2.9-5 5.8-5s5.3 1.9 5.8 5" />
    <path d="M15.6 5.6a3 3 0 0 1 0 5.8M17.4 14.7c1.9.6 3.1 2.3 3.4 4.8" />
  </Svg>
);

export const PhoneCallIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M6.6 3.6 9 3.3l1.6 4-2 1.5a12 12 0 0 0 6.6 6.6l1.5-2 4 1.6-.3 2.4a2.4 2.4 0 0 1-2.6 2.1A16.4 16.4 0 0 1 4.5 6.2a2.4 2.4 0 0 1 2.1-2.6Z" />
  </Svg>
);

export const VideoIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="2.8" y="6" width="13" height="12" rx="3" />
    <path d="m15.8 10.4 5.4-3.1v9.4l-5.4-3.1" />
  </Svg>
);

export const FeedIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="3.8" />
    <circle cx="17" cy="7" r="0.6" fill="currentColor" />
  </Svg>
);

export const ProfileIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3.2" />
    <path d="M6.2 18.4c1.2-2.2 3.3-3.4 5.8-3.4s4.6 1.2 5.8 3.4" />
  </Svg>
);

export const BackIcon = (p: IconProps): ReactElement => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M15 4.5 7.5 12l7.5 7.5" />
  </Svg>
);

export const ComposeIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M12.5 4.5H7a3 3 0 0 0-3 3V17a3 3 0 0 0 3 3h9.5a3 3 0 0 0 3-3v-5.5" />
    <path d="m17.6 3.7 2.7 2.7-8 8-3.5.8.8-3.5 8-8Z" />
  </Svg>
);

export const ContactsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.8 20c.7-3.6 3.6-5.8 7.2-5.8s6.5 2.2 7.2 5.8" />
  </Svg>
);

export const SearchIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.6 15.6 4.6 4.6" />
  </Svg>
);

export const MoreIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const PlusIcon = (p: IconProps): ReactElement => (
  <Svg {...p} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const MutedIcon = (p: IconProps): ReactElement => (
  <Svg {...p} strokeWidth={2}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
    <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
  </Svg>
);

export const PinnedIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M9 3.5h6l-1 5 3.5 3.5v1.5h-11V12L10 8.5z" fill="currentColor" stroke="none" />
    <path d="M12 14.5V21" strokeWidth={2} />
  </Svg>
);

export const ArchiveIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
    <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
  </Svg>
);

export const TrashIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.8 12.2A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.3l.8-12.2" />
  </Svg>
);

export const ReadIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4 12.5 9 17.5 20 6.5" strokeWidth={2.2} />
  </Svg>
);

export const UnreadIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M12 4C7 4 3.5 7.3 3.5 11.3c0 2.2 1.1 4.1 2.9 5.4L5.7 20l3.7-1.7c.8.2 1.7.3 2.6.3 5 0 8.5-3.3 8.5-7.3" />
    <circle cx="19" cy="5" r="2.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const SendIcon = (p: IconProps): ReactElement => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M12 19V5.5M6 11.5l6-6 6 6" />
  </Svg>
);

export const ClipIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="m20 11.5-7.6 7.6a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.8 4.8l-7.9 7.9a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3" />
  </Svg>
);

export const EmojiIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M8.3 14c.9 1.4 2.2 2.1 3.7 2.1s2.8-.7 3.7-2.1" />
    <circle cx="9" cy="9.8" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9.8" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

/** Saved replies (2.19): a speech bubble with a quick-reply bolt. */
export const SavedRepliesIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M12 3.8c-4.7 0-8.5 3.2-8.5 7.2 0 2.1 1.1 4 2.8 5.3l-.8 3.9 3.9-1.8c.8.2 1.7.3 2.6.3 4.7 0 8.5-3.2 8.5-7.2s-3.8-7.7-8.5-7.7Z" />
    <path d="M12.8 7.5 10 11.6h3.2l-1.6 3.4" />
  </Svg>
);

/** Stickers: a square with a peeled corner. */
export const StickerIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M20.5 13.5V7a3.5 3.5 0 0 0-3.5-3.5H7A3.5 3.5 0 0 0 3.5 7v10A3.5 3.5 0 0 0 7 20.5h6.5z" />
    <path d="M13.5 20.5v-4a3 3 0 0 1 3-3h4" />
  </Svg>
);

/** A link (call links, 2.19). */
export const LinkIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
    <path d="M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
  </Svg>
);

export const CopyIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.4" />
    <path d="M15.5 8.5V6.9a2.4 2.4 0 0 0-2.4-2.4H6.9a2.4 2.4 0 0 0-2.4 2.4v6.2a2.4 2.4 0 0 0 2.4 2.4h1.6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps): ReactElement => (
  <Svg {...p} strokeWidth={2}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Svg>
);

/** A call's direction: an arrow into the corner (incoming) or out of it (outgoing). */
export const CallInIcon = (p: IconProps): ReactElement => (
  <Svg {...p} strokeWidth={2}>
    <path d="M17 7 7 17M7 9.5V17h7.5" />
  </Svg>
);

export const CallOutIcon = (p: IconProps): ReactElement => (
  <Svg {...p} strokeWidth={2}>
    <path d="M7 17 17 7M9.5 7H17v7.5" />
  </Svg>
);

/** Delivery ticks: one (sent), two (delivered or read), a clock (sending). */
export const TickIcon = (p: IconProps): ReactElement => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="m3 8.6 2.9 2.9L12.6 4.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const DoubleTickIcon = (p: IconProps): ReactElement => (
  <svg width={p.size ?? 18} height={p.size ?? 16} viewBox="0 0 18 16" aria-hidden="true" focusable="false">
    <path
      d="m1.6 8.6 2.9 2.9L11.2 4.8M8.3 11.1l.4.4 6.7-6.7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ClockIcon = (p: IconProps): ReactElement => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 5.2V8l1.9 1.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

/** White glyphs on the coloured squares of the settings list. */
export const Glyph = {
  account: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5.5 19.5c.8-3.4 3.4-5.4 6.5-5.4s5.7 2 6.5 5.4" />
    </Svg>
  ),
  lock: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  ),
  bell: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />
    </Svg>
  ),
  brush: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <path d="M14.5 4.5 19.5 9.5 11 18l-5-5zM6 13c-2 1-2.5 3.2-2.5 6.5 3.3 0 5.5-.5 6.5-2.5" />
    </Svg>
  ),
  devices: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <rect x="3" y="5" width="12.5" height="10" rx="1.6" />
      <path d="M6 19h6.5" />
      <rect x="16.5" y="8.5" width="4.5" height="10.5" rx="1.2" />
    </Svg>
  ),
  data: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
      <path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
    </Svg>
  ),
  phone: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <path d="M7 4.2 9.2 4l1.4 3.6-1.8 1.3a10.6 10.6 0 0 0 5.9 5.9l1.3-1.8 3.6 1.4-.2 2.2a2.2 2.2 0 0 1-2.4 2A14.6 14.6 0 0 1 5 6.6a2.2 2.2 0 0 1 2-2.4Z" />
    </Svg>
  ),
  globe: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z" />
    </Svg>
  ),
  help: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" />
    </Svg>
  ),
  bookmark: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <path d="M7 4h10v16.5l-5-3.5-5 3.5z" />
    </Svg>
  ),
  folder: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </Svg>
  ),
  people: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.5-3 2.7-4.8 5.5-4.8s5 1.8 5.5 4.8M15.5 5.8a2.8 2.8 0 0 1 0 5.4M17 14.5c1.8.6 2.9 2.1 3.3 4.5" />
    </Svg>
  ),
  update: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
    </Svg>
  ),
  gear: (p: IconProps): ReactElement => (
    <Svg {...p} strokeWidth={2}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </Svg>
  ),
};
