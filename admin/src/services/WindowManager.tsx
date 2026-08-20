import type { ComponentType, ReactNode } from 'react';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { findApp } from './appRegistry';
import {
  loadWindowLayout,
  saveWindowLayout,
  STATE_RESTORED_EVENT,
  type PersistedWindowLayout,
} from './desktopState';

/** Any icon that accepts a className — in practice a lucide glyph. */
export type WindowIcon = ComponentType<{ className?: string }>;

export interface ManagedWindow {
  id: string;
  title: string;
  accent?: string;
  /** Shown in the title bar, the task button and the docked caption. */
  Icon?: WindowIcon;
  component: ReactNode;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  /**
   * Full-screen appliances (POS, display screens) never give the maximized state back: they
   * cannot be restored to floating, and Escape cannot close them. The task bar can still
   * minimise them, and their caption controls can still close them.
   */
  alwaysMaximized: boolean;
  /** Geometry to restore to when un-maximising. */
  restore?: { x: number; y: number; w: number; h: number };
}

export interface OpenWindowRequest {
  id: string;
  title: string;
  accent?: string;
  Icon?: WindowIcon;
  component: ReactNode;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized?: boolean;
  maximized?: boolean;
  alwaysMaximized?: boolean;
  /** Where to un-maximise to. */
  restore?: { x: number; y: number; w: number; h: number };
}

export interface Viewport {
  width: number;
  height: number;
}

interface WindowManagerState {
  windows: ManagedWindow[];
  focusedId: string | null;
  /** Size of the client area windows live in, published by WindowsLayer. */
  viewport: Viewport;
  setViewport: (viewport: Viewport) => void;
  open: (window: OpenWindowRequest) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  maximize: (id: string) => void;
  minimizeAll: () => void;
  closeAll: () => void;
  cascade: () => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, w: number, h: number) => void;
  /** Resizing from a top/left edge moves the origin as it changes the size. */
  setBounds: (id: string, bounds: { x: number; y: number; w: number; h: number }) => void;
}

const WindowManagerContext = createContext<WindowManagerState | null>(null);

const Z_BASE = 100;

const CASCADE_STEP = 28;

/**
 * The saved desktop, turned back into live windows.
 *
 * This runs as the **initial value of the window state**, not as a restore performed after
 * mount, and that is the whole point. Restoring after mount means there is a first render in
 * which the desktop is legitimately empty — and anything that writes during that window (the
 * debounced save, the flush on teardown, React's StrictMode remount in development) persists
 * that emptiness over the layout it was about to load. Seeding the state means `windows` is
 * never emptier than storage, so there is no moment left to lose the race in.
 *
 * A window whose module no longer ships is dropped rather than revived as an error.
 */
function hydrate(): ManagedWindow[] {
  return [...loadWindowLayout()]
    .sort((a, b) => a.zIndex - b.zIndex)
    .flatMap((saved) => {
      const app = findApp(saved.id);
      if (!app) return [];
      return [
        {
          id: app.id,
          title: app.label,
          accent: app.accent,
          Icon: app.Icon,
          component: createElement(app.Component),
          x: saved.x,
          y: saved.y,
          w: saved.w,
          h: saved.h,
          // Kept verbatim rather than reassigned, so the stack comes back in the order it was
          // left rather than in the order this loop happened to walk it.
          zIndex: saved.zIndex,
          minimized: saved.minimized,
          maximized: app.alwaysMaximized === true || saved.maximized,
          alwaysMaximized: app.alwaysMaximized ?? false,
          ...(saved.restore !== undefined ? { restore: saved.restore } : {}),
        },
      ];
    });
}

/** The next z above everything restored, so a newly raised window still lands on top. */
function topZ(windows: ManagedWindow[]): number {
  return windows.reduce((best, w) => Math.max(best, w.zIndex), Z_BASE);
}

