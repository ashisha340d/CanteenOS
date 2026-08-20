import { createElement, useCallback } from 'react';
import { useWindowManager } from './WindowManager';
import { findApp, type DesktopApp } from './appRegistry';

const MAX_W = 1120;
const MAX_H = 720;
const CASCADE_STEP = 26;
const CASCADE_WRAP = 7;

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

      const w = Math.max(420, Math.min(MAX_W, viewport.width - 80));
      const h = Math.max(300, Math.min(MAX_H, viewport.height - 60));
      const cascade = (windows.length % CASCADE_WRAP) * CASCADE_STEP;

      open({
        id: app.id,
        title: app.label,
        accent: app.accent,
        Icon: app.Icon,
        component: createElement(app.Component),
        x: Math.max(16, Math.round((viewport.width - w) / 2 + cascade - 60)),
        y: Math.max(16, Math.round((viewport.height - h) / 2 + cascade - 30)),
        w,
        h,
        alwaysMaximized: app.alwaysMaximized,
      });
    },
    [open, windows.length, viewport],
  );
}
