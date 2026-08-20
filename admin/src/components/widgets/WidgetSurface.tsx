import { useEffect, useMemo } from 'react';
import { DockableWidget, type WidgetSwitch } from './DockableWidget';
import { defaultOptions, findWidget, type WidgetDefinition } from './registry';
import {
  hostIsSeeded,
  removeHostWidget,
  setHostWidgets,
  setWidgetOption,
  useHostWidgets,
  useWidgetOptions,
  type WidgetDock,
} from './widgetState';
import './widgetSurface.css';

/**
 * Drop this into any screen and that screen can carry widgets.
 *
 * The surface is a transparent, click-through overlay pinned to its positioned parent, so a
 * page keeps working normally underneath it — only the cards themselves take the pointer.
 * Everything else follows from `hostId`: which widgets a surface shows, where each one sits
 * and how each is configured are all stored against that id, so the desktop, a module page
 * and a form each keep their own arrangement of the same widget types without knowing about
 * one another.
 *
 *   <div className="relative">
 *     <MyForm />
 *     <WidgetSurface hostId="purchase-entry" defaults={['clock', 'sales']} />
 *   </div>
 */

const MARGIN = 16;
const GAP = 12;
/** Below this the stack starts a new column rather than running off the bottom. */
const ASSUMED_COLUMN_HEIGHT = 640;

export interface WidgetSurfaceProps {
  hostId: string;
  /**
   * Seeded the first time this surface is mounted, then never again — after that the set is
   * whatever the operator has left it as, including empty.
   */
  defaults?: string[];
  /** Removes the remove control, so the surface's widgets are fixed rather than user-managed. */
  permanent?: boolean;
  className?: string;
}

/**
 * First-time placement: a gadget column down the right-hand edge, wrapping into a second
 * column when it runs out of height. Only ever used for a widget that has never been placed —
 * once it has been dragged, its stored corner offsets win.
 */
function defaultPlacement(
  definitions: WidgetDefinition[],
  index: number,
): { dock: WidgetDock; offsetX: number; offsetY: number; w: number; h: number } {
  let offsetX = MARGIN;
  let offsetY = MARGIN;

  for (let i = 0; i < index; i += 1) {
    const previous = definitions[i];
    if (!previous) continue;
    if (offsetY + previous.size.h + GAP > ASSUMED_COLUMN_HEIGHT) {
      offsetX += previous.size.w + GAP;
      offsetY = MARGIN;
    } else {
      offsetY += previous.size.h + GAP;
    }
  }

  const own = definitions[index];
  return {
    dock: 'top-right',
    offsetX,
    offsetY,
    w: own?.size.w ?? 260,
    h: own?.size.h ?? 200,
  };
}

export function WidgetSurface({
  hostId,
  defaults,
  permanent = false,
  className,
}: WidgetSurfaceProps): JSX.Element | null {
  const ids = useHostWidgets(hostId);

  useEffect(() => {
    if (defaults === undefined || defaults.length === 0) return;
    if (hostIsSeeded(hostId)) return;
    setHostWidgets(hostId, defaults);
  }, [hostId, defaults]);

  // A widget removed from the registry between releases must not take the surface down with
  // it; it simply stops being rendered.
  const definitions = ids.flatMap((id) => findWidget(id) ?? []);
  if (definitions.length === 0) return null;

  return (
    <div className={`widget-surface ${className ?? ''}`.trim()}>
      {definitions.map((definition, index) => (
        <MountedWidget
          key={definition.id}
          definition={definition}
          hostId={hostId}
          placement={defaultPlacement(definitions, index)}
          permanent={permanent}
        />
      ))}
    </div>
  );
}

/**
 * One widget and its own configuration. Split out because options are read with a hook, and a
 * hook cannot be called inside the map above.
 */
function MountedWidget({
  definition,
  hostId,
  placement,
  permanent,
}: {
  definition: WidgetDefinition;
  hostId: string;
  placement: { dock: WidgetDock; offsetX: number; offsetY: number; w: number; h: number };
  permanent: boolean;
}): JSX.Element {
  const defaults = useMemo(() => defaultOptions(definition), [definition]);
  const options = useWidgetOptions(hostId, definition.id, defaults);

  const switches: WidgetSwitch[] = (definition.switches ?? []).map((option) => ({
    key: option.key,
    label: option.label,
    on: options[option.key] === true,
    toggle: () =>
      setWidgetOption(hostId, definition.id, option.key, options[option.key] !== true),
  }));

  return (
    <DockableWidget
      id={definition.id}
      hostId={hostId}
      title={definition.label}
      accent={definition.accent}
      defaultPlacement={placement}
      minWidth={definition.min.w}
      minHeight={definition.min.h}
      {...(switches.length > 0 ? { switches } : {})}
      {...(permanent ? {} : { onClose: () => removeHostWidget(hostId, definition.id) })}
    >
      <definition.Body options={options} />
    </DockableWidget>
  );
}
