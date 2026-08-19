import { Suspense, useCallback, useRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useWindowManager, type ManagedWindow } from '@/services/WindowManager';
import './DesktopWindow.css';

interface DesktopWindowProps {
  win: ManagedWindow;
  isFocused: boolean;
}

const TITLE_HEIGHT = 38;
const MIN_W = 420;
const MIN_H = 300;

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function DesktopWindow({ win, isFocused }: DesktopWindowProps): JSX.Element | null {
  const { close, focus, minimize, maximize, move, setBounds } = useWindowManager();
  const winRef = useRef<HTMLDivElement>(null);

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (win.maximized || e.button !== 0) return;
      e.preventDefault();
      focus(win.id);
      const offset = { x: e.clientX - win.x, y: e.clientY - win.y };

      const onMove = (ev: MouseEvent): void => {
        const layer = winRef.current?.parentElement;
        const maxX = (layer?.clientWidth ?? window.innerWidth) - 120;
        const maxY = (layer?.clientHeight ?? window.innerHeight) - 40;
        move(
          win.id,
          Math.max(0, Math.min(maxX, ev.clientX - offset.x)),
          Math.max(0, Math.min(maxY, ev.clientY - offset.y)),
        );
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [win.id, win.x, win.y, win.maximized, focus, move],
  );

  /**
   * Resize from any edge or corner. Dragging a top or left edge has to move the origin as it
   * changes the size, or the window walks across the desktop instead of growing.
   */
  const handleResizeMouseDown = useCallback(
    (edge: ResizeEdge, e: React.MouseEvent) => {
      if (win.maximized || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      focus(win.id);
      const start = { mx: e.clientX, my: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - start.mx;
        const dy = ev.clientY - start.my;
        let { x, y, w, h } = start;

        if (edge.includes('e')) w = Math.max(MIN_W, start.w + dx);
        if (edge.includes('s')) h = Math.max(MIN_H, start.h + dy);
        if (edge.includes('w')) {
          w = Math.max(MIN_W, start.w - dx);
          x = start.x + (start.w - w);
        }
        if (edge.includes('n')) {
          h = Math.max(MIN_H, start.h - dy);
          y = start.y + (start.h - h);
        }

        setBounds(win.id, { x: Math.max(0, x), y: Math.max(0, y), w, h });
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [win.id, win.x, win.y, win.w, win.h, win.maximized, focus, setBounds],
  );

  if (win.minimized) return null;

  const geometry: React.CSSProperties = win.maximized
    ? { left: 0, top: 0, width: '100%', height: '100%', borderRadius: 0 }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  return (
    <div
      ref={winRef}
      className={`os-window ${isFocused ? 'os-window--focused' : ''} ${win.maximized ? 'os-window--docked' : ''
        }`}
      style={{ ...geometry, zIndex: win.zIndex }}
      onMouseDown={() => focus(win.id)}
    >
      {/* Maximised windows dock their caption into the app bar (see AppShell), so the title
          bar is not drawn here at all — that row of space goes back to the content. */}
      {!win.maximized && (
        <div
          className="os-window__titlebar"
          style={{ height: TITLE_HEIGHT }}
          onMouseDown={handleTitleMouseDown}
          onDoubleClick={() => maximize(win.id)}
        >
          <div className="os-window__lights">
            <button
              type="button"
              aria-label={`Close ${win.title}`}
              title="Close"
              className="os-window__light os-window__light--close"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => close(win.id)}
            />
            <button
              type="button"
              aria-label={`Minimise ${win.title}`}
              title="Minimise"
              className="os-window__light os-window__light--min"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => minimize(win.id)}
            />
            <button
              type="button"
              aria-label={`Maximise ${win.title}`}
              title="Maximise"
              className="os-window__light os-window__light--max"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => maximize(win.id)}
            />
          </div>

          {win.Icon ? (
            <span className="os-window__icon" style={{ background: win.accent }}>
              <win.Icon className="os-window__icon-glyph" />
            </span>
          ) : (
            win.accent && <span className="os-window__accent" style={{ background: win.accent }} />
          )}
          <span className="os-window__title">{win.title}</span>
        </div>
      )}

      <div className="os-window__body">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spinner className="text-muted-foreground size-5" />
              <span className="sr-only">Loading {win.title}</span>
            </div>
          }
        >
          {win.component}
        </Suspense>
      </div>

      {!win.maximized &&
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`os-window__resize os-window__resize--${edge}`}
            onMouseDown={(e) => handleResizeMouseDown(edge, e)}
            role="presentation"
          />
        ))}
    </div>
  );
}
