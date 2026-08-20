import type { MasterStatus } from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import type { CountRow, IngredientCategoryRow, IngredientRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * The recipe-facing view of the item master: `ingredient_categories` and `products`.
 *
 * This used to read a separate, deliberately narrow `ingredients` table. Migration 004 made
 * `products` the single item master — it reproduces every column `ingredients` had, under the
 * same names, and every row was copied across keeping its id — so this repository now reads
 * `products` and nothing above it changed: the DTO, the `ingredients` sync entity name and
 * the recipe rows on the phone are all byte-for-byte what they were.
 *
 * What it deliberately does *not* do is widen. Recipes care about name, unit and category;
 * the purchase attributes on the same rows (tax profile, batch policy, valuation, reorder
 * levels) belong to the product master's own repository. Two readers, one table, one truth.
 */
const PRODUCTS_TABLE = 'products';

export interface MasterListFilter {
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

async function softDeleteRow(db: Db, table: string, id: string): Promise<boolean> {
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
    conditions.push('(name LIKE ? OR name_hi LIKE ?)');
    params.push(`%${filter.search}%`, `%${filter.search}%`);
  }
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/* -------------------------------------------------------- ingredient categories */

const CATEGORY_COLUMNS = `
  id, name, name_hi, status, sort_order, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class IngredientCategoryRepository {
  async findById(db: Db, id: string): Promise<IngredientCategoryRow | null> {
    return selectOne<IngredientCategoryRow>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM ingredient_categories WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async findByName(db: Db, name: string): Promise<IngredientCategoryRow | null> {
    return selectOne<IngredientCategoryRow>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM ingredient_categories WHERE name = ? AND deleted_at IS NULL`,
      [name],
    );
  }

  async list(
    db: Db,
    filter: MasterListFilter,
  ): Promise<{ rows: IngredientCategoryRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<IngredientCategoryRow>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM ingredient_categories ${where}
        ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM ingredient_categories ${where}`,
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
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<IngredientCategoryRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO ingredient_categories
        (id, name, name_hi, status, sort_order, created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [input.id, input.name, input.nameHi, input.status, input.sortOrder, input.createdBy, now, now, syncSeq],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted ingredient category could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: { name?: string; nameHi?: string | null; status?: MasterStatus; sortOrder?: number },
  ): Promise<IngredientCategoryRow | null> {
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
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, 'ingredient_categories', id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDeleteRow(db, 'ingredient_categories', id);
  }

  async changedSince(db: Db, cursor: number, limit: number): Promise<IngredientCategoryRow[]> {
    return selectRows<IngredientCategoryRow>(
      db,
      `SELECT ${CATEGORY_COLUMNS} FROM ingredient_categories
        WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

/* ------------------------------------------------------------------ ingredients */

const INGREDIENT_COLUMNS = `
  id, category_id, name, name_hi, unit, status, sort_order, created_by,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class IngredientRepository {
  async findById(db: Db, id: string): Promise<IngredientRow | null> {
    return selectOne<IngredientRow>(
      db,
      `SELECT ${INGREDIENT_COLUMNS} FROM products WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async findByIds(db: Db, ids: readonly string[]): Promise<IngredientRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return selectRows<IngredientRow>(
      db,
      `SELECT ${INGREDIENT_COLUMNS} FROM products WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ids,
    );
  }

  async findByName(db: Db, name: string): Promise<IngredientRow | null> {
    return selectOne<IngredientRow>(
      db,
      `SELECT ${INGREDIENT_COLUMNS} FROM products WHERE name = ? AND deleted_at IS NULL`,
      [name],
    );
  }

  async list(
    db: Db,
    filter: MasterListFilter & { categoryId?: string },
  ): Promise<{ rows: IngredientRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.includeDeleted !== true) conditions.push('i.deleted_at IS NULL');
    if (filter.status) {
      conditions.push('i.status = ?');
      params.push(filter.status);
    }
    if (filter.search) {
      conditions.push('(i.name LIKE ? OR i.name_hi LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }
    if (filter.categoryId !== undefined) {
      conditions.push('i.category_id = ?');
      params.push(filter.categoryId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await selectRows<IngredientRow>(
      db,
      `SELECT i.id, i.category_id, i.name, i.name_hi, i.unit, i.status, i.sort_order, i.created_by,
              i.created_at, i.updated_at, i.deleted_at, i.revision, i.sync_seq,
              c.name AS category_name
         FROM products i
         LEFT JOIN ingredient_categories c ON c.id = i.category_id
         ${where}
         ORDER BY i.name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM products i ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(
    db: Db,
    input: {
      id: string;
      categoryId: string | null;
      name: string;
      nameHi: string | null;
      unit: string;
      status: MasterStatus;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<IngredientRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO products
        (id, category_id, name, name_hi, unit, status, sort_order, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.categoryId,
        input.name,
        input.nameHi,
        input.unit,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted ingredient could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      categoryId?: string | null;
      name?: string;
      nameHi?: string | null;
      unit?: string;
      status?: MasterStatus;
      sortOrder?: number;
    },
  ): Promise<IngredientRow | null> {
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
    if (input.status !== undefined) {
      assignments.push('status = ?');
      params.push(input.status);
    }
    if (input.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(input.sortOrder);
    }
    await applyUpdate(db, PRODUCTS_TABLE, id, assignments, params);
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    return softDeleteRow(db, PRODUCTS_TABLE, id);
  }

  async isReferencedByRecipes(db: Db, id: string): Promise<boolean> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM recipe_ingredients WHERE ingredient_id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row !== null && Number(row.total) > 0;
  }

  async distinctUnits(db: Db): Promise<string[]> {
    const rows = await selectRows<RowDataPacket & { unit: string }>(
      db,
      `SELECT DISTINCT unit FROM products WHERE deleted_at IS NULL ORDER BY unit ASC`,
    );
    return rows.map((row) => row.unit);
  }

  async changedSince(db: Db, cursor: number, limit: number): Promise<IngredientRow[]> {
    return selectRows<IngredientRow>(
      db,
      `SELECT ${INGREDIENT_COLUMNS} FROM products WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

export const ingredientCategoryRepository = new IngredientCategoryRepository();
export const ingredientRepository = new IngredientRepository();
