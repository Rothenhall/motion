'use client';

import React from 'react';

type IconName =
  | 'grid'
  | 'calendar'
  | 'zap'
  | 'inbox'
  | 'link'
  | 'chart'
  | 'settings'
  | 'search'
  | 'bell'
  | 'help'
  | 'chevron-down'
  | 'chevron-right'
  | 'plus'
  | 'arrow-up-right'
  | 'arrow-right'
  | 'more'
  | 'clock'
  | 'check'
  | 'alert'
  | 'instagram'
  | 'facebook'
  | 'threads'
  | 'sparkles'
  | 'filter'
  | 'send'
  | 'trash'
  | 'external'
  | 'pause'
  | 'play'
  | 'sun'
  | 'moon'
  | 'command'
  | 'x';

const paths: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M16 2.5v4M8 2.5v4M3 9.5h18" /></>,
  zap: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
  inbox: <><path d="M4 4h16v15H4z" /><path d="m4 14 3.2-3.5L10 14l3-3 2.7 3 2.3-2.5L20 14" /><path d="M8 8h8" /></>,
  link: <><path d="M10 13.5 8.5 15a3.5 3.5 0 0 1-5-5l2-2a3.5 3.5 0 0 1 5 0" /><path d="m14 10.5 1.5-1.5a3.5 3.5 0 1 1 5 5l-2 2a3.5 3.5 0 0 1-5 0" /><path d="m8.5 15 7-7" /></>,
  chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 3-4 3 2 5-7" /></>,
  settings: <><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="m4.9 4.9 1.4 1.4m11.4-1.4-1.4 1.4M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M2.5 12h2M19.5 12h2M12 2.5v2M12 19.5v2" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 4.2 1.6c-.9.8-2 1.2-2 2.7M12 16.5h.01" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  'arrow-up-right': <><path d="M7 17 17 7M8 7h9v9" /></>,
  'arrow-right': <><path d="M4 12h16M14 6l6 6-6 6" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  alert: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 16.5h.01" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /></>,
  facebook: <path d="M14 21v-8h2.8l.4-3H14V8.1c0-.9.3-1.6 1.7-1.6h1.7V3.8c-.3 0-1.3-.1-2.5-.1C12.4 3.7 11 5 11 7.4V10H8.5v3H11v8" />,
  threads: <><path d="M18.5 9.8c-.4-3.1-2.5-5.2-6.3-5.5-3.4-.2-6.1 1.4-6.1 4.2 0 3.1 2.7 4.4 6.1 4.4 2.4 0 4.4-1.1 4.4-2.9 0-1.8-1.7-2.8-4-2.8-2.8 0-4.8 1.8-4.8 4.8 0 3.4 2.5 5.7 6.1 5.7 3.9 0 6.1-2.2 6.1-5.9 0-2.6-1.2-4.9-3.7-6.4" /></>,
  sparkles: <><path d="m12 3 1.2 4.6L18 9l-4.8 1.4L12 15l-1.2-4.6L6 9l4.8-1.4L12 3ZM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15ZM5 14l.5 1.5L7 16l-1.5.5L5 18l-.5-1.5L3 16l1.5-.5L5 14Z" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  send: <><path d="m21 3-7.2 18-3.7-7.1L3 10.2 21 3Z" /><path d="M10.1 13.9 21 3" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" /></>,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  play: <path d="m9 5 10 7-10 7V5Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z" />,
  command: <><path d="M9 9V6a2 2 0 1 0-2 2h3ZM9 9H6a2 2 0 1 0 2 2v-3ZM9 9h3v3a2 2 0 1 1-2-2V9Zm6-3h3a2 2 0 1 1-2 2v-3ZM15 6v3h-3a2 2 0 1 0 2-2V6Zm0 9v3a2 2 0 1 0 2-2h-3Zm0 0h3a2 2 0 1 1-2 2v-3Zm-6 3v-3h3a2 2 0 1 1-2 2H9Z" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Icon({ name, size = 18, strokeWidth = 1.8, className = '' }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
