import type { MasterStatus, UomDimension } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, UomRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the unit master (004_purchase_foundation.sql).
 *
 * No `sync_seq`: units are read by the purchase and inventory screens, never by the Android
 * app, so there is no sync bookkeeping here. Deletion is a soft delete — a unit that a posted
 * document already quoted must remain resolvable.
 */

const UOM_COLUMNS = `u.id, u.code, u.name, u.dimension, u.is_base, u.factor_to_base,
    u.decimal_places, u.status, u.sort_order, u.created_by, u.created_at, u.updated_at,
    u.deleted_at`;

export interface UomListFilter {
  search?: string;
  dimension?: UomDimension;
  status?: MasterStatus;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface InsertUomInput {
  id: string;
  code: string;
  name: string;
  dimension: UomDimension;
  isBase: boolean;
  factorToBase: number;
  decimalPlaces: number;
  status: MasterStatus;
  sortOrder: number;
  createdBy: string | null;
}

export type UpdateUomInput = Partial<Omit<InsertUomInput, 'id' | 'createdBy'>>;

/** Maps a DTO-shaped patch onto its column, in one place so a rename cannot half-apply. */
const UPDATABLE_COLUMNS: Readonly<Record<keyof UpdateUomInput, string>> = {
  code: 'code',
  name: 'name',
  dimension: 'dimension',
  isBase: 'is_base',
  factorToBase: 'factor_to_base',
  decimalPlaces: 'decimal_places',
  status: 'status',
  sortOrder: 'sort_order',
};

function buildWhere(filter: UomListFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.includeDeleted !== true) conditions.push('u.deleted_at IS NULL');
  if (filter.dimension !== undefined) {
    conditions.push('u.dimension = ?');
    params.push(filter.dimension);
  }
  if (filter.status !== undefined) {
    conditions.push('u.status = ?');
    params.push(filter.status);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(u.code LIKE ? OR u.name LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export class UomRepository {
  async findById(db: Db, id: string): Promise<UomRow | null> {
    return selectOne<UomRow>(
      db,
      `SELECT ${UOM_COLUMNS} FROM uoms u WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id],
    );
  }

  async findByCode(db: Db, code: string): Promise<UomRow | null> {
    return selectOne<UomRow>(
      db,
      `SELECT ${UOM_COLUMNS} FROM uoms u WHERE u.code = ? AND u.deleted_at IS NULL`,
      [code],
    );
  }

  async list(db: Db, filter: UomListFilter): Promise<{ rows: UomRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<UomRow>(
      db,
      `SELECT ${UOM_COLUMNS} FROM uoms u ${where}
        ORDER BY u.dimension ASC, u.sort_order ASC, u.code ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM uoms u ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(db: Db, input: InsertUomInput): Promise<UomRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO uoms
        (id, code, name, dimension, is_base, factor_to_base, decimal_places, status,
         sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.code,
        input.name,
        input.dimension,
        input.isBase ? 1 : 0,
        input.factorToBase,
        input.decimalPlaces,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted unit ${input.id} could not be read back`);
    return row;
  }

  async update(db: Db, id: string, input: UpdateUomInput): Promise<UomRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = input[key as keyof UpdateUomInput];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (assignments.length === 0) return this.findById(db, id);

    const result = await mutate(
      db,
      `UPDATE uoms SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    if (result.affectedRows === 0) return null;
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE uoms SET deleted_at = ?, status = 'INACTIVE', updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  }

  /**
   * Guards deletion. A unit quoted by a product — as its stock unit, its purchase unit, or on
   * a supplier mapping — must be deactivated rather than removed, or the quantity on those
   * rows stops meaning anything.
   */
  async countProductReferences(db: Db, id: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM products
           WHERE (stock_uom_id = ? OR purchase_uom_id = ?) AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM supplier_products
           WHERE purchase_uom_id = ? AND deleted_at IS NULL) AS total`,
      [id, id, id],
    );
    return row === null ? 0 : Number(row.total);
  }
}

export const uomRepository = new UomRepository();
