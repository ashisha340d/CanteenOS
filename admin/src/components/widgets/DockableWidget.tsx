import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, GripVerticalIcon, XIcon } from 'lucide-react';
import type { WindowIcon } from '@/services/WindowManager';
import {
  loadPlacement,
  savePlacement,
  type WidgetDock,
  type WidgetPlacement,
} from './widgetState';
import './DockableWidget.css';

/**
 * A widget card that can be dropped onto any surface in the product, dragged anywhere inside
 * it, resized, rolled up and closed — and that remembers all of it, per surface.
 *
 * "Dockable" is literal rather than decorative. A widget is never stored as a top-left
 * coordinate; it is stored as an offset from whichever *corner* it was let go nearest to. So
 * a card parked at the bottom-right of the desktop is still at the bottom-right after the
 * browser window is resized, instead of being left stranded in the middle or clipped off the
 * edge — which is exactly the failure that makes most in-house "draggable panel" components
 * unusable on a second monitor.
 *
 * The component owns chrome and behaviour only. What is *inside* it is an ordinary React
 * child, so the same frame carries a clock, a sales figure or a chart without knowing which.
 */

const HEADER_H = 34;
const EDGE_MARGIN = 8;
const DRAG_THRESHOLD = 3;

export interface DockableWidgetProps {
  /** Unique within its surface. Together with `hostId` it keys the stored placement. */
  id: string;
  /** The surface this instance belongs to — `desktop`, a module id, a form id. */
  hostId: string;
  title: string;
  Icon?: WindowIcon;
  /** Colour for the header glyph. Falls back to the desktop accent. */
  accent?: string;
  /** Used the first time this widget appears on this surface. */
  defaultPlacement: Pick<WidgetPlacement, 'dock' | 'offsetX' | 'offsetY' | 'w' | 'h'>;
  minWidth: number;
  minHeight: number;
  /** Omit to make the widget permanent on this surface — no close button is drawn. */
  onClose?: () => void;
  /** Rendered at the right of the header, before the controls. Range pickers live here. */
  toolbar?: ReactNode;
  children: ReactNode;
}

