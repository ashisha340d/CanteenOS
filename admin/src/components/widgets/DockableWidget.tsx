import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckIcon, MoveIcon, XIcon } from 'lucide-react';
import {
  loadPlacement,
  savePlacement,
  type WidgetDock,
  type WidgetPlacement,
} from './widgetState';
import './DockableWidget.css';

/**
 * A widget card that can be dropped onto any surface in the product, and that gets out of the
 * way once it is placed.
 *
 * **Resting state is headless.** No title bar, no buttons, no frame competing with the module
 * windows around it — the card is painted from the *desktop skin's* own bevel tokens, so it
 * reads as part of the wallpaper rather than as a small window someone forgot to close. Beta's
 * hairline tokens and Sandalwood's warm bevels come through automatically, because the depth
 * is expressed in `--desk-bevel-hi/lo` rather than in a hard-coded shadow.
 *
 * **Long-press to adjust.** Holding the pointer down on the card for a moment lifts it into
 * adjust mode; from there it is dragged, resized, switched or removed. Letting go after a move
 * fixes it back into the surface. Holding still instead leaves adjust mode open so the resize
 * grip and the option switches can be reached — a gesture that only worked while the button
 * was held could never expose a second control.
 *
 * "Dockable" is literal. A widget is stored as an offset from whichever *corner* it was let go
 * nearest to, never as a top-left coordinate, so a card parked bottom-right is still
 * bottom-right after the shell is resized instead of stranded mid-screen or clipped away.
 */

const EDGE_MARGIN = 8;
const DRAG_THRESHOLD = 4;
/** Long enough not to fire on a click, short enough not to feel broken. */
const LONG_PRESS_MS = 420;
/** Height of the adjust bar plus its gap, for deciding which side of the card it sits on. */
const ADJUST_BAR_H = 36;

export interface WidgetSwitch {
  key: string;
  label: string;
  on: boolean;
  toggle: () => void;
}

export interface DockableWidgetProps {
  /** Unique within its surface. Together with `hostId` it keys the stored placement. */
  id: string;
  /** The surface this instance belongs to — `desktop`, a module id, a form id. */
  hostId: string;
  /** Not drawn at rest; used for the accessible name and the adjust-mode caption. */
  title: string;
  accent?: string;
  defaultPlacement: WidgetPlacement;
  minWidth: number;
  minHeight: number;
  /** Omit to make the widget permanent on this surface — no remove control is offered. */
  onClose?: () => void;
  /** Display switches offered in adjust mode. */
  switches?: WidgetSwitch[];
  children: ReactNode;
}

