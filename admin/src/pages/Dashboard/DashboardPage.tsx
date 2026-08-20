import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignStartVerticalIcon,
  LayoutGridIcon,
  Minimize2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcwIcon,
  SettingsIcon,
  ShapesIcon,
  SquareDashedIcon,
  Trash2Icon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWindowManager } from '@/services/WindowManager';
import { useLaunchApp } from '@/services/useLaunchApp';
import { APPS, SETTINGS_APP_ID, type DesktopApp } from '@/services/appRegistry';
import { STATE_RESTORED_EVENT } from '@/services/desktopState';
import { ICON_SET_LABEL, ICON_SETS, useTheme, type IconSet } from '@/theme/ThemeProvider';
import { WidgetSurface } from '@/components/widgets/WidgetSurface';
import { WIDGETS } from '@/components/widgets/registry';
import {
  addHostWidget,
  DESKTOP_HOST,
  removeHostWidget,
  resetHost,
  useHostWidgets,
} from '@/components/widgets/widgetState';
import {
  alignToGrid,
  autoArrange,
  COL_W,
  DESKTOP_GROUPS_KEY,
  GROUP_HEADER_H,
  GROUP_MIN_H,
  GROUP_MIN_W,
  groupAt,
  groupContentBox,
  ICON_H,
  ICON_POSITIONS_KEY,
  ICON_W,
  loadGroups,
  loadIconPositions,
  ORIGIN,
  RESET_ICONS_EVENT,
  resolvePosition,
  ROW_H,
  saveGroups,
  saveIconPositions,
  toPlacement,
  type DesktopGroup,
  type IconPositions,
} from './desktopIcons';
import './DashboardPage.css';

