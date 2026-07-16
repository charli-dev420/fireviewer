import type { SVGProps } from 'react';

export type PublicIconName =
  | 'accessibility' | 'arrow' | 'arrow-left' | 'bell' | 'bookmark' | 'calendar' | 'chart' | 'check-circle'
  | 'chevron-down' | 'chevron-right' | 'clock' | 'close' | 'cookie' | 'crosshair'
  | 'data' | 'database' | 'external' | 'flame' | 'globe' | 'image' | 'info' | 'keyboard' | 'location' | 'lock'
  | 'log-in' | 'mail' | 'map' | 'menu' | 'message' | 'monitor' | 'phone'
  | 'plus' | 'plus-circle' | 'search' | 'share' | 'shield' | 'target' | 'trash' | 'user' | 'users'
  | 'warning' | 'x-circle';

interface PublicIconProps extends SVGProps<SVGSVGElement> {
  readonly name: PublicIconName;
  readonly size?: number;
}

export function PublicIcon({ name, size = 24, ...props }: PublicIconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  };

  switch (name) {
    case 'menu': return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case 'close': return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case 'chevron-down': return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case 'chevron-right': return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case 'arrow': return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
    case 'arrow-left': return <svg {...common}><path d="M19 12H5M10 7l-5 5 5 5" /></svg>;
    case 'plus': return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="6.7" /><path d="m16 16 4 4" /></svg>;
    case 'crosshair': return <svg {...common}><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="1.8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
    case 'plus-circle': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
    case 'globe': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>;
    case 'external': return <svg {...common}><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
    case 'phone': return <svg {...common}><path d="M6.7 3.8 9 8.1 7.3 9.8a15.8 15.8 0 0 0 6.9 6.9l1.7-1.7 4.3 2.3v2.4a1.8 1.8 0 0 1-1.8 1.8A16.4 16.4 0 0 1 2.5 5.6 1.8 1.8 0 0 1 4.3 3.8Z" /></svg>;
    case 'map': return <svg {...common}><path d="m3 6.8 5-2.5 8 2.5 5-2.5v13l-5 2.5-8-2.5-5 2.5Z" /><path d="M8 4.3v13M16 6.8v13" /></svg>;
    case 'location': return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
    case 'flame': return <svg {...common}><path d="M13 2c1 4-2 5-2 8 0 2 1 3 2 3 2 0 3-2 2-5 3 2 5 5 5 8a8 8 0 0 1-16 0c0-4 2-7 6-11 0 4 1 5 3 6" /></svg>;
    case 'bell': return <svg {...common}><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7M10 20h4" /></svg>;
    case 'shield': return <svg {...common}><path d="M12 3 20 6v5.8c0 4.4-2.7 7.4-8 9.2-5.3-1.8-8-4.8-8-9.2V6Z" /></svg>;
    case 'user': return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case 'users': return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5" /></svg>;
    case 'log-in': return <svg {...common}><path d="M14 4h5v16h-5M10 8l4 4-4 4M14 12H3" /></svg>;
    case 'image': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 4" /></svg>;
    case 'bookmark': return <svg {...common}><path d="M6 3h12v18l-6-4-6 4Z" /></svg>;
    case 'cookie': return <svg {...common}><path d="M20 12.5A8.5 8.5 0 1 1 11.5 4a4 4 0 0 0 5 5 4 4 0 0 0 3.5 3.5Z" /><path d="M8 12h.01M11 17h.01M6.5 8h.01" /></svg>;
    case 'target': return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3" /></svg>;
    case 'database': return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>;
    case 'data': return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M2 19h22" /></svg>;
    case 'chart': return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20V7" /></svg>;
    case 'share': return <svg {...common}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></svg>;
    case 'clock': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'mail': return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
    case 'message': return <svg {...common}><path d="M4 4h16v12H8l-4 4Z" /></svg>;
    case 'lock': return <svg {...common}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>;
    case 'trash': return <svg {...common}><path d="M4 7h16M9 3h6l1 4H8l1-4ZM7 7l1 14h8l1-14M10 11v6M14 11v6" /></svg>;
    case 'calendar': return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>;
    case 'monitor': return <svg {...common}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
    case 'keyboard': return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M5 9h.01M9 9h.01M13 9h.01M17 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10" /></svg>;
    case 'accessibility': return <svg {...common}><circle cx="12" cy="4" r="2" /><path d="M4 8h16M12 6v6M8 21l4-9 4 9M6 11l6 1 6-1" /></svg>;
    case 'info': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 10v6M12 7h.01" /></svg>;
    case 'warning': return <svg {...common}><path d="M10.3 2.9 1.9 17a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
    case 'check-circle': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
    case 'x-circle': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
    default: return null;
  }
}