/** Which corner the widget ended up nearest, measured from its centre. */
function nearestDock(centreX: number, centreY: number, hostW: number, hostH: number): WidgetDock {
  const vertical = centreY < hostH / 2 ? 'top' : 'bottom';
  const horizontal = centreX < hostW / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}` as WidgetDock;
}

/** Corner-anchored offsets → the absolute box to paint, clamped inside the surface. */
function resolveBox(
  placement: WidgetPlacement,
  hostW: number,
  hostH: number,
): { left: number; top: number; width: number; height: number } {
  const height = placement.collapsed ? HEADER_H : placement.h;
  const width = Math.min(placement.w, Math.max(placement.w, hostW - EDGE_MARGIN * 2));

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

/** The absolute box a drag or resize produced → the corner-anchored form that gets stored. */
function toPlacement(
  box: { left: number; top: number; width: number; height: number },
  hostW: number,
  hostH: number,
  collapsed: boolean,
  storedHeight: number,
): WidgetPlacement {
  const dock = nearestDock(box.left + box.width / 2, box.top + box.height / 2, hostW, hostH);
  return {
    dock,
    offsetX: Math.round(dock.endsWith('left') ? box.left : hostW - box.left - box.width),
    offsetY: Math.round(dock.startsWith('top') ? box.top : hostH - box.top - box.height),
    w: Math.round(box.width),
    // Collapsing must not overwrite the height the widget goes back to when it is expanded.
    h: collapsed ? storedHeight : Math.round(box.height),
    collapsed,
  };
}

export function DockableWidget({
  id,
  hostId,
  title,
  Icon,
  accent,
  defaultPlacement,
  minWidth,
  minHeight,
  onClose,
  toolbar,
  children,
}: DockableWidgetProps): JSX.Element {
  const [placement, setPlacement] = useState<WidgetPlacement>(
    () => loadPlacement(hostId, id) ?? { ...defaultPlacement, collapsed: false },
  );
  const [interacting, setInteracting] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const [host, setHost] = useState({ w: 0, h: 0 });

  // Placements are corner-anchored, so the surface's own size is an input to every layout
  // calculation — not just something to clamp against at the end.
  useEffect(() => {
    const surface = rootRef.current?.parentElement;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHost({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const commit = useCallback(
    (next: WidgetPlacement) => {
      setPlacement(next);
      savePlacement(hostId, id, next);
    },
    [hostId, id],
  );

  const box = resolveBox(placement, host.w, host.h);
  const boxRef = useRef(box);
  boxRef.current = box;

  const startDrag = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || host.w === 0) return;
      event.preventDefault();
      const start = boxRef.current;
      const origin = { x: event.clientX, y: event.clientY };
      let moved = false;
      let latest = start;

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - origin.x;
        const dy = ev.clientY - origin.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        moved = true;
        setInteracting(true);
        latest = {
          ...start,
          left: Math.max(0, Math.min(host.w - start.width, start.left + dx)),
          top: Math.max(0, Math.min(host.h - start.height, start.top + dy)),
        };
        setPlacement((prev) =>
          toPlacement(latest, host.w, host.h, prev.collapsed, prev.h),
        );
      };

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setInteracting(false);
        if (moved) {
          setPlacement((prev) => {
            const next = toPlacement(latest, host.w, host.h, prev.collapsed, prev.h);
            savePlacement(hostId, id, next);
            return next;
          });
        }
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [host.w, host.h, hostId, id],
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
        setInteracting(true);
        latest = {
          ...start,
          width: Math.max(minWidth, Math.min(host.w - start.left, start.width + ev.clientX - origin.x)),
          height: Math.max(minHeight, Math.min(host.h - start.top, start.height + ev.clientY - origin.y)),
        };
        // A resize always lands expanded and always adopts the new height, so unlike a drag
        // it has nothing to carry over from the previous placement.
        setPlacement(toPlacement(latest, host.w, host.h, false, latest.height));
      };

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setInteracting(false);
        const next = toPlacement(latest, host.w, host.h, false, latest.height);
        setPlacement(next);
        savePlacement(hostId, id, next);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [host.w, host.h, hostId, id, minWidth, minHeight],
  );

  function toggleCollapsed(): void {
    commit({ ...placement, collapsed: !placement.collapsed });
  }

  return (
    <section
      ref={rootRef}
      className={[
        'os-widget',
        placement.collapsed ? 'os-widget--collapsed' : '',
        interacting ? 'os-widget--interacting' : '',
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
    >
      <header className="os-widget__header" onMouseDown={startDrag} onDoubleClick={toggleCollapsed}>
        <GripVerticalIcon className="os-widget__grip" aria-hidden />
        {Icon && <Icon className="os-widget__icon" />}
        <h3 className="os-widget__title">{title}</h3>

        {/* Stops a click on a range picker from being read as the start of a drag. */}
        {toolbar && (
          <div className="os-widget__toolbar" onMouseDown={(e) => e.stopPropagation()}>
            {toolbar}
          </div>
        )}

        <button
          type="button"
          className="os-widget__control"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleCollapsed}
          aria-expanded={!placement.collapsed}
          title={placement.collapsed ? 'Expand' : 'Collapse'}
        >
          <ChevronDownIcon className="os-widget__control-glyph" />
        </button>

        {onClose && (
          <button
            type="button"
            className="os-widget__control os-widget__control--close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            title={`Remove ${title}`}
            aria-label={`Remove ${title}`}
          >
            <XIcon className="os-widget__control-glyph" />
          </button>
        )}
      </header>

      {!placement.collapsed && (
        <>
          <div className="os-widget__body">{children}</div>
          <span
            className="os-widget__resize"
            role="presentation"
            onMouseDown={startResize}
            title="Resize"
          />
        </>
      )}
    </section>
  );
}
