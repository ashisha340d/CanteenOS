/**
 * The desktop's layout model: where every icon sits, and which group box — if any — it lives
 * inside.
 *
 * Shared between the desktop and the Settings window, which runs *in* a window on that very
 * desktop. Kept in its own module so the two can agree on the storage keys and the reset
 * signal without importing each other.
 */

export const ICON_POSITIONS_KEY = 'canteenos_icon_positions_v1';
export const DESKTOP_GROUPS_KEY = 'canteenos_desktop_groups_v1';

/** Fired by Settings; the desktop listens and puts every icon back on the default grid. */
export const RESET_ICONS_EVENT = 'canteenos:reset-desktop-icons';

/* The icon cell. A grid rather than free pixels, so "align to grid" has something to align to
   and two icons can never half-overlap. */
export const ICON_W = 88;
export const ICON_H = 84;
export const COL_W = 104;
export const ROW_H = 100;
export const ORIGIN = 20;

/** Chrome a group box spends on its own title bar, above the area icons may occupy. */
export const GROUP_HEADER_H = 28;
export const GROUP_PADDING = 10;
export const GROUP_MIN_W = COL_W + GROUP_PADDING * 2;
export const GROUP_MIN_H = GROUP_HEADER_H + ROW_H + GROUP_PADDING * 2;

export interface IconPosition {
  x: number;
  y: number;
}

/**
 * Where one icon is.
 *
 * When `groupId` is set, `x`/`y` are relative to that group's content box rather than to the
 * desktop — which is the whole reason group membership is stored on the icon instead of a
 * list on the group. Moving or resizing a box then needs to touch nothing: its icons are
 * already expressed in its own coordinates and travel with it for free.
 */
export interface IconPlacement extends IconPosition {
  groupId?: string;
}

export type IconPositions = Record<string, IconPlacement>;

/** A container drawn on the desktop. Icons dropped inside it belong to it. */
export interface DesktopGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

export function loadIconPositions(): IconPositions {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ICON_POSITIONS_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return {};
    // Anything hand-edited, or left over from a layout that predates group boxes, must not
    // crash the desktop — a bad entry is dropped and that icon falls back to the grid.
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).flatMap(([id, value]) => {
        if (typeof value !== 'object' || value === null) return [];
        const candidate = value as Record<string, unknown>;
        if (!isFiniteNumber(candidate['x']) || !isFiniteNumber(candidate['y'])) return [];
        const groupId = candidate['groupId'];
        return [
          [
            id,
            {
              x: candidate['x'],
              y: candidate['y'],
              ...(typeof groupId === 'string' ? { groupId } : {}),
            } satisfies IconPlacement,
          ],
        ];
      }),
    );
  } catch {
    return {};
  }
}

export function saveIconPositions(positions: IconPositions): void {
  localStorage.setItem(ICON_POSITIONS_KEY, JSON.stringify(positions));
}

export function loadGroups(): DesktopGroup[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DESKTOP_GROUPS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (typeof value !== 'object' || value === null) return [];
      const candidate = value as Record<string, unknown>;
      if (typeof candidate['id'] !== 'string') return [];
      if (
        !isFiniteNumber(candidate['x']) ||
        !isFiniteNumber(candidate['y']) ||
        !isFiniteNumber(candidate['w']) ||
        !isFiniteNumber(candidate['h'])
      ) {
        return [];
      }
      return [
        {
          id: candidate['id'],
          title: typeof candidate['title'] === 'string' ? candidate['title'] : 'Group',
          x: candidate['x'],
          y: candidate['y'],
          w: candidate['w'],
          h: candidate['h'],
        } satisfies DesktopGroup,
      ];
    });
  } catch {
    return [];
  }
}

export function saveGroups(groups: DesktopGroup[]): void {
  localStorage.setItem(DESKTOP_GROUPS_KEY, JSON.stringify(groups));
}

/* --------------------------------------------------------------------- geometry */

/** The area inside a group that icons may occupy, in desktop coordinates. */
export function groupContentBox(group: DesktopGroup): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: group.x + GROUP_PADDING,
    y: group.y + GROUP_HEADER_H,
    w: Math.max(0, group.w - GROUP_PADDING * 2),
    h: Math.max(0, group.h - GROUP_HEADER_H - GROUP_PADDING),
  };
}

