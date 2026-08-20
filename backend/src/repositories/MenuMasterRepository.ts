import type { RowDataPacket } from 'mysql2';
import type {
  AvailabilityStatus,
  MasterStatus,
  MediaEntityType,
  MediaRole,
  ModifierSelectionType,
  RoutableEntityType,
} from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CounterRouteRow,
  CounterRow,
  CountRow,
  ItemGroupRow,
  MediaAssetRow,
  MediaAssignmentRow,
  MenuCategoryAssignmentRow,
  MenuItemAssignmentRow,
  MenuItemScheduleRow,
  MenuItemVariantCatalogPriceRow,
  MenuItemVariantRow,
  MenuRow,
  MenuScheduleRow,
  ModifierAssignmentRow,
  ModifierGroupRow,
  ModifierRow,
  PrintingGroupRow,
  PrintingRouteRow,
} from '../models/rows';
import { newId } from '../utils/ids';
import { toDbDateTime, toDbTime } from '../utils/time';

/**
 * Repositories for the Menu Master layer introduced in 012_menu_master.sql.
 *
 * Follows the same shape as MasterRepository.ts (stations / activity types / menu categories /
 * menu items): every write bumps `revision` and allocates a fresh `sync_seq`, every delete is
 * a soft delete, every list is paginated with `deleted_at IS NULL` unless told otherwise.
 */

export interface ListFilter {
  search?: string;
  status?: MasterStatus;
  includeDeleted?: boolean;
  /**
   * Only meaningful for tables that carry `catalogue_id` (item_groups). A string narrows to one
   * Menu Catalogue; `null` asks for the rows filed under no catalogue at all.
   */
  catalogueId?: string | null;
  limit: number;
  offset: number;
}

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

async function softDeleteWhere(
  db: Db,
  table: string,
  where: string,
  params: unknown[],
): Promise<number> {
  const syncSeq = await allocateSyncSeq(db);
  const now = toDbDateTime();
  const result = await mutate(
    db,
    `UPDATE ${table}
        SET deleted_at = ?, status = 'INACTIVE', updated_at = ?,
            revision = revision + 1, sync_seq = ?
      WHERE ${where} AND deleted_at IS NULL`,
    [now, now, syncSeq, ...params],
  );
  return result.affectedRows;
}

function buildWhere(
  filter: ListFilter,
  extra: { conditions: string[]; params: unknown[] } = { conditions: [], params: [] },
  searchColumn = 'name',
): { where: string; params: unknown[] } {
  const conditions = [...extra.conditions];
  const params = [...extra.params];

  if (filter.includeDeleted !== true) conditions.push('deleted_at IS NULL');
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.search) {
    conditions.push(`${searchColumn} LIKE ?`);
    params.push(`%${filter.search}%`);
  }
  if (filter.catalogueId !== undefined) {
    if (filter.catalogueId === null) {
      conditions.push('catalogue_id IS NULL');
    } else {
      conditions.push('catalogue_id = ?');
      params.push(filter.catalogueId);
    }
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/* ------------------------------------------------------------------------- menus */

const MENU_COLUMNS = `
  id, code, name, description, status, sort_order, priority, version,
  effective_from, effective_until, published_at, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

/** One servable menu paired with one of the schedule windows that apply to it today. */
export interface MenuScheduleWindowRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  priority: number;
  /** Null when the LEFT JOIN found no window for today, whatever the reason. */
  start_time: string | null;
  end_time: string | null;
  /** 1 when the menu carries an ACTIVE schedule row on any day at all. */
  has_schedule: number;
}

export class MenuRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuRow>(
      db,
      `SELECT ${MENU_COLUMNS} FROM menus WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async findByCode(db: Db, code: string) {
    return selectOne<MenuRow>(
      db,
      `SELECT ${MENU_COLUMNS} FROM menus WHERE code = ? AND deleted_at IS NULL`,
      [code],
    );
  }

  async list(db: Db, filter: ListFilter): Promise<{ rows: MenuRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<MenuRow>(
      db,
      `SELECT ${MENU_COLUMNS} FROM menus ${where}
        ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(db, `SELECT COUNT(*) AS total FROM menus ${where}`, params);
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  /**
   * Every menu servable on `today`, joined to whichever of its ACTIVE schedule windows fall on
   * `weekday`. A menu with no window today still returns one row, with a null `start_time`.
   *
   * `has_schedule` is what tells the two null cases apart: a menu with no schedule rows at all
   * is always on, whereas a breakfast-only menu asked about on a Sunday is merely closed. Both
   * arrive with a null `start_time`, so the flag is the only thing separating them.
   */
  async listScheduleWindows(
    db: Db,
    params: { today: string; weekday: number },
  ): Promise<MenuScheduleWindowRow[]> {
    return selectRows<MenuScheduleWindowRow>(
      db,
      `SELECT m.id, m.code, m.name, m.priority,
              s.start_time, s.end_time,
              EXISTS (SELECT 1 FROM menu_schedules any_day
                       WHERE any_day.menu_id = m.id
                         AND any_day.deleted_at IS NULL
                         AND any_day.status = 'ACTIVE') AS has_schedule
         FROM menus m
         LEFT JOIN menu_schedules s
                ON s.menu_id = m.id
               AND s.deleted_at IS NULL
               AND s.status = 'ACTIVE'
               AND (s.day_of_week IS NULL OR s.day_of_week = ?)
        WHERE m.deleted_at IS NULL
          AND m.status = 'ACTIVE'
          AND m.published_at IS NOT NULL
          AND (m.effective_from IS NULL OR m.effective_from <= ?)
          AND (m.effective_until IS NULL OR m.effective_until >= ?)
        ORDER BY m.priority DESC, m.name ASC, s.start_time ASC`,
      [params.weekday, params.today, params.today],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      status: MasterStatus;
      sortOrder: number;
      priority: number;
      effectiveFrom: string | null;
      effectiveUntil: string | null;
      createdBy: string | null;
    },
  ): Promise<MenuRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menus
        (id, code, name, description, status, sort_order, priority, version,
         effective_from, effective_until, created_by, created_at, updated_at,
         revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.code,
        input.name,
        input.description,
        input.status,
        input.sortOrder,
        input.priority,
        input.effectiveFrom,
        input.effectiveUntil,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted menu could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      code?: string;
      name?: string;
      description?: string | null;
      status?: MasterStatus;
      sortOrder?: number;
      priority?: number;
      effectiveFrom?: string | null;
      effectiveUntil?: string | null;
      bumpVersion?: boolean;
    },
  ): Promise<MenuRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.code !== undefined) {
      assignments.push('code = ?');
      params.push(input.code);
    }
    if (input.name !== undefined) {
      assignments.push('name = ?');
      params.push(input.name);
    }
    if (input.description !== undefined) {
      assignments.push('description = ?');
      params.push(input.description);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    if (input.priority !== undefined) {
      assignments.push('priority = ?');
      params.push(input.priority);
    }
    if (input.effectiveFrom !== undefined) {
      assignments.push('effective_from = ?');
      params.push(input.effectiveFrom);
    }
    if (input.effectiveUntil !== undefined) {
      assignments.push('effective_until = ?');
      params.push(input.effectiveUntil);
    }
    if (input.bumpVersion) {
      assignments.push('version = version + 1');
    }
    await applyUpdate(db, 'menus', id, assignments, params);
    return this.findById(db, id);
  }

  async setPublished(db: Db, id: string, published: boolean): Promise<MenuRow | null> {
    await applyUpdate(db, 'menus', id, ['published_at = ?'], [published ? toDbDateTime() : null]);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'menus', id);
  }

  async restore(db: Db, id: string): Promise<MenuRow | null> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE menus SET deleted_at = NULL, status = 'ACTIVE', updated_at = ?,
              revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NOT NULL`,
      [now, syncSeq, id],
    );
    return selectOne<MenuRow>(db, `SELECT ${MENU_COLUMNS} FROM menus WHERE id = ?`, [id]);
  }

  async findByIdIncludingDeleted(db: Db, id: string) {
    return selectOne<MenuRow>(db, `SELECT ${MENU_COLUMNS} FROM menus WHERE id = ?`, [id]);
  }

  /** Refused while the menu still has any category or item assignments. */
  async countAssignmentReferences(db: Db, menuId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM menu_category_assignments WHERE menu_id = ? AND deleted_at IS NULL) +
         (SELECT COUNT(*) FROM menu_item_assignments WHERE menu_id = ? AND deleted_at IS NULL)
         AS total`,
      [menuId, menuId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async changedSince(db: Db, cursor: number, limit: number) {
    return selectRows<MenuRow>(
      db,
      `SELECT ${MENU_COLUMNS} FROM menus WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

/* ------------------------------------------------------- menu category assignments */

const MCA_COLUMNS = `
  mca.id, mca.menu_id, mca.category_id, mca.display_name, mca.display_name_hi,
  mca.description, mca.description_hi, mca.status, mca.sort_order, mca.pos_visible,
  mca.board_visible, mca.created_by, mca.created_at, mca.updated_at, mca.deleted_at,
  mca.revision, mca.sync_seq,
  mc.name AS category_name, mc.name_hi AS category_name_hi, mc.image_path AS category_image_path`;

export class MenuCategoryAssignmentRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuCategoryAssignmentRow>(
      db,
      `SELECT ${MCA_COLUMNS} FROM menu_category_assignments mca
         JOIN menu_categories mc ON mc.id = mca.category_id
        WHERE mca.id = ? AND mca.deleted_at IS NULL`,
      [id],
    );
  }

  async listForMenu(db: Db, menuId: string, includeInactive = false) {
    return selectRows<MenuCategoryAssignmentRow>(
      db,
      `SELECT ${MCA_COLUMNS} FROM menu_category_assignments mca
         JOIN menu_categories mc ON mc.id = mca.category_id
        WHERE mca.menu_id = ? AND mca.deleted_at IS NULL
          ${includeInactive ? '' : "AND mca.status = 'ACTIVE'"}
        ORDER BY mca.sort_order ASC, mc.name ASC`,
      [menuId],
    );
  }

  /**
   * Every live assignment for one category, across menus. Used when a category's `catalogue_id`
   * changes: the rows naming any other menu are now stale and have to be pruned.
   */
  async listForCategory(db: Db, categoryId: string) {
    return selectRows<MenuCategoryAssignmentRow>(
      db,
      `SELECT ${MCA_COLUMNS} FROM menu_category_assignments mca
         JOIN menu_categories mc ON mc.id = mca.category_id
        WHERE mca.category_id = ? AND mca.deleted_at IS NULL`,
      [categoryId],
    );
  }

  async findByMenuAndCategory(db: Db, menuId: string, categoryId: string) {
    return selectOne<MenuCategoryAssignmentRow>(
      db,
      `SELECT ${MCA_COLUMNS} FROM menu_category_assignments mca
         JOIN menu_categories mc ON mc.id = mca.category_id
        WHERE mca.menu_id = ? AND mca.category_id = ? AND mca.deleted_at IS NULL`,
      [menuId, categoryId],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      menuId: string;
      categoryId: string;
      displayName: string | null;
      displayNameHi: string | null;
      description: string | null;
      descriptionHi: string | null;
      status: MasterStatus;
      sortOrder: number;
      posVisible: boolean;
      boardVisible: boolean;
      createdBy: string | null;
    },
  ): Promise<MenuCategoryAssignmentRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_category_assignments
        (id, menu_id, category_id, display_name, display_name_hi, description, description_hi,
         status, sort_order, pos_visible, board_visible, created_by, created_at, updated_at,
         revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, display_name = VALUES(display_name),
         display_name_hi = VALUES(display_name_hi), description = VALUES(description),
         description_hi = VALUES(description_hi), status = VALUES(status), sort_order = VALUES(sort_order),
         pos_visible = VALUES(pos_visible), board_visible = VALUES(board_visible),
         updated_at = VALUES(updated_at),
         revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [
        input.id,
        input.menuId,
        input.categoryId,
        input.displayName,
        input.displayNameHi,
        input.description,
        input.descriptionHi,
        input.status,
        input.sortOrder,
        input.posVisible ? 1 : 0,
        input.boardVisible ? 1 : 0,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findByMenuAndCategory(db, input.menuId, input.categoryId);
    if (row === null) throw new Error('Inserted menu category assignment could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      displayName?: string | null;
      displayNameHi?: string | null;
      description?: string | null;
      descriptionHi?: string | null;
      status?: MasterStatus;
      sortOrder?: number;
      posVisible?: boolean;
      boardVisible?: boolean;
    },
  ): Promise<MenuCategoryAssignmentRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.displayName !== undefined) {
      assignments.push('display_name = ?');
      params.push(input.displayName);
    }
    if (input.displayNameHi !== undefined) {
      assignments.push('display_name_hi = ?');
      params.push(input.displayNameHi);
    }
    if (input.description !== undefined) {
      assignments.push('description = ?');
      params.push(input.description);
    }
    if (input.descriptionHi !== undefined) {
      assignments.push('description_hi = ?');
      params.push(input.descriptionHi);
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    if (input.posVisible !== undefined) {
      assignments.push('pos_visible = ?');
      params.push(input.posVisible ? 1 : 0);
    }
    if (input.boardVisible !== undefined) {
      assignments.push('board_visible = ?');
      params.push(input.boardVisible ? 1 : 0);
    }
    await applyUpdate(db, 'menu_category_assignments', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'menu_category_assignments', id);
  }

  async countItemReferences(db: Db, categoryAssignmentId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM menu_item_assignments WHERE category_assignment_id = ? AND deleted_at IS NULL',
      [categoryAssignmentId],
    );
    return row === null ? 0 : Number(row.total);
  }
}

