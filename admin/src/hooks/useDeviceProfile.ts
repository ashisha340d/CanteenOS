import { useEffect, useState } from 'react';

/**
 * What kind of machine is this, really?
 *
 * Deliberately not user-agent sniffing: a UA string tells you what the browser claims to be,
 * not how the user is actually pointing at the screen. A Surface in tablet mode and a
 * half-width desktop window both want the compact layout for different reasons, and a UA
 * check gets both wrong. Viewport width decides the layout; pointer and hover capability
 * decide affordances (drag handles, hover-reveal controls, resize grips) that simply do not
 * exist on a touchscreen.
 */

export interface DeviceProfile {
  /** Viewport is narrow enough for the dedicated mobile experience. */
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
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

const MOBILE_MAX = 768;
const TABLET_MAX = 1024;

function read(): DeviceProfile {
  // Guard for the non-browser case so this module stays importable in tests.
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      coarsePointer: false,
      noHover: false,
      hasTouch: false,
      prefersReducedMotion: false,
      supportsPointerAffordances: true,
    };
  }

  const width = window.innerWidth;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const hasTouch = navigator.maxTouchPoints > 0;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A touch device gets the mobile experience a little further up the width range than a
  // mouse-driven window does, because its hit targets need the extra room.
  const touchLike = coarsePointer && noHover;
  const isMobile = width < MOBILE_MAX || (touchLike && width < TABLET_MAX);
  const isTablet = !isMobile && width < TABLET_MAX;

  return {
    isMobile,
    isTablet,
    isDesktop: !isMobile && !isTablet,
    coarsePointer,
    noHover,
    hasTouch,
    prefersReducedMotion,
    supportsPointerAffordances: !touchLike,
  };
}

const QUERIES = [
  `(max-width: ${MOBILE_MAX - 1}px)`,
  `(max-width: ${TABLET_MAX - 1}px)`,
  '(pointer: coarse)',
  '(hover: none)',
  '(prefers-reduced-motion: reduce)',
];

export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(read);

  useEffect(() => {
    const onChange = (): void => setProfile(read());
    const lists = QUERIES.map((query) => window.matchMedia(query));
    lists.forEach((list) => list.addEventListener('change', onChange));
    // Width can cross a threshold without any of the media queries flipping (e.g. between
    // 768 and 1024 on a mouse-driven window), so listen to resize as well.
    window.addEventListener('resize', onChange);
    onChange();
    return () => {
      lists.forEach((list) => list.removeEventListener('change', onChange));
      window.removeEventListener('resize', onChange);
    };
  }, []);

  return profile;
}

/** Convenience wrapper for the common "is this the mobile experience?" question. */
export function useIsMobileExperience(): boolean {
  return useDeviceProfile().isMobile;
}
