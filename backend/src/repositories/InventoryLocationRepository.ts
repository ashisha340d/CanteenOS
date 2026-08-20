import type { InventoryLocationKind, MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, InventoryLocationRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the inventory location master (004_purchase_foundation.sql) — the stores
 * goods are received into, held in and issued from.
 *
 * `revision` is bumped on every write for optimistic concurrency; there is no `sync_seq`
 * because locations never reach the Android app. Deletion is a soft delete, refused by the
 * service while stock policy or a product default still points here.
 */

const LOCATION_COLUMNS = `l.id, l.code, l.name, l.name_hi, l.kind, l.parent_id, l.counter_id,
    l.station_id, l.department, l.is_default_receiving, l.allows_negative_stock, l.status,
    l.sort_order, l.notes, l.created_by, l.created_at, l.updated_at, l.deleted_at, l.revision`;

const LOCATION_SELECT = `SELECT ${LOCATION_COLUMNS}, p.name AS parent_name
    FROM inventory_locations l
    LEFT JOIN inventory_locations p ON p.id = l.parent_id`;

export interface InventoryLocationListFilter {
  search?: string;
  kind?: InventoryLocationKind;
  parentId?: string;
  status?: MasterStatus;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface InsertInventoryLocationInput {
  id: string;
  code: string;
  name: string;
  nameHi: string | null;
  kind: InventoryLocationKind;
  parentId: string | null;
  counterId: string | null;
  stationId: string | null;
  department: string | null;
  isDefaultReceiving: boolean;
  allowsNegativeStock: boolean;
  status: MasterStatus;
  sortOrder: number;
  notes: string | null;
  createdBy: string | null;
}

export type UpdateInventoryLocationInput = Partial<
  Omit<InsertInventoryLocationInput, 'id' | 'createdBy'>
>;

const UPDATABLE_COLUMNS: Readonly<Record<keyof UpdateInventoryLocationInput, string>> = {
  code: 'code',
  name: 'name',
  nameHi: 'name_hi',
  kind: 'kind',
  parentId: 'parent_id',
  counterId: 'counter_id',
  stationId: 'station_id',
  department: 'department',
  isDefaultReceiving: 'is_default_receiving',
  allowsNegativeStock: 'allows_negative_stock',
  status: 'status',
  sortOrder: 'sort_order',
  notes: 'notes',
};

function buildWhere(filter: InventoryLocationListFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.includeDeleted !== true) conditions.push('l.deleted_at IS NULL');
  if (filter.kind !== undefined) {
    conditions.push('l.kind = ?');
    params.push(filter.kind);
  }
  if (filter.parentId !== undefined) {
    conditions.push('l.parent_id = ?');
    params.push(filter.parentId);
  }
  if (filter.status !== undefined) {
    conditions.push('l.status = ?');
    params.push(filter.status);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(l.name LIKE ? OR l.code LIKE ? OR l.department LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export class InventoryLocationRepository {
  async findById(db: Db, id: string): Promise<InventoryLocationRow | null> {
    return selectOne<InventoryLocationRow>(
      db,
      `${LOCATION_SELECT} WHERE l.id = ? AND l.deleted_at IS NULL`,
      [id],
    );
  }

  async findByCode(db: Db, code: string): Promise<InventoryLocationRow | null> {
    return selectOne<InventoryLocationRow>(
      db,
      `${LOCATION_SELECT} WHERE l.code = ? AND l.deleted_at IS NULL`,
      [code],
    );
  }

  async list(
    db: Db,
    filter: InventoryLocationListFilter,
  ): Promise<{ rows: InventoryLocationRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<InventoryLocationRow>(
      db,
      `${LOCATION_SELECT} ${where} ORDER BY l.sort_order ASC, l.name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM inventory_locations l ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(db: Db, input: InsertInventoryLocationInput): Promise<InventoryLocationRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO inventory_locations
        (id, code, name, name_hi, kind, parent_id, counter_id, station_id, department,
         is_default_receiving, allows_negative_stock, status, sort_order, notes, created_by,
         created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.code,
        input.name,
        input.nameHi,
        input.kind,
        input.parentId,
        input.counterId,
        input.stationId,
        input.department,
        input.isDefaultReceiving ? 1 : 0,
        input.allowsNegativeStock ? 1 : 0,
        input.status,
        input.sortOrder,
        input.notes,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted location ${input.id} could not be read back`);
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: UpdateInventoryLocationInput,
  ): Promise<InventoryLocationRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = input[key as keyof UpdateInventoryLocationInput];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (assignments.length === 0) return this.findById(db, id);

    const result = await mutate(
      db,
      `UPDATE inventory_locations
          SET ${assignments.join(', ')}, updated_at = ?, revision = revision + 1
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    if (result.affectedRows === 0) return null;
    return this.findById(db, id);
  }

  /**
   * Stands every other location down from being the receiving default.
   *
   * "At most one" is enforced here rather than by a unique index, because MySQL cannot index
   * "only the rows where the flag is 1". Always called inside the transaction that is setting
   * the new default, so the two writes commit together.
   */
  async clearDefaultReceiving(db: Db, exceptId: string | null): Promise<void> {
    const params: unknown[] = [toDbDateTime()];
    let sql = `UPDATE inventory_locations
                  SET is_default_receiving = 0, updated_at = ?, revision = revision + 1
                WHERE is_default_receiving = 1 AND deleted_at IS NULL`;
    if (exceptId !== null) {
      sql += ' AND id <> ?';
      params.push(exceptId);
    }
    await mutate(db, sql, params);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE inventory_locations
          SET deleted_at = ?, status = 'INACTIVE', is_default_receiving = 0, updated_at = ?,
              revision = revision + 1
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  }

  /** Guards deletion: a store still named by a product or by a child store stays put. */
  async countReferences(db: Db, id: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM products
           WHERE default_location_id = ? AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM product_locations
           WHERE location_id = ? AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM inventory_locations
           WHERE parent_id = ? AND deleted_at IS NULL) AS total`,
      [id, id, id],
    );
    return row === null ? 0 : Number(row.total);
  }
}

export const inventoryLocationRepository = new InventoryLocationRepository();