/* ------------------------------------------------------------ menu item assignments */

const MIA_COLUMNS = `
  mia.id, mia.menu_id, mia.food_item_id, mia.category_assignment_id, mia.display_name,
  mia.display_name_hi, mia.description, mia.description_hi, mia.preparation_method,
  mia.preparation_method_hi, mia.preparation_time_minutes, mia.unit,
  mia.status, mia.availability, mia.sort_order, mia.pos_visible, mia.board_visible,
  mia.qr_visible, mia.web_visible, mia.app_visible, mia.dine_in_available,
  mia.takeaway_available, mia.delivery_available, mia.allow_decimal_quantity,
  mia.created_by, mia.created_at,
  mia.updated_at, mia.deleted_at, mia.revision, mia.sync_seq,
  mi.name AS food_item_name, mi.name_hi AS food_item_name_hi,
  mi.description AS food_item_description, mi.unit AS food_item_unit,
  mi.image_path AS food_item_image_path, mi.base_price AS food_item_base_price,
  (SELECT COUNT(*) FROM menu_item_variants v
    WHERE v.food_item_id = mia.food_item_id AND v.deleted_at IS NULL) AS variant_count`;

export interface MenuItemAssignmentListFilter extends ListFilter {
  menuId?: string;
  categoryAssignmentId?: string;
  availability?: AvailabilityStatus;
}

