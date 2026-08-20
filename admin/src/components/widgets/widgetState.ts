import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { STATE_RESTORED_EVENT } from '@/services/desktopState';

/**
 * Where widgets are, and which ones a given surface is showing.
 *
 * Two independent records, because they change for different reasons: the *set* of widgets
 * changes when someone adds or removes one, and the *placement* of a widget changes on every
 * drag. Keeping them apart means a drag does not rewrite the membership list forty times a
 * second, and a surface with a fixed set of widgets still remembers where they were put.
 *
 * Both live under the `canteenos_` prefix, so the Settings export/import already carries them.
 */

/**
 * The corner a widget's offsets are measured from — which is the whole point of "dockable".
 * A widget parked in the bottom-right stays in the bottom-right when the shell is resized,
 * instead of drifting off the edge as it would with plain top-left coordinates.
 */
export type WidgetDock = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface WidgetPlacement {
  dock: WidgetDock;
  /** Distance from the docked vertical edge to the widget's nearer side. */
  offsetX: number;
  /** Distance from the docked horizontal edge to the widget's nearer side. */
  offsetY: number;
  w: number;
  h: number;
}

export const WIDGET_PLACEMENT_KEY = 'canteenos_widget_placement_v1';
export const WIDGET_MEMBERSHIP_KEY = 'canteenos_widgets_v1';
export const WIDGET_OPTIONS_KEY = 'canteenos_widget_options_v1';

/** The desktop's own surface id. Named so Settings and the desktop cannot disagree on it. */
export const DESKTOP_HOST = 'desktop';

/** Fired whenever a surface's widget set changes, so every mounted surface re-reads. */
export const WIDGETS_CHANGED_EVENT = 'canteenos:widgets-changed';

type PlacementMap = Record<string, WidgetPlacement>;
type MembershipMap = Record<string, string[]>;

const DOCKS: WidgetDock[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function slotKey(hostId: string, widgetId: string): string {
  return `${hostId}:${widgetId}`;
}

/* ----------------------------------------------------------------------- placement */

function isPlacement(value: unknown): value is WidgetPlacement {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    DOCKS.includes(candidate['dock'] as WidgetDock) &&
    Number.isFinite(candidate['offsetX']) &&
    Number.isFinite(candidate['offsetY']) &&
    Number.isFinite(candidate['w']) &&
    Number.isFinite(candidate['h'])
  );
}

export function loadPlacement(hostId: string, widgetId: string): WidgetPlacement | null {
  const stored: unknown = readJson<PlacementMap>(WIDGET_PLACEMENT_KEY, {})[slotKey(hostId, widgetId)];
  return isPlacement(stored) ? stored : null;
}

export function savePlacement(hostId: string, widgetId: string, placement: WidgetPlacement): void {
  const all = readJson<PlacementMap>(WIDGET_PLACEMENT_KEY, {});
  all[slotKey(hostId, widgetId)] = placement;
  localStorage.setItem(WIDGET_PLACEMENT_KEY, JSON.stringify(all));
}

/* ------------------------------------------------------------------------- options */

/**
 * A widget's own display switches — whether the clock also shows weather, and so on. Kept
 * apart from placement for the same reason placement is kept apart from membership: they
 * change on completely different occasions, and a drag must not rewrite a preference.
 */
export type WidgetOptions = Record<string, boolean>;

type OptionsMap = Record<string, WidgetOptions>;

let optionsCache: OptionsMap | undefined;

function allOptions(): OptionsMap {
  optionsCache ??= readJson<OptionsMap>(WIDGET_OPTIONS_KEY, {});
  return optionsCache;
}

const NO_OPTIONS: WidgetOptions = {};

export function widgetOptions(hostId: string, widgetId: string): WidgetOptions {
  return allOptions()[slotKey(hostId, widgetId)] ?? NO_OPTIONS;
}

