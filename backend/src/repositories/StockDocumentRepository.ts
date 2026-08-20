import type {
  InventoryLocationKind,
  StockAdjustmentReason,
  StockAdjustmentStatus,
  StockCountStatus,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import { toDbDateTime } from '../utils/time';

/**
 * Data access for the stock documents — adjustments and counts with their lines — plus the
 * read projections the inventory API serves over `stock_balances` and `stock_batches`.
 *
 * `StockRepository` owns the posting core's data access and is not touched from here. What is
 * here is everything the wire needs that the core does not: joined, paged, filtered reads for
 * the screens, and the document tables the core knows nothing about.
 *
 * Nothing in this file writes to `stock_ledger` or `stock_balances`. Movements come from
 * `stockLedgerService.post()` and nowhere else.
 */

/* ------------------------------------------------------------------------ row types --- */

export interface StockAdjustmentRow extends RowDataPacket {
  id: string;
  adjustment_number: string;
  daily_sequence: number;
  business_date: string;
  location_id: string;
  reason: StockAdjustmentReason;
  status: StockAdjustmentStatus;
  stock_count_id: string | null;
  notes: string | null;
  total_in_value: string;
  total_out_value: string;
  created_by: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  posted_by: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  location_name?: string;
  created_by_name?: string | null;
  posted_by_name?: string | null;
  line_count?: string | number;
}

export interface StockAdjustmentLineRow extends RowDataPacket {
  id: string;
  adjustment_id: string;
  product_id: string;
  batch_id: string | null;
  direction: 'IN' | 'OUT';
  quantity: string;
  unit_cost: string;
  line_value: string;
  system_quantity: string | null;
  reason: StockAdjustmentReason | null;
  notes: string | null;
  sort_order: number;
  product_name?: string;
  product_unit?: string;
  batch_number?: string | null;
}

export interface StockCountRow extends RowDataPacket {
  id: string;
  count_number: string;
  daily_sequence: number;
  business_date: string;
  location_id: string;
  status: StockCountStatus;
  is_full_count: number;
  notes: string | null;
  adjustment_id: string | null;
  counted_by: string | null;
  counted_at: string | null;
  created_by: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  posted_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  location_name?: string;
  created_by_name?: string | null;
  adjustment_number?: string | null;
  line_count?: string | number;
  counted_line_count?: string | number;
  variance_line_count?: string | number;
  total_variance_value?: string | number;
}

export interface StockCountLineRow extends RowDataPacket {
  id: string;
  stock_count_id: string;
  product_id: string;
  batch_id: string | null;
  system_quantity: string;
  physical_quantity: string | null;
  variance_quantity: string;
  unit_cost: string;
  reason: StockAdjustmentReason | null;
  notes: string | null;
  is_counted: number;
  sort_order: number;
  product_name?: string;
  product_code?: string | null;
  product_unit?: string;
  batch_number?: string | null;
}

/** A balance as the balances grid reads it: joined, valued and measured against its level. */
export interface StockBalanceViewRow extends RowDataPacket {
  id: string;
  product_id: string;
  location_id: string;
  batch_id: string | null;
  quantity: string;
  reserved_quantity: string;
  average_cost: string;
  stock_value: string;
  last_movement_at: string | null;
  product_name: string;
  product_code: string | null;
  product_unit: string;
  location_name: string;
  location_kind: InventoryLocationKind;
  batch_number: string | null;
  expiry_date: string | null;
  days_to_expiry: number | null;
  reorder_level: string | null;
  location_on_hand: string;
}

export interface StockBatchViewRow extends RowDataPacket {
  id: string;
  product_id: string;
  batch_number: string | null;
  manufacturing_date: string | null;
  expiry_date: string | null;
  supplier_id: string | null;
  first_received_at: string;
  initial_quantity: string;
  unit_cost: string;
  source_type: string;
  source_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  product_name: string;
  supplier_name: string | null;
  quantity_on_hand: string;
  days_to_expiry: number | null;
}

export interface StockSummaryRow extends RowDataPacket {
  distinct_products: string | number;
  total_stock_value: string | null;
  expiring_soon_count: string | number;
  expired_count: string | number;
  negative_balance_count: string | number;
}

/** A product+batch holding stock at a location, as a fresh count sheet snapshots it. */
export interface CountSnapshotRow extends RowDataPacket {
  product_id: string;
  batch_id: string | null;
  quantity: string;
  average_cost: string;
  product_name: string;
}

/* --------------------------------------------------------------------------- filters --- */

export interface StockBalanceListFilter {
  productId?: string;
  locationId?: string;
  categoryId?: string;
  nonZeroOnly?: boolean;
  belowReorderLevel?: boolean;
  expiringWithinDays?: number;
  batchTrackedOnly?: boolean;
  limit: number;
  offset: number;
}

export interface StockBatchListFilter {
  productId?: string;
  locationId?: string;
  status?: string;
  expiringWithinDays?: number;
  onHandOnly?: boolean;
  limit: number;
  offset: number;
}

export interface StockAdjustmentListFilter {
  locationId?: string;
  status?: StockAdjustmentStatus;
  reason?: StockAdjustmentReason;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export interface StockCountListFilter {
  locationId?: string;
  status?: StockCountStatus;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export interface InsertStockAdjustmentInput {
  id: string;
  adjustmentNumber: string;
  dailySequence: number;
  businessDate: string;
  locationId: string;
  reason: StockAdjustmentReason;
  status: StockAdjustmentStatus;
  stockCountId: string | null;
  notes: string | null;
  createdBy: string | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export interface InsertStockAdjustmentLineInput {
  id: string;
  adjustmentId: string;
  productId: string;
  batchId: string | null;
  direction: 'IN' | 'OUT';
  quantity: number;
  unitCost: number;
  lineValue: number;
  systemQuantity: number | null;
  reason: StockAdjustmentReason | null;
  notes: string | null;
  sortOrder: number;
}

export interface StockAdjustmentStatusPatch {
  status: StockAdjustmentStatus;
  submittedBy?: string | null;
  submittedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedBy?: string | null;
  postedAt?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  totalInValue?: number;
  totalOutValue?: number;
}

export interface InsertStockCountInput {
  id: string;
  countNumber: string;
  dailySequence: number;
  businessDate: string;
  locationId: string;
  isFullCount: boolean;
  notes: string | null;
  createdBy: string | null;
}

export interface InsertStockCountLineInput {
  id: string;
  stockCountId: string;
  productId: string;
  batchId: string | null;
  systemQuantity: number;
  unitCost: number;
  sortOrder: number;
}

export interface StockCountStatusPatch {
  status?: StockCountStatus;
  countedBy?: string | null;
  countedAt?: string | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  postedAt?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  adjustmentId?: string | null;
}

/* ----------------------------------------------------------------------------- SQL --- */

const ADJUSTMENT_SELECT = `
  SELECT sa.*, il.name AS location_name,
         cu.name AS created_by_name, pu.name AS posted_by_name,
         (SELECT COUNT(*) FROM stock_adjustment_lines l WHERE l.adjustment_id = sa.id) AS line_count
    FROM stock_adjustments sa
    JOIN inventory_locations il ON il.id = sa.location_id
    LEFT JOIN users cu ON cu.id = sa.created_by
    LEFT JOIN users pu ON pu.id = sa.posted_by`;

const ADJUSTMENT_LINE_SELECT = `
  SELECT sal.*, p.name AS product_name, p.unit AS product_unit, sb.batch_number
    FROM stock_adjustment_lines sal
    JOIN products p ON p.id = sal.product_id
    LEFT JOIN stock_batches sb ON sb.id = sal.batch_id`;

const COUNT_SELECT = `
  SELECT sc.*, il.name AS location_name, cu.name AS created_by_name,
         sa.adjustment_number,
         (SELECT COUNT(*) FROM stock_count_lines l WHERE l.stock_count_id = sc.id) AS line_count,
         (SELECT COUNT(*) FROM stock_count_lines l
           WHERE l.stock_count_id = sc.id AND l.is_counted = 1) AS counted_line_count,
         (SELECT COUNT(*) FROM stock_count_lines l
           WHERE l.stock_count_id = sc.id AND l.variance_quantity <> 0) AS variance_line_count,
         (SELECT COALESCE(SUM(l.variance_quantity * l.unit_cost), 0) FROM stock_count_lines l
           WHERE l.stock_count_id = sc.id) AS total_variance_value
    FROM stock_counts sc
    JOIN inventory_locations il ON il.id = sc.location_id
    LEFT JOIN users cu ON cu.id = sc.created_by
    LEFT JOIN stock_adjustments sa ON sa.id = sc.adjustment_id`;

const COUNT_LINE_SELECT = `
  SELECT scl.*, p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
         sb.batch_number
    FROM stock_count_lines scl
    JOIN products p ON p.id = scl.product_id
    LEFT JOIN stock_batches sb ON sb.id = scl.batch_id`;

/**
 * The balances grid, resolved in one statement.
 *
 * `reorder_level` prefers the per-location policy and falls back to the product-level one,
 * which is the same precedence the requirement generator will use. `location_on_hand` is the
 * product's total at this location — a batch row on its own cannot be compared to a level.
 */
const BALANCE_FROM = `
    FROM stock_balances sb
    JOIN products p ON p.id = sb.product_id AND p.deleted_at IS NULL
    JOIN inventory_locations il ON il.id = sb.location_id AND il.deleted_at IS NULL
    LEFT JOIN stock_batches bt ON bt.id = sb.batch_id
    LEFT JOIN product_locations pl
           ON pl.product_id = sb.product_id AND pl.location_id = sb.location_id
          AND pl.deleted_at IS NULL`;

const BALANCE_SELECT = `
  SELECT sb.id, sb.product_id, sb.location_id, sb.batch_id, sb.quantity, sb.reserved_quantity,
         sb.average_cost, sb.stock_value, sb.last_movement_at,
         p.name AS product_name, p.code AS product_code, p.unit AS product_unit,
         il.name AS location_name, il.kind AS location_kind,
         bt.batch_number, bt.expiry_date,
         DATEDIFF(bt.expiry_date, CURDATE()) AS days_to_expiry,
         COALESCE(pl.reorder_level, p.reorder_level) AS reorder_level,
         (SELECT COALESCE(SUM(b2.quantity), 0) FROM stock_balances b2
           WHERE b2.product_id = sb.product_id AND b2.location_id = sb.location_id)
           AS location_on_hand
  ${BALANCE_FROM}`;

const REORDER_LEVEL_EXPR = 'COALESCE(pl.reorder_level, p.reorder_level)';

const LOCATION_ON_HAND_EXPR = `(SELECT COALESCE(SUM(b3.quantity), 0) FROM stock_balances b3
    WHERE b3.product_id = sb.product_id AND b3.location_id = sb.location_id)`;

const BATCH_FROM = `
    FROM stock_batches sb
    JOIN products p ON p.id = sb.product_id AND p.deleted_at IS NULL
    LEFT JOIN entities sup ON sup.id = sb.supplier_id`;

/* ------------------------------------------------------------------------ helpers --- */

function whereOf(conditions: readonly string[]): string {
  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

async function countOf(db: Db, sql: string, params: readonly unknown[]): Promise<number> {
  const row = await selectOne<RowDataPacket & { total: string | number }>(db, sql, params);
  return row === null ? 0 : Number(row.total);
}

export class StockDocumentRepository {
  /* ------------------------------------------------------------------- balances */

  buildBalanceWhere(filter: StockBalanceListFilter): { where: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.productId !== undefined) {
      conditions.push('sb.product_id = ?');
      params.push(filter.productId);
    }
    if (filter.locationId !== undefined) {
      conditions.push('sb.location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.categoryId !== undefined) {
      conditions.push('p.category_id = ?');
      params.push(filter.categoryId);
    }
    if (filter.nonZeroOnly === true) conditions.push('sb.quantity <> 0');
    if (filter.batchTrackedOnly === true) conditions.push('p.is_batch_tracked = 1');
    if (filter.expiringWithinDays !== undefined) {
      conditions.push(
        'bt.expiry_date IS NOT NULL AND bt.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)',
      );
      params.push(filter.expiringWithinDays);
    }
    if (filter.belowReorderLevel === true) {
      conditions.push(
        `${REORDER_LEVEL_EXPR} IS NOT NULL AND ${REORDER_LEVEL_EXPR} > 0
         AND ${LOCATION_ON_HAND_EXPR} < ${REORDER_LEVEL_EXPR}`,
      );
    }

    return { where: whereOf(conditions), params };
  }

  async listBalanceView(
    db: Db,
    filter: StockBalanceListFilter,
  ): Promise<{ rows: StockBalanceViewRow[]; total: number }> {
    const { where, params } = this.buildBalanceWhere(filter);
    const rows = await selectRows<StockBalanceViewRow>(
      db,
      `${BALANCE_SELECT} ${where}
        ORDER BY p.name ASC, il.name ASC, bt.expiry_date ASC, sb.id ASC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(db, `SELECT COUNT(*) AS total ${BALANCE_FROM} ${where}`, params);
    return { rows, total };
  }

  /**
   * Headline figures over the balance cache.
   *
   * Every number is an aggregate of real rows. Expiry is measured on the batch, so an
   * untracked balance can never be counted as expiring — it has no date to expire on.
   */
  async summarise(
    db: Db,
    options: { locationId?: string; nearExpiryDays: number },
  ): Promise<StockSummaryRow> {
    const conditions: string[] = [];
    const params: unknown[] = [options.nearExpiryDays];
    if (options.locationId !== undefined) {
      conditions.push('sb.location_id = ?');
      params.push(options.locationId);
    }

    const row = await selectOne<StockSummaryRow>(
      db,
      `SELECT COUNT(DISTINCT CASE WHEN sb.quantity <> 0 THEN sb.product_id END)
                AS distinct_products,
              COALESCE(SUM(sb.stock_value), 0) AS total_stock_value,
              COUNT(CASE WHEN sb.quantity > 0 AND bt.expiry_date IS NOT NULL
                          AND bt.expiry_date >= CURDATE()
                          AND bt.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
                         THEN 1 END) AS expiring_soon_count,
              COUNT(CASE WHEN sb.quantity > 0 AND bt.expiry_date IS NOT NULL
                          AND bt.expiry_date < CURDATE() THEN 1 END) AS expired_count,
              COUNT(CASE WHEN sb.quantity < 0 THEN 1 END) AS negative_balance_count
         FROM stock_balances sb
         JOIN products p ON p.id = sb.product_id AND p.deleted_at IS NULL
         JOIN inventory_locations il ON il.id = sb.location_id AND il.deleted_at IS NULL
         LEFT JOIN stock_batches bt ON bt.id = sb.batch_id
        ${whereOf(conditions)}`,
      params,
    );
    if (row === null) {
      throw new Error('Stock summary aggregate returned no row');
    }
    return row;
  }

  /**
   * How many products are short somewhere in scope.
   *
   * Counted per product rather than per balance row: a product held in three batches is one
   * product running low, not three. The level is the location policy where one exists.
   */
  async countBelowReorderLevel(db: Db, locationId?: string): Promise<number> {
    const params: unknown[] = [];
    let scope = '';
    if (locationId !== undefined) {
      scope = 'AND sb.location_id = ?';
      params.push(locationId);
    }
    return countOf(
      db,
      `SELECT COUNT(DISTINCT t.product_id) AS total FROM (
         SELECT sb.product_id AS product_id,
                SUM(sb.quantity) AS on_hand,
                COALESCE(pl.reorder_level, p.reorder_level) AS reorder_level
           FROM stock_balances sb
           JOIN products p ON p.id = sb.product_id AND p.deleted_at IS NULL
           LEFT JOIN product_locations pl
                  ON pl.product_id = sb.product_id AND pl.location_id = sb.location_id
                 AND pl.deleted_at IS NULL
          WHERE p.is_stocked = 1 ${scope}
          GROUP BY sb.product_id, sb.location_id, COALESCE(pl.reorder_level, p.reorder_level)
         HAVING reorder_level IS NOT NULL AND reorder_level > 0 AND on_hand < reorder_level
       ) t`,
      params,
    );
  }

  /* -------------------------------------------------------------------- batches */

  async listBatchView(
    db: Db,
    filter: StockBatchListFilter,
  ): Promise<{ rows: StockBatchViewRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // The on-hand figure is the batch's remaining quantity, narrowed to one location when the
    // caller asked about one. It is a subquery rather than a join so a batch with no balance
    // row still lists, at zero.
    const onHandParams: unknown[] = [];
    let onHandScope = '';
    if (filter.locationId !== undefined) {
      onHandScope = 'AND bal.location_id = ?';
      onHandParams.push(filter.locationId);
    }
    const onHand = `(SELECT COALESCE(SUM(bal.quantity), 0) FROM stock_balances bal
        WHERE bal.batch_id = sb.id ${onHandScope})`;

    if (filter.productId !== undefined) {
      conditions.push('sb.product_id = ?');
      params.push(filter.productId);
    }
    if (filter.status !== undefined) {
      conditions.push('sb.status = ?');
      params.push(filter.status);
    }
    if (filter.expiringWithinDays !== undefined) {
      conditions.push(
        'sb.expiry_date IS NOT NULL AND sb.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)',
      );
      params.push(filter.expiringWithinDays);
    }
    if (filter.locationId !== undefined) {
      conditions.push(`EXISTS (SELECT 1 FROM stock_balances bx
                                WHERE bx.batch_id = sb.id AND bx.location_id = ?)`);
      params.push(filter.locationId);
    }
    if (filter.onHandOnly === true) {
      conditions.push(`${onHand} > 0`);
      params.push(...onHandParams);
    }

    const where = whereOf(conditions);
    const rows = await selectRows<StockBatchViewRow>(
      db,
      `SELECT sb.*, p.name AS product_name, sup.name AS supplier_name,
              DATEDIFF(sb.expiry_date, CURDATE()) AS days_to_expiry,
              ${onHand} AS quantity_on_hand
       ${BATCH_FROM} ${where}
        ORDER BY CASE WHEN sb.expiry_date IS NULL THEN 1 ELSE 0 END ASC,
                 sb.expiry_date ASC, sb.first_received_at ASC
        LIMIT ? OFFSET ?`,
      [...onHandParams, ...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total ${BATCH_FROM} ${where}`,
      params,
    );
    return { rows, total };
  }

  /* ---------------------------------------------------------------- adjustments */

  async findAdjustment(db: Db, id: string): Promise<StockAdjustmentRow | null> {
    return selectOne<StockAdjustmentRow>(db, `${ADJUSTMENT_SELECT} WHERE sa.id = ?`, [id]);
  }

  /**
   * Read an adjustment and hold a row lock on it for the rest of the transaction.
   *
   * Deliberately unjoined: the lock has to be on `stock_adjustments` and nothing else, and
   * two clients racing the Post button must serialise here rather than both reaching the
   * ledger.
   */
  async lockAdjustment(db: Db, id: string): Promise<StockAdjustmentRow | null> {
    return selectOne<StockAdjustmentRow>(
      db,
      'SELECT * FROM stock_adjustments WHERE id = ? FOR UPDATE',
      [id],
    );
  }

  async listAdjustments(
    db: Db,
    filter: StockAdjustmentListFilter,
  ): Promise<{ rows: StockAdjustmentRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.locationId !== undefined) {
      conditions.push('sa.location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.status !== undefined) {
      conditions.push('sa.status = ?');
      params.push(filter.status);
    }
    if (filter.reason !== undefined) {
      conditions.push('sa.reason = ?');
      params.push(filter.reason);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('sa.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('sa.business_date <= ?');
      params.push(filter.dateTo);
    }
    const where = whereOf(conditions);
    const rows = await selectRows<StockAdjustmentRow>(
      db,
      `${ADJUSTMENT_SELECT} ${where}
        ORDER BY sa.business_date DESC, sa.daily_sequence DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM stock_adjustments sa ${where}`,
      params,
    );
    return { rows, total };
  }

  async insertAdjustment(db: Db, input: InsertStockAdjustmentInput): Promise<StockAdjustmentRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO stock_adjustments
         (id, adjustment_number, daily_sequence, business_date, location_id, reason, status,
          stock_count_id, notes, total_in_value, total_out_value, created_by,
          submitted_by, submitted_at, approved_by, approved_at,
          created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.adjustmentNumber,
        input.dailySequence,
        input.businessDate,
        input.locationId,
        input.reason,
        input.status,
        input.stockCountId,
        input.notes,
        input.createdBy,
        input.submittedBy ?? null,
        input.submittedAt ?? null,
        input.approvedBy ?? null,
        input.approvedAt ?? null,
        now,
        now,
      ],
    );
    const row = await this.findAdjustment(db, input.id);
    if (row === null) throw new Error(`Inserted stock adjustment ${input.id} could not be read back`);
    return row;
  }

  async updateAdjustmentHeader(
    db: Db,
    id: string,
    input: { locationId?: string; reason?: StockAdjustmentReason; notes?: string | null },
  ): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.locationId !== undefined) {
      assignments.push('location_id = ?');
      params.push(input.locationId);
    }
    if (input.reason !== undefined) {
      assignments.push('reason = ?');
      params.push(input.reason);
    }
    if (input.notes !== undefined) {
      assignments.push('notes = ?');
      params.push(input.notes);
    }
    assignments.push('updated_at = ?', 'revision = revision + 1');
    params.push(toDbDateTime(), id);
    await mutate(db, `UPDATE stock_adjustments SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  async setAdjustmentStatus(
    db: Db,
    id: string,
    patch: StockAdjustmentStatusPatch,
  ): Promise<void> {
    const assignments: string[] = ['status = ?'];
    const params: unknown[] = [patch.status];
    const columns: Readonly<Record<string, unknown>> = {
      submitted_by: patch.submittedBy,
      submitted_at: patch.submittedAt,
      approved_by: patch.approvedBy,
      approved_at: patch.approvedAt,
      posted_by: patch.postedBy,
      posted_at: patch.postedAt,
      cancelled_by: patch.cancelledBy,
      cancelled_at: patch.cancelledAt,
      total_in_value: patch.totalInValue,
      total_out_value: patch.totalOutValue,
    };
    for (const [column, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    assignments.push('updated_at = ?', 'revision = revision + 1');
    params.push(toDbDateTime(), id);
    await mutate(db, `UPDATE stock_adjustments SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  async listAdjustmentLines(db: Db, adjustmentId: string): Promise<StockAdjustmentLineRow[]> {
    return selectRows<StockAdjustmentLineRow>(
      db,
      `${ADJUSTMENT_LINE_SELECT} WHERE sal.adjustment_id = ? ORDER BY sal.sort_order ASC`,
      [adjustmentId],
    );
  }

  async deleteAdjustmentLines(db: Db, adjustmentId: string): Promise<void> {
    await mutate(db, 'DELETE FROM stock_adjustment_lines WHERE adjustment_id = ?', [adjustmentId]);
  }

  async insertAdjustmentLine(db: Db, input: InsertStockAdjustmentLineInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO stock_adjustment_lines
         (id, adjustment_id, product_id, batch_id, direction, quantity, unit_cost, line_value,
          system_quantity, reason, notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.adjustmentId,
        input.productId,
        input.batchId,
        input.direction,
        input.quantity,
        input.unitCost,
        input.lineValue,
        input.systemQuantity,
        input.reason,
        input.notes,
        input.sortOrder,
        now,
        now,
      ],
    );
  }

  /** After posting, a line records what the ledger actually valued it at. */
  async setAdjustmentLineValue(
    db: Db,
    lineId: string,
    input: { unitCost: number; lineValue: number },
  ): Promise<void> {
    await mutate(
      db,
      'UPDATE stock_adjustment_lines SET unit_cost = ?, line_value = ?, updated_at = ? WHERE id = ?',
      [input.unitCost, input.lineValue, toDbDateTime(), lineId],
    );
  }

  /* --------------------------------------------------------------------- counts */

  async findCount(db: Db, id: string): Promise<StockCountRow | null> {
    return selectOne<StockCountRow>(db, `${COUNT_SELECT} WHERE sc.id = ?`, [id]);
  }

  async lockCount(db: Db, id: string): Promise<StockCountRow | null> {
    return selectOne<StockCountRow>(db, 'SELECT * FROM stock_counts WHERE id = ? FOR UPDATE', [
      id,
    ]);
  }

  async listCounts(
    db: Db,
    filter: StockCountListFilter,
  ): Promise<{ rows: StockCountRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.locationId !== undefined) {
      conditions.push('sc.location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.status !== undefined) {
      conditions.push('sc.status = ?');
      params.push(filter.status);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('sc.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('sc.business_date <= ?');
      params.push(filter.dateTo);
    }
    const where = whereOf(conditions);
    const rows = await selectRows<StockCountRow>(
      db,
      `${COUNT_SELECT} ${where}
        ORDER BY sc.business_date DESC, sc.daily_sequence DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const total = await countOf(
      db,
      `SELECT COUNT(*) AS total FROM stock_counts sc ${where}`,
      params,
    );
    return { rows, total };
  }

  async insertCount(db: Db, input: InsertStockCountInput): Promise<StockCountRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO stock_counts
         (id, count_number, daily_sequence, business_date, location_id, status, is_full_count,
          notes, created_by, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.countNumber,
        input.dailySequence,
        input.businessDate,
        input.locationId,
        input.isFullCount ? 1 : 0,
        input.notes,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findCount(db, input.id);
    if (row === null) throw new Error(`Inserted stock count ${input.id} could not be read back`);
    return row;
  }

  async insertCountLine(db: Db, input: InsertStockCountLineInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO stock_count_lines
         (id, stock_count_id, product_id, batch_id, system_quantity, physical_quantity,
          variance_quantity, unit_cost, is_counted, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?, 0, ?, ?, ?)`,
      [
        input.id,
        input.stockCountId,
        input.productId,
        input.batchId,
        input.systemQuantity,
        input.unitCost,
        input.sortOrder,
        now,
        now,
      ],
    );
  }

  async listCountLines(db: Db, countId: string): Promise<StockCountLineRow[]> {
    return selectRows<StockCountLineRow>(
      db,
      `${COUNT_LINE_SELECT} WHERE scl.stock_count_id = ? ORDER BY scl.sort_order ASC`,
      [countId],
    );
  }

  async findCountLine(db: Db, countId: string, lineId: string): Promise<StockCountLineRow | null> {
    return selectOne<StockCountLineRow>(
      db,
      'SELECT * FROM stock_count_lines WHERE id = ? AND stock_count_id = ?',
      [lineId, countId],
    );
  }

  /**
   * Record what was physically found on one line.
   *
   * The variance is written here rather than generated by the database: MariaDB 10.6 refuses
   * the expression in a GENERATED ALWAYS clause (see the 005 header), so this method is what
   * guarantees `variance_quantity` and the two quantities never disagree.
   */
  async recordCountLine(
    db: Db,
    lineId: string,
    input: {
      physicalQuantity: number | null;
      varianceQuantity: number;
      isCounted: boolean;
      reason?: StockAdjustmentReason | null;
      notes?: string | null;
    },
  ): Promise<void> {
    const assignments = [
      'physical_quantity = ?',
      'variance_quantity = ?',
      'is_counted = ?',
      'updated_at = ?',
    ];
    const params: unknown[] = [
      input.physicalQuantity,
      input.varianceQuantity,
      input.isCounted ? 1 : 0,
      toDbDateTime(),
    ];
    if (input.reason !== undefined) {
      assignments.push('reason = ?');
      params.push(input.reason);
    }
    if (input.notes !== undefined) {
      assignments.push('notes = ?');
      params.push(input.notes);
    }
    params.push(lineId);
    await mutate(db, `UPDATE stock_count_lines SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  async setCountStatus(db: Db, id: string, patch: StockCountStatusPatch): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const columns: Readonly<Record<string, unknown>> = {
      status: patch.status,
      counted_by: patch.countedBy,
      counted_at: patch.countedAt,
      submitted_by: patch.submittedBy,
      submitted_at: patch.submittedAt,
      approved_by: patch.approvedBy,
      approved_at: patch.approvedAt,
      posted_at: patch.postedAt,
      cancelled_by: patch.cancelledBy,
      cancelled_at: patch.cancelledAt,
      adjustment_id: patch.adjustmentId,
    };
    for (const [column, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    assignments.push('updated_at = ?', 'revision = revision + 1');
    params.push(toDbDateTime(), id);
    await mutate(db, `UPDATE stock_counts SET ${assignments.join(', ')} WHERE id = ?`, params);
  }

  /**
   * What a location is believed to hold, as a fresh count sheet snapshots it.
   *
   * One row per product and batch actually held. A zero balance is excluded: a count sheet is
   * a list of what should be on the shelf, and the operator adds anything found that is not.
   */
  async snapshotHoldings(
    db: Db,
    filter: { locationId: string; productIds?: readonly string[]; categoryId?: string },
  ): Promise<CountSnapshotRow[]> {
    const conditions = ['sb.location_id = ?', 'sb.quantity <> 0', 'p.is_stocked = 1'];
    const params: unknown[] = [filter.locationId];
    if (filter.productIds !== undefined && filter.productIds.length > 0) {
      conditions.push(`sb.product_id IN (${filter.productIds.map(() => '?').join(', ')})`);
      params.push(...filter.productIds);
    }
    if (filter.categoryId !== undefined) {
      conditions.push('p.category_id = ?');
      params.push(filter.categoryId);
    }
    return selectRows<CountSnapshotRow>(
      db,
      `SELECT sb.product_id, sb.batch_id, sb.quantity, sb.average_cost, p.name AS product_name
         FROM stock_balances sb
         JOIN products p ON p.id = sb.product_id AND p.deleted_at IS NULL
        ${whereOf(conditions)}
        ORDER BY p.name ASC, sb.batch_id ASC`,
      params,
    );
  }

  /** The stocked products among a requested set, so a count sheet can name what it cannot find. */
  async findStockedProducts(
    db: Db,
    ids: readonly string[],
  ): Promise<(RowDataPacket & { id: string; name: string; moving_average_cost: string })[]> {
    if (ids.length === 0) return [];
    return selectRows<RowDataPacket & { id: string; name: string; moving_average_cost: string }>(
      db,
      `SELECT id, name, moving_average_cost FROM products
        WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL AND is_stocked = 1
        ORDER BY name ASC`,
      ids,
    );
  }

  async findLocationName(db: Db, locationId: string): Promise<string | null> {
    const row = await selectOne<RowDataPacket & { name: string }>(
      db,
      'SELECT name FROM inventory_locations WHERE id = ? AND deleted_at IS NULL',
      [locationId],
    );
    return row === null ? null : row.name;
  }
}

export const stockDocumentRepository = new StockDocumentRepository();