export class MenuItemAssignmentRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuItemAssignmentRow>(
      db,
      `SELECT ${MIA_COLUMNS} FROM menu_item_assignments mia
         JOIN menu_items mi ON mi.id = mia.food_item_id
        WHERE mia.id = ? AND mia.deleted_at IS NULL`,
      [id],
    );
  }

  /**
   * Every menu that offers this dish. A counter running out is a fact about the food, so the
   * caller that hides it has to reach each menu's own assignment row, not just one.
   */
  async listForFoodItem(db: Db, foodItemId: string, includeInactive = false) {
    return selectRows<MenuItemAssignmentRow>(
      db,
      `SELECT ${MIA_COLUMNS} FROM menu_item_assignments mia
         JOIN menu_items mi ON mi.id = mia.food_item_id
        WHERE mia.food_item_id = ? AND mia.deleted_at IS NULL
          ${includeInactive ? '' : "AND mia.status = 'ACTIVE'"}`,
      [foodItemId],
    );
  }

  async findByMenuAndFoodItem(db: Db, menuId: string, foodItemId: string) {
    return selectOne<MenuItemAssignmentRow>(
      db,
      `SELECT ${MIA_COLUMNS} FROM menu_item_assignments mia
         JOIN menu_items mi ON mi.id = mia.food_item_id
        WHERE mia.menu_id = ? AND mia.food_item_id = ? AND mia.deleted_at IS NULL`,
      [menuId, foodItemId],
    );
  }

  async list(
    db: Db,
    filter: MenuItemAssignmentListFilter,
  ): Promise<{ rows: MenuItemAssignmentRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.includeDeleted !== true) conditions.push('mia.deleted_at IS NULL');
    if (filter.status) {
      conditions.push('mia.status = ?');
      params.push(filter.status);
    }
    if (filter.availability) {
      conditions.push('mia.availability = ?');
      params.push(filter.availability);
    }
    if (filter.menuId) {
      conditions.push('mia.menu_id = ?');
      params.push(filter.menuId);
    }
    if (filter.categoryAssignmentId) {
      conditions.push('mia.category_assignment_id = ?');
      params.push(filter.categoryAssignmentId);
    }
    if (filter.search) {
      conditions.push('(mi.name LIKE ? OR mia.display_name LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await selectRows<MenuItemAssignmentRow>(
      db,
      `SELECT ${MIA_COLUMNS} FROM menu_item_assignments mia
         JOIN menu_items mi ON mi.id = mia.food_item_id
        ${where}
        ORDER BY mia.sort_order ASC, mi.name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM menu_item_assignments mia
         JOIN menu_items mi ON mi.id = mia.food_item_id ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      menuId: string;
      foodItemId: string;
      categoryAssignmentId: string | null;
      displayName: string | null;
      displayNameHi: string | null;
      description: string | null;
      descriptionHi: string | null;
      preparationMethod: string | null;
      preparationMethodHi: string | null;
      preparationTimeMinutes: number | null;
      unit: string | null;
      status: MasterStatus;
      availability: AvailabilityStatus;
      sortOrder: number;
      posVisible: boolean;
      boardVisible: boolean;
      qrVisible: boolean;
      webVisible: boolean;
      appVisible: boolean;
      dineInAvailable: boolean;
      takeawayAvailable: boolean;
      deliveryAvailable: boolean;
      allowDecimalQuantity: boolean;
      createdBy: string | null;
    },
  ): Promise<MenuItemAssignmentRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_item_assignments
        (id, menu_id, food_item_id, category_assignment_id, display_name, display_name_hi,
         description, description_hi, preparation_method, preparation_method_hi,
         preparation_time_minutes, unit, status, availability, sort_order,
         pos_visible, board_visible, qr_visible, web_visible, app_visible, dine_in_available,
         takeaway_available, delivery_available, allow_decimal_quantity, created_by, created_at, updated_at,
         revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL,
         category_assignment_id = VALUES(category_assignment_id), display_name = VALUES(display_name),
         display_name_hi = VALUES(display_name_hi), description = VALUES(description),
         description_hi = VALUES(description_hi), preparation_method = VALUES(preparation_method),
         preparation_method_hi = VALUES(preparation_method_hi),
         preparation_time_minutes = VALUES(preparation_time_minutes), unit = VALUES(unit),
         status = VALUES(status), availability = VALUES(availability), sort_order = VALUES(sort_order),
         pos_visible = VALUES(pos_visible), board_visible = VALUES(board_visible),
         qr_visible = VALUES(qr_visible), web_visible = VALUES(web_visible), app_visible = VALUES(app_visible),
         dine_in_available = VALUES(dine_in_available), takeaway_available = VALUES(takeaway_available),
         delivery_available = VALUES(delivery_available),
         allow_decimal_quantity = VALUES(allow_decimal_quantity),
         updated_at = VALUES(updated_at), revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [
        input.id,
        input.menuId,
        input.foodItemId,
        input.categoryAssignmentId,
        input.displayName,
        input.displayNameHi,
        input.description,
        input.descriptionHi,
        input.preparationMethod,
        input.preparationMethodHi,
        input.preparationTimeMinutes,
        input.unit,
        input.status,
        input.availability,
        input.sortOrder,
        input.posVisible ? 1 : 0,
        input.boardVisible ? 1 : 0,
        input.qrVisible ? 1 : 0,
        input.webVisible ? 1 : 0,
        input.appVisible ? 1 : 0,
        input.dineInAvailable ? 1 : 0,
        input.takeawayAvailable ? 1 : 0,
        input.deliveryAvailable ? 1 : 0,
        input.allowDecimalQuantity ? 1 : 0,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findByMenuAndFoodItem(db, input.menuId, input.foodItemId);
    if (row === null) throw new Error('Inserted menu item assignment could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      categoryAssignmentId: string | null;
      displayName: string | null;
      displayNameHi: string | null;
      description: string | null;
      descriptionHi: string | null;
      preparationMethod: string | null;
      preparationMethodHi: string | null;
      preparationTimeMinutes: number | null;
      unit: string | null;
      status: MasterStatus;
      availability: AvailabilityStatus;
      sortOrder: number;
      posVisible: boolean;
      boardVisible: boolean;
      qrVisible: boolean;
      webVisible: boolean;
      appVisible: boolean;
      dineInAvailable: boolean;
      takeawayAvailable: boolean;
      deliveryAvailable: boolean;
      allowDecimalQuantity: boolean;
    }>,
  ): Promise<MenuItemAssignmentRow | null> {
    const columnMap: Record<string, string> = {
      categoryAssignmentId: 'category_assignment_id',
      displayName: 'display_name',
      displayNameHi: 'display_name_hi',
      description: 'description',
      descriptionHi: 'description_hi',
      preparationMethod: 'preparation_method',
      preparationMethodHi: 'preparation_method_hi',
      preparationTimeMinutes: 'preparation_time_minutes',
      unit: 'unit',
      status: 'status',
      availability: 'availability',
      sortOrder: 'sort_order',
    };
    const booleanColumns: Record<string, string> = {
      posVisible: 'pos_visible',
      boardVisible: 'board_visible',
      qrVisible: 'qr_visible',
      webVisible: 'web_visible',
      appVisible: 'app_visible',
      dineInAvailable: 'dine_in_available',
      takeawayAvailable: 'takeaway_available',
      deliveryAvailable: 'delivery_available',
      allowDecimalQuantity: 'allow_decimal_quantity',
    };
    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(columnMap)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value);
      }
    }
    for (const [key, column] of Object.entries(booleanColumns)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value ? 1 : 0);
      }
    }
    await applyUpdate(db, 'menu_item_assignments', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'menu_item_assignments', id);
  }

  async softDeleteForFoodItem(db: Db, foodItemId: string): Promise<number> {
    return softDeleteWhere(db, 'menu_item_assignments', 'food_item_id = ?', [foodItemId]);
  }

  /** True once an order has been placed for this food item under this specific menu. */
  async countOrderReferences(db: Db, assignmentId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM order_items oi
           WHERE oi.menu_id = a.menu_id AND oi.menu_item_id = a.food_item_id) +
         (SELECT COUNT(*) FROM pos_order_items poi
            JOIN pos_orders po ON po.id = poi.pos_order_id
           WHERE po.menu_id = a.menu_id AND poi.menu_item_id = a.food_item_id) AS total
         FROM menu_item_assignments a
        WHERE a.id = ?`,
      [assignmentId],
    );
    return row === null ? 0 : Number(row.total);
  }

  /**
   * Un-86's a batch of assignments: `UNAVAILABLE` and `SOLD_OUT` both fold back to `AVAILABLE`,
   * everything else is left alone. Used by `MenuShiftSchedulerService` at the start of each
   * shift — a menu should not open a new shift still hiding what ran out on the last one.
   *
   * Not `sync_seq`-bumped: `menu_item_assignments` is outside `SYNC_ENTITIES` (Menu Master is
   * not yet part of Android's offline delta-sync set), so there is no cursor for this write to
   * satisfy.
   */
  async resetAvailability(db: Db, assignmentIds: string[]): Promise<number> {
    if (assignmentIds.length === 0) return 0;
    const placeholders = assignmentIds.map(() => '?').join(', ');
    const result = await mutate(
      db,
      `UPDATE menu_item_assignments
          SET availability = 'AVAILABLE', updated_at = ?, revision = revision + 1
        WHERE id IN (${placeholders}) AND availability IN ('UNAVAILABLE', 'SOLD_OUT')
          AND deleted_at IS NULL`,
      [toDbDateTime(), ...assignmentIds],
    );
    return result.affectedRows;
  }
}

