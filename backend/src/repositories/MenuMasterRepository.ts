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
  ItemGroupAssignmentRow,
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
    const row = await this.findById(db, input.id);
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
  mi.name AS food_item_name, mi.name_hi AS food_item_name_hi, mi.unit AS food_item_unit,
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
    const row = await this.findById(db, input.id);
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

  /** True once an order has been placed for this food item under this specific menu. */
  async countOrderReferences(db: Db, assignmentId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM order_items oi
         JOIN menu_item_assignments a ON a.id = ?
        WHERE oi.menu_id = a.menu_id AND oi.menu_item_id = a.food_item_id`,
      [assignmentId],
    );
    return row === null ? 0 : Number(row.total);
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
    const row = await this.findById(db, input.id);
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

  async countOrderReferences(db: Db, variantId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM order_items WHERE variant_id = ?',
      [variantId],
    );
    return row === null ? 0 : Number(row.total);
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
         JOIN counters c ON c.id = cr.counter_id
        WHERE cr.id = ? AND cr.deleted_at IS NULL`,
      [id],
    );
  }

  async listForEntity(db: Db, entityType: RoutableEntityType, entityId: string) {
    return selectRows<CounterRouteRow>(
      db,
      `SELECT ${COUNTER_ROUTE_COLUMNS} FROM counter_routes cr
         JOIN counters c ON c.id = cr.counter_id
        WHERE cr.entity_type = ? AND cr.entity_id = ? AND cr.deleted_at IS NULL
        ORDER BY c.name ASC`,
      [entityType, entityId],
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
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO counter_routes (id, entity_type, entity_id, counter_id, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [input.id, input.entityType, input.entityId, input.counterId, input.status, input.createdBy, now, now, syncSeq],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted counter route could not be read back');
    return row;
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'counter_routes', id);
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
         JOIN printing_groups pg ON pg.id = pr.printing_group_id
        WHERE pr.id = ? AND pr.deleted_at IS NULL`,
      [id],
    );
  }

  async listForEntity(db: Db, entityType: RoutableEntityType, entityId: string) {
    return selectRows<PrintingRouteRow>(
      db,
      `SELECT ${PRINTING_ROUTE_COLUMNS} FROM printing_routes pr
         JOIN printing_groups pg ON pg.id = pr.printing_group_id
        WHERE pr.entity_type = ? AND pr.entity_id = ? AND pr.deleted_at IS NULL
        ORDER BY pr.sort_order ASC, pg.name ASC`,
      [entityType, entityId],
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
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO printing_routes
        (id, entity_type, entity_id, printing_group_id, sort_order, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted printing route could not be read back');
    return row;
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'printing_routes', id);
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
         JOIN modifier_groups mg ON mg.id = ma.modifier_group_id
        WHERE ma.id = ? AND ma.deleted_at IS NULL`,
      [id],
    );
  }

  async listForEntity(db: Db, entityType: RoutableEntityType, entityId: string) {
    return selectRows<ModifierAssignmentRow>(
      db,
      `SELECT ${MODIFIER_ASSIGNMENT_COLUMNS} FROM modifier_assignments ma
         JOIN modifier_groups mg ON mg.id = ma.modifier_group_id
        WHERE ma.entity_type = ? AND ma.entity_id = ? AND ma.deleted_at IS NULL
        ORDER BY ma.sort_order ASC, mg.name ASC`,
      [entityType, entityId],
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
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO modifier_assignments
        (id, entity_type, entity_id, modifier_group_id, is_required, sort_order, status,
         created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted modifier assignment could not be read back');
    return row;
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'modifier_assignments', id);
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

const ITEM_GROUP_COLUMNS = `
  id, name, code, description, status, sort_order, created_by,
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
      `INSERT INTO item_groups (id, name, code, description, status, sort_order, created_by,
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
    if (row === null) throw new Error('Inserted item group could not be read back');
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
  ): Promise<ItemGroupRow | null> {
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
    await applyUpdate(db, 'item_groups', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'item_groups', id);
  }

  async countAssignmentReferences(db: Db, groupId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM item_group_assignments WHERE group_id = ? AND deleted_at IS NULL',
      [groupId],
    );
    return row === null ? 0 : Number(row.total);
  }
}

const ITEM_GROUP_ASSIGNMENT_COLUMNS = `
  iga.id, iga.food_item_id, iga.group_id, iga.status, iga.created_by,
  iga.created_at, iga.updated_at, iga.deleted_at, iga.revision, iga.sync_seq,
  ig.name AS group_name`;

export class ItemGroupAssignmentRepository {
  async findById(db: Db, id: string) {
    return selectOne<ItemGroupAssignmentRow>(
      db,
      `SELECT ${ITEM_GROUP_ASSIGNMENT_COLUMNS} FROM item_group_assignments iga
         JOIN item_groups ig ON ig.id = iga.group_id
        WHERE iga.id = ? AND iga.deleted_at IS NULL`,
      [id],
    );
  }

  async listForFoodItem(db: Db, foodItemId: string) {
    return selectRows<ItemGroupAssignmentRow>(
      db,
      `SELECT ${ITEM_GROUP_ASSIGNMENT_COLUMNS} FROM item_group_assignments iga
         JOIN item_groups ig ON ig.id = iga.group_id
        WHERE iga.food_item_id = ? AND iga.status = 'ACTIVE' AND iga.deleted_at IS NULL
        ORDER BY ig.name ASC`,
      [foodItemId],
    );
  }

  async insert(
    db: Db,
    input: {
      id: string;
      foodItemId: string;
      groupId: string;
      status: MasterStatus;
      createdBy: string | null;
    },
  ): Promise<ItemGroupAssignmentRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO item_group_assignments (id, food_item_id, group_id, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [input.id, input.foodItemId, input.groupId, input.status, input.createdBy, now, now, syncSeq],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted item group assignment could not be read back');
    return row;
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDelete(db, 'item_group_assignments', id);
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
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?)`,
      [input.id, input.variantId, input.menuId, input.price, input.createdBy, now, now, syncSeq],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted variant catalog price could not be read back');
    return row;
  }

  async removeForMenu(db: Db, variantId: string, menuId: string): Promise<boolean> {
    const existing = await this.findByVariantAndMenu(db, variantId, menuId);
    if (existing === null) return false;
    return softDelete(db, 'menu_item_variant_catalog_prices', existing.id);
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
export const itemGroupAssignmentRepository = new ItemGroupAssignmentRepository();
export const menuItemScheduleRepository = new MenuItemScheduleRepository();
export const menuItemVariantCatalogPriceRepository = new MenuItemVariantCatalogPriceRepository();

// Re-exported so callers that only need the type do not import from '@menuboard/shared' twice.
export type { MediaEntityType, MediaRole };
export type { MenuCategoryAssignmentRow, MenuItemAssignmentRow, MediaAssetRow, MediaAssignmentRow };
