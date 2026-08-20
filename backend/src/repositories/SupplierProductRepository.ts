import type { MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, SupplierProductRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the supplier ↔ product mapping (004_purchase_foundation.sql): what the
 * supplier calls the thing, in what unit they sell it, and how many of ours that is.
 *
 * The supplier is an `entities` row of type VENDOR — there is no separate vendor table — so
 * every read joins the entity master for the display name.
 */

const SUPPLIER_PRODUCT_COLUMNS = `sp.id, sp.supplier_id, sp.product_id, sp.supplier_sku,
    sp.supplier_product_name, sp.barcode, sp.purchase_uom_id, sp.conversion_factor,
    sp.pack_size, sp.last_rate, sp.last_purchased_at, sp.lead_time_days, sp.is_preferred,
    sp.status, sp.notes, sp.created_by, sp.created_at, sp.updated_at, sp.deleted_at`;

const SUPPLIER_PRODUCT_SELECT = `SELECT ${SUPPLIER_PRODUCT_COLUMNS},
         e.name AS supplier_name,
         p.name AS product_name,
         p.unit AS product_unit,
         u.code AS purchase_uom_code
    FROM supplier_products sp
    JOIN entities e ON e.id = sp.supplier_id
    JOIN products p ON p.id = sp.product_id
    LEFT JOIN uoms u ON u.id = sp.purchase_uom_id`;

export interface SupplierProductListFilter {
  search?: string;
  supplierId?: string;
  productId?: string;
  status?: MasterStatus;
  preferredOnly?: boolean;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface InsertSupplierProductInput {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  supplierProductName: string | null;
  barcode: string | null;
  purchaseUomId: string | null;
  conversionFactor: number;
  packSize: string | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
  status: MasterStatus;
  notes: string | null;
  createdBy: string | null;
}

export type UpdateSupplierProductInput = Partial<
  Omit<InsertSupplierProductInput, 'id' | 'supplierId' | 'productId' | 'createdBy'>
>;

const UPDATABLE_COLUMNS: Readonly<Record<keyof UpdateSupplierProductInput, string>> = {
  supplierSku: 'supplier_sku',
  supplierProductName: 'supplier_product_name',
  barcode: 'barcode',
  purchaseUomId: 'purchase_uom_id',
  conversionFactor: 'conversion_factor',
  packSize: 'pack_size',
  leadTimeDays: 'lead_time_days',
  isPreferred: 'is_preferred',
  status: 'status',
  notes: 'notes',
};

function buildWhere(filter: SupplierProductListFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.includeDeleted !== true) conditions.push('sp.deleted_at IS NULL');
  if (filter.supplierId !== undefined) {
    conditions.push('sp.supplier_id = ?');
    params.push(filter.supplierId);
  }
  if (filter.productId !== undefined) {
    conditions.push('sp.product_id = ?');
    params.push(filter.productId);
  }
  if (filter.status !== undefined) {
    conditions.push('sp.status = ?');
    params.push(filter.status);
  }
  if (filter.preferredOnly === true) conditions.push('sp.is_preferred = 1');
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push(
      '(sp.supplier_sku LIKE ? OR sp.supplier_product_name LIKE ? OR sp.barcode LIKE ? OR p.name LIKE ? OR e.name LIKE ?)',
    );
    const like = `%${filter.search}%`;
    params.push(like, like, like, like, like);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export class SupplierProductRepository {
  async findById(db: Db, id: string): Promise<SupplierProductRow | null> {
    return selectOne<SupplierProductRow>(
      db,
      `${SUPPLIER_PRODUCT_SELECT} WHERE sp.id = ? AND sp.deleted_at IS NULL`,
      [id],
    );
  }

  /**
   * The mapping for one supplier and one product, *including* a soft-deleted one.
   *
   * `uq_supplier_products` covers deleted rows, so an upsert has to revive the old row rather
   * than insert a second one and collide.
   */
  async findBySupplierAndProduct(
    db: Db,
    supplierId: string,
    productId: string,
  ): Promise<SupplierProductRow | null> {
    return selectOne<SupplierProductRow>(
      db,
      `${SUPPLIER_PRODUCT_SELECT} WHERE sp.supplier_id = ? AND sp.product_id = ?`,
      [supplierId, productId],
    );
  }

  /** Same reasoning for `uq_supplier_products_sku`: the SKU is unique per supplier. */
  async findBySupplierAndSku(
    db: Db,
    supplierId: string,
    supplierSku: string,
  ): Promise<SupplierProductRow | null> {
    return selectOne<SupplierProductRow>(
      db,
      `${SUPPLIER_PRODUCT_SELECT} WHERE sp.supplier_id = ? AND sp.supplier_sku = ?`,
      [supplierId, supplierSku],
    );
  }

  async list(
    db: Db,
    filter: SupplierProductListFilter,
  ): Promise<{ rows: SupplierProductRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<SupplierProductRow>(
      db,
      `${SUPPLIER_PRODUCT_SELECT} ${where}
        ORDER BY p.name ASC, sp.is_preferred DESC, e.name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total
         FROM supplier_products sp
         JOIN entities e ON e.id = sp.supplier_id
         JOIN products p ON p.id = sp.product_id
         ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(db: Db, input: InsertSupplierProductInput): Promise<SupplierProductRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO supplier_products
        (id, supplier_id, product_id, supplier_sku, supplier_product_name, barcode,
         purchase_uom_id, conversion_factor, pack_size, lead_time_days, is_preferred, status,
         notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.supplierId,
        input.productId,
        input.supplierSku,
        input.supplierProductName,
        input.barcode,
        input.purchaseUomId,
        input.conversionFactor,
        input.packSize,
        input.leadTimeDays,
        input.isPreferred ? 1 : 0,
        input.status,
        input.notes,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) {
      throw new Error(`Inserted supplier product ${input.id} could not be read back`);
    }
    return row;
  }

  /**
   * @param revive clears `deleted_at`, used when an upsert lands on a mapping that was
   *               previously removed — the unique key means the old row is the only way back.
   */
  async update(
    db: Db,
    id: string,
    input: UpdateSupplierProductInput,
    options: { revive?: boolean } = {},
  ): Promise<SupplierProductRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = input[key as keyof UpdateSupplierProductInput];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (options.revive === true) assignments.push('deleted_at = NULL');
    if (assignments.length === 0) return this.findById(db, id);

    const where = options.revive === true ? 'WHERE id = ?' : 'WHERE id = ? AND deleted_at IS NULL';
    const result = await mutate(
      db,
      `UPDATE supplier_products SET ${assignments.join(', ')}, updated_at = ? ${where}`,
      [...params, toDbDateTime(), id],
    );
    if (result.affectedRows === 0) return null;
    return this.findById(db, id);
  }

  /** At most one preferred supplier per product. Cleared inside the setting transaction. */
  async clearPreferred(db: Db, productId: string, exceptId: string | null): Promise<void> {
    const params: unknown[] = [toDbDateTime(), productId];
    let sql = `UPDATE supplier_products SET is_preferred = 0, updated_at = ?
                WHERE product_id = ? AND is_preferred = 1 AND deleted_at IS NULL`;
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
      `UPDATE supplier_products
          SET deleted_at = ?, status = 'INACTIVE', is_preferred = 0, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  }
}

export const supplierProductRepository = new SupplierProductRepository();
