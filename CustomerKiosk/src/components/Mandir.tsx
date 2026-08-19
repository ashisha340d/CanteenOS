/**
 * A mandir, drawn.
 *
 * The brief for this panel came with a photograph of Bhakti Mandir at Mangarh, and a photograph
 * is exactly what it must not be. Three reasons, all practical rather than aesthetic. A
 * photograph is somebody's copyright and this repository would be asserting a licence it does
 * not hold. It is also a fixed set of pixels: the kiosk runs on a 10-inch tablet in portrait
 * and on a 27-inch panel, wears four skins including a dark one, and a bitmap serves exactly
 * one of those combinations well. And it would be a stale claim — a building photographed on
 * build day, shipped to a hall that may not be that building.
 *
 * So this is geometry in the shape of a north-Indian temple: a plinth, a stepped gopura,
 * flanking shikharas, a kalash and a pennant. It inherits `currentColor`, which means it takes
 * the skin's own trim on every one of the four without a second file, and it scales to any
 * panel because it is a path rather than a raster.
 *
 * The `viewBox` is deliberately tall and narrow: this is a side panel, read down the edge of a
 * screen, not a hero image.
 */

export function MandirSilhouette({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 200 420"
      aria-hidden
      className={className}
      fill="none"
      preserveAspectRatio="xMidYMax meet"
    >
      {/* Ground and plinth — three receding steps, the way a temple meets its courtyard. */}
      <rect x="6" y="392" width="188" height="10" rx="2" fill="currentColor" opacity=".26" />
      <rect x="16" y="378" width="168" height="14" rx="2" fill="currentColor" opacity=".34" />
      <rect x="28" y="362" width="144" height="16" rx="2" fill="currentColor" opacity=".42" />

      {/* Flanking shikharas, lower than the central tower and set back from it. */}
      <path
        d="M40 362V276c0-19 6-33 14-42 8 9 14 23 14 42v86H40Z"
        fill="currentColor"
        opacity=".5"
      />
      <path
        d="M132 362V276c0-19 6-33 14-42 8 9 14 23 14 42v86h-28Z"
        fill="currentColor"
        opacity=".5"
      />
      <circle cx="54" cy="228" r="5" fill="currentColor" opacity=".62" />
      <circle cx="146" cy="228" r="5" fill="currentColor" opacity=".62" />

      {/* The sanctum: a broad base, an arched doorway, and the tower above it. */}
      <path d="M62 362V300h76v62H62Z" fill="currentColor" opacity=".58" />
      <path
        d="M88 362v-34a12 12 0 0 1 24 0v34H88Z"
        fill="currentColor"
        opacity=".22"
      />

      {/* Stepped gopura. Each tier is a little narrower and a little shorter than the last —
          the proportion is what makes a stack of rectangles read as a temple rather than a
          staircase. */}
      <path d="M66 300l6-26h56l6 26H66Z" fill="currentColor" opacity=".64" />
      <path d="M74 274l6-25h40l6 25H74Z" fill="currentColor" opacity=".7" />
      <path d="M82 249l5-24h26l5 24H82Z" fill="currentColor" opacity=".76" />
      <path d="M89 225l4-22h14l4 22H89Z" fill="currentColor" opacity=".82" />

      {/* Amalaka, kalash and pennant. The finial is the one place the drawing allows a curve
          that is not structural. */}
      <ellipse cx="100" cy="199" rx="15" ry="6" fill="currentColor" opacity=".88" />
      <path d="M96 193v-9a4 4 0 0 1 8 0v9h-8Z" fill="currentColor" />
      <circle cx="100" cy="177" r="6" fill="currentColor" />
      <path d="M100 171V150" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M101 152c14 3 22 8 26 13-11 4-19 6-26 6v-19Z" fill="currentColor" opacity=".9" />
    </svg>
  );
}

/**
 * The panel the mandir sits in: a wash of the skin's canvas, a hairline horizon, and the
 * building rising out of it. Used down the side of the staff setup screen, which is the one
 * screen in the kiosk with room to spare and a person who has to wait at it.
 */
export function MandirPanel({ className = '' }: { className?: string }): JSX.Element {
  return (
    <div
      className={`relative overflow-hidden bg-canvas-deep ${className}`}
      aria-hidden
    >
      {/* A low glow behind the tower, so the silhouette is lit rather than pasted on. */}
      <span className="absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(120%_80%_at_50%_100%,var(--color-accent-tint),transparent_70%)]" />
      <span className="hairline absolute inset-x-8 bottom-[14%] h-px" />
      <MandirSilhouette className="absolute inset-x-0 bottom-0 h-[78%] w-full text-trim" />
    </div>
  );
}