/** Controls and inputs must keep working at rest, so a press on one is never a long-press. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="menuitem"], [role="button"]';

function nearestDock(centreX: number, centreY: number, hostW: number, hostH: number): WidgetDock {
  const vertical = centreY < hostH / 2 ? 'top' : 'bottom';
  const horizontal = centreX < hostW / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}` as WidgetDock;
}

function resolveBox(
  placement: WidgetPlacement,
  hostW: number,
  hostH: number,
): { left: number; top: number; width: number; height: number } {
  const width = Math.min(placement.w, Math.max(placement.w, hostW - EDGE_MARGIN * 2));
  const height = placement.h;

  const left = placement.dock.endsWith('left')
    ? placement.offsetX
    : hostW - placement.offsetX - width;
  const top = placement.dock.startsWith('top')
    ? placement.offsetY
    : hostH - placement.offsetY - height;

  return {
    left: Math.max(0, Math.min(left, Math.max(0, hostW - width))),
    top: Math.max(0, Math.min(top, Math.max(0, hostH - height))),
    width,
    height,
  };
}

function toPlacement(
  box: { left: number; top: number; width: number; height: number },
  hostW: number,
  hostH: number,
): WidgetPlacement {
  const dock = nearestDock(box.left + box.width / 2, box.top + box.height / 2, hostW, hostH);
  return {
    dock,
    offsetX: Math.round(dock.endsWith('left') ? box.left : hostW - box.left - box.width),
    offsetY: Math.round(dock.startsWith('top') ? box.top : hostH - box.top - box.height),
    w: Math.round(box.width),
    h: Math.round(box.height),
  };
}

export function DockableWidget({
  id,
  hostId,
  title,
  accent,
  defaultPlacement,
  minWidth,
  minHeight,
  onClose,
  switches,
  children,
}: DockableWidgetProps): JSX.Element {
  const [placement, setPlacement] = useState<WidgetPlacement>(
    () => loadPlacement(hostId, id) ?? defaultPlacement,
  );
  const [adjusting, setAdjusting] = useState(false);
  const [moving, setMoving] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const [host, setHost] = useState({ w: 0, h: 0 });

  // Placements are corner-anchored, so the surface's size is an input to every layout
  // calculation rather than only a clamp applied at the end.
  useEffect(() => {
    const surface = rootRef.current?.parentElement;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHost({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const box = resolveBox(placement, host.w, host.h);
  const boxRef = useRef(box);
  boxRef.current = box;

  const commit = useCallback(
    (next: WidgetPlacement) => {
      setPlacement(next);
      savePlacement(hostId, id, next);
    },
    [hostId, id],
  );

  /* Adjust mode is left the way any transient mode is: by pressing Escape, or by touching
     something that is not this widget. */
  useEffect(() => {
    if (!adjusting) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAdjusting(false);
    };
    const onDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setAdjusting(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [adjusting]);

  /** Move the card. Shared by the long-press gesture and by dragging while already adjusting. */
  const beginMove = useCallback(
    (origin: { x: number; y: number }, exitOnDrop: boolean) => {
      const start = boxRef.current;
      let latest = start;
      let moved = false;

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - origin.x;
        const dy = ev.clientY - origin.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        moved = true;
        setMoving(true);
        latest = {
          ...start,
          left: Math.max(0, Math.min(host.w - start.width, start.left + dx)),
          top: Math.max(0, Math.min(host.h - start.height, start.top + dy)),
        };
        setPlacement(toPlacement(latest, host.w, host.h));
      };

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setMoving(false);
        if (!moved) return;
        commit(toPlacement(latest, host.w, host.h));
        // Released after actually moving it: the widget has been placed, so it settles back
        // into the wallpaper. Held still instead, adjust mode stays open for the grip.
        if (exitOnDrop) setAdjusting(false);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [host.w, host.h, commit],
  );

  const onBodyMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || host.w === 0) return;
      if ((event.target as HTMLElement).closest(INTERACTIVE) !== null) return;

      const origin = { x: event.clientX, y: event.clientY };

      if (adjusting) {
        event.preventDefault();
        beginMove(origin, true);
        return;
      }

      // Not yet adjusting: arm the long press, and abandon it if the pointer leaves before it
      // matures — a small drag over a widget is somebody selecting, not somebody moving it.
      let armed = true;
      const cancel = (): void => {
        armed = false;
        clearTimeout(timer);
        window.removeEventListener('mousemove', watch);
        window.removeEventListener('mouseup', cancel);
      };
      const watch = (ev: MouseEvent): void => {
        if (Math.abs(ev.clientX - origin.x) + Math.abs(ev.clientY - origin.y) > DRAG_THRESHOLD) {
          cancel();
        }
      };
      const timer = setTimeout(() => {
        if (!armed) return;
        window.removeEventListener('mousemove', watch);
        window.removeEventListener('mouseup', cancel);
        setAdjusting(true);
        beginMove(origin, true);
      }, LONG_PRESS_MS);

      window.addEventListener('mousemove', watch);
      window.addEventListener('mouseup', cancel);
    },
    [adjusting, host.w, beginMove],
  );

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || host.w === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const start = boxRef.current;
      const origin = { x: event.clientX, y: event.clientY };
      let latest = start;

      const onMove = (ev: MouseEvent): void => {
        setMoving(true);
        latest = {
          ...start,
          width: Math.max(
            minWidth,
            Math.min(host.w - start.left, start.width + ev.clientX - origin.x),
          ),
          height: Math.max(
            minHeight,
            Math.min(host.h - start.top, start.height + ev.clientY - origin.y),
          ),
        };
        setPlacement(toPlacement(latest, host.w, host.h));
      };

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setMoving(false);
        commit(toPlacement(latest, host.w, host.h));
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [host.w, host.h, minWidth, minHeight, commit],
  );

  return (
    <section
      ref={rootRef}
      className={[
        'os-widget',
        adjusting ? 'os-widget--adjusting' : '',
        moving ? 'os-widget--moving' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        ...(accent === undefined ? {} : { ['--widget-accent' as string]: accent }),
      }}
      aria-label={title}
      onMouseDown={onBodyMouseDown}
    >
      <div className="os-widget__body">{children}</div>

      {adjusting && (
        // A card docked against the top of the surface has no room above it for the bar, so
        // it flips underneath rather than being clipped off the screen.
        <div
          className={`os-widget__adjust ${box.top < ADJUST_BAR_H ? 'os-widget__adjust--below' : ''}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="os-widget__caption">
            <MoveIcon className="size-3" aria-hidden />
            {title}
          </span>

          {switches?.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`os-widget__switch ${option.on ? 'os-widget__switch--on' : ''}`}
              aria-pressed={option.on}
              onClick={option.toggle}
            >
              {option.label}
            </button>
          ))}

          {onClose && (
            <button
              type="button"
              className="os-widget__act os-widget__act--remove"
              onClick={onClose}
              title={`Remove ${title}`}
              aria-label={`Remove ${title}`}
            >
              <XIcon className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            className="os-widget__act"
            onClick={() => setAdjusting(false)}
            title="Done"
            aria-label="Done adjusting"
          >
            <CheckIcon className="size-3.5" />
          </button>
        </div>
      )}

      {adjusting && (
        <span
          className="os-widget__resize"
          role="presentation"
          onMouseDown={startResize}
          title="Resize"
        />
      )}
    </section>
  );
}