const DRAG_THRESHOLD = 4;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Follows the pointer until the mouse comes back up. The one drag idiom on this desktop. */
function trackDrag(
  onMove: (event: MouseEvent) => void,
  onUp: () => void,
): void {
  const move = (event: MouseEvent): void => onMove(event);
  const up = (): void => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    onUp();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

export function DashboardPage(): JSX.Element {
  const { windows, minimizeAll, closeAll, cascade } = useWindowManager();
  const launch = useLaunchApp();
  const { iconSet, setIconSet } = useTheme();
  const shownWidgets = useHostWidgets(DESKTOP_HOST);

  const [positions, setPositions] = useState<IconPositions>(loadIconPositions);
  const [groups, setGroups] = useState<DesktopGroup[]>(loadGroups);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  /* Three in-flight gestures, each held outside the persisted model. Committing a drag to
     `positions` on every mouse move would mean writing group-relative coordinates for an icon
     that has not yet been dropped into a group — the two coordinate spaces would fight. */
  const [dragIcon, setDragIcon] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragGroup, setDragGroup] = useState<(Rect & { id: string }) | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);

  const desktopRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });

  useEffect(() => {
    const area = desktopRef.current;
    if (!area) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  // Settings runs in a window on this very desktop, so it asks for the reset by event rather
  // than reaching into state it cannot see.
  useEffect(() => {
    function onReset(): void {
      localStorage.removeItem(ICON_POSITIONS_KEY);
      localStorage.removeItem(DESKTOP_GROUPS_KEY);
      setPositions({});
      setGroups([]);
    }
    // A restored snapshot may carry a different layout; re-read rather than re-render with
    // the pre-restore one.
    function onStateRestored(): void {
      setPositions(loadIconPositions());
      setGroups(loadGroups());
    }
    window.addEventListener(RESET_ICONS_EVENT, onReset);
    window.addEventListener(STATE_RESTORED_EVENT, onStateRestored);
    return () => {
      window.removeEventListener(RESET_ICONS_EVENT, onReset);
      window.removeEventListener(STATE_RESTORED_EVENT, onStateRestored);
    };
  }, []);

  // Escape abandons a box being drawn, the way it cancels any other in-progress gesture.
  useEffect(() => {
    if (draft === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDraft(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft]);

  const commitPositions = useCallback((next: IconPositions) => {
    setPositions(next);
    saveIconPositions(next);
  }, []);

  const commitGroups = useCallback((next: DesktopGroup[]) => {
    setGroups(next);
    saveGroups(next);
  }, []);

  /* A box being moved or resized has to be resolved before anything is drawn against it —
     its icons are stored in its coordinates and must travel with it during the drag. */
  const liveGroups = useMemo(
    () => (dragGroup === null ? groups : groups.map((g) => (g.id === dragGroup.id ? { ...g, ...dragGroup } : g))),
    [groups, dragGroup],
  );

  const groupsById = useMemo(
    () => new Map(liveGroups.map((group) => [group.id, group])),
    [liveGroups],
  );

  const rowsPerCol = Math.max(1, Math.floor((size.h - ORIGIN) / ROW_H));

  const defaultPosition = useCallback(
    (index: number) => ({
      x: ORIGIN + Math.floor(index / rowsPerCol) * COL_W,
      y: ORIGIN + (index % rowsPerCol) * ROW_H,
    }),
    [rowsPerCol],
  );

  const iconAt = useCallback(
    (app: DesktopApp, index: number) => {
      if (dragIcon?.id === app.id) return { x: dragIcon.x, y: dragIcon.y };
      const placement = positions[app.id];
      return placement === undefined
        ? defaultPosition(index)
        : resolvePosition(placement, groupsById);
    },
    [dragIcon, positions, groupsById, defaultPosition],
  );

  /* ------------------------------------------------------------------ icon drag */

  const startIconDrag = useCallback(
    (app: DesktopApp, index: number, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      setSelectedId(app.id);

      const start = iconAt(app, index);
      const origin = { x: event.clientX, y: event.clientY };
      let moved = false;
      let latest = start;

      trackDrag(
        (ev) => {
          const dx = ev.clientX - origin.x;
          const dy = ev.clientY - origin.y;
          if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
          moved = true;
          latest = {
            x: Math.max(0, Math.min(size.w - ICON_W, start.x + dx)),
            y: Math.max(0, Math.min(size.h - ICON_H, start.y + dy)),
          };
          setDragIcon({ id: app.id, ...latest });
        },
        () => {
          setDragIcon(null);
          if (!moved) return;
          // Which box it landed in is decided here, once, rather than on every mouse move.
          const landed = groupAt(latest.x, latest.y, liveGroups);
          commitPositions({ ...positions, [app.id]: toPlacement(latest.x, latest.y, landed) });
        },
      );
    },
    [iconAt, size, liveGroups, positions, commitPositions],
  );

  /* ----------------------------------------------------------------- drawing a box */

  const startDraw = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || event.target !== event.currentTarget) return;
      setSelectedId(null);

      const area = desktopRef.current;
      if (!area) return;
      const bounds = area.getBoundingClientRect();
      const origin = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      let latest: Rect | null = null;

      trackDrag(
        (ev) => {
          const x = Math.max(0, Math.min(size.w, ev.clientX - bounds.left));
          const y = Math.max(0, Math.min(size.h, ev.clientY - bounds.top));
          latest = {
            x: Math.min(origin.x, x),
            y: Math.min(origin.y, y),
            w: Math.abs(x - origin.x),
            h: Math.abs(y - origin.y),
          };
          setDraft(latest);
        },
        () => {
          setDraft(null);
          // A short drag is a click that wobbled, not a box. Anything below the minimum
          // usable size is discarded rather than creating something unusably small.
          if (latest === null || latest.w < GROUP_MIN_W || latest.h < GROUP_MIN_H) return;
          const group: DesktopGroup = {
            id: crypto.randomUUID(),
            title: `Group ${groups.length + 1}`,
            ...latest,
          };
          commitGroups([...groups, group]);
          setRenamingId(group.id);
        },
      );
    },
    [size, groups, commitGroups],
  );

  /* ------------------------------------------------------------- box move & resize */

  const startGroupDrag = useCallback(
    (group: DesktopGroup, mode: 'move' | 'resize', event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const origin = { x: event.clientX, y: event.clientY };
      const start: Rect = { x: group.x, y: group.y, w: group.w, h: group.h };
      let latest = start;

      trackDrag(
        (ev) => {
          const dx = ev.clientX - origin.x;
          const dy = ev.clientY - origin.y;
          latest =
            mode === 'move'
              ? {
                ...start,
                x: Math.max(0, Math.min(size.w - start.w, start.x + dx)),
                y: Math.max(0, Math.min(size.h - start.h, start.y + dy)),
              }
              : {
                ...start,
                w: Math.max(GROUP_MIN_W, Math.min(size.w - start.x, start.w + dx)),
                h: Math.max(GROUP_MIN_H, Math.min(size.h - start.y, start.h + dy)),
              };
          setDragGroup({ id: group.id, ...latest });
        },
        () => {
          setDragGroup(null);
          const resized: DesktopGroup = { ...group, ...latest };
          commitGroups(groups.map((g) => (g.id === group.id ? resized : g)));

          // Shrinking a box must not leave its icons outside it — they are clamped back into
          // the content area rather than silently escaping onto the desktop.
          if (mode !== 'resize') return;
          const box = groupContentBox(resized);
          const clamped: IconPositions = { ...positions };
          let changed = false;
          for (const [id, placement] of Object.entries(positions)) {
            if (placement.groupId !== group.id) continue;
            const x = Math.max(0, Math.min(placement.x, Math.max(0, box.w - ICON_W)));
            const y = Math.max(0, Math.min(placement.y, Math.max(0, box.h - ICON_H)));
            if (x === placement.x && y === placement.y) continue;
            clamped[id] = { ...placement, x, y };
            changed = true;
          }
          if (changed) commitPositions(clamped);
        },
      );
    },
    [size, groups, positions, commitGroups, commitPositions],
  );

  const deleteGroup = useCallback(
    (group: DesktopGroup) => {
      const box = groupContentBox(group);
      // The icons are freed where they visibly are, not sent back to the grid — deleting the
      // box around a set of icons should not also rearrange them.
      const freed: IconPositions = Object.fromEntries(
        Object.entries(positions).map(([id, placement]) =>
          placement.groupId === group.id
            ? [id, { x: box.x + placement.x, y: box.y + placement.y }]
            : [id, placement],
        ),
      );
      commitPositions(freed);
      commitGroups(groups.filter((g) => g.id !== group.id));
    },
    [positions, groups, commitPositions, commitGroups],
  );

  const renameGroup = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      commitGroups(groups.map((g) => (g.id === id ? { ...g, title: trimmed === '' ? 'Group' : trimmed } : g)));
      setRenamingId(null);
    },
    [groups, commitGroups],
  );

  const hasWindows = windows.length > 0;
  const appIds = useMemo(() => APPS.map((app) => app.id), []);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={`os-desktop ${draft === null ? '' : 'os-desktop--drawing'}`}
          ref={desktopRef}
          onMouseDown={startDraw}
        >
          {liveGroups.map((group) => (
            <GroupBox
              key={group.id}
              group={group}
              renaming={renamingId === group.id}
              onRename={renameGroup}
              onStartRename={() => setRenamingId(group.id)}
              onCancelRename={() => setRenamingId(null)}
              onDelete={() => deleteGroup(group)}
              onDrag={(mode, event) => startGroupDrag(group, mode, event)}
            />
          ))}

          {draft && (
            <div
              className="os-draft"
              style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
              aria-hidden
            >
              {draft.w >= GROUP_MIN_W && draft.h >= GROUP_MIN_H && (
                <span className="os-draft__hint">Release to create a group</span>
              )}
            </div>
          )}

          {APPS.map((app, index) => {
            const pos = iconAt(app, index);
            const isOpen = windows.some((w) => w.id === app.id);
            return (
              <button
                key={app.id}
                type="button"
                className={[
                  'os-icon',
                  isOpen ? 'os-icon--open' : '',
                  selectedId === app.id ? 'os-icon--selected' : '',
                  dragIcon?.id === app.id ? 'os-icon--dragging' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: pos.x, top: pos.y, ['--icon-accent' as string]: app.accent }}
                aria-label={app.label}
                aria-pressed={selectedId === app.id}
                onMouseDown={(e) => startIconDrag(app, index, e)}
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
                <span className="os-icon__tile">
                  <app.Icon className="os-icon__glyph" />
                </span>
                <span className="os-icon__label">{app.label}</span>
              </button>
            );
          })}

          <WidgetSurface hostId={DESKTOP_HOST} />
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-60">
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

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ShapesIcon data-icon="inline-start" />
            Change icons
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuRadioGroup
              value={iconSet}
              onValueChange={(next) => setIconSet(next as IconSet)}
            >
              {ICON_SETS.map((option) => (
                <ContextMenuRadioItem key={option} value={option}>
                  {ICON_SET_LABEL[option]}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <LayoutGridIcon data-icon="inline-start" />
            Widgets
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuLabel>Show on the desktop</ContextMenuLabel>
            {WIDGETS.map((widget) => {
              const shown = shownWidgets.includes(widget.id);
              return (
                <ContextMenuCheckboxItem
                  key={widget.id}
                  checked={shown}
                  onSelect={(event) => {
                    // Keep the menu open: adding three widgets should be three clicks, not
                    // three round trips through the context menu.
                    event.preventDefault();
                    if (shown) removeHostWidget(DESKTOP_HOST, widget.id);
                    else addHostWidget(DESKTOP_HOST, widget.id);
                  }}
                >
                  {widget.label}
                </ContextMenuCheckboxItem>
              );
            })}
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => resetHost(DESKTOP_HOST)}>
              <RotateCcwIcon data-icon="inline-start" />
              Clear all widgets
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem
          onSelect={() => commitPositions(autoArrange(appIds, positions, groups, size.h))}
        >
          <WandSparklesIcon data-icon="inline-start" />
          Auto arrange icons
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => commitPositions(alignToGrid(positions))}>
          <AlignStartVerticalIcon data-icon="inline-start" />
          Align icons to grid
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            window.dispatchEvent(new CustomEvent(RESET_ICONS_EVENT));
          }}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Reset icons & groups
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem disabled>
          <SquareDashedIcon data-icon="inline-start" />
          Drag the desktop to draw a group
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => launch(SETTINGS_APP_ID)}>
          <SettingsIcon data-icon="inline-start" />
          Appearance settings
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A drawn container. Chrome only — the icons inside it are painted by the desktop. */
function GroupBox({
  group,
  renaming,
  onRename,
  onStartRename,
  onCancelRename,
  onDelete,
  onDrag,
}: {
  group: DesktopGroup;
  renaming: boolean;
  onRename: (id: string, title: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onDrag: (mode: 'move' | 'resize', event: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <section
      className="os-group"
      style={{ left: group.x, top: group.y, width: group.w, height: group.h }}
      aria-label={group.title}
    >
      <header
        className="os-group__header"
        style={{ height: GROUP_HEADER_H }}
        onMouseDown={(e) => onDrag('move', e)}
        onDoubleClick={onStartRename}
      >
        {renaming ? (
          <input
            className="os-group__rename"
            defaultValue={group.title}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={(e) => onRename(group.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(group.id, e.currentTarget.value);
              if (e.key === 'Escape') onCancelRename();
            }}
          />
        ) : (
          <span className="os-group__title">{group.title}</span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="os-group__menu"
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={`${group.title} options`}
            >
              <MoreHorizontalIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={onStartRename}>
              <PencilIcon data-icon="inline-start" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2Icon data-icon="inline-start" />
              Delete group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <span
        className="os-group__resize"
        role="presentation"
        onMouseDown={(e) => onDrag('resize', e)}
      />
    </section>
  );
}