/* ---------------------------------------------------------------- menu item variants */

const VARIANT_COLUMNS = `
  id, food_item_id, variant_code, name, name_hi, description, description_hi,
  portion_name, portion_name_hi, quantity, unit, price, tax_profile_id, status, availability,
  sort_order,
  preparation_method, preparation_method_hi, preparation_time_minutes, is_default,
  allow_decimal_quantity,
  created_by, created_at, updated_at, deleted_at, revision, sync_seq`;

export class MenuItemVariantRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuItemVariantRow>(
      db,
      `SELECT ${VARIANT_COLUMNS} FROM menu_item_variants WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async findByCode(db: Db, foodItemId: string, variantCode: string) {
    return selectOne<MenuItemVariantRow>(
      db,
      `SELECT ${VARIANT_COLUMNS} FROM menu_item_variants
        WHERE food_item_id = ? AND variant_code = ? AND deleted_at IS NULL`,
      [foodItemId, variantCode],
    );
  }

  /** Global to the Food Item Master — every menu that offers this dish sees the same variants. */
  async listForFoodItem(db: Db, foodItemId: string, includeInactive = false) {
    return selectRows<MenuItemVariantRow>(
      db,
      `SELECT ${VARIANT_COLUMNS} FROM menu_item_variants
        WHERE food_item_id = ? AND deleted_at IS NULL
          ${includeInactive ? '' : "AND status = 'ACTIVE'"}
        ORDER BY sort_order ASC, name ASC`,
      [foodItemId],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      foodItemId: string;
      variantCode: string | null;
      name: string;
      nameHi: string | null;
      description: string | null;
      descriptionHi: string | null;
      portionName: string | null;
      portionNameHi: string | null;
      quantity: number | null;
      unit: string | null;
      price: number;
      taxProfileId: string | null;
      status: MasterStatus;
      availability: AvailabilityStatus;
      sortOrder: number;
      preparationMethod: string | null;
      preparationMethodHi: string | null;
      preparationTimeMinutes: number | null;
      isDefault: boolean;
      allowDecimalQuantity: boolean;
      createdBy: string | null;
    },
  ): Promise<MenuItemVariantRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_item_variants
        (id, food_item_id, variant_code, name, name_hi, description, description_hi,
         portion_name, portion_name_hi, quantity, unit, price, tax_profile_id, status,
         availability, sort_order,
         preparation_method, preparation_method_hi, preparation_time_minutes, is_default,
         allow_decimal_quantity, created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, name = VALUES(name), name_hi = VALUES(name_hi),
         description = VALUES(description), description_hi = VALUES(description_hi),
         portion_name = VALUES(portion_name), portion_name_hi = VALUES(portion_name_hi),
         quantity = VALUES(quantity), unit = VALUES(unit), price = VALUES(price),
         tax_profile_id = VALUES(tax_profile_id), status = VALUES(status),
         availability = VALUES(availability), sort_order = VALUES(sort_order),
         preparation_method = VALUES(preparation_method),
         preparation_method_hi = VALUES(preparation_method_hi),
         preparation_time_minutes = VALUES(preparation_time_minutes), is_default = VALUES(is_default),
         allow_decimal_quantity = VALUES(allow_decimal_quantity),
         updated_at = VALUES(updated_at), revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [
        input.id,
        input.foodItemId,
        input.variantCode,
        input.name,
        input.nameHi,
        input.description,
        input.descriptionHi,
        input.portionName,
        input.portionNameHi,
        input.quantity,
        input.unit,
        input.price,
        input.taxProfileId,
        input.status,
        input.availability,
        input.sortOrder,
        input.preparationMethod,
        input.preparationMethodHi,
        input.preparationTimeMinutes,
        input.isDefault ? 1 : 0,
        input.allowDecimalQuantity ? 1 : 0,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = input.variantCode
      ? await this.findByCode(db, input.foodItemId, input.variantCode)
      : await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted menu item variant could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      variantCode: string | null;
      name: string;
      nameHi: string | null;
      description: string | null;
      descriptionHi: string | null;
      portionName: string | null;
      portionNameHi: string | null;
      quantity: number | null;
      unit: string | null;
      price: number;
      taxProfileId: string | null;
      status: MasterStatus;
      availability: AvailabilityStatus;
      sortOrder: number;
      preparationMethod: string | null;
      preparationMethodHi: string | null;
      preparationTimeMinutes: number | null;
      isDefault: boolean;
      allowDecimalQuantity: boolean;
    }>,
  ): Promise<MenuItemVariantRow | null> {
    const columnMap: Record<string, string> = {
      variantCode: 'variant_code',
      name: 'name',
      nameHi: 'name_hi',
      description: 'description',
      descriptionHi: 'description_hi',
      portionName: 'portion_name',
      portionNameHi: 'portion_name_hi',
      quantity: 'quantity',
      unit: 'unit',
      price: 'price',
      taxProfileId: 'tax_profile_id',
      status: 'status',
      availability: 'availability',
      sortOrder: 'sort_order',
      preparationMethod: 'preparation_method',
      preparationMethodHi: 'preparation_method_hi',
      preparationTimeMinutes: 'preparation_time_minutes',
    };
    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(columnMap)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value);
      }
    }
    if (input.isDefault !== undefined) {
      assignments.push('is_default = ?');
      params.push(input.isDefault ? 1 : 0);
    }
    if (input.allowDecimalQuantity !== undefined) {
      assignments.push('allow_decimal_quantity = ?');
      params.push(input.allowDecimalQuantity ? 1 : 0);
    }
    await applyUpdate(db, 'menu_item_variants', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'menu_item_variants', id);
  }

  async softDeleteForFoodItem(db: Db, foodItemId: string): Promise<number> {
    return softDeleteWhere(db, 'menu_item_variants', 'food_item_id = ?', [foodItemId]);
  }

  async countOrderReferences(db: Db, variantId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM order_items WHERE variant_id = ?) +
         (SELECT COUNT(*) FROM pos_order_items WHERE variant_id = ?) AS total`,
      [variantId, variantId],
    );
    return row === null ? 0 : Number(row.total);
  }

  /**
   * The variant-level half of {@link MenuItemAssignmentRepository.resetAvailability}. A variant
   * belongs to a food item, not to any one menu (013 made them global across every menu that
   * offers the dish), so this is scoped by `food_item_id` rather than by menu — a caller passes
   * the food items relevant to whichever menu it is resetting.
   */
  async resetAvailability(db: Db, foodItemIds: string[]): Promise<number> {
    if (foodItemIds.length === 0) return 0;
    const placeholders = foodItemIds.map(() => '?').join(', ');
    const result = await mutate(
      db,
      `UPDATE menu_item_variants
          SET availability = 'AVAILABLE', updated_at = ?, revision = revision + 1
        WHERE food_item_id IN (${placeholders}) AND availability IN ('UNAVAILABLE', 'SOLD_OUT')
          AND deleted_at IS NULL`,
      [toDbDateTime(), ...foodItemIds],
    );
    return result.affectedRows;
  }
}

/* ----------------------------------------------------------------------- counters */