/** Where an icon actually paints, resolving group-relative coordinates against its box. */
export function resolvePosition(
  placement: IconPlacement,
  groups: Map<string, DesktopGroup>,
): IconPosition {
  if (placement.groupId === undefined) return { x: placement.x, y: placement.y };
  const group = groups.get(placement.groupId);
  // A placement pointing at a box that has since been deleted is treated as loose rather
  // than hidden; the icon reappears on the desktop where the box used to be.
  if (group === undefined) return { x: placement.x, y: placement.y };
  const box = groupContentBox(group);
  return { x: box.x + placement.x, y: box.y + placement.y };
}

/**
 * Which box, if any, an icon dropped at these desktop coordinates lands in. The icon's own
 * centre decides, not the pointer — dragging by the label should not put an icon somewhere
 * its tile is not.
 *
 * Later boxes win, matching their paint order: the one drawn on top is the one you dropped
 * into.
 */
export function groupAt(x: number, y: number, groups: DesktopGroup[]): DesktopGroup | null {
  const centreX = x + ICON_W / 2;
  const centreY = y + ICON_H / 2;
  let found: DesktopGroup | null = null;
  for (const group of groups) {
    const box = groupContentBox(group);
    if (centreX >= box.x && centreX <= box.x + box.w && centreY >= box.y && centreY <= box.y + box.h) {
      found = group;
    }
  }
  return found;
}

/** Desktop coordinates → the placement to store, given whichever box it landed in. */
export function toPlacement(
  x: number,
  y: number,
  group: DesktopGroup | null,
): IconPlacement {
  if (group === null) return { x: Math.round(x), y: Math.round(y) };
  const box = groupContentBox(group);
  return {
    x: Math.round(Math.max(0, Math.min(x - box.x, Math.max(0, box.w - ICON_W)))),
    y: Math.round(Math.max(0, Math.min(y - box.y, Math.max(0, box.h - ICON_H)))),
    groupId: group.id,
  };
}

/* --------------------------------------------------------------------- arranging */

/** Column-major grid packing, the order every desktop has filled its icons in since 1995. */
function packColumnMajor(
  ids: string[],
  rows: number,
  origin: { x: number; y: number },
): Record<string, IconPosition> {
  const packed: Record<string, IconPosition> = {};
  ids.forEach((id, index) => {
    packed[id] = {
      x: origin.x + Math.floor(index / rows) * COL_W,
      y: origin.y + (index % rows) * ROW_H,
    };
  });
  return packed;
}

/**
 * Repacks every container from scratch: the free desktop, and each box, independently.
 *
 * Icons keep their box — auto-arrange tidies a desktop, it does not empty somebody's boxes
 * back onto it — and within each container they are laid out in registry order so the result
 * is the same every time it is run.
 */
export function autoArrange(
  appIds: string[],
  positions: IconPositions,
  groups: DesktopGroup[],
  desktopHeight: number,
): IconPositions {
  const groupIds = new Set(groups.map((group) => group.id));
  const loose: string[] = [];
  const byGroup = new Map<string, string[]>();

  for (const id of appIds) {
    const placement = positions[id];
    const groupId = placement?.groupId;
    if (groupId !== undefined && groupIds.has(groupId)) {
      byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), id]);
    } else {
      loose.push(id);
    }
  }

  const next: IconPositions = {};

  const desktopRows = Math.max(1, Math.floor((desktopHeight - ORIGIN) / ROW_H));
  Object.entries(packColumnMajor(loose, desktopRows, { x: ORIGIN, y: ORIGIN })).forEach(
    ([id, position]) => {
      next[id] = position;
    },
  );

  for (const group of groups) {
    const box = groupContentBox(group);
    const rows = Math.max(1, Math.floor(box.h / ROW_H));
    Object.entries(packColumnMajor(byGroup.get(group.id) ?? [], rows, { x: 0, y: 0 })).forEach(
      ([id, position]) => {
        next[id] = { ...position, groupId: group.id };
      },
    );
  }

  return next;
}

/** Snaps what is already there to the nearest cell, without reordering anything. */
export function alignToGrid(positions: IconPositions): IconPositions {
  return Object.fromEntries(
    Object.entries(positions).map(([id, placement]) => {
      const originX = placement.groupId === undefined ? ORIGIN : 0;
      const originY = placement.groupId === undefined ? ORIGIN : 0;
      return [
        id,
        {
          ...placement,
          x: originX + Math.max(0, Math.round((placement.x - originX) / COL_W)) * COL_W,
          y: originY + Math.max(0, Math.round((placement.y - originY) / ROW_H)) * ROW_H,
        },
      ];
    }),
  );
}
