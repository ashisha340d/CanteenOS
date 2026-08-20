import type {
  BatchIssuePolicy,
  MasterStatus,
  ProductKind,
  ValuationMethod,
} from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, ProductLocationRow, ProductRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the product master and its per-location stock policy
 * (004_purchase_foundation.sql).
 *
 * `products` is the same table `IngredientRepository` reads: migration 004 made it the single
 * item master, reproducing every `ingredients` column under the same name. That repository
 * keeps the narrow recipe view; this one owns the purchase attributes — units, tax, batch
 * policy, valuation and reorder levels — and the joins the purchase screens display. Two
 * readers, one table, one truth.
 *
 * Every write allocates a `sync_seq`, because the recipe view of these rows is cached on the
 * phone and a purchase edit to a product's name or unit must reach it.
 */

const PRODUCT_COLUMNS = `p.id, p.category_id, p.name, p.name_hi, p.unit, p.status, p.sort_order,
    p.created_by, p.created_at, p.updated_at, p.deleted_at, p.revision, p.sync_seq,
    p.code, p.barcode, p.brand, p.description, p.kind,
    p.hsn_sac_id, p.tax_profile_id,
    p.stock_uom_id, p.purchase_uom_id, p.purchase_conversion_factor, p.pack_size,
    p.is_batch_tracked, p.is_expiry_tracked, p.shelf_life_days, p.batch_issue_policy,
    p.valuation_method, p.standard_cost, p.moving_average_cost, p.last_purchase_rate,
    p.last_purchased_at,
    p.default_location_id, p.preferred_supplier_id, p.min_stock, p.reorder_level, p.max_stock,
    p.lead_time_days, p.is_purchasable, p.is_stocked`;

/** Everything the product grid shows, resolved in one statement. */
const PRODUCT_JOINED_FIELDS = `c.name AS category_name,
         su.code AS stock_uom_code,
         pu.code AS purchase_uom_code,
         tp.name AS tax_profile_name,
         tp.gst_rate AS tax_rate,
         hs.code AS hsn_sac_code,
         hs.code_type AS hsn_sac_code_type,
         dl.name AS default_location_name,
         sup.name AS preferred_supplier_name`;

const PRODUCT_FROM = `FROM products p
    LEFT JOIN ingredient_categories c ON c.id = p.category_id
    LEFT JOIN uoms su ON su.id = p.stock_uom_id
    LEFT JOIN uoms pu ON pu.id = p.purchase_uom_id
    LEFT JOIN tax_profiles tp ON tp.id = p.tax_profile_id
    LEFT JOIN hsn_sac_master hs ON hs.id = p.hsn_sac_id
    LEFT JOIN inventory_locations dl ON dl.id = p.default_location_id
    LEFT JOIN entities sup ON sup.id = p.preferred_supplier_id`;

const PRODUCT_SELECT = `SELECT ${PRODUCT_COLUMNS},
         ${PRODUCT_JOINED_FIELDS}
    ${PRODUCT_FROM}`;

/**
 * The same grid with the real on-hand quantity attached.
 *
 * A LEFT JOIN, so a product that has never had a movement reports 0 — and that zero is the
 * truth, not a placeholder: no balance row exists because no stock was ever posted. Summed
 * across every location and batch, because `stockOnHand` on the product master means "how much
 * of this do we have", not "how much is in one store".
 */
const PRODUCT_SELECT_WITH_STOCK = `SELECT ${PRODUCT_COLUMNS},
         ${PRODUCT_JOINED_FIELDS},
         COALESCE(soh.quantity, 0) AS stock_on_hand
    ${PRODUCT_FROM}
    LEFT JOIN (SELECT product_id, SUM(quantity) AS quantity
                 FROM stock_balances GROUP BY product_id) soh ON soh.product_id = p.id`;

/**
 * On hand across every location, as a correlated subquery.
 *
 * Used in the WHERE clause rather than the join above so that the row-count query — which does
 * not carry the join — can apply the same condition.
 */
const PRODUCT_ON_HAND_EXPR = `COALESCE((SELECT SUM(b.quantity) FROM stock_balances b
                                         WHERE b.product_id = p.id), 0)`;

