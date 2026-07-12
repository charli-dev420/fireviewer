import type { SVGProps } from 'react';

export type IconName =
  | 'alert'
  | 'arrow-down'
  | 'check'
  | 'chevron-down'
  | 'clock'
  | 'close'
  | 'compass'
  | 'copy'
  | 'download'
  | 'eye'
  | 'file-text'
  | 'filter'
  | 'flame'
  | 'history'
  | 'info'
  | 'layers'
  | 'link'
  | 'location'
  | 'measure'
  | 'menu'
  | 'north'
  | 'offline'
  | 'refresh'
  | 'search'
  | 'shield'
  | 'sparkles'
  | 'table'
  | 'text'
  | 'user'
  | 'warning';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...props }: IconProps) {
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
    case 'flame':
      return (
        <svg {...common} viewBox="0 0 32 40" fill="currentColor" stroke="none">
          <path d="M18.8 1.4c1.2 7.2-3.7 10.2-3.7 15.5 0 2.5 1.5 4.2 3.8 4.7-1.1-4.5 2.7-6.8 4.5-10.1 4.4 4.5 7.1 9.3 7.1 14.6 0 7.5-6.5 13.6-14.5 13.6S1.5 33.6 1.5 26.1c0-8.8 6.4-13 9.2-19.9.4 4.1 1.7 6.1 3.6 7.6.4-5.7 3-8.5 4.5-12.4Z" />
        </svg>
      );
    case 'alert':
    case 'warning':
      return (
        <svg {...common}>
          <path d="M10.3 2.9 1.9 17a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case 'chevron-down':
    case 'arrow-down':
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case 'compass':
    case 'north':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m15.4 8.6-2 5.7-5.7 2 2-5.7 5.7-2Z" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="10" height="10" rx="2" />
          <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        </svg>
      );
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...common}>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case 'file-text':
    case 'text':
      return (
        <svg {...common}>
          <path d="M6 2h8l4 4v16H6z" />
          <path d="M14 2v5h5M9 13h6M9 17h6M9 9h2" />
        </svg>
      );
    case 'filter':
      return (
        <svg {...common}>
          <path d="M4 5h16M7 12h10M10 19h4" />
        </svg>
      );
    case 'history':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5M12 7v5l3 2" />
        </svg>
      );
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6M12 7h.01" />
        </svg>
      );
    case 'layers':
      return (
        <svg {...common}>
          <path d="m12 2 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
        </svg>
      );
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
        </svg>
      );
    case 'location':
      return (
        <svg {...common}>
          <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.3" />
        </svg>
      );
    case 'measure':
      return (
        <svg {...common}>
          <path d="m4 17 13-13 3 3L7 20z" />
          <path d="m14 7 3 3M11 10l2 2M8 13l2 2" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case 'offline':
      return (
        <svg {...common}>
          <path d="m2 2 20 20" />
          <path d="M5 12a10 10 0 0 1 14.1-7.4M8.5 15.5A5 5 0 0 1 16 16M12 20h.01" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 6v5h-5M4 18v-5h5" />
          <path d="M18.7 10A7 7 0 0 0 6.2 6.2L4 11M5.3 14A7 7 0 0 0 17.8 17.8L20 13" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v5.5c0 4.7 3.2 8 7.5 9.5 4.3-1.5 7.5-4.8 7.5-9.5V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...common}>
          <path d="m12 3 1.1 3.4L16.5 7.5l-3.4 1.1L12 12l-1.1-3.4-3.4-1.1 3.4-1.1L12 3Z" />
          <path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13Z" />
          <path d="m6 14 .7 1.8 1.8.7-1.8.7L6 19l-.7-1.8-1.8-.7 1.8-.7L6 14Z" />
        </svg>
      );
    case 'table':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 9v11M15 9v11" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    default:
      return null;
  }
}
