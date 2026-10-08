import { useId, type ReactElement } from 'react';

/** River's mark: three currents converging into one stream. Original artwork. */
export function RiverMark({ size = 36 }: { size?: number }): ReactElement {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="River">
      <defs>
        <linearGradient id={`${id}-g`} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4fe3d1" />
          <stop offset="0.55" stopColor="#6aa8ff" />
          <stop offset="1" stopColor="#a27bff" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="18"
        fill="#0a1020"
        stroke={`url(#${id}-g)`}
        strokeOpacity="0.5"
      />
      <g fill="none" stroke={`url(#${id}-g)`} strokeWidth="4.2" strokeLinecap="round">
        <path d="M14 20c8 0 10 6 18 6s10-6 18-6" opacity="0.55" />
        <path d="M14 32c8 0 10 6 18 6s10-6 18-6" />
        <path d="M14 44c8 0 10 6 18 6s10-6 18-6" opacity="0.55" />
      </g>
    </svg>
  );
}
