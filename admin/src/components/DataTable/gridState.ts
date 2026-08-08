import { useCallback, useState } from 'react';

export interface GridPersistedState {
  widths: Record<string, number>;
  order: string[];
  /** Columns the user has switched off. Stored as a list so new columns default to visible. */
  hidden: string[];
  /** Columns frozen to the left edge, in pin order. */
  pinned: string[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

const PREFIX = 'menuboard.admin.grid.';

/**
 * Column widths, order, visibility, pinning and sort, persisted per grid id
 * (docs/AGENTS.md Grid Standard).
 *
 * Stored per browser rather than per account: these are workstation preferences — a column
 * width that suits a 4K desk monitor is wrong on a laptop, and the same user moves between
 * both. Anything genuinely account-level belongs in the settings API, not here.
 */
export function useGridState(
  gridId: string,
  defaultFields: string[],
): { state: GridPersistedState; update: (patch: Partial<GridPersistedState>) => void; reset: () => void } {
  const key = PREFIX + gridId;
  const [state, setState] = useState<GridPersistedState>(() => defaultState(key, defaultFields));

  const update = useCallback(
    (patch: Partial<GridPersistedState>) => {
      setState((prev) => {
        const next = { ...prev, ...patch };
        localStorage.setItem(key, JSON.stringify(next));
        return next;
      });
    },
    [key],
  );

  const reset = useCallback(() => {
    localStorage.removeItem(key);
    setState({ widths: {}, order: defaultFields, hidden: [], pinned: [] });
    // defaultFields is rebuilt each render by the caller; depending on it would reset on
    // every render. The field list only changes when the page itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state, update, reset };
}

function defaultState(key: string, defaultFields: string[]): GridPersistedState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GridPersistedState>;
      const order = parsed.order ?? [];
      // Merge in any newly-added columns not present in a previously-persisted order, and
      // drop any that no longer exist, so a release that changes the columns cannot strand
      // a user with a broken grid.
      const known = order.filter((field) => defaultFields.includes(field));
      const missing = defaultFields.filter((field) => !known.includes(field));
      return {
        widths: parsed.widths ?? {},
        order: [...known, ...missing],
        hidden: (parsed.hidden ?? []).filter((field) => defaultFields.includes(field)),
        pinned: (parsed.pinned ?? []).filter((field) => defaultFields.includes(field)),
        ...(parsed.sortBy !== undefined ? { sortBy: parsed.sortBy } : {}),
        ...(parsed.sortDir !== undefined ? { sortDir: parsed.sortDir } : {}),
      };
    }
  } catch {
    // fall through to defaults
  }
  return { widths: {}, order: defaultFields, hidden: [], pinned: [] };
}

const VIEW_PREFIX = 'menuboard.admin.view.';

export function useViewMode(pageId: string): ['table' | 'card', (mode: 'table' | 'card') => void] {
  const key = VIEW_PREFIX + pageId;
  const [mode, setModeState] = useState<'table' | 'card'>(() => {
    const raw = localStorage.getItem(key);
    return raw === 'card' ? 'card' : 'table';
  });
  const setMode = useCallback(
    (next: 'table' | 'card') => {
      setModeState(next);
      localStorage.setItem(key, next);
    },
    [key],
  );
  return [mode, setMode];
}