const PRODUCT_LOCATION_COLUMNS = `pl.id, pl.product_id, pl.location_id, pl.min_stock,
    pl.reorder_level, pl.max_stock, pl.is_default_destination, pl.bin, pl.status,
    pl.created_by, pl.created_at, pl.updated_at, pl.deleted_at`;

const PRODUCT_LOCATION_SELECT = `SELECT ${PRODUCT_LOCATION_COLUMNS},
         pr.name AS product_name,
         l.name AS location_name,
         l.kind AS location_kind
    FROM product_locations pl
    JOIN products pr ON pr.id = pl.product_id
    JOIN inventory_locations l ON l.id = pl.location_id`;

export interface ProductListFilter {
  search?: string;
  categoryId?: string;
  kind?: ProductKind;
  status?: MasterStatus;
  purchasableOnly?: boolean;
  stockedOnly?: boolean;
  batchTrackedOnly?: boolean;
  supplierId?: string;
  locationId?: string;
  belowReorderLevel?: boolean;
  /** Join the summed balance so the grid can show `stockOnHand`. Opt-in: it costs a scan. */
  includeStock?: boolean;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface InsertProductInput {
  id: string;
  categoryId: string | null;
  name: string;
  nameHi: string | null;
  unit: string;
  status: MasterStatus;
  sortOrder: number;
  code: string | null;
  barcode: string | null;
  brand: string | null;
  description: string | null;
  kind: ProductKind;
  hsnSacId: string | null;
  taxProfileId: string | null;
  stockUomId: string | null;
  purchaseUomId: string | null;
  purchaseConversionFactor: number;
  packSize: string | null;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  shelfLifeDays: number | null;
  batchIssuePolicy: BatchIssuePolicy;
  valuationMethod: ValuationMethod;
  standardCost: number | null;
  defaultLocationId: string | null;
  preferredSupplierId: string | null;
  minStock: number | null;
  reorderLevel: number | null;
  maxStock: number | null;
  leadTimeDays: number | null;
  isPurchasable: boolean;
  isStocked: boolean;
  createdBy: string | null;
}

export type UpdateProductInput = Partial<Omit<InsertProductInput, 'id' | 'createdBy'>>;

const UPDATABLE_COLUMNS: Readonly<Record<keyof UpdateProductInput, string>> = {
  categoryId: 'category_id',
  name: 'name',
  nameHi: 'name_hi',
  unit: 'unit',
  status: 'status',
  sortOrder: 'sort_order',
  code: 'code',
  barcode: 'barcode',
  brand: 'brand',
  description: 'description',
  kind: 'kind',
  hsnSacId: 'hsn_sac_id',
  taxProfileId: 'tax_profile_id',
  stockUomId: 'stock_uom_id',
  purchaseUomId: 'purchase_uom_id',
  purchaseConversionFactor: 'purchase_conversion_factor',
  packSize: 'pack_size',
  isBatchTracked: 'is_batch_tracked',
  isExpiryTracked: 'is_expiry_tracked',
  shelfLifeDays: 'shelf_life_days',
  batchIssuePolicy: 'batch_issue_policy',
  valuationMethod: 'valuation_method',
  standardCost: 'standard_cost',
  defaultLocationId: 'default_location_id',
  preferredSupplierId: 'preferred_supplier_id',
  minStock: 'min_stock',
  reorderLevel: 'reorder_level',
  maxStock: 'max_stock',
  leadTimeDays: 'lead_time_days',
  isPurchasable: 'is_purchasable',
  isStocked: 'is_stocked',
};

export interface UpsertProductLocationInput {
  id: string;
  productId: string;
  locationId: string;
  minStock: number | null;
  reorderLevel: number | null;
  maxStock: number | null;
  isDefaultDestination: boolean;
  bin: string | null;
  status: MasterStatus;
  createdBy: string | null;
}

function buildWhere(filter: ProductListFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.includeDeleted !== true) conditions.push('p.deleted_at IS NULL');
  if (filter.categoryId !== undefined) {
    conditions.push('p.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.kind !== undefined) {
    conditions.push('p.kind = ?');
    params.push(filter.kind);
  }
  if (filter.status !== undefined) {
    conditions.push('p.status = ?');
    params.push(filter.status);
  }
  if (filter.purchasableOnly === true) conditions.push('p.is_purchasable = 1');
  if (filter.stockedOnly === true) conditions.push('p.is_stocked = 1');
  if (filter.batchTrackedOnly === true) conditions.push('p.is_batch_tracked = 1');

  // EXISTS rather than a JOIN: a product mapped to the same supplier twice (different SKUs)
  // must still appear once.
  if (filter.supplierId !== undefined) {
    conditions.push(`EXISTS (SELECT 1 FROM supplier_products sp
                              WHERE sp.product_id = p.id AND sp.supplier_id = ?
                                AND sp.deleted_at IS NULL)`);
    params.push(filter.supplierId);
  }
  if (filter.locationId !== undefined) {
    conditions.push(`EXISTS (SELECT 1 FROM product_locations pl
                              WHERE pl.product_id = p.id AND pl.location_id = ?
                                AND pl.deleted_at IS NULL)`);
    params.push(filter.locationId);
  }

  // A real comparison against the balance cache: stocked, has a level to be below, and holds
  // less than that level right now. A product with no balance row is on hand zero, which is
  // below any level worth setting — that is the case the reorder report exists to catch.
  if (filter.belowReorderLevel === true) {
    conditions.push(
      `p.is_stocked = 1 AND p.reorder_level IS NOT NULL AND p.reorder_level > 0
       AND ${PRODUCT_ON_HAND_EXPR} < p.reorder_level`,
    );
  }

  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(p.name LIKE ? OR p.code LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export class ProductRepository {
  async findById(db: Db, id: string): Promise<ProductRow | null> {
    return selectOne<ProductRow>(db, `${PRODUCT_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`, [
      id,
    ]);
  }

  async findByName(db: Db, name: string): Promise<ProductRow | null> {
    return selectOne<ProductRow>(
      db,
      `${PRODUCT_SELECT} WHERE p.name = ? AND p.deleted_at IS NULL`,
      [name],
    );
  }

  /** Codes are unique across live *and* deleted rows, so this deliberately sees both. */
  async findByCode(db: Db, code: string): Promise<ProductRow | null> {
    return selectOne<ProductRow>(db, `${PRODUCT_SELECT} WHERE p.code = ?`, [code]);
  }

  async list(db: Db, filter: ProductListFilter): Promise<{ rows: ProductRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const select = filter.includeStock === true ? PRODUCT_SELECT_WITH_STOCK : PRODUCT_SELECT;
    const rows = await selectRows<ProductRow>(
      db,
      `${select} ${where} ORDER BY p.sort_order ASC, p.name ASC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM products p ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(db: Db, input: InsertProductInput): Promise<ProductRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO products
        (id, category_id, name, name_hi, unit, status, sort_order, created_by,
         created_at, updated_at, revision, sync_seq,
         code, barcode, brand, description, kind,
         hsn_sac_id, tax_profile_id,
         stock_uom_id, purchase_uom_id, purchase_conversion_factor, pack_size,
         is_batch_tracked, is_expiry_tracked, shelf_life_days, batch_issue_policy,
         valuation_method, standard_cost,
         default_location_id, preferred_supplier_id, min_stock, reorder_level, max_stock,
         lead_time_days, is_purchasable, is_stocked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.code,
        input.barcode,
        input.brand,
        input.description,
        input.kind,
        input.hsnSacId,
        input.taxProfileId,
        input.stockUomId,
        input.purchaseUomId,
        input.purchaseConversionFactor,
        input.packSize,
        input.isBatchTracked ? 1 : 0,
        input.isExpiryTracked ? 1 : 0,
        input.shelfLifeDays,
        input.batchIssuePolicy,
        input.valuationMethod,
        input.standardCost,
        input.defaultLocationId,
        input.preferredSupplierId,
        input.minStock,
        input.reorderLevel,
        input.maxStock,
        input.leadTimeDays,
        input.isPurchasable ? 1 : 0,
        input.isStocked ? 1 : 0,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted product ${input.id} could not be read back`);
    return row;
  }

  async update(db: Db, id: string, input: UpdateProductInput): Promise<ProductRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = input[key as keyof UpdateProductInput];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    if (assignments.length === 0) return this.findById(db, id);

    const syncSeq = await allocateSyncSeq(db);
    const result = await mutate(
      db,
      `UPDATE products
          SET ${assignments.join(', ')}, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), syncSeq, id],
    );
    if (result.affectedRows === 0) return null;
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE products
          SET deleted_at = ?, status = 'INACTIVE', updated_at = ?, revision = revision + 1,
              sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
    return result.affectedRows > 0;
  }

  /** A product a recipe still calls for is deactivated, never removed. */
  async isReferencedByRecipes(db: Db, id: string): Promise<boolean> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM recipe_ingredients
        WHERE ingredient_id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row !== null && Number(row.total) > 0;
  }

  /* -------------------------------------------------- per-location stock policy */

  async listLocations(db: Db, productId: string): Promise<ProductLocationRow[]> {
    return selectRows<ProductLocationRow>(
      db,
      `${PRODUCT_LOCATION_SELECT}
        WHERE pl.product_id = ? AND pl.deleted_at IS NULL
        ORDER BY pl.is_default_destination DESC, l.sort_order ASC, l.name ASC`,
      [productId],
    );
  }

  async findLocationById(db: Db, id: string): Promise<ProductLocationRow | null> {
    return selectOne<ProductLocationRow>(
      db,
      `${PRODUCT_LOCATION_SELECT} WHERE pl.id = ? AND pl.deleted_at IS NULL`,
      [id],
    );
  }

  /**
   * The policy row for one product at one location, *including* a soft-deleted one.
   *
   * `uq_product_locations` covers deleted rows too, so an upsert has to find and revive the
   * old row rather than insert a second one and collide.
   */
  async findLocation(
    db: Db,
    productId: string,
    locationId: string,
  ): Promise<ProductLocationRow | null> {
    return selectOne<ProductLocationRow>(
      db,
      `${PRODUCT_LOCATION_SELECT} WHERE pl.product_id = ? AND pl.location_id = ?`,
      [productId, locationId],
    );
  }

  async upsertLocation(
    db: Db,
    input: UpsertProductLocationInput,
  ): Promise<ProductLocationRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO product_locations
        (id, product_id, location_id, min_stock, reorder_level, max_stock,
         is_default_destination, bin, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         min_stock = VALUES(min_stock),
         reorder_level = VALUES(reorder_level),
         max_stock = VALUES(max_stock),
         is_default_destination = VALUES(is_default_destination),
         bin = VALUES(bin),
         status = VALUES(status),
         deleted_at = NULL,
         updated_at = VALUES(updated_at)`,
      [
        input.id,
        input.productId,
        input.locationId,
        input.minStock,
        input.reorderLevel,
        input.maxStock,
        input.isDefaultDestination ? 1 : 0,
        input.bin,
        input.status,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findLocation(db, input.productId, input.locationId);
    if (row === null) {
      throw new Error(`Upserted product location ${input.id} could not be read back`);
    }
    return row;
  }

  /** At most one default destination per product; same reasoning as the receiving default. */
  async clearDefaultDestination(
    db: Db,
    productId: string,
    exceptLocationId: string | null,
  ): Promise<void> {
    const params: unknown[] = [toDbDateTime(), productId];
    let sql = `UPDATE product_locations
                  SET is_default_destination = 0, updated_at = ?
                WHERE product_id = ? AND is_default_destination = 1 AND deleted_at IS NULL`;
    if (exceptLocationId !== null) {
      sql += ' AND location_id <> ?';
      params.push(exceptLocationId);
    }
    await mutate(db, sql, params);
  }

  async softDeleteLocation(db: Db, productId: string, locationId: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE product_locations
          SET deleted_at = ?, status = 'INACTIVE', is_default_destination = 0, updated_at = ?
        WHERE product_id = ? AND location_id = ? AND deleted_at IS NULL`,
      [now, now, productId, locationId],
    );
    return result.affectedRows > 0;
  }
}

export const productRepository = new ProductRepository();
