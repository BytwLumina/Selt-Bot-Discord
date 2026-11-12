import type { ReactNode } from 'react';

export type IconName =
  | 'grid'
  | 'mic'
  | 'stream'
  | 'eye'
  | 'moon'
  | 'bot'
  | 'sparkle'
  | 'target'
  | 'terminal'
  | 'sun'
  | 'activity'
  | 'clock'
  | 'hourglass'
  | 'server'
  | 'check'
  | 'alert'
  | 'inbox'
  | 'refresh'
  | 'sliders';

const PATHS: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7.4" height="7.4" rx="2" />
      <rect x="13.6" y="3" width="7.4" height="7.4" rx="2" />
      <rect x="3" y="13.6" width="7.4" height="7.4" rx="2" />
      <rect x="13.6" y="13.6" width="7.4" height="7.4" rx="2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.6" width="6" height="11" rx="3" />
      <path d="M5.6 11.2a6.4 6.4 0 0 0 12.8 0M12 17.6v3.8" />
    </>
  ),
  stream: (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M8.1 8.1a5.5 5.5 0 0 0 0 7.8M15.9 15.9a5.5 5.5 0 0 0 0-7.8M5.2 5.2a9.6 9.6 0 0 0 0 13.6M18.8 18.8a9.6 9.6 0 0 0 0-13.6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.6 12S6.2 5.6 12 5.6 21.4 12 21.4 12 17.8 18.4 12 18.4 2.6 12 2.6 12z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  moon: <path d="M20.2 14.6A8.5 8.5 0 0 1 9.4 3.8a8.5 8.5 0 1 0 10.8 10.8z" />,
  bot: (
    <>
      <rect x="4.4" y="8" width="15.2" height="11" rx="3.4" />
      <path d="M12 4.4V8M8.8 12.6h.01M15.2 12.6h.01M9.6 15.8h4.8" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.4l1.9 4.5 4.5 1.9-4.5 1.9L12 16.2l-1.9-4.5L5.6 9.8l4.5-1.9z" />
      <path d="M18.4 15.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.4" />
      <path d="M12 2.6v3.8M12 17.6v3.8M2.6 12h3.8M17.6 12h3.8" />
    </>
  ),
  terminal: (
    <>
      <rect x="2.6" y="4" width="18.8" height="16" rx="2.4" />
      <path d="M6.6 9.2l2.8 2.8-2.8 2.8M12.6 14.8h4.8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2M12 19.4v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.6 12h2M19.4 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </>
  ),
  activity: <path d="M3 12h3.4l2.6 6 4-14 2.6 8H21" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3.1 1.9" />
    </>
  ),
  hourglass: (
    <>
      <path d="M7 3.5h10M7 20.5h10M8 3.5v3c0 2 4 4.3 4 5.5s-4 3.5-4 5.5v3M16 3.5v3c0 2-4 4.3-4 5.5s4 3.5 4 5.5v3" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="6.4" rx="2" />
      <rect x="3" y="13.6" width="18" height="6.4" rx="2" />
      <path d="M7 7.2h.01M7 16.8h.01" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  alert: (
    <>
      <path d="M12 3.6l9 15.8H3z" />
      <path d="M12 9.4v4.4M12 16.6h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.4 13.2h4.2l1.6 2.6h5.6l1.6-2.6h4.2" />
      <path d="M5.4 4.6h13.2l2 8.6v4.6a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6v-4.6z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
};

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
