import { createElement, useCallback } from 'react';
import { useWindowManager, type Viewport } from './WindowManager';
import { findApp, type DesktopApp } from './appRegistry';
import { getAppGeometry, type RememberedGeometry } from './desktopState';

const MAX_W = 1120;
const MAX_H = 720;
const CASCADE_STEP = 26;
const CASCADE_WRAP = 7;
/** How much of a restored window must stay on screen for it to be grabbable. */
const MIN_VISIBLE = 120;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampBox(b: Box, viewport: Viewport): Box {
  const w = Math.max(420, Math.min(b.w, viewport.width - 16));
  const h = Math.max(300, Math.min(b.h, viewport.height - 16));
  return {
    w,
    h,
    x: Math.max(0, Math.min(b.x, viewport.width - MIN_VISIBLE)),
    y: Math.max(0, Math.min(b.y, viewport.height - 40)),
  };
}

/**
 * A remembered window may not fit the screen it comes back to — a smaller display, a resized
 * browser, a different workstation sharing the same saved state. Pull it back into view rather
 * than opening it somewhere the operator cannot reach the caption bar.
 */
function clampToViewport(g: RememberedGeometry, viewport: Viewport): RememberedGeometry {
  return {
    ...clampBox({ x: g.x, y: g.y, w: g.w, h: g.h }, viewport),
    maximized: g.maximized,
    // Clamped as well, not passed through: a window maximised on a large screen and reopened on
    // a smaller one would otherwise un-maximise to a floating box that is off the display.
    ...(g.restore !== undefined ? { restore: clampBox(g.restore, viewport) } : {}),
  };
}

/**
 * One way to open a module, shared by the desktop icons, the Start menu and the desktop
 * context menu — so a window lands in the same place however it was launched.
 *
 * Re-opening a module that is already running raises it instead of stacking a second copy;
 * that decision lives in the window manager's `open`.
 */
export function useLaunchApp(): (app: DesktopApp | string) => void {
  const { open, windows, viewport } = useWindowManager();

  return useCallback(
    (target: DesktopApp | string) => {
      const app = typeof target === 'string' ? findApp(target) : target;
      if (!app) return;

      // A separate application gets a separate window — named, so a second launch reuses the
      // one already open rather than piling up display tabs.
      if (app.externalUrl !== undefined) {
        window.open(app.externalUrl, `canteenos-${app.id}`, 'noopener,noreferrer')?.focus();
        return;
      }

      // Where this module was last left, if it has ever been opened. The cascade is only for a
      // window with no history — using it unconditionally is what made a carefully placed
      // module jump back to the middle of the screen every time it was reopened.
      const saved = getAppGeometry(app.id);
      const placement: RememberedGeometry = saved
        ? clampToViewport(saved, viewport)
        : (() => {
            const w = Math.max(420, Math.min(MAX_W, viewport.width - 80));
            const h = Math.max(300, Math.min(MAX_H, viewport.height - 60));
            const cascade = (windows.length % CASCADE_WRAP) * CASCADE_STEP;
            return {
              x: Math.max(16, Math.round((viewport.width - w) / 2 + cascade - 60)),
              y: Math.max(16, Math.round((viewport.height - h) / 2 + cascade - 30)),
              w,
              h,
              maximized: false,
            };
          })();

      open({
        id: app.id,
        title: app.label,
        accent: app.accent,
        Icon: app.Icon,
        component: createElement(app.Component),
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
        maximized: placement.maximized,
        // Carried through so a window closed while maximised still knows the floating size to
        // un-maximise back to, instead of being stuck full-screen.
        ...(placement.restore !== undefined ? { restore: placement.restore } : {}),
        alwaysMaximized: app.alwaysMaximized,
      });
    },
    [open, windows.length, viewport],
  );
}
