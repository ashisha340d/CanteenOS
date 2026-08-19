import { useEffect, useState } from 'react';

/**
 * Input capabilities of the machine — not its size.
 *
 * Canteen OS Admin is a desktop windowing environment: there is no narrow-screen layout to
 * switch to, so viewport width no longer decides anything. What still matters is how the user
 * points at the screen, because hover-reveal controls, drag handles and resize grips do not
 * exist on a touchscreen, and motion preferences must be honoured everywhere.
 */

export interface DeviceProfile {
  /** Finger or stylus rather than a mouse: `(pointer: coarse)`. */
  coarsePointer: boolean;
  /** No true hover state available: `(hover: none)`. */
  noHover: boolean;
  /** The device reports touch points, independent of the current pointer. */
  hasTouch: boolean;
  prefersReducedMotion: boolean;
  /**
   * Hover-reveal affordances and drag/resize grips are pointless — and often actively
   * harmful, since they occupy space and never appear — without a hovering pointer.
   */
  supportsPointerAffordances: boolean;
}

function read(): DeviceProfile {
  // Guard for the non-browser case so this module stays importable in tests.
  if (typeof window === 'undefined') {
    return {
      coarsePointer: false,
      noHover: false,
      hasTouch: false,
      prefersReducedMotion: false,
      supportsPointerAffordances: true,
    };
  }

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;

  return {
    coarsePointer,
    noHover,
    hasTouch: navigator.maxTouchPoints > 0,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    supportsPointerAffordances: !(coarsePointer && noHover),
  };
}

const QUERIES = ['(pointer: coarse)', '(hover: none)', '(prefers-reduced-motion: reduce)'];

export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(read);

  useEffect(() => {
    const onChange = (): void => setProfile(read());
    const lists = QUERIES.map((query) => window.matchMedia(query));
    lists.forEach((list) => list.addEventListener('change', onChange));
    onChange();
    return () => {
      lists.forEach((list) => list.removeEventListener('change', onChange));
    };
  }, []);

  return profile;
}
