/**
 * Shared between the desktop and the Settings window, which lives inside a window on that very
 * desktop. Kept in its own module so the two can agree on the storage key and the reset signal
 * without importing each other.
 */

export const ICON_POSITIONS_KEY = 'canteenos_icon_positions_v1';

/** Fired by Settings; the desktop listens and puts every icon back on the default grid. */
export const RESET_ICONS_EVENT = 'canteenos:reset-desktop-icons';

export interface IconPosition {
  x: number;
  y: number;
}

export type IconPositions = Record<string, IconPosition>;

export function loadIconPositions(): IconPositions {
  try {
    const raw = JSON.parse(localStorage.getItem(ICON_POSITIONS_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    // Anything hand-edited or left over from an older layout must not crash the desktop.
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        ([, value]) =>
          typeof value === 'object' &&
          value !== null &&
          Number.isFinite((value as { x?: unknown }).x) &&
          Number.isFinite((value as { y?: unknown }).y),
      ),
    ) as IconPositions;
  } catch {
    return {};
  }
}