const COUNTER_COLUMNS = `
  id, name, code, description, status, sort_order, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class CounterRepository {
  async findById(db: Db, id: string) {
    return selectOne<CounterRow>(
      db,
      `SELECT ${COUNTER_COLUMNS} FROM counters WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: ListFilter) {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<CounterRow>(
      db,
      `SELECT ${COUNTER_COLUMNS} FROM counters ${where} ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(db, `SELECT COUNT(*) AS total FROM counters ${where}`, params);
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
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<CounterRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO counters (id, name, code, description, status, sort_order, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.name,
        input.code,
        input.description,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted counter could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      name: string;
      code: string | null;
      description: string | null;
      status: MasterStatus;
      sortOrder: number;
    }>,
  ): Promise<CounterRow | null> {
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
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, 'counters', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'counters', id);
  }

  async countRouteReferences(db: Db, counterId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM counter_routes WHERE counter_id = ? AND deleted_at IS NULL',
      [counterId],
    );
    return row === null ? 0 : Number(row.total);
  }
}

const COUNTER_ROUTE_COLUMNS = `
  cr.id, cr.entity_type, cr.entity_id, cr.counter_id, cr.status, cr.created_by,
  cr.created_at, cr.updated_at, cr.deleted_at, cr.revision, cr.sync_seq,
  c.name AS counter_name`;

export class CounterRouteRepository {
  async findById(db: Db, id: string) {
    return selectOne<CounterRouteRow>(
      db,
      `SELECT ${COUNTER_ROUTE_COLUMNS} FROM counter_routes cr
         JOIN counters c ON c.id = cr.counter_id AND c.deleted_at IS NULL
        WHERE cr.id = ? AND cr.deleted_at IS NULL`,
      [id],
    );
  }

  async findForTarget(
    db: Db,
    entityType: RoutableEntityType,
    entityId: string,
    counterId: string,
  ) {
    return selectOne<CounterRouteRow>(
      db,
      `SELECT ${COUNTER_ROUTE_COLUMNS} FROM counter_routes cr
         JOIN counters c ON c.id = cr.counter_id AND c.deleted_at IS NULL
        WHERE cr.entity_type = ? AND cr.entity_id = ? AND cr.counter_id = ?
          AND cr.deleted_at IS NULL`,
      [entityType, entityId, counterId],
    );
  }

  async listForEntity(db: Db, entityType: RoutableEntityType, entityId: string) {
    return selectRows<CounterRouteRow>(
      db,
      `SELECT ${COUNTER_ROUTE_COLUMNS} FROM counter_routes cr
         JOIN counters c ON c.id = cr.counter_id AND c.deleted_at IS NULL
        WHERE cr.entity_type = ? AND cr.entity_id = ? AND cr.deleted_at IS NULL
          AND cr.status = 'ACTIVE'
        ORDER BY c.sort_order ASC, c.name ASC`,
      [entityType, entityId],
    );
  }

  async listForEntities(db: Db, entityType: RoutableEntityType, entityIds: readonly string[]) {
    if (entityIds.length === 0) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    return selectRows<CounterRouteRow>(
      db,
      `SELECT ${COUNTER_ROUTE_COLUMNS} FROM counter_routes cr
         JOIN counters c ON c.id = cr.counter_id AND c.deleted_at IS NULL
        WHERE cr.entity_type = ? AND cr.entity_id IN (${placeholders})
          AND cr.deleted_at IS NULL AND cr.status = 'ACTIVE'
        ORDER BY c.sort_order ASC, c.name ASC`,
      [entityType, ...entityIds],
    );
  }

  async listForEntityType(db: Db, entityType: RoutableEntityType) {
    const targetTable = entityType === 'MENU_ITEM'
      ? 'menu_items'
      : entityType === 'MENU_ITEM_ASSIGNMENT'
        ? 'menu_item_assignments'
        : 'menu_item_variants';
    return selectRows<CounterRouteRow>(
      db,
      `SELECT ${COUNTER_ROUTE_COLUMNS} FROM counter_routes cr
         JOIN counters c ON c.id = cr.counter_id AND c.deleted_at IS NULL
         JOIN ${targetTable} target ON target.id = cr.entity_id AND target.deleted_at IS NULL
        WHERE cr.entity_type = ? AND cr.deleted_at IS NULL AND cr.status = 'ACTIVE'
        ORDER BY c.sort_order ASC, c.name ASC`,
      [entityType],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      entityType: RoutableEntityType;
      entityId: string;
      counterId: string;
      status: MasterStatus;
      createdBy: string | null;
    },
  ): Promise<CounterRouteRow> {
    const existing = await this.findForTarget(db, input.entityType, input.entityId, input.counterId);
    if (existing?.status === input.status) return existing;
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO counter_routes (id, entity_type, entity_id, counter_id, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, status = VALUES(status),
         updated_at = VALUES(updated_at), revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [input.id, input.entityType, input.entityId, input.counterId, input.status, input.createdBy, now, now, syncSeq],
    );
    const row = await this.findForTarget(db, input.entityType, input.entityId, input.counterId);
    if (row === null) throw new Error('Inserted counter route could not be read back');
    return row;
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'counter_routes', id);
  }

  async softDeleteForCounter(db: Db, counterId: string): Promise<number> {
    return softDeleteWhere(db, 'counter_routes', 'counter_id = ?', [counterId]);
  }

  async softDeleteForEntity(db: Db, entityType: RoutableEntityType, entityId: string): Promise<number> {
    return softDeleteWhere(db, 'counter_routes', 'entity_type = ? AND entity_id = ?', [entityType, entityId]);
  }
}

/* ------------------------------------------------------------------ printing groups */

const PRINTING_GROUP_COLUMNS = `
  id, name, code, description, status, sort_order, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class PrintingGroupRepository {
  async findById(db: Db, id: string) {
    return selectOne<PrintingGroupRow>(
      db,
      `SELECT ${PRINTING_GROUP_COLUMNS} FROM printing_groups WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: ListFilter) {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<PrintingGroupRow>(
      db,
      `SELECT ${PRINTING_GROUP_COLUMNS} FROM printing_groups ${where} ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM printing_groups ${where}`,
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
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<PrintingGroupRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO printing_groups (id, name, code, description, status, sort_order, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.name,
        input.code,
        input.description,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted printing group could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      name: string;
      code: string | null;
      description: string | null;
      status: MasterStatus;
      sortOrder: number;
    }>,
  ): Promise<PrintingGroupRow | null> {
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
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, 'printing_groups', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'printing_groups', id);
  }

  async countRouteReferences(db: Db, printingGroupId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM printing_routes WHERE printing_group_id = ? AND deleted_at IS NULL',
      [printingGroupId],
    );
    return row === null ? 0 : Number(row.total);
  }
}

const PRINTING_ROUTE_COLUMNS = `
  pr.id, pr.entity_type, pr.entity_id, pr.printing_group_id, pr.sort_order, pr.status,
  pr.created_by, pr.created_at, pr.updated_at, pr.deleted_at, pr.revision, pr.sync_seq,
  pg.name AS printing_group_name`;

export class PrintingRouteRepository {
  async findById(db: Db, id: string) {
    return selectOne<PrintingRouteRow>(
      db,
      `SELECT ${PRINTING_ROUTE_COLUMNS} FROM printing_routes pr
         JOIN printing_groups pg ON pg.id = pr.printing_group_id AND pg.deleted_at IS NULL
        WHERE pr.id = ? AND pr.deleted_at IS NULL`,
      [id],
    );
  }

  async findForTarget(
    db: Db,
    entityType: RoutableEntityType,
    entityId: string,
    printingGroupId: string,
  ) {
    return selectOne<PrintingRouteRow>(
      db,
      `SELECT ${PRINTING_ROUTE_COLUMNS} FROM printing_routes pr
         JOIN printing_groups pg ON pg.id = pr.printing_group_id AND pg.deleted_at IS NULL
        WHERE pr.entity_type = ? AND pr.entity_id = ? AND pr.printing_group_id = ?
          AND pr.deleted_at IS NULL`,
      [entityType, entityId, printingGroupId],
    );
  }

  async listForEntity(db: Db, entityType: RoutableEntityType, entityId: string) {
    return selectRows<PrintingRouteRow>(
      db,
      `SELECT ${PRINTING_ROUTE_COLUMNS} FROM printing_routes pr
         JOIN printing_groups pg ON pg.id = pr.printing_group_id AND pg.deleted_at IS NULL
        WHERE pr.entity_type = ? AND pr.entity_id = ? AND pr.deleted_at IS NULL
          AND pr.status = 'ACTIVE'
        ORDER BY pr.sort_order ASC, pg.sort_order ASC, pg.name ASC`,
      [entityType, entityId],
    );
  }

  async listForEntities(db: Db, entityType: RoutableEntityType, entityIds: readonly string[]) {
    if (entityIds.length === 0) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    return selectRows<PrintingRouteRow>(
      db,
      `SELECT ${PRINTING_ROUTE_COLUMNS} FROM printing_routes pr
         JOIN printing_groups pg ON pg.id = pr.printing_group_id AND pg.deleted_at IS NULL
        WHERE pr.entity_type = ? AND pr.entity_id IN (${placeholders})
          AND pr.deleted_at IS NULL AND pr.status = 'ACTIVE'
        ORDER BY pr.sort_order ASC, pg.sort_order ASC, pg.name ASC`,
      [entityType, ...entityIds],
    );
  }

  async listForEntityType(db: Db, entityType: RoutableEntityType) {
    const targetTable = entityType === 'MENU_ITEM'
      ? 'menu_items'
      : entityType === 'MENU_ITEM_ASSIGNMENT'
        ? 'menu_item_assignments'
        : 'menu_item_variants';
    return selectRows<PrintingRouteRow>(
      db,
      `SELECT ${PRINTING_ROUTE_COLUMNS} FROM printing_routes pr
         JOIN printing_groups pg ON pg.id = pr.printing_group_id AND pg.deleted_at IS NULL
         JOIN ${targetTable} target ON target.id = pr.entity_id AND target.deleted_at IS NULL
        WHERE pr.entity_type = ? AND pr.deleted_at IS NULL AND pr.status = 'ACTIVE'
        ORDER BY pr.sort_order ASC, pg.sort_order ASC, pg.name ASC`,
      [entityType],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      entityType: RoutableEntityType;
      entityId: string;
      printingGroupId: string;
      sortOrder: number;
      status: MasterStatus;
      createdBy: string | null;
    },
  ): Promise<PrintingRouteRow> {
    const existing = await this.findForTarget(
      db,
      input.entityType,
      input.entityId,
      input.printingGroupId,
    );
    if (existing?.status === input.status) return existing;
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO printing_routes
        (id, entity_type, entity_id, printing_group_id, sort_order, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, sort_order = VALUES(sort_order),
         status = VALUES(status), updated_at = VALUES(updated_at),
         revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [
        input.id,
        input.entityType,
        input.entityId,
        input.printingGroupId,
        input.sortOrder,
        input.status,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findForTarget(
      db,
      input.entityType,
      input.entityId,
      input.printingGroupId,
    );
    if (row === null) throw new Error('Inserted printing route could not be read back');
    return row;
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'printing_routes', id);
  }

  async softDeleteForPrintingGroup(db: Db, printingGroupId: string): Promise<number> {
    return softDeleteWhere(db, 'printing_routes', 'printing_group_id = ?', [printingGroupId]);
  }

  async softDeleteForEntity(db: Db, entityType: RoutableEntityType, entityId: string): Promise<number> {
    return softDeleteWhere(db, 'printing_routes', 'entity_type = ? AND entity_id = ?', [entityType, entityId]);
  }
}

/* ---------------------------------------------------------------------- modifiers */

const MODIFIER_GROUP_COLUMNS = `
  id, name, description, selection_type, min_select, max_select, status, sort_order,
  created_by, created_at, updated_at, deleted_at, revision, sync_seq`;

export class ModifierGroupRepository {
  async findById(db: Db, id: string) {
    return selectOne<ModifierGroupRow>(
      db,
      `SELECT ${MODIFIER_GROUP_COLUMNS} FROM modifier_groups WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: ListFilter) {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<ModifierGroupRow>(
      db,
      `SELECT ${MODIFIER_GROUP_COLUMNS} FROM modifier_groups ${where} ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM modifier_groups ${where}`,
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
      selectionType: ModifierSelectionType;
      minSelect: number;
      maxSelect: number | null;
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<ModifierGroupRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO modifier_groups
        (id, name, description, selection_type, min_select, max_select, status, sort_order,
         created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.name,
        input.description,
        input.selectionType,
        input.minSelect,
        input.maxSelect,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted modifier group could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      name: string;
      description: string | null;
      selectionType: ModifierSelectionType;
      minSelect: number;
      maxSelect: number | null;
      status: MasterStatus;
      sortOrder: number;
    }>,
  ): Promise<ModifierGroupRow | null> {
    const columnMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      selectionType: 'selection_type',
      minSelect: 'min_select',
      maxSelect: 'max_select',
      status: 'status',
      sortOrder: 'sort_order',
    };
    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(columnMap)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value);
      }
    }
    await applyUpdate(db, 'modifier_groups', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'modifier_groups', id);
  }
}

