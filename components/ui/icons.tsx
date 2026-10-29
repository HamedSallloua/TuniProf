// Small inline icons (no emojis anywhere on the site). They are decorative: the text next
// to them says the same thing, so they are hidden from screen readers.

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export function PinIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function StarIcon({
  className = 'size-4',
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
    >
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
    </svg>
  );
}

export function PhoneIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

export function ChevronIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ArrowIcon({ className = 'size-4' }: IconProps) {
  // Points to the reading direction's "forward"; flipped for right-to-left in the CSS.
  return (
    <svg {...base} className={`${className} rtl:-scale-x-100`}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function UsersIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 20a5 5 0 0 0-3-4.6" />
    </svg>
  );
}

export function StudentIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2 9l10-5 10 5-10 5-10-5z" />
      <path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9v6" />
    </svg>
  );
}

export function CalendarIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  );
}

export function PlusIcon({ className = 'size-4' }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
