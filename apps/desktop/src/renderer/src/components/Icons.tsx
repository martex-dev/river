import type { ReactElement, ReactNode, SVGProps } from 'react';
import type { Section } from '../store.ts';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 22, children, ...rest }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4 11.2 12 4l8 7.2" />
    <path d="M6.5 9.5V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5" />
    <path d="M10 20v-4.5a2 2 0 0 1 4 0V20" />
  </Svg>
);

export const MessagesIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4.5 6.5a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.4c-.4.3-.8 0-.8-.4V16H7a2.5 2.5 0 0 1-2.5-2.5z" />
    <path d="M8.5 9h7M8.5 12h4.5" />
  </Svg>
);

export const CommunitiesIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="7" r="2.6" />
    <circle cx="6" cy="16.5" r="2.6" />
    <circle cx="18" cy="16.5" r="2.6" />
    <path d="M10.6 9.2 7.4 14.2M13.4 9.2l3.2 5M8.6 16.5h6.8" />
  </Svg>
);

export const SocialIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="5" />
    <circle cx="12" cy="12" r="3.6" />
    <path d="M16.6 7.4h.01" strokeWidth={2.4} />
  </Svg>
);

export const CallsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M6.2 4.5h2.3l1.3 3.6-1.7 1.2a10.5 10.5 0 0 0 6.6 6.6l1.2-1.7 3.6 1.3v2.3a1.7 1.7 0 0 1-1.8 1.7C10.6 19 5 13.4 4.5 6.3a1.7 1.7 0 0 1 1.7-1.8z" />
    <path d="M15 4.8a5 5 0 0 1 4.2 4.2M14.6 8a2 2 0 0 1 1.4 1.4" />
  </Svg>
);

export const FilesIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2h6A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
    <path d="M10 13.5h4M12 11.5v4" />
  </Svg>
);

export const ContactsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <circle cx="12" cy="10" r="2.6" />
    <path d="M7.6 17.2a4.8 4.8 0 0 1 8.8 0" />
  </Svg>
);

export const SecurityIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M12 3.8 5.5 6.3v5.2c0 4.2 2.8 7.4 6.5 8.7 3.7-1.3 6.5-4.5 6.5-8.7V6.3z" />
    <path d="m9.2 12 2 2 3.8-4" />
  </Svg>
);

export const SettingsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M5 7h8M17 7h2M5 12h2M11 12h8M5 17h10M19 17h0" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="17" r="2" />
  </Svg>
);

export const LockIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2.2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);

export const ArrowIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M5 12h13M13 7l5 5-5 5" />
  </Svg>
);

export const CheckIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="m5.5 12.5 4 4 9-9" />
  </Svg>
);

export const ExternalIcon = (p: IconProps): ReactElement => (
  <Svg {...p}>
    <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />
  </Svg>
);

export const SECTION_ICONS: Record<Section, (p: IconProps) => ReactElement> = {
  home: HomeIcon,
  messages: MessagesIcon,
  communities: CommunitiesIcon,
  social: SocialIcon,
  calls: CallsIcon,
  files: FilesIcon,
  contacts: ContactsIcon,
  security: SecurityIcon,
  settings: SettingsIcon,
};
