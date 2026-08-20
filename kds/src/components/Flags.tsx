/**
 * The two flags, drawn rather than typed.
 *
 * 🇮🇳/🇬🇧 as emoji is the obvious way to do this and the wrong one here: Chrome on Windows has
 * no flag glyphs, so a regional-indicator pair renders as the bare letters "IN" and "GB". These
 * boards are Windows wall screens, so the flags are inline SVG and look the same everywhere.
 *
 * Shared between the language switch and the chat's auto-Hindi button — the same mark should
 * mean the same thing in both places.
 */

export function IndiaFlag({ className = 'kds-flag' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 30 20" className={className} aria-hidden="true" focusable="false">
      <rect width="30" height="20" rx="2.5" fill="#fff" />
      <path d="M2.5 0h25a2.5 2.5 0 0 1 2.5 2.5V6.67H0V2.5A2.5 2.5 0 0 1 2.5 0Z" fill="#FF9933" />
      <path d="M0 13.33h30V17.5a2.5 2.5 0 0 1-2.5 2.5h-25A2.5 2.5 0 0 1 0 17.5v-4.17Z" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.7" />
      <circle cx="15" cy="10" r="0.6" fill="#000080" />
    </svg>
  );
}

export function UkFlag({ className = 'kds-flag' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 30 20" className={className} aria-hidden="true" focusable="false">
      <rect width="30" height="20" rx="2.5" fill="#012169" />
      {/* The white saltire, then the red one laid over it, clipped to the rounded rectangle. */}
      <clipPath id="kds-uk-clip">
        <rect width="30" height="20" rx="2.5" />
      </clipPath>
      <g clipPath="url(#kds-uk-clip)">
        <path d="M0 0 30 20M30 0 0 20" stroke="#fff" strokeWidth="4" />
        <path d="M0 0 30 20M30 0 0 20" stroke="#C8102E" strokeWidth="2" />
        <path d="M15 0v20M0 10h30" stroke="#fff" strokeWidth="6.5" />
        <path d="M15 0v20M0 10h30" stroke="#C8102E" strokeWidth="3.9" />
      </g>
    </svg>
  );
}
