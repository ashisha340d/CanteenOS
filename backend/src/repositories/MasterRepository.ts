import type { MasterStatus } from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  ActivityTypeRow,
  CountRow,
  MenuCategoryRow,
  MenuItemRow,
  StationRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Master data repositories: stations, activity types, menu categories, menu items.
 *
 * All four are written only by the Admin Portal. Android receives them as a read-only
 * synchronised cache, so none of them appear in PUSHABLE_ENTITIES.
 */

export interface MasterListFilter {
  search?: string;
  status?: MasterStatus;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

/** Shared tail for every master UPDATE: bump revision and stamp a fresh cursor. */
async function applyUpdate(
  db: Db,
  table: string,
  id: string,
  assignments: string[],
  params: unknown[],
): Promise<boolean> {
  if (assignments.length === 0) return false;
  const syncSeq = await allocateSyncSeq(db);
  const result = await mutate(
    db,
    `UPDATE ${table}
        SET ${assignments.join(', ')}, updated_at = ?, revision = revision + 1, sync_seq = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [...params, toDbDateTime(), syncSeq, id],
  );
  return result.affectedRows > 0;
}

async function softDelete(db: Db, table: string, id: string): Promise<boolean> {
  const syncSeq = await allocateSyncSeq(db);
  const now = toDbDateTime();
  const result = await mutate(
    db,
    `UPDATE ${table}
        SET deleted_at = ?, status = 'INACTIVE', updated_at = ?,
            revision = revision + 1, sync_seq = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [now, now, syncSeq, id],
  );
  return result.affectedRows > 0;
}

function buildMasterWhere(
  filter: MasterListFilter,
  extra: { conditions: string[]; params: unknown[] } = { conditions: [], params: [] },
): { where: string; params: unknown[] } {
  const conditions = [...extra.conditions];
  const params = [...extra.params];

  if (filter.includeDeleted !== true) conditions.push('deleted_at IS NULL');
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.search) {
    conditions.push('name LIKE ?');
    params.push(`%${filter.search}%`);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/* ---------------------------------------------------------------------- stations */

const STATION_COLUMNS = `
  id, name, code, description, status, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class StationRepository {
  async findById(db: Db, id: string) {
    return selectOne<StationRow>(
      db,
      `SELECT ${STATION_COLUMNS} FROM stations WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: MasterListFilter): Promise<{ rows: StationRow[]; total: number }> {
    const { where, params } = buildMasterWhere(filter);
    const rows = await selectRows<StationRow>(
      db,
      `SELECT ${STATION_COLUMNS} FROM stations ${where}
        ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM stations ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      name: string;
      code: string | null;
      description: string | null;
      status: MasterStatus;
      createdBy: string | null;
    },
  ): Promise<StationRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO stations
        (id, name, code, description, status, created_by, created_at, updated_at,
         revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.name,
        input.code,
        input.description,
        input.status,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted station could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      name?: string;
      code?: string | null;
      description?: string | null;
      status?: MasterStatus;
    },
  ): Promise<StationRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      assignments.push('name = ?');
      params.push(input.name);
    }
    if (input.code !== undefined) {
      assignments.push('code = ?');
      params.push(input.code);
    }
    if (input.description !== undefined) {
      assignments.push('description = ?');
      params.push(input.description);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    await applyUpdate(db, 'stations', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'stations', id);
  }

  /** Guards deletion: a station with boards on it (the FK is RESTRICT) must be deactivated. */
  async countBoardReferences(db: Db, stationId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM boards WHERE station_id = ? AND deleted_at IS NULL',
      [stationId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async changedSince(db: Db, cursor: number, limit: number) {
    return selectRows<StationRow>(
      db,
      `SELECT ${STATION_COLUMNS} FROM stations WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

/* ----------------------------------------------------------------- activity types */

const ACTIVITY_COLUMNS = `
  id, name, description, icon, status, sort_order, is_system, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class ActivityTypeRepository {
  async findById(db: Db, id: string) {
    return selectOne<ActivityTypeRow>(
      db,
      `SELECT ${ACTIVITY_COLUMNS} FROM activity_types WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: MasterListFilter): Promise<{ rows: ActivityTypeRow[]; total: number }> {
    const { where, params } = buildMasterWhere(filter);
    const rows = await selectRows<ActivityTypeRow>(
      db,
      `SELECT ${ACTIVITY_COLUMNS} FROM activity_types ${where}
        ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM activity_types ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      name: string;
      description: string | null;
      icon: string | null;
      status: MasterStatus;
      sortOrder: number;
      isSystem: boolean;
      createdBy: string | null;
    },
  ): Promise<ActivityTypeRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO activity_types
        (id, name, description, icon, status, sort_order, is_system, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.name,
        input.description,
        input.icon,
        input.status,
        input.sortOrder,
        input.isSystem ? 1 : 0,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted activity type could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      icon?: string | null;
      status?: MasterStatus;
      sortOrder?: number;
    },
  ): Promise<ActivityTypeRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      assignments.push('name = ?');
      params.push(input.name);
    }
    if (input.description !== undefined) {
      assignments.push('description = ?');
      params.push(input.description);
    }
    if (input.icon !== undefined) {
      assignments.push('icon = ?');
      params.push(input.icon);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, 'activity_types', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'activity_types', id);
  }

  async changedSince(db: Db, cursor: number, limit: number) {
    return selectRows<ActivityTypeRow>(
      db,
      `SELECT ${ACTIVITY_COLUMNS} FROM activity_types
        WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

/* --------------------------------------------------------------- menu categories */

const CATEGORY_COLUMNS = `
  id, name, name_hi, description, image_path, status, sort_order, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class MenuCategoryRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuCategoryRow>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM menu_categories WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(
    db: Db,
    filter: MasterListFilter,
  ): Promise<{ rows: MenuCategoryRow[]; total: number }> {
    const { where, params } = buildMasterWhere(filter);
    const rows = await selectRows<MenuCategoryRow>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM menu_categories ${where}
        ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM menu_categories ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      name: string;
      nameHi: string | null;
      description: string | null;
      imagePath: string | null;
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<MenuCategoryRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_categories
        (id, name, name_hi, description, image_path, status, sort_order, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.name,
        input.nameHi ?? null,
        input.description,
        input.imagePath,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted menu category could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      name?: string;
      nameHi?: string | null;
      description?: string | null;
      imagePath?: string | null;
      status?: MasterStatus;
      sortOrder?: number;
    },
  ): Promise<MenuCategoryRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      assignments.push('name = ?');
      params.push(input.name);
    }
    if (input.nameHi !== undefined) {
      assignments.push('name_hi = ?');
      params.push(input.nameHi);
    }
    if (input.description !== undefined) {
      assignments.push('description = ?');
      params.push(input.description);
    }
    if (input.imagePath !== undefined) {
      assignments.push('image_path = ?');
      params.push(input.imagePath);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, 'menu_categories', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'menu_categories', id);
  }

  async countActiveItems(db: Db, categoryId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM menu_items WHERE category_id = ? AND deleted_at IS NULL',
      [categoryId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async changedSince(db: Db, cursor: number, limit: number) {
    return selectRows<MenuCategoryRow>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM menu_categories
        WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

/* -------------------------------------------------------------------- menu items */

const ITEM_COLUMNS = `
  id, category_id, name, name_hi, unit, unit_hi, image_path, status, sort_order, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class MenuItemRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM menu_items WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async findByIds(db: Db, ids: readonly string[]): Promise<MenuItemRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return selectRows<MenuItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM menu_items WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ids,
    );
  }

  async list(
    db: Db,
    filter: MasterListFilter & { categoryId?: string },
  ): Promise<{ rows: MenuItemRow[]; total: number }> {
    const extra: { conditions: string[]; params: unknown[] } = { conditions: [], params: [] };
    if (filter.categoryId !== undefined) {
      extra.conditions.push('category_id = ?');
      extra.params.push(filter.categoryId);
    }
    const { where, params } = buildMasterWhere(filter, extra);
    const rows = await selectRows<MenuItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM menu_items ${where}
        ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM menu_items ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      categoryId: string;
      name: string;
      nameHi: string | null;
      unit: string;
      unitHi: string | null;
      imagePath: string | null;
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<MenuItemRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_items
        (id, category_id, name, name_hi, unit, unit_hi, image_path, status, sort_order, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.categoryId,
        input.name,
        input.nameHi ?? null,
        input.unit,
        input.unitHi ?? null,
        input.imagePath,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted menu item could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      categoryId?: string;
      name?: string;
      nameHi?: string | null;
      unit?: string;
      unitHi?: string | null;
      imagePath?: string | null;
      status?: MasterStatus;
      sortOrder?: number;
    },
  ): Promise<MenuItemRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.categoryId !== undefined) {
      assignments.push('category_id = ?');
      params.push(input.categoryId);
    }
    if (input.name !== undefined) {
      assignments.push('name = ?');
      params.push(input.name);
    }
    if (input.nameHi !== undefined) {
      assignments.push('name_hi = ?');
      params.push(input.nameHi);
    }
    if (input.unit !== undefined) {
      assignments.push('unit = ?');
      params.push(input.unit);
    }
    if (input.unitHi !== undefined) {
      assignments.push('unit_hi = ?');
      params.push(input.unitHi);
    }
    if (input.imagePath !== undefined) {
      assignments.push('image_path = ?');
      params.push(input.imagePath);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, 'menu_items', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'menu_items', id);
  }

  /** Guards deletion: an item already referenced by an order must be deactivated instead. */
  async countOrderReferences(db: Db, menuItemId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM order_items WHERE menu_item_id = ? AND deleted_at IS NULL',
      [menuItemId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async changedSince(db: Db, cursor: number, limit: number) {
    return selectRows<MenuItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM menu_items WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

export const stationRepository = new StationRepository();
export const activityTypeRepository = new ActivityTypeRepository();
export const menuCategoryRepository = new MenuCategoryRepository();
export const menuItemRepository = new MenuItemRepository();