const MODIFIER_COLUMNS = `
  id, modifier_group_id, name, name_hi, price_delta, status, sort_order, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class ModifierRepository {
  async findById(db: Db, id: string) {
    return selectOne<ModifierRow>(
      db,
      `SELECT ${MODIFIER_COLUMNS} FROM modifiers WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async listForGroup(db: Db, groupId: string) {
    return selectRows<ModifierRow>(
      db,
      `SELECT ${MODIFIER_COLUMNS} FROM modifiers
        WHERE modifier_group_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC`,
      [groupId],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      modifierGroupId: string;
      name: string;
      nameHi: string | null;
      priceDelta: number;
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<ModifierRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO modifiers
        (id, modifier_group_id, name, name_hi, price_delta, status, sort_order, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.modifierGroupId,
        input.name,
        input.nameHi,
        input.priceDelta,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted modifier could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      name: string;
      nameHi: string | null;
      priceDelta: number;
      status: MasterStatus;
      sortOrder: number;
    }>,
  ): Promise<ModifierRow | null> {
    const columnMap: Record<string, string> = {
      name: 'name',
      nameHi: 'name_hi',
      priceDelta: 'price_delta',
      status: 'status',
      sortOrder: 'sort_order',
    };
    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(columnMap)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value);
      }
    }
    await applyUpdate(db, 'modifiers', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'modifiers', id);
  }

  async softDeleteForGroup(db: Db, modifierGroupId: string): Promise<number> {
    return softDeleteWhere(db, 'modifiers', 'modifier_group_id = ?', [modifierGroupId]);
  }
}

const MODIFIER_ASSIGNMENT_COLUMNS = `
  ma.id, ma.entity_type, ma.entity_id, ma.modifier_group_id, ma.is_required, ma.sort_order,
  ma.status, ma.created_by, ma.created_at, ma.updated_at, ma.deleted_at, ma.revision, ma.sync_seq,
  mg.name AS modifier_group_name`;

export class ModifierAssignmentRepository {
  async findById(db: Db, id: string) {
    return selectOne<ModifierAssignmentRow>(
      db,
      `SELECT ${MODIFIER_ASSIGNMENT_COLUMNS} FROM modifier_assignments ma
         JOIN modifier_groups mg ON mg.id = ma.modifier_group_id AND mg.deleted_at IS NULL
        WHERE ma.id = ? AND ma.deleted_at IS NULL`,
      [id],
    );
  }

  async findForTarget(
    db: Db,
    entityType: RoutableEntityType,
    entityId: string,
    modifierGroupId: string,
  ) {
    return selectOne<ModifierAssignmentRow>(
      db,
      `SELECT ${MODIFIER_ASSIGNMENT_COLUMNS} FROM modifier_assignments ma
         JOIN modifier_groups mg ON mg.id = ma.modifier_group_id AND mg.deleted_at IS NULL
        WHERE ma.entity_type = ? AND ma.entity_id = ? AND ma.modifier_group_id = ?
          AND ma.deleted_at IS NULL`,
      [entityType, entityId, modifierGroupId],
    );
  }

  async listForEntity(db: Db, entityType: RoutableEntityType, entityId: string) {
    return selectRows<ModifierAssignmentRow>(
      db,
      `SELECT ${MODIFIER_ASSIGNMENT_COLUMNS} FROM modifier_assignments ma
         JOIN modifier_groups mg ON mg.id = ma.modifier_group_id AND mg.deleted_at IS NULL
        WHERE ma.entity_type = ? AND ma.entity_id = ? AND ma.deleted_at IS NULL
          AND ma.status = 'ACTIVE'
        ORDER BY ma.sort_order ASC, mg.sort_order ASC, mg.name ASC`,
      [entityType, entityId],
    );
  }

  async listForEntities(db: Db, entityType: RoutableEntityType, entityIds: readonly string[]) {
    if (entityIds.length === 0) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    return selectRows<ModifierAssignmentRow>(
      db,
      `SELECT ${MODIFIER_ASSIGNMENT_COLUMNS} FROM modifier_assignments ma
         JOIN modifier_groups mg ON mg.id = ma.modifier_group_id AND mg.deleted_at IS NULL
        WHERE ma.entity_type = ? AND ma.entity_id IN (${placeholders})
          AND ma.deleted_at IS NULL AND ma.status = 'ACTIVE'
        ORDER BY ma.sort_order ASC, mg.sort_order ASC, mg.name ASC`,
      [entityType, ...entityIds],
    );
  }

