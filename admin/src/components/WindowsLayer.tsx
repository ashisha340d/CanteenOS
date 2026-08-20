import { useEffect, useRef } from 'react';
import { DesktopWindow } from './DesktopWindow';
import { useWindowManager, type ManagedWindow } from '@/services/WindowManager';

/** Fields and rich-text areas own Escape while they have the caret. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * A dialog, popover, select, tooltip or the command palette is layered above the window and
 * must consume Escape first — otherwise dismissing a confirm dialog also closes the window
 * behind it.
 */
function overlayIsOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]',
    ),
  );
}

/**
 * Where the windows are drawn.
 *
 * Restoring the saved layout is deliberately *not* done here. This layer mounts under the
 * window manager, so anything it restored would arrive one render after the manager had
 * already published — and begun persisting — an empty desktop. The manager seeds itself from
 * storage instead, and this component only ever renders what it is given.
 */
export function WindowsLayer(): JSX.Element {
  const { windows, close, focusedId, move, setViewport } = useWindowManager();
  const layerRef = useRef<HTMLDivElement>(null);
  const windowsRef = useRef<ManagedWindow[]>(windows);
  windowsRef.current = windows;

  // Publish the client area so anything that opens a window — desktop icon, Start menu,
  // context menu — can centre it without reaching for the DOM itself.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const observer = new ResizeObserver(() => {
      setViewport({ width: layer.clientWidth, height: layer.clientHeight });
    });
    observer.observe(layer);
    setViewport({ width: layer.clientWidth, height: layer.clientHeight });
    return () => observer.disconnect();
  }, [setViewport]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!focusedId) return;
      if (overlayIsOpen() || isTypingTarget(event.target)) return;
      // Full-screen appliances (POS, display screens) never exit on Escape.
      const focused = windowsRef.current.find((w) => w.id === focusedId);
      if (focused?.alwaysMaximized) return;
      close(focusedId);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, focusedId]);

  // A narrower browser would otherwise strand windows off-screen with no way to drag them back.
  useEffect(() => {
    function onResize(): void {
      const layer = layerRef.current;
      if (!layer) return;
      const maxX = Math.max(0, layer.clientWidth - 120);
      const maxY = Math.max(0, layer.clientHeight - 40);
      for (const win of windowsRef.current) {
        const x = Math.min(win.x, maxX);
        const y = Math.min(win.y, maxY);
        if (x !== win.x || y !== win.y) move(win.id, x, y);
      }
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [move]);

  return (
    // Transparent to the pointer so desktop icons underneath stay clickable; each window opts
    // back in for itself. A full-size wrapper per window would swallow every click on the
    // desktop and on every window below it.
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-40">
      {windows.map((win) => (
        <DesktopWindow key={win.id} win={win} isFocused={win.id === focusedId} />
      ))}
    </div>
  );
}
