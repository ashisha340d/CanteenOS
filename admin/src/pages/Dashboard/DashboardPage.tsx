import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutGridIcon,
  Minimize2Icon,
  RotateCcwIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useWindowManager } from '@/services/WindowManager';
import { useLaunchApp } from '@/services/useLaunchApp';
import { APPS, SETTINGS_APP_ID, type DesktopApp } from '@/services/appRegistry';
import { STATE_RESTORED_EVENT } from '@/services/desktopState';
import {
  ICON_POSITIONS_KEY,
  loadIconPositions,
  RESET_ICONS_EVENT,
  type IconPositions,
} from './desktopIcons';
import './DashboardPage.css';

const ICON_W = 88;
const ICON_H = 84;
const COL_W = 104;
const ROW_H = 100;
const ORIGIN = 20;
const DRAG_THRESHOLD = 4;

export function DashboardPage(): JSX.Element {
  const { windows, minimizeAll, closeAll, cascade } = useWindowManager();
  const launch = useLaunchApp();
  const [positions, setPositions] = useState<IconPositions>(loadIconPositions);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const desktopRef = useRef<HTMLDivElement>(null);
  const [rowsPerCol, setRowsPerCol] = useState(6);

  // Persisting from inside a state updater is a side effect StrictMode runs twice; mirror the
  // latest value into a ref and write from the event handler instead.
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // Settings runs in a window on this very desktop, so it asks for the reset by event rather
  // than reaching into state it cannot see.
  useEffect(() => {
    function onReset(): void {
      localStorage.removeItem(ICON_POSITIONS_KEY);
      setPositions({});
    }
    // A restored snapshot may carry different icon positions; re-read rather than re-render
    // with the pre-restore layout.
    function onStateRestored(): void {
      setPositions(loadIconPositions());
    }
    window.addEventListener(RESET_ICONS_EVENT, onReset);
    window.addEventListener(STATE_RESTORED_EVENT, onStateRestored);
    return () => {
      window.removeEventListener(RESET_ICONS_EVENT, onReset);
      window.removeEventListener(STATE_RESTORED_EVENT, onStateRestored);
    };
  }, []);

  // Columns wrap to the desktop's real height rather than a guessed six rows, so icons never
  // disappear below the fold on a short screen.
  useEffect(() => {
    function measure(): void {
      const height = desktopRef.current?.clientHeight ?? 0;
      setRowsPerCol(Math.max(1, Math.floor((height - ORIGIN) / ROW_H)));
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const defaultPosition = useCallback(
    (index: number) => ({
      x: ORIGIN + Math.floor(index / rowsPerCol) * COL_W,
      y: ORIGIN + (index % rowsPerCol) * ROW_H,
    }),
    [rowsPerCol],
  );

  const startDrag = useCallback(
    (app: DesktopApp, index: number, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setSelectedId(app.id);
      const start = positionsRef.current[app.id] ?? defaultPosition(index);
      const origin = { x: event.clientX, y: event.clientY };
      let moved = false;

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - origin.x;
        const dy = ev.clientY - origin.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        moved = true;
        setDraggingId(app.id);
        const area = desktopRef.current;
        const maxX = Math.max(0, (area?.clientWidth ?? window.innerWidth) - ICON_W);
        const maxY = Math.max(0, (area?.clientHeight ?? window.innerHeight) - ICON_H);
        setPositions((prev) => ({
          ...prev,
          [app.id]: {
            x: Math.max(0, Math.min(maxX, start.x + dx)),
            y: Math.max(0, Math.min(maxY, start.y + dy)),
          },
        }));
      };

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setDraggingId(null);
        if (moved) localStorage.setItem(ICON_POSITIONS_KEY, JSON.stringify(positionsRef.current));
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [defaultPosition],
  );

  const hasWindows = windows.length > 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="os-desktop"
          ref={desktopRef}
          // Clicking bare desktop clears the selection, the way it does on any OS.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
        >
          {APPS.map((app, index) => {
            const pos = positions[app.id] ?? defaultPosition(index);
            const isOpen = windows.some((w) => w.id === app.id);
            return (
              <button
                key={app.id}
                type="button"
                className={[
                  'os-icon',
                  isOpen ? 'os-icon--open' : '',
                  selectedId === app.id ? 'os-icon--selected' : '',
                  draggingId === app.id ? 'os-icon--dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: pos.x, top: pos.y }}
                aria-label={app.label}
                aria-pressed={selectedId === app.id}
                onMouseDown={(e) => startDrag(app, index, e)}
                // Single click selects, double click opens — desktop convention, and it stops
                // a slightly-dragged icon from launching by accident.
                onDoubleClick={() => launch(app)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    launch(app);
                  }
                }}
              >
                <span className="os-icon__tile" style={{ background: app.accent }}>
                  <app.Icon className="os-icon__glyph" />
                </span>
                <span className="os-icon__label">{app.label}</span>
              </button>
            );
          })}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => cascade()} disabled={!hasWindows}>
          <LayoutGridIcon data-icon="inline-start" />
          Cascade windows
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => minimizeAll()} disabled={!hasWindows}>
          <Minimize2Icon data-icon="inline-start" />
          Show desktop
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => closeAll()} disabled={!hasWindows} variant="destructive">
          <XIcon data-icon="inline-start" />
          Close all windows
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            window.dispatchEvent(new CustomEvent(RESET_ICONS_EVENT));
          }}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Arrange icons
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => launch(SETTINGS_APP_ID)}>
          <SettingsIcon data-icon="inline-start" />
          Appearance settings
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