  async listForEntityType(db: Db, entityType: RoutableEntityType) {
    const targetTable = entityType === 'MENU_ITEM'
      ? 'menu_items'
      : entityType === 'MENU_ITEM_ASSIGNMENT'
        ? 'menu_item_assignments'
        : 'menu_item_variants';
    return selectRows<ModifierAssignmentRow>(
      db,
      `SELECT ${MODIFIER_ASSIGNMENT_COLUMNS} FROM modifier_assignments ma
         JOIN modifier_groups mg ON mg.id = ma.modifier_group_id AND mg.deleted_at IS NULL
         JOIN ${targetTable} target ON target.id = ma.entity_id AND target.deleted_at IS NULL
        WHERE ma.entity_type = ? AND ma.deleted_at IS NULL AND ma.status = 'ACTIVE'
        ORDER BY ma.sort_order ASC, mg.sort_order ASC, mg.name ASC`,
      [entityType],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      entityType: RoutableEntityType;
      entityId: string;
      modifierGroupId: string;
      isRequired: boolean;
      sortOrder: number;
      status: MasterStatus;
      createdBy: string | null;
    },
  ): Promise<ModifierAssignmentRow> {
    const existing = await this.findForTarget(
      db,
      input.entityType,
      input.entityId,
      input.modifierGroupId,
    );
    if (existing?.status === input.status) return existing;
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO modifier_assignments
        (id, entity_type, entity_id, modifier_group_id, is_required, sort_order, status,
         created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, is_required = VALUES(is_required),
         sort_order = VALUES(sort_order), status = VALUES(status),
         updated_at = VALUES(updated_at), revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [
        input.id,
        input.entityType,
        input.entityId,
        input.modifierGroupId,
        input.isRequired ? 1 : 0,
        input.sortOrder,
        input.status,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findForTarget(
      db,
      input.entityType,
      input.entityId,
      input.modifierGroupId,
    );
    if (row === null) throw new Error('Inserted modifier assignment could not be read back');
    return row;
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'modifier_assignments', id);
  }

  async softDeleteForModifierGroup(db: Db, modifierGroupId: string, entityType?: RoutableEntityType) {
    return softDeleteWhere(
      db,
      'modifier_assignments',
      `modifier_group_id = ?${entityType ? ' AND entity_type = ?' : ''}`,
      entityType ? [modifierGroupId, entityType] : [modifierGroupId],
    );
  }

  async softDeleteForEntity(db: Db, entityType: RoutableEntityType, entityId: string): Promise<number> {
    return softDeleteWhere(db, 'modifier_assignments', 'entity_type = ? AND entity_id = ?', [entityType, entityId]);
  }
}

/* ------------------------------------------------------------------- menu schedules */

const SCHEDULE_COLUMNS = `
  id, menu_id, day_of_week, start_time, end_time, status, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class MenuScheduleRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuScheduleRow>(
      db,
      `SELECT ${SCHEDULE_COLUMNS} FROM menu_schedules WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async listForMenu(db: Db, menuId: string) {
    return selectRows<MenuScheduleRow>(
      db,
      `SELECT ${SCHEDULE_COLUMNS} FROM menu_schedules
        WHERE menu_id = ? AND deleted_at IS NULL
        ORDER BY day_of_week IS NULL DESC, day_of_week ASC, start_time ASC`,
      [menuId],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      menuId: string;
      dayOfWeek: number | null;
      startTime: string;
      endTime: string;
      status: MasterStatus;
      createdBy: string | null;
    },
  ): Promise<MenuScheduleRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_schedules
        (id, menu_id, day_of_week, start_time, end_time, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.menuId,
        input.dayOfWeek,
        toDbTime(input.startTime),
        toDbTime(input.endTime),
        input.status,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted menu schedule could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      dayOfWeek: number | null;
      startTime: string;
      endTime: string;
      status: MasterStatus;
    }>,
  ): Promise<MenuScheduleRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.dayOfWeek !== undefined) {
      assignments.push('day_of_week = ?');
      params.push(input.dayOfWeek);
    }
    if (input.startTime !== undefined) {
      assignments.push('start_time = ?');
      params.push(toDbTime(input.startTime));
    }
    if (input.endTime !== undefined) {
      assignments.push('end_time = ?');
      params.push(toDbTime(input.endTime));
    }
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    await applyUpdate(db, 'menu_schedules', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'menu_schedules', id);
  }
}

/* ---------------------------------------------------------------------- item groups */

