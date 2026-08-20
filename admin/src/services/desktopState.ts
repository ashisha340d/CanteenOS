/**
 * One place where every workstation preference lives — or is at least collected by.
 *
 * Two layers, deliberately:
 *
 * 1. **Live state** — things a running session writes continuously (open windows, selected
 *    module tab). These go into a single JSON blob under STATE_KEY, written through this
 *    module, never scattered across component files.
 *
 * 2. **Snapshot** — `snapshotDesktopState()` / `restoreDesktopSnapshot()`. One function reads
 *    everything this app has ever persisted (the blob, plus the pre-existing per-feature keys
 *    for grids, view modes, modal geometry, POS preferences and icons), and one function
 *    writes it all back. Export/import/reset in Settings are thin wrappers over these two.
 */

export interface PersistedWindowLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  /**
   * Where a maximised window goes back to. Without it, a window restored in the maximised
   * state had nothing to un-maximise *to* — it simply stayed full-screen, which read as the
   * desktop having forgotten the size it was given.
   */
  restore?: { x: number; y: number; w: number; h: number };
}

export interface DesktopSnapshot {
  version: 1;
  capturedAt: string;
  /** Window layout from the live blob, which owns it. */
  windows: PersistedWindowLayout[];
  /** Every matched localStorage entry, verbatim — grids, views, modals, POS prefs, icons. */
  storage: Record<string, string>;
}

const STATE_KEY = 'canteenos.state.v1';

/* Anything this app has ever written that is worth keeping. The pre-existing feature stores
   predate the blob, so the snapshot gathers them by prefix rather than renaming history. */
const STORAGE_PREFIXES = ['menuboard.admin.', 'canteenos_', 'pos-'];

/** Fired after a snapshot restore / reset so live features re-read their keys. */
export const STATE_RESTORED_EVENT = 'canteenos:state-restored';

interface Blob {
  windows?: PersistedWindowLayout[];
  moduleTabs?: Record<string, string>;
}

function readBlob(): Blob {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as Blob) : {};
  } catch {
    return {};
  }
}

function writeBlob(patch: Blob): void {
  localStorage.setItem(STATE_KEY, JSON.stringify({ ...readBlob(), ...patch }));
}

/* ---------------------------------------------------------------------- live state */

export function saveWindowLayout(windows: PersistedWindowLayout[]): void {
  writeBlob({ windows });
}

export function loadWindowLayout(): PersistedWindowLayout[] {
  return readBlob().windows ?? [];
}

export function getModuleTab(moduleId: string): string | undefined {
  return readBlob().moduleTabs?.[moduleId];
}

export function setModuleTab(moduleId: string, tab: string): void {
  writeBlob({ moduleTabs: { ...readBlob().moduleTabs, [moduleId]: tab } });
}

/* --------------------------------------------------------------- remembered windows */

/** What a window remembers between being closed and being launched again. */
export interface RememberedGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  maximized: boolean;
  /** Where to un-maximise to, kept so a window closed maximised still knows its floating size. */
  restore?: { x: number; y: number; w: number; h: number };
}

/* Deliberately its own key rather than a third field on the blob. `snapshotDesktopState()`
   skips STATE_KEY and reads the blob only through `windows`, and `restoreDesktopSnapshot()`
   clears storage before writing that one field back — so any other blob field is dropped on
   export and wiped on import. A `menuboard.admin.` key is already matched by STORAGE_PREFIXES,
   so this rides along in a snapshot verbatim with no changes to the code below. */
const APP_GEOMETRY_KEY = 'menuboard.admin.desktop.app-geometry.v1';

function readAppGeometry(): Record<string, RememberedGeometry> {
  try {
    const raw = localStorage.getItem(APP_GEOMETRY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, RememberedGeometry>) : {};
  } catch {
    return {};
  }
}

/**
 * The size and position an app was last seen at, or undefined if it has never been opened.
 *
 * The saved layout only covers windows that are *open*: closing one drops it from that list,
 * which is why a module used to come back at the default cascade position however carefully it
 * had been placed. This outlives the window itself.
 */
export function getAppGeometry(appId: string): RememberedGeometry | undefined {
  return readAppGeometry()[appId];
}

/** Merged, not replaced, so remembering one window never forgets the others. */
export function rememberAppGeometry(entries: Record<string, RememberedGeometry>): void {
  if (Object.keys(entries).length === 0) return;
  localStorage.setItem(APP_GEOMETRY_KEY, JSON.stringify({ ...readAppGeometry(), ...entries }));
}

/* ------------------------------------------------------------------------ snapshot */

/** Everything, in one call. */
export function snapshotDesktopState(): DesktopSnapshot {
  const storage: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || key === STATE_KEY) continue;
    if (!STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    const value = localStorage.getItem(key);
    if (value !== null) storage[key] = value;
  }
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    windows: loadWindowLayout(),
    storage,
  };
}

/** Everything, back, in one call. Live features re-read via the restored event. */
export function restoreDesktopSnapshot(snapshot: DesktopSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Not a Canteen OS state file.');
  if (snapshot.version !== 1) throw new Error(`Unsupported state version: ${String(snapshot.version)}`);

  clearDesktopState();
  for (const [key, value] of Object.entries(snapshot.storage ?? {})) {
    localStorage.setItem(key, value);
  }
  writeBlob({ windows: snapshot.windows ?? [] });
  window.dispatchEvent(new CustomEvent(STATE_RESTORED_EVENT));
}

/** Wipe every preference this app owns. The blob included. */
export function clearDesktopState(): void {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && (key === STATE_KEY || STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
      doomed.push(key);
    }
  }
  doomed.forEach((key) => localStorage.removeItem(key));
}

/* ------------------------------------------------------------------ file round-trip */

export function downloadSnapshot(): void {
  const json = JSON.stringify(snapshotDesktopState(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `canteenos-state-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function readSnapshotFile(file: File): Promise<DesktopSnapshot> {
  return file.text().then((text) => JSON.parse(text) as DesktopSnapshot);
}
