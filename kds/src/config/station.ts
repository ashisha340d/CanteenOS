import type { Uuid } from '@menuboard/shared';

export type StationMode = 'counter' | 'kitchen' | 'cds';

export interface StationSelection {
  mode: StationMode;
  id: Uuid;
  name: string;
}

const STATION_KEY = 'menuboard.kds.station';

/**
 * A `?mode=` link outranks whatever this screen chose before: opening the CDS URL on a display
 * already pinned to a counter must show the picker, not the old board.
 */
function modeFromUrl(): StationMode | null {
  const value = new URLSearchParams(window.location.search).get('mode');
  return value === 'counter' || value === 'kitchen' || value === 'cds' ? value : null;
}

export function readStation(): StationSelection | null {
  const wanted = modeFromUrl();
  const raw = localStorage.getItem(STATION_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StationSelection>;
    if (
      (parsed.mode === 'counter' || parsed.mode === 'kitchen' || parsed.mode === 'cds') &&
      typeof parsed.id === 'string' &&
      typeof parsed.name === 'string'
    ) {
      if (wanted !== null && parsed.mode !== wanted) return null;
      return { mode: parsed.mode, id: parsed.id, name: parsed.name };
    }
  } catch {
    // A corrupt entry is the same as no entry.
  }
  localStorage.removeItem(STATION_KEY);
  return null;
}

export function saveStation(station: StationSelection): void {
  localStorage.setItem(STATION_KEY, JSON.stringify(station));
}

export function clearStation(): void {
  localStorage.removeItem(STATION_KEY);
}

/* Out-of-station: whether this screen is unmanned right now. Remembered per station so a
   reload mid-shift does not quietly mark the counter staffed again. */

export interface AwayState {
  on: boolean;
  /** Manual away only clears from the button; idle-detected away clears on any touch. */
  manual: boolean;
}

const awayKeyFor = (stationId: string): string => `menuboard.kds.away.${stationId}`;

export function readAway(stationId: string): AwayState {
  try {
    const parsed = JSON.parse(localStorage.getItem(awayKeyFor(stationId)) ?? '') as Partial<AwayState>;
    return { on: parsed.on === true, manual: parsed.manual === true };
  } catch {
    return { on: false, manual: false };
  }
}

export function saveAway(stationId: string, away: AwayState): void {
  localStorage.setItem(awayKeyFor(stationId), JSON.stringify(away));
}