// Correlated subquery rather than a JOIN for the same reason as CATEGORY_COLUMNS: buildWhere
// emits unqualified `name` / `status` / `deleted_at`, which joining `menus` would make ambiguous.
const ITEM_GROUP_COLUMNS = `
  id, catalogue_id, name, code, description, status, sort_order, created_by,
  (SELECT m.name FROM menus m WHERE m.id = item_groups.catalogue_id) AS catalogue_name,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class ItemGroupRepository {
  async findById(db: Db, id: string) {
    return selectOne<ItemGroupRow>(
      db,
      `SELECT ${ITEM_GROUP_COLUMNS} FROM item_groups WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async list(db: Db, filter: ListFilter) {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<ItemGroupRow>(
      db,
      `SELECT ${ITEM_GROUP_COLUMNS} FROM item_groups ${where} ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(db, `SELECT COUNT(*) AS total FROM item_groups ${where}`, params);
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      catalogueId: string | null;
      name: string;
      code: string | null;
      description: string | null;
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<ItemGroupRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO item_groups (id, catalogue_id, name, code, description, status, sort_order,
         created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.catalogueId,
        input.name,
        input.code,
        input.description,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted item group could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: Partial<{
      catalogueId: string | null;
      name: string;
      code: string | null;
      description: string | null;
      status: MasterStatus;
      sortOrder: number;
    }>,
  ): Promise<ItemGroupRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.catalogueId !== undefined) {
      assignments.push('catalogue_id = ?');
      params.push(input.catalogueId);
    }
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
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, 'item_groups', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'item_groups', id);
  }

  async countItemReferences(db: Db, groupId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM menu_items WHERE group_id = ? AND deleted_at IS NULL',
      [groupId],
    );
    return row === null ? 0 : Number(row.total);
  }
}

/* -------------------------------------------------------------- food item schedules */

const MENU_ITEM_SCHEDULE_COLUMNS = `
  id, food_item_id, day_of_week, shift, is_available, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class MenuItemScheduleRepository {
  async listForFoodItem(db: Db, foodItemId: string) {
    return selectRows<MenuItemScheduleRow>(
      db,
      `SELECT ${MENU_ITEM_SCHEDULE_COLUMNS} FROM menu_item_schedules
        WHERE food_item_id = ? AND deleted_at IS NULL
        ORDER BY day_of_week ASC, shift ASC`,
      [foodItemId],
    );
  }

  /**
   * Which of these food items are offered in a given shift on a given weekday.
   *
   * One query for a whole menu rather than one per dish: the Digital Menu Board resolves this
   * for every item on the wall on every poll, and a per-item round trip would make the morning
   * menu the most expensive thing the board does.
   *
   * The schedule table alone decides this, and `menu_items.always_available` is deliberately
   * *not* folded in. It reads as though it should be — an always-available dish is sold at
   * every hour, breakfast included — but it defaults to 1 on every row (014), so honouring it
   * here would put every dish in every shift and leave the caller unable to distinguish a
   * breakfast menu from the whole menu. A flag that is true of everything cannot narrow
   * anything; the schedule is the only thing an operator actually sets per shift.
   *
   * Absence therefore means "not scheduled for that shift". A caller that needs to tell "not
   * offered then" from "nobody has configured shifts at all" must compare against the total.
   */
  async findFoodItemsInShift(
    db: Db,
    foodItemIds: string[],
    dayOfWeek: number,
    shift: 'MORNING' | 'EVENING',
  ): Promise<Set<string>> {
    if (foodItemIds.length === 0) return new Set();
    const placeholders = foodItemIds.map(() => '?').join(', ');
    const rows = await selectRows<{ food_item_id: string } & RowDataPacket>(
      db,
      `SELECT DISTINCT s.food_item_id
         FROM menu_item_schedules s
        WHERE s.food_item_id IN (${placeholders}) AND s.day_of_week = ? AND s.shift = ?
          AND s.is_available = 1 AND s.deleted_at IS NULL`,
      [...foodItemIds, dayOfWeek, shift],
    );
    return new Set(rows.map((row) => row.food_item_id));
  }

  /**
   * Which of these food items belong on the morning menu for the shift-change auto-reset
   * (`MenuShiftSchedulerService`) — a different question from {@link findFoodItemsInShift}, and
   * deliberately a separate query rather than a shared one.
   *
   * The board's display filter excludes `always_available` on purpose: it defaults to 1 on
   * every row, so folding it in there would make "morning menu" mean "the whole menu" and
   * defeat the filter entirely. A reset has the opposite problem — an always-available dish
   * that got 86'd yesterday evening must not stay hidden until the *evening* reset just because
   * nobody wrote it a MORNING schedule row; it is available every hour by definition, morning
   * included. So here `always_available` counts, and this method exists to keep that asymmetry
   * from leaking into the board's own, already-correct, filter.
   */
  async findFoodItemsForMorningReset(
    db: Db,
    foodItemIds: string[],
    dayOfWeek: number,
  ): Promise<Set<string>> {
    if (foodItemIds.length === 0) return new Set();
    const placeholders = foodItemIds.map(() => '?').join(', ');
    const rows = await selectRows<{ food_item_id: string } & RowDataPacket>(
      db,
      `SELECT DISTINCT s.food_item_id
         FROM menu_item_schedules s
        WHERE s.food_item_id IN (${placeholders}) AND s.day_of_week = ? AND s.shift = 'MORNING'
          AND s.is_available = 1 AND s.deleted_at IS NULL
        UNION
       SELECT i.id AS food_item_id
         FROM menu_items i
        WHERE i.id IN (${placeholders}) AND i.always_available = 1 AND i.deleted_at IS NULL`,
      [...foodItemIds, dayOfWeek, ...foodItemIds],
    );
    return new Set(rows.map((row) => row.food_item_id));
  }

  async deleteForFoodItem(db: Db, foodItemId: string): Promise<number> {
    const result = await mutate(db, 'DELETE FROM menu_item_schedules WHERE food_item_id = ?', [foodItemId]);
    return result.affectedRows;
  }

  async replaceForFoodItem(
    db: Db,
    foodItemId: string,
    slots: Array<{ dayOfWeek: number; shift: 'MORNING' | 'EVENING'; isAvailable: boolean }>,
    createdBy: string | null,
  ): Promise<MenuItemScheduleRow[]> {
    await mutate(db, 'DELETE FROM menu_item_schedules WHERE food_item_id = ?', [foodItemId]);
    const now = toDbDateTime();
    for (const slot of slots) {
      const syncSeq = await allocateSyncSeq(db);
      await mutate(
        db,
        `INSERT INTO menu_item_schedules
          (id, food_item_id, day_of_week, shift, is_available, created_by,
           created_at, updated_at, revision, sync_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          newId(),
          foodItemId,
          slot.dayOfWeek,
          slot.shift,
          slot.isAvailable ? 1 : 0,
          createdBy,
          now,
          now,
          syncSeq,
        ],
      );
    }
    return this.listForFoodItem(db, foodItemId);
  }
}

/* ------------------------------------------------------ variant catalogue pricing */

const VARIANT_CATALOG_PRICE_COLUMNS = `
  mivcp.id, mivcp.variant_id, mivcp.menu_id, mivcp.price, mivcp.status, mivcp.created_by,
  mivcp.created_at, mivcp.updated_at, mivcp.deleted_at, mivcp.revision, mivcp.sync_seq,
  m.name AS menu_name, m.code AS menu_code`;

export class MenuItemVariantCatalogPriceRepository {
  async findById(db: Db, id: string) {
    return selectOne<MenuItemVariantCatalogPriceRow>(
      db,
      `SELECT ${VARIANT_CATALOG_PRICE_COLUMNS} FROM menu_item_variant_catalog_prices mivcp
         JOIN menus m ON m.id = mivcp.menu_id
        WHERE mivcp.id = ? AND mivcp.deleted_at IS NULL`,
      [id],
    );
  }

  async findByVariantAndMenu(db: Db, variantId: string, menuId: string) {
    return selectOne<MenuItemVariantCatalogPriceRow>(
      db,
      `SELECT ${VARIANT_CATALOG_PRICE_COLUMNS} FROM menu_item_variant_catalog_prices mivcp
         JOIN menus m ON m.id = mivcp.menu_id
        WHERE mivcp.variant_id = ? AND mivcp.menu_id = ? AND mivcp.deleted_at IS NULL`,
      [variantId, menuId],
    );
  }

  async listForVariant(db: Db, variantId: string) {
    return selectRows<MenuItemVariantCatalogPriceRow>(
      db,
      `SELECT ${VARIANT_CATALOG_PRICE_COLUMNS} FROM menu_item_variant_catalog_prices mivcp
         JOIN menus m ON m.id = mivcp.menu_id
        WHERE mivcp.variant_id = ? AND mivcp.deleted_at IS NULL
        ORDER BY m.name ASC`,
      [variantId],
    );
  }

  async upsert(
    db: Db,
    input: {
      id: string;
      variantId: string;
      menuId: string;
      price: number;
      createdBy: string | null;
    },
  ): Promise<MenuItemVariantCatalogPriceRow> {
    const existing = await this.findByVariantAndMenu(db, input.variantId, input.menuId);
    if (existing !== null) {
      await applyUpdate(db, 'menu_item_variant_catalog_prices', existing.id, ['price = ?'], [input.price]);
      const row = await this.findById(db, existing.id);
      if (row === null) throw new Error('Updated variant catalog price could not be read back');
      return row;
    }
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_item_variant_catalog_prices
        (id, variant_id, menu_id, price, status, created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, price = VALUES(price), status = 'ACTIVE',
         updated_at = VALUES(updated_at),
         revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [input.id, input.variantId, input.menuId, input.price, input.createdBy, now, now, syncSeq],
    );
    const row = await this.findByVariantAndMenu(db, input.variantId, input.menuId);
    if (row === null) throw new Error('Inserted variant catalog price could not be read back');
    return row;
  }

  async removeForMenu(db: Db, variantId: string, menuId: string): Promise<boolean> {
    const existing = await this.findByVariantAndMenu(db, variantId, menuId);
    if (existing === null) return false;
    return softDelete(db, 'menu_item_variant_catalog_prices', existing.id);
  }

  async softDeleteForVariants(db: Db, variantIds: readonly string[]): Promise<number> {
    if (variantIds.length === 0) return 0;
    const placeholders = variantIds.map(() => '?').join(', ');
    return softDeleteWhere(
      db,
      'menu_item_variant_catalog_prices',
      `variant_id IN (${placeholders})`,
      [...variantIds],
    );
  }
}

export const menuRepository = new MenuRepository();
export const menuCategoryAssignmentRepository = new MenuCategoryAssignmentRepository();
export const menuItemAssignmentRepository = new MenuItemAssignmentRepository();
export const menuItemVariantRepository = new MenuItemVariantRepository();
export const counterRepository = new CounterRepository();
export const counterRouteRepository = new CounterRouteRepository();
export const printingGroupRepository = new PrintingGroupRepository();
export const printingRouteRepository = new PrintingRouteRepository();
export const modifierGroupRepository = new ModifierGroupRepository();
export const modifierRepository = new ModifierRepository();
export const modifierAssignmentRepository = new ModifierAssignmentRepository();
export const menuScheduleRepository = new MenuScheduleRepository();
export const itemGroupRepository = new ItemGroupRepository();
export const menuItemScheduleRepository = new MenuItemScheduleRepository();
export const menuItemVariantCatalogPriceRepository = new MenuItemVariantCatalogPriceRepository();

// Re-exported so callers that only need the type do not import from '@menuboard/shared' twice.
export type { MediaEntityType, MediaRole };
export type { MenuCategoryAssignmentRow, MenuItemAssignmentRow, MediaAssetRow, MediaAssignmentRow };
