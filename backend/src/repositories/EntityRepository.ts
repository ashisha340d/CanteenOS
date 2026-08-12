import type { EntityType, MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, EntityRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the Entity master (022_entities_and_pos.sql) — customers, employees,
 * vendors and any other party a bill may be raised in the name of.
 *
 * No `revision`/`sync_seq`: like tax_profiles (021), the entity master is a counter and
 * Admin-Portal surface that never reaches the Android app, so there is no sync bookkeeping
 * here. Deletion is a soft delete, refused by the service while POS history references the row.
 */

const ENTITY_COLUMNS = `e.id, e.code, e.type, e.name, e.name_hi, e.phone, e.email, e.address,
    e.city, e.state_code, e.gstin, e.pan, e.department, e.designation, e.linked_user_id,
    e.discount_percent, e.credit_limit, e.account_balance, e.notes, e.status, e.sort_order,
    e.created_by, e.created_at, e.updated_at, e.deleted_at`;

const ENTITY_SELECT = `SELECT ${ENTITY_COLUMNS},
         u.name AS linked_user_name,
         (SELECT COUNT(*) FROM pos_orders po
           WHERE po.entity_id = e.id AND po.deleted_at IS NULL) AS pos_order_count
    FROM entities e
    LEFT JOIN users u ON u.id = e.linked_user_id`;

export interface EntityListFilter {
  search?: string;
  type?: EntityType;
  status?: MasterStatus;
  phone?: string;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface InsertEntityInput {
  id: string;
  code: string;
  type: EntityType;
  name: string;
  nameHi: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  stateCode: string | null;
  gstin: string | null;
  pan: string | null;
  department: string | null;
  designation: string | null;
  linkedUserId: string | null;
  discountPercent: number;
  creditLimit: number;
  notes: string | null;
  status: MasterStatus;
  sortOrder: number;
  createdBy: string | null;
}

export type UpdateEntityInput = Partial<Omit<InsertEntityInput, 'id' | 'createdBy'>>;

/** Maps a DTO-shaped patch onto its column, in one place so a rename cannot half-apply. */
const UPDATABLE_COLUMNS: Readonly<Record<keyof UpdateEntityInput, string>> = {
  code: 'code',
  type: 'type',
  name: 'name',
  nameHi: 'name_hi',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
  stateCode: 'state_code',
  gstin: 'gstin',
  pan: 'pan',
  department: 'department',
  designation: 'designation',
  linkedUserId: 'linked_user_id',
  discountPercent: 'discount_percent',
  creditLimit: 'credit_limit',
  notes: 'notes',
  status: 'status',
  sortOrder: 'sort_order',
};

function buildWhere(filter: EntityListFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.includeDeleted !== true) conditions.push('e.deleted_at IS NULL');
  if (filter.type !== undefined) {
    conditions.push('e.type = ?');
    params.push(filter.type);
  }
  if (filter.status !== undefined) {
    conditions.push('e.status = ?');
    params.push(filter.status);
  }
  if (filter.phone !== undefined && filter.phone !== '') {
    conditions.push('e.phone = ?');
    params.push(filter.phone);
  }
  if (filter.search !== undefined && filter.search !== '') {
    // The counter searches by whichever of the three it has to hand.
    conditions.push('(e.name LIKE ? OR e.code LIKE ? OR e.phone LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export class EntityRepository {
  async findById(db: Db, id: string): Promise<EntityRow | null> {
    return selectOne<EntityRow>(db, `${ENTITY_SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`, [
      id,
    ]);
  }

  async findByPhone(db: Db, phone: string): Promise<EntityRow | null> {
    return selectOne<EntityRow>(
      db,
      `${ENTITY_SELECT} WHERE e.phone = ? AND e.deleted_at IS NULL ORDER BY e.created_at ASC LIMIT 1`,
      [phone],
    );
  }

  async list(db: Db, filter: EntityListFilter): Promise<{ rows: EntityRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<EntityRow>(
      db,
      `${ENTITY_SELECT} ${where} ORDER BY e.sort_order ASC, e.name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM entities e ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  /**
   * The highest numeric suffix currently issued for a code prefix, including soft-deleted
   * rows — reusing a deleted entity's code would make two different parties share an
   * identifier in the audit trail.
   */
  async maxCodeSequence(db: Db, prefix: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(CAST(SUBSTRING(code, ?) AS UNSIGNED)), 0) AS total
         FROM entities
        WHERE code LIKE ? FOR UPDATE`,
      [prefix.length + 1, `${prefix}%`],
    );
    return row === null ? 0 : Number(row.total);
  }

  async insert(db: Db, input: InsertEntityInput): Promise<EntityRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO entities
        (id, code, type, name, name_hi, phone, email, address, city, state_code, gstin, pan,
         department, designation, linked_user_id, discount_percent, credit_limit,
         account_balance, notes, status, sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.code,
        input.type,
        input.name,
        input.nameHi,
        input.phone,
        input.email,
        input.address,
        input.city,
        input.stateCode,
        input.gstin,
        input.pan,
        input.department,
        input.designation,
        input.linkedUserId,
        input.discountPercent,
        input.creditLimit,
        input.notes,
        input.status,
        input.sortOrder,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted entity ${input.id} could not be read back`);
    return row;
  }

  async update(db: Db, id: string, input: UpdateEntityInput): Promise<EntityRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = input[key as keyof UpdateEntityInput];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    if (assignments.length === 0) return this.findById(db, id);

    const result = await mutate(
      db,
      `UPDATE entities SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    if (result.affectedRows === 0) return null;
    return this.findById(db, id);
  }

  /**
   * Moves the running account balance. Positive `delta` = the entity now owes more. Always
   * called inside the transaction that wrote the payment row that caused the movement.
   */
  async adjustAccountBalance(db: Db, id: string, delta: number): Promise<void> {
    await mutate(
      db,
      `UPDATE entities SET account_balance = account_balance + ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [delta, toDbDateTime(), id],
    );
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE entities SET deleted_at = ?, status = 'INACTIVE', updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  }

  /** Guards deletion: an entity that appears on a POS ticket must be deactivated instead. */
  async countPosOrderReferences(db: Db, id: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM pos_orders WHERE entity_id = ? AND deleted_at IS NULL',
      [id],
    );
    return row === null ? 0 : Number(row.total);
  }
}

export const entityRepository = new EntityRepository();
