import { useSyncExternalStore } from 'react';
import { STATE_RESTORED_EVENT } from './desktopState';

/**
 * Where this workstation physically is.
 *
 * Only two features need it — the weather widget and the holiday calendar — but both need it
 * to be exact rather than guessed: a canteen in Pune and one in Coimbatore keep different
 * public holidays and see different weather, and neither can be inferred from the browser's
 * locale. So it is asked for once, in Settings, and stored here.
 *
 * Coordinates and timezone come from the same geocoding lookup that resolved the name, so a
 * saved location is always internally consistent — the user never types a latitude.
 */

export interface WorkstationLocation {
  name: string;
  /** State or province, when the geocoder knows one. Disambiguates same-named towns. */
  region: string | null;
  country: string;
  /** ISO 3166-1 alpha-2. The holiday calendar is keyed on this. */
  countryCode: string;
  latitude: number;
  longitude: number;
  /** IANA zone, e.g. `Asia/Kolkata`. */
  timezone: string;
}

const LOCATION_KEY = 'menuboard.admin.location';

/** Fired on save so every mounted widget re-reads without a provider in between. */
export const LOCATION_CHANGED_EVENT = 'canteenos:location-changed';

/**
 * `useSyncExternalStore` compares snapshots by identity, so parsing on every call would
 * re-render forever. The parsed value is held until something invalidates it.
 */
let cached: WorkstationLocation | null | undefined;

function isLocation(value: unknown): value is WorkstationLocation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['name'] === 'string' &&
    typeof candidate['country'] === 'string' &&
    typeof candidate['countryCode'] === 'string' &&
    typeof candidate['timezone'] === 'string' &&
    Number.isFinite(candidate['latitude']) &&
    Number.isFinite(candidate['longitude'])
  );
}

export function loadLocation(): WorkstationLocation | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    cached = isLocation(parsed) ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function saveLocation(next: WorkstationLocation | null): void {
  cached = next;
  if (next === null) localStorage.removeItem(LOCATION_KEY);
  else localStorage.setItem(LOCATION_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(LOCATION_CHANGED_EVENT));
}

function subscribe(onChange: () => void): () => void {
  // An imported snapshot rewrites the key underneath us, so that counts as a change too.
  const invalidate = (): void => {
    cached = undefined;
    onChange();
  };
  window.addEventListener(LOCATION_CHANGED_EVENT, invalidate);
  window.addEventListener(STATE_RESTORED_EVENT, invalidate);
  return () => {
    window.removeEventListener(LOCATION_CHANGED_EVENT, invalidate);
    window.removeEventListener(STATE_RESTORED_EVENT, invalidate);
  };
}

export function useWorkstationLocation(): WorkstationLocation | null {
  return useSyncExternalStore(subscribe, loadLocation, () => null);
}

/** `Pune, Maharashtra · India` — the one-line form used in Settings and widget captions. */
export function describeLocation(location: WorkstationLocation): string {
  const place = location.region === null ? location.name : `${location.name}, ${location.region}`;
  return `${place} · ${location.country}`;
}
