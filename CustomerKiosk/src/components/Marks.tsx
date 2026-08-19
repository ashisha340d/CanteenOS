/**
 * Drawn marks, not imported artwork.
 *
 * The kiosk ships no logo file: a temple canteen renames itself more often than it redeploys,
 * and a bitmap would pin the brand to whatever was correct on build day. These are geometry.
 */

export function LotusMark({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={className} fill="none">
      <path
        d="M24 39c-8.2 0-15-4.6-15-10.3 0-1 .2-2 .6-2.9 2.4 3 7.5 5 14.4 5s12-2 14.4-5c.4.9.6 1.9.6 2.9C39 34.4 32.2 39 24 39Z"
        fill="currentColor"
        opacity=".28"
      />
      <path
        d="M24 9c3.1 3.4 4.7 7 4.7 10.8 0 3.9-1.6 7.5-4.7 10.9-3.1-3.4-4.7-7-4.7-10.9C19.3 16 20.9 12.4 24 9Z"
        fill="currentColor"
      />
      <path
        d="M12.4 15.6c4.2 1.1 7.2 3 9.1 5.8 1.9 2.8 2.6 6.1 2.1 9.9-4.2-1.1-7.2-3-9.1-5.8-1.9-2.8-2.6-6.1-2.1-9.9Z"
        fill="currentColor"
        opacity=".72"
      />
      <path
        d="M35.6 15.6c.5 3.8-.2 7.1-2.1 9.9-1.9 2.8-4.9 4.7-9.1 5.8-.5-3.8.2-7.1 2.1-9.9 1.9-2.8 4.9-4.7 9.1-5.8Z"
        fill="currentColor"
        opacity=".72"
      />
    </svg>
  );
}

/** The Indian pure-vegetarian mark: a green dot inside a green square. */
export function VegMark({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="none">
      <rect x="1" y="1" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3.4" fill="currentColor" />
    </svg>
  );
}

/** A hairline flanked by a small diamond — the one ornament the kiosk allows itself. */
export function Divider({ className = '' }: { className?: string }): JSX.Element {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden>
      <span className="hairline h-px flex-1" />
      <span className="size-1.5 rotate-45 bg-trim/70" />
      <span className="hairline h-px flex-1" />
    </div>
  );
}