export function setWidgetOption(
  hostId: string,
  widgetId: string,
  key: string,
  value: boolean,
): void {
  const slot = slotKey(hostId, widgetId);
  const next: OptionsMap = {
    ...allOptions(),
    [slot]: { ...(allOptions()[slot] ?? {}), [key]: value },
  };
  optionsCache = next;
  localStorage.setItem(WIDGET_OPTIONS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(WIDGETS_CHANGED_EVENT));
}

/** Stored switches merged over the registry's defaults, so an untouched widget still works. */
export function useWidgetOptions(
  hostId: string,
  widgetId: string,
  defaults: WidgetOptions,
): WidgetOptions {
  const stored = useSyncExternalStore(
    subscribe,
    useCallback(() => widgetOptions(hostId, widgetId), [hostId, widgetId]),
    () => NO_OPTIONS,
  );
  return useMemo(() => ({ ...defaults, ...stored }), [defaults, stored]);
}

/* ---------------------------------------------------------------------- membership */

/**
 * `useSyncExternalStore` compares by identity, so the parsed membership map is cached and
 * only rebuilt when something actually writes to it. Without this the desktop re-renders in
 * a loop.
 */
let membershipCache: MembershipMap | undefined;

function membership(): MembershipMap {
  membershipCache ??= readJson<MembershipMap>(WIDGET_MEMBERSHIP_KEY, {});
  return membershipCache;
}

function commit(next: MembershipMap): void {
  membershipCache = next;
  localStorage.setItem(WIDGET_MEMBERSHIP_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(WIDGETS_CHANGED_EVENT));
}

const EMPTY: string[] = [];

export function hostWidgets(hostId: string): string[] {
  const ids = membership()[hostId];
  return Array.isArray(ids) ? ids : EMPTY;
}

export function addHostWidget(hostId: string, widgetId: string): void {
  const current = hostWidgets(hostId);
  if (current.includes(widgetId)) return;
  commit({ ...membership(), [hostId]: [...current, widgetId] });
}

export function removeHostWidget(hostId: string, widgetId: string): void {
  const current = hostWidgets(hostId);
  if (!current.includes(widgetId)) return;
  commit({ ...membership(), [hostId]: current.filter((id) => id !== widgetId) });
}

export function setHostWidgets(hostId: string, widgetIds: string[]): void {
  commit({ ...membership(), [hostId]: widgetIds });
}

/**
 * Forgets both the set and the placements for one surface, so the next mount starts from the
 * surface's own defaults rather than from a layout somebody has since dragged into a corner.
 */
export function resetHost(hostId: string): void {
  const next = { ...membership() };
  delete next[hostId];

  const prefix = `${hostId}:`;
  const placements = readJson<PlacementMap>(WIDGET_PLACEMENT_KEY, {});
  for (const key of Object.keys(placements)) {
    if (key.startsWith(prefix)) delete placements[key];
  }
  localStorage.setItem(WIDGET_PLACEMENT_KEY, JSON.stringify(placements));

  const options = { ...allOptions() };
  for (const key of Object.keys(options)) {
    if (key.startsWith(prefix)) delete options[key];
  }
  optionsCache = options;
  localStorage.setItem(WIDGET_OPTIONS_KEY, JSON.stringify(options));

  commit(next);
}

function subscribe(onChange: () => void): () => void {
  const invalidate = (): void => {
    membershipCache = undefined;
    optionsCache = undefined;
    onChange();
  };
  window.addEventListener(WIDGETS_CHANGED_EVENT, invalidate);
  window.addEventListener(STATE_RESTORED_EVENT, invalidate);
  return () => {
    window.removeEventListener(WIDGETS_CHANGED_EVENT, invalidate);
    window.removeEventListener(STATE_RESTORED_EVENT, invalidate);
  };
}

/** The widget ids a surface is currently showing, live across adds, removes and imports. */
export function useHostWidgets(hostId: string): string[] {
  const snapshot = useCallback(() => hostWidgets(hostId), [hostId]);
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** True once the surface has a stored set — i.e. its defaults have already been seeded. */
export function hostIsSeeded(hostId: string): boolean {
  return Array.isArray(membership()[hostId]);
}
