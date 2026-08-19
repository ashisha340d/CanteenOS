import type { ComponentType, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { saveWindowLayout } from './desktopState';

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
  /** Restored sessions need their saved flags; fresh launches leave both false. */
  minimized?: boolean;
  maximized?: boolean;
  alwaysMaximized?: boolean;
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

export function WindowManagerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [windows, setWindows] = useState<ManagedWindow[]>([]);
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
          return prev.map((w) =>
            w.id === request.id ? { ...w, zIndex: z, minimized: false } : w,
          );
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
          },
        ];
      });
      setFocusedId(request.id);
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

  // Focus follows the stack. Closing or minimising the active window hands focus to whatever
  // is now on top, so Esc and the task bar never point at a window that is gone.
  useEffect(() => {
    if (focusedId && windows.some((w) => w.id === focusedId && !w.minimized)) return;
    const top = windows
      .filter((w) => !w.minimized)
      .reduce<ManagedWindow | null>((best, w) => (!best || w.zIndex > best.zIndex ? w : best), null);
    setFocusedId(top?.id ?? null);
  }, [windows, focusedId]);

  // The desktop comes back the way it was left: layout lands in the state blob after a short
  // debounce, so a drag does not write storage on every mouse move.
  useEffect(() => {
    const timer = setTimeout(() => {
      saveWindowLayout(
        windows.map((w) => ({
          id: w.id,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          zIndex: w.zIndex,
          minimized: w.minimized,
          maximized: w.maximized,
        })),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [windows]);

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

/**
 * The maximised window, if there is one — the topmost, so a floating window raised over a
 * maximised one does not steal the caption.
 *
 * A maximised child in an MDI application gives up its own title bar and docks its title and
 * controls into the parent's bar, which is a row of vertical space back for the content.
 */
export function useDockedWindow(): ManagedWindow | null {
  const { windows } = useWindowManager();
  return windows
    .filter((w) => w.maximized && !w.minimized)
    .reduce<ManagedWindow | null>((best, w) => (!best || w.zIndex > best.zIndex ? w : best), null);
}