export function WindowManagerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [windows, setWindows] = useState<ManagedWindow[]>(hydrate);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [viewport, setViewportState] = useState<Viewport>({ width: 1280, height: 720 });

  const setViewport = useCallback((next: Viewport) => {
    setViewportState((prev) =>
      prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, []);

  // Held in a ref, not a module global: mutating a module-level counter from inside a state
  // updater is a side effect the updater is not allowed to have (StrictMode double-invokes it,
  // and every provider instance would share the same counter).
  const zRef = useRef(Z_BASE);
  // Seeded once, from the restored stack — which may already be using values above the base.
  const zSeeded = useRef(false);
  if (!zSeeded.current) {
    zSeeded.current = true;
    zRef.current = topZ(windows);
  }

  const nextZ = useCallback(() => {
    zRef.current += 1;
    return zRef.current;
  }, []);

  const focus = useCallback(
    (id: string) => {
      const z = nextZ();
      setWindows((prev) =>
        prev.map((w) => (w.id === id ? { ...w, zIndex: z, minimized: false } : w)),
      );
      setFocusedId(id);
    },
    [nextZ],
  );

  const open = useCallback(
    (request: OpenWindowRequest) => {
      const z = nextZ();
      setWindows((prev) => {
        // One window per module: launching an already-open app raises it rather than stacking
        // a second copy of the same page on top of itself.
        if (prev.some((w) => w.id === request.id)) {
          return prev.map((w) => (w.id === request.id ? { ...w, zIndex: z, minimized: false } : w));
        }
        return [
          ...prev,
          {
            ...request,
            zIndex: z,
            minimized: request.minimized ?? false,
            // A full-screen appliance opens maximized regardless of what the request says.
            maximized: request.alwaysMaximized === true || request.maximized === true,
            alwaysMaximized: request.alwaysMaximized ?? false,
            ...(request.restore !== undefined ? { restore: request.restore } : {}),
          },
        ];
      });
      // Opening something already minimised is a restore, not a launch: it must not take the
      // screen from whatever the operator is actually looking at.
      if (request.minimized !== true) setFocusedId(request.id);
    },
    [nextZ],
  );

  const close = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimize = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
  }, []);

  const maximize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        // Full-screen appliances never give the maximized state back.
        if (w.alwaysMaximized) return { ...w, maximized: true };
        if (w.maximized) {
          const restore = w.restore ?? { x: w.x, y: w.y, w: w.w, h: w.h };
          return { ...w, ...restore, maximized: false, restore: undefined };
        }
        return { ...w, maximized: true, restore: { x: w.x, y: w.y, w: w.w, h: w.h } };
      }),
    );
  }, []);

  const move = useCallback((id: string, x: number, y: number) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }, []);

  const resize = useCallback((id: string, w: number, h: number) => {
    setWindows((prev) => prev.map((win) => (win.id === id ? { ...win, w, h } : win)));
  }, []);

  const setBounds = useCallback(
    (id: string, bounds: { x: number; y: number; w: number; h: number }) => {
      setWindows((prev) => prev.map((win) => (win.id === id ? { ...win, ...bounds } : win)));
    },
    [],
  );

  const minimizeAll = useCallback(() => {
    setWindows((prev) => prev.map((w) => ({ ...w, minimized: true })));
  }, []);

  const closeAll = useCallback(() => {
    setWindows([]);
  }, []);

  /** Fan every open window out from the top-left, restoring anything minimised or maximised. */
  const cascade = useCallback(() => {
    setWindows((prev) => {
      const w = Math.max(420, Math.min(980, viewport.width - 120));
      const h = Math.max(300, Math.min(640, viewport.height - 120));
      return prev.map((win, index) => ({
        ...win,
        minimized: false,
        maximized: false,
        restore: undefined,
        x: 24 + index * CASCADE_STEP,
        y: 24 + index * CASCADE_STEP,
        w,
        h,
      }));
    });
  }, [viewport]);

  // Focus follows the stack. Closing or minimising the active window hands focus to whatever is
  // now on top, so Esc and the task bar never point at a window that is gone. It is also what
  // gives a freshly restored desktop its focused window, without the restore having to choose.
  useEffect(() => {
    if (focusedId && windows.some((w) => w.id === focusedId && !w.minimized)) return;
    const top = windows
      .filter((w) => !w.minimized)
      .reduce<ManagedWindow | null>((best, w) => (!best || w.zIndex > best.zIndex ? w : best), null);
    setFocusedId(top?.id ?? null);
  }, [windows, focusedId]);

  /* Importing a state file replaces the layout underneath a running desktop, so the stack is
     rebuilt from what was just written rather than left showing the previous session. */
  useEffect(() => {
    const onRestored = (): void => {
      const next = hydrate();
      zRef.current = topZ(next);
      setWindows(next);
      setFocusedId(null);
    };
    window.addEventListener(STATE_RESTORED_EVENT, onRestored);
    return () => window.removeEventListener(STATE_RESTORED_EVENT, onRestored);
  }, []);

  /* The desktop comes back the way it was left.

     Writing lands after a short debounce so a drag does not hit storage on every mouse move —
     but the debounce is also how the last change of a session used to disappear: maximise a
     window and close the tab inside those 300ms and nothing was ever written, which reads
     exactly like "it does not remember". So the same snapshot is also flushed synchronously
     when the page is being hidden or torn down. */
  const snapshot = useCallback(
    (): PersistedWindowLayout[] =>
      windows.map((w) => ({
        id: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        zIndex: w.zIndex,
        minimized: w.minimized,
        maximized: w.maximized,
        ...(w.restore !== undefined ? { restore: w.restore } : {}),
      })),
    [windows],
  );

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const timer = setTimeout(() => saveWindowLayout(snapshot()), 300);
    return () => clearTimeout(timer);
  }, [snapshot]);

  useEffect(() => {
    const flush = (): void => saveWindowLayout(snapshotRef.current());
    // `pagehide` fires on close, reload and navigation away, including the cases `beforeunload`
    // is unreliable for on mobile; `hidden` covers a tab simply being switched away from.
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      // Leaving the desktop entirely (a full-bleed route like POS) tears this provider down
      // with a debounce possibly still pending.
      flush();
    };
  }, []);

  const state = useMemo(
    () => ({
      windows,
      focusedId,
      viewport,
      setViewport,
      open,
      close,
      focus,
      minimize,
      maximize,
      minimizeAll,
      closeAll,
      cascade,
      move,
      resize,
      setBounds,
    }),
    [
      windows,
      focusedId,
      viewport,
      setViewport,
      open,
      close,
      focus,
      minimize,
      maximize,
      minimizeAll,
      closeAll,
      cascade,
      move,
      resize,
      setBounds,
    ],
  );

  return <WindowManagerContext.Provider value={state}>{children}</WindowManagerContext.Provider>;
}

export function useWindowManager(): WindowManagerState {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) throw new Error('useWindowManager must be used inside WindowManagerProvider');
  return ctx;
}
