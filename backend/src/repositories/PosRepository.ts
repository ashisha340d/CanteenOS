import type {
  GstTaxability,
  PosDiscountType,
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  PosPaymentStatus,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CountRow,
  PosOrderItemRow,
  PosOrderRow,
  PosPaymentRow,
} from '../models/rows';
import type { RowDataPacket } from 'mysql2/promise';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the till (022_entities_and_pos.sql): ticket headers, their lines and their
 * payments, plus the one catalogue read the POS needs in order to price a line.
 *
 * No sync bookkeeping — the POS never reaches the Android app. `revision` is bumped on every
 * header write purely for optimistic concurrency between two terminals on the same ticket.
 */

const POS_ORDER_COLUMNS = `po.id, po.order_number, po.daily_sequence, po.business_date,
    po.order_type, po.status, po.payment_status, po.station_id, po.counter_id, po.menu_id,
    po.entity_id, po.entity_type, po.entity_name, po.entity_phone, po.entity_address,
    po.table_label, po.pax, po.scheduled_for, po.notes, po.discount_type, po.discount_value,
    po.subtotal_amount, po.discount_amount, po.tax_amount, po.round_off_amount,
    po.total_amount, po.paid_amount, po.balance_amount, po.placed_at, po.completed_at,
    po.cancelled_at, po.cancel_reason, po.created_by, po.updated_by, po.created_at,
    po.updated_at, po.deleted_at, po.revision`;

const POS_ORDER_SELECT = `SELECT ${POS_ORDER_COLUMNS},
         s.name AS station_name,
         c.name AS counter_name,
         u.name AS created_by_name,
         (SELECT COUNT(*) FROM pos_order_items poi
           WHERE poi.pos_order_id = po.id AND poi.status = 'ACTIVE') AS item_count
    FROM pos_orders po
    LEFT JOIN stations s ON s.id = po.station_id
    LEFT JOIN counters c ON c.id = po.counter_id
    LEFT JOIN users u ON u.id = po.created_by`;

const POS_ITEM_COLUMNS = `id, pos_order_id, menu_item_id, variant_id, custom_item_name,
    item_name, variant_name, quantity, unit, unit_price, gross_amount, discount_type,
    discount_value, discount_amount, taxable_amount, tax_profile_id, tax_rate, cgst_amount,
    sgst_amount, igst_amount, cess_amount, tax_amount, line_total, allow_decimal_quantity,
    notes, sort_order, status, cancelled_at, cancelled_by, kds_status, cancel_reason,
    acknowledged_at, acknowledged_by, served_at, served_by, created_at, updated_at`;

const POS_PAYMENT_COLUMNS = `id, pos_order_id, method, amount, tendered_amount, change_amount,
    reference, notes, entity_id, is_reversal, received_by, received_at, created_at, updated_at`;

/** A transaction is one settled ticket, however many tenders it was split across. */
const SETTLED_TRANSACTIONS = `COUNT(DISTINCT CASE WHEN po.status = 'COMPLETED' THEN po.id END)`;

/** Lines that were actually sold: live lines on settled tickets, within the range. */
const ANALYTICS_ITEM_CONDITIONS = `po.business_date BETWEEN ? AND ?
          AND po.deleted_at IS NULL
          AND po.status = 'COMPLETED'
          AND poi.status = 'ACTIVE'`;

export interface PosOrderListFilter {
  status?: PosOrderStatus[];
  orderType?: PosOrderType[];
  paymentStatus?: PosPaymentStatus[];
  entityId?: string;
  stationId?: string;
  counterId?: string;
  named?: boolean;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface InsertPosOrderInput {
  id: string;
  orderNumber: string;
  dailySequence: number;
  businessDate: string;
  orderType: PosOrderType;
  status: PosOrderStatus;
  stationId: string | null;
  counterId: string | null;
  menuId: string | null;
  entityId: string | null;
  entityType: string | null;
  entityName: string | null;
  entityPhone: string | null;
  entityAddress: string | null;
  tableLabel: string | null;
  pax: number;
  scheduledFor: string | null;
  notes: string | null;
  discountType: PosDiscountType;
  discountValue: number;
  createdBy: string;
}

/** Every derived amount, computed by the service and written verbatim. */
export interface PosOrderTotals {
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  roundOffAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: PosPaymentStatus;
}

export interface InsertPosOrderItemInput {
  id: string;
  menuItemId: string | null;
  variantId: string | null;
  customItemName: string | null;
  itemName: string;
  variantName: string | null;
  quantity: number;
  unit: string;
  allowDecimalQuantity: boolean;
  unitPrice: number;
  grossAmount: number;
  discountType: PosDiscountType;
  discountValue: number;
  discountAmount: number;
  taxableAmount: number;
  taxProfileId: string | null;
  taxRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  taxAmount: number;
  lineTotal: number;
  notes: string | null;
  sortOrder: number;
}

export interface InsertPosPaymentInput {
  id: string;
  posOrderId: string;
  method: PosPaymentMethod;
  amount: number;
  tenderedAmount: number | null;
  changeAmount: number;
  reference: string | null;
  notes: string | null;
  entityId: string | null;
  isReversal: boolean;
  receivedBy: string | null;
}

/** One sellable configuration, resolved from the Menu Master for pricing a POS line. */
export interface SellableRow extends RowDataPacket {
  menu_item_id: string;
  item_name: string;
  item_unit: string;
  variant_id: string | null;
  variant_name: string | null;
  variant_unit: string | null;
  base_price: string | null;
  variant_price: string | null;
  catalog_price: string | null;
  allow_decimal_quantity: number;
  tax_profile_id: string | null;
  gst_taxability: GstTaxability | null;
  gst_rate: string | null;
  cgst_rate: string | null;
  sgst_rate: string | null;
  igst_rate: string | null;
  cess_rate: string | null;
  price_is_inclusive: number | null;
}

export interface PosDashboardCountRow extends RowDataPacket {
  status: PosOrderStatus;
  order_type: PosOrderType;
  is_named: number;
  total: number;
  total_amount: string;
  balance_amount: string;
}

export interface PosCounterLoadRow extends RowDataPacket {
  counter_id: string;
  code: string | null;
  name: string;
  active_count: number;
  open_amount: string;
}

export interface PosPaymentMethodTotalRow extends RowDataPacket {
  method: PosPaymentMethod;
  total: number;
}

export interface PosSalesTotalsRow extends RowDataPacket {
  net_sales: string;
  gross_sales: string;
  refunded_amount: string;
  transaction_count: number;
}

export interface PosSalesDayRow extends RowDataPacket {
  business_date: string;
  net_sales: string;
  transaction_count: number;
}

export interface PosItemTotalsRow extends RowDataPacket {
  items_sold: string;
  discount_amount: string;
  tax_amount: string;
}

export interface PosTopItemRow extends RowDataPacket {
  menu_item_id: string | null;
  item_name: string;
  variant_name: string | null;
  quantity: string;
  net_amount: string;
}

export interface PosBusyHourRow extends RowDataPacket {
  hour: number;
  transaction_count: number;
  net_sales: string;
}

/** Inclusive business-date window every analytics read is scoped to. */
export interface PosAnalyticsRange {
  dateFrom: string;
  dateTo: string;
}

function buildWhere(filter: PosOrderListFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.includeDeleted !== true) conditions.push('po.deleted_at IS NULL');
  if (filter.status !== undefined && filter.status.length > 0) {
    conditions.push(`po.status IN (${filter.status.map(() => '?').join(', ')})`);
    params.push(...filter.status);
  }
  if (filter.orderType !== undefined && filter.orderType.length > 0) {
    conditions.push(`po.order_type IN (${filter.orderType.map(() => '?').join(', ')})`);
    params.push(...filter.orderType);
  }
  if (filter.paymentStatus !== undefined && filter.paymentStatus.length > 0) {
    conditions.push(`po.payment_status IN (${filter.paymentStatus.map(() => '?').join(', ')})`);
    params.push(...filter.paymentStatus);
  }
  if (filter.entityId !== undefined) {
    conditions.push('po.entity_id = ?');
    params.push(filter.entityId);
  }
  if (filter.stationId !== undefined) {
    conditions.push('po.station_id = ?');
    params.push(filter.stationId);
  }
  if (filter.counterId !== undefined) {
    conditions.push('po.counter_id = ?');
    params.push(filter.counterId);
  }
  if (filter.named !== undefined) {
    // "Named" is a property of the ticket, not of the entity master: a walk-in whose name was
    // typed but never registered still counts, which is why entity_name is part of the test.
    conditions.push(
      filter.named
        ? '(po.entity_id IS NOT NULL OR po.entity_name IS NOT NULL)'
        : '(po.entity_id IS NULL AND po.entity_name IS NULL)',
    );
  }
  if (filter.dateFrom !== undefined) {
    conditions.push('po.business_date >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo !== undefined) {
    conditions.push('po.business_date <= ?');
    params.push(filter.dateTo);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push(
      '(po.order_number LIKE ? OR po.entity_name LIKE ? OR po.entity_phone LIKE ? OR po.table_label LIKE ?)',
    );
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

export class PosRepository {
  async findById(db: Db, id: string): Promise<PosOrderRow | null> {
    return selectOne<PosOrderRow>(
      db,
      `${POS_ORDER_SELECT} WHERE po.id = ? AND po.deleted_at IS NULL`,
      [id],
    );
  }

  async list(
    db: Db,
    filter: PosOrderListFilter,
  ): Promise<{ rows: PosOrderRow[]; total: number }> {
    const { where, params } = buildWhere(filter);
    const rows = await selectRows<PosOrderRow>(
      db,
      `${POS_ORDER_SELECT} ${where}
        ORDER BY po.business_date DESC, po.daily_sequence DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM pos_orders po ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  /**
   * Next bill number for a business date.
   *
   * `FOR UPDATE` on the day's rows is what makes two terminals ringing up simultaneously
   * safe: the second waits rather than reading the same maximum. The unique key on
   * `(business_date, daily_sequence)` is the backstop if that ever fails.
   */
  async nextDailySequence(db: Db, businessDate: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(daily_sequence), 0) AS total
         FROM pos_orders WHERE business_date = ? FOR UPDATE`,
      [businessDate],
    );
    return (row === null ? 0 : Number(row.total)) + 1;
  }

  async insert(db: Db, input: InsertPosOrderInput): Promise<PosOrderRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO pos_orders
        (id, order_number, daily_sequence, business_date, order_type, status, payment_status,
         station_id, counter_id, menu_id, entity_id, entity_type, entity_name, entity_phone,
         entity_address, table_label, pax, scheduled_for, notes, discount_type, discount_value,
         created_by, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.orderNumber,
        input.dailySequence,
        input.businessDate,
        input.orderType,
        input.status,
        input.stationId,
        input.counterId,
        input.menuId,
        input.entityId,
        input.entityType,
        input.entityName,
        input.entityPhone,
        input.entityAddress,
        input.tableLabel,
        input.pax,
        input.scheduledFor,
        input.notes,
        input.discountType,
        input.discountValue,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted POS order ${input.id} could not be read back`);
    return row;
  }

  /** Header fields the counter may edit while a ticket is still open. */
  async updateHeader(
    db: Db,
    id: string,
    input: {
      orderType?: PosOrderType;
      stationId?: string | null;
      counterId?: string | null;
      menuId?: string | null;
      entityId?: string | null;
      entityType?: string | null;
      entityName?: string | null;
      entityPhone?: string | null;
      entityAddress?: string | null;
      tableLabel?: string | null;
      pax?: number;
      scheduledFor?: string | null;
      notes?: string | null;
      discountType?: PosDiscountType;
      discountValue?: number;
    },
    updatedBy: string,
  ): Promise<void> {
    const columns: Record<string, unknown> = {
      order_type: input.orderType,
      station_id: input.stationId,
      counter_id: input.counterId,
      menu_id: input.menuId,
      entity_id: input.entityId,
      entity_type: input.entityType,
      entity_name: input.entityName,
      entity_phone: input.entityPhone,
      entity_address: input.entityAddress,
      table_label: input.tableLabel,
      pax: input.pax,
      scheduled_for: input.scheduledFor,
      notes: input.notes,
      discount_type: input.discountType,
      discount_value: input.discountValue,
    };

    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }
    if (assignments.length === 0) return;

    await mutate(
      db,
      `UPDATE pos_orders
          SET ${assignments.join(', ')}, updated_by = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, updatedBy, toDbDateTime(), id],
    );
  }

  async updateTotals(db: Db, id: string, totals: PosOrderTotals): Promise<void> {
    await mutate(
      db,
      `UPDATE pos_orders
          SET subtotal_amount = ?, discount_amount = ?, tax_amount = ?, round_off_amount = ?,
              total_amount = ?, paid_amount = ?, balance_amount = ?, payment_status = ?,
              updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [
        totals.subtotalAmount,
        totals.discountAmount,
        totals.taxAmount,
        totals.roundOffAmount,
        totals.totalAmount,
        totals.paidAmount,
        totals.balanceAmount,
        totals.paymentStatus,
        toDbDateTime(),
        id,
      ],
    );
  }

  async updateStatus(
    db: Db,
    id: string,
    input: {
      status: PosOrderStatus;
      scheduledFor?: string | null;
      placedAt?: string | null;
      completedAt?: string | null;
      cancelledAt?: string | null;
      cancelReason?: string | null;
      paymentStatus?: PosPaymentStatus;
    },
    updatedBy: string,
  ): Promise<void> {
    const columns: Record<string, unknown> = {
      status: input.status,
      scheduled_for: input.scheduledFor,
      placed_at: input.placedAt,
      completed_at: input.completedAt,
      cancelled_at: input.cancelledAt,
      cancel_reason: input.cancelReason,
      payment_status: input.paymentStatus,
    };

    const assignments: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of Object.entries(columns)) {
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(value);
    }

    await mutate(
      db,
      `UPDATE pos_orders
          SET ${assignments.join(', ')}, updated_by = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, updatedBy, toDbDateTime(), id],
    );
  }

  /* ------------------------------------------------------------------ lines */

  async listItems(db: Db, posOrderId: string): Promise<PosOrderItemRow[]> {
    return selectRows<PosOrderItemRow>(
      db,
      `SELECT ${POS_ITEM_COLUMNS} FROM pos_order_items
        WHERE pos_order_id = ? ORDER BY sort_order ASC, created_at ASC`,
      [posOrderId],
    );
  }

  async listItemsForOrders(db: Db, posOrderIds: string[]): Promise<PosOrderItemRow[]> {
    if (posOrderIds.length === 0) return [];
    return selectRows<PosOrderItemRow>(
      db,
      `SELECT ${POS_ITEM_COLUMNS} FROM pos_order_items
        WHERE pos_order_id IN (${posOrderIds.map(() => '?').join(', ')})
        ORDER BY sort_order ASC, created_at ASC`,
      posOrderIds,
    );
  }

  /**
   * Replaces the whole line set.
   *
   * Deleting and re-inserting rather than diffing is deliberate: a POS ticket is edited by
   * one operator at a time and rarely exceeds a dozen lines, so a diff would add a class of
   * partial-update bug for no measurable gain. Lines already cancelled are preserved, because
   * a cancellation is a record of something that happened, not a line the operator removed.
   */
  async replaceItems(
    db: Db,
    posOrderId: string,
    items: InsertPosOrderItemInput[],
  ): Promise<void> {
    await mutate(db, `DELETE FROM pos_order_items WHERE pos_order_id = ? AND status = 'ACTIVE'`, [
      posOrderId,
    ]);
    if (items.length === 0) return;

    const now = toDbDateTime();
    // Generated rather than hand-typed: a literal run of 28 question marks is impossible to
    // audit by eye, and getting it wrong by one costs a 500 on every save.
    const INSERT_COLUMNS = [
      'id',
      'pos_order_id',
      'menu_item_id',
      'variant_id',
      'custom_item_name',
      'item_name',
      'variant_name',
      'quantity',
      'unit',
      'unit_price',
      'gross_amount',
      'discount_type',
      'discount_value',
      'discount_amount',
      'taxable_amount',
      'tax_profile_id',
      'tax_rate',
      'cgst_amount',
      'sgst_amount',
      'igst_amount',
      'cess_amount',
      'tax_amount',
      'line_total',
      'allow_decimal_quantity',
      'notes',
      'sort_order',
      'created_at',
      'updated_at',
    ] as const;
    const row = `(${INSERT_COLUMNS.map(() => '?').join(', ')}, 'ACTIVE')`;
    const placeholders = items.map(() => row).join(', ');
    const params: unknown[] = [];
    for (const item of items) {
      params.push(
        item.id,
        posOrderId,
        item.menuItemId,
        item.variantId,
        item.customItemName,
        item.itemName,
        item.variantName,
        item.quantity,
        item.unit,
        item.unitPrice,
        item.grossAmount,
        item.discountType,
        item.discountValue,
        item.discountAmount,
        item.taxableAmount,
        item.taxProfileId,
        item.taxRate,
        item.cgstAmount,
        item.sgstAmount,
        item.igstAmount,
        item.cessAmount,
        item.taxAmount,
        item.lineTotal,
        item.allowDecimalQuantity ? 1 : 0,
        item.notes,
        item.sortOrder,
        now,
        now,
      );
    }

    await mutate(
      db,
      `INSERT INTO pos_order_items (${INSERT_COLUMNS.join(', ')}, status)
       VALUES ${placeholders}`,
      params,
    );
  }

  async cancelItems(db: Db, posOrderId: string, cancelledBy: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE pos_order_items
          SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, updated_at = ?
        WHERE pos_order_id = ? AND status = 'ACTIVE'`,
      [now, cancelledBy, now, posOrderId],
    );
  }

  /* --------------------------------------------------------------- payments */

  async listPayments(db: Db, posOrderId: string): Promise<PosPaymentRow[]> {
    return selectRows<PosPaymentRow>(
      db,
      `SELECT ${POS_PAYMENT_COLUMNS} FROM pos_payments
        WHERE pos_order_id = ? ORDER BY received_at ASC`,
      [posOrderId],
    );
  }

  async insertPayments(db: Db, payments: InsertPosPaymentInput[]): Promise<void> {
    if (payments.length === 0) return;
    const now = toDbDateTime();
    const placeholders = payments.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const payment of payments) {
      params.push(
        payment.id,
        payment.posOrderId,
        payment.method,
        payment.amount,
        payment.tenderedAmount,
        payment.changeAmount,
        payment.reference,
        payment.notes,
        payment.entityId,
        payment.isReversal ? 1 : 0,
        payment.receivedBy,
        now,
        now,
        now,
      );
    }
    await mutate(
      db,
      `INSERT INTO pos_payments
        (id, pos_order_id, method, amount, tendered_amount, change_amount, reference, notes,
         entity_id, is_reversal, received_by, received_at, created_at, updated_at)
       VALUES ${placeholders}`,
      params,
    );
  }

  /* -------------------------------------------------------------- dashboard */

  /**
   * One grouped pass over the day, rather than a query per tile. The service pivots the rows
   * into the summary; doing that in SQL would need a dozen conditional aggregates that are
   * harder to read than the pivot.
   */
  async dashboardCounts(
    db: Db,
    businessDate: string,
    scope: { stationId?: string; counterId?: string },
  ): Promise<PosDashboardCountRow[]> {
    const conditions = ['po.deleted_at IS NULL'];
    const params: unknown[] = [];

    // Active tickets carry over: a draft parked yesterday is still a draft this morning, so
    // only the settled statuses are pinned to the business date.
    conditions.push(
      `(po.status IN ('DRAFT','SCHEDULED','OPEN') OR po.business_date = ?)`,
    );
    params.push(businessDate);

    if (scope.stationId !== undefined) {
      conditions.push('po.station_id = ?');
      params.push(scope.stationId);
    }
    if (scope.counterId !== undefined) {
      conditions.push('po.counter_id = ?');
      params.push(scope.counterId);
    }

    return selectRows<PosDashboardCountRow>(
      db,
      `SELECT po.status,
              po.order_type,
              CASE WHEN po.entity_id IS NOT NULL OR po.entity_name IS NOT NULL THEN 1 ELSE 0 END
                AS is_named,
              COUNT(*) AS total,
              COALESCE(SUM(po.total_amount), 0) AS total_amount,
              COALESCE(SUM(po.balance_amount), 0) AS balance_amount
         FROM pos_orders po
        WHERE ${conditions.join(' AND ')}
        GROUP BY po.status, po.order_type, is_named`,
      params,
    );
  }

  /**
   * How much work is sitting on each service counter right now.
   *
   * Every ACTIVE counter is returned, including the idle ones — a counter with nothing on it
   * is exactly the information someone rebalancing the floor is looking for, and leaving it
   * out of the result would silently hide it from the load summary.
   */
  async counterLoad(
    db: Db,
    scope: { stationId?: string; counterId?: string },
  ): Promise<PosCounterLoadRow[]> {
    const conditions = [
      'po.deleted_at IS NULL',
      `po.status IN ('DRAFT','SCHEDULED','OPEN')`,
      'po.counter_id = c.id',
    ];
    const params: unknown[] = [];

    if (scope.stationId !== undefined) {
      conditions.push('po.station_id = ?');
      params.push(scope.stationId);
    }
    if (scope.counterId !== undefined) {
      conditions.push('po.counter_id = ?');
      params.push(scope.counterId);
    }

    return selectRows<PosCounterLoadRow>(
      db,
      `SELECT c.id   AS counter_id,
              c.code AS code,
              c.name AS name,
              COUNT(po.id) AS active_count,
              COALESCE(SUM(po.balance_amount), 0) AS open_amount
         FROM counters c
         LEFT JOIN pos_orders po ON ${conditions.join(' AND ')}
        WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'
        GROUP BY c.id, c.code, c.name
        ORDER BY c.sort_order ASC, c.name ASC`,
      params,
    );
  }

  /** Net cash taken today: completed sales less anything reversed. */
  async salesTotalForDate(db: Db, businessDate: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(SUM(p.amount), 0) AS total
         FROM pos_payments p
         JOIN pos_orders po ON po.id = p.pos_order_id
        WHERE po.business_date = ? AND po.deleted_at IS NULL`,
      [businessDate],
    );
    return row === null ? 0 : Number(row.total);
  }

  /** Money taken today grouped by payment method. */
  async salesByPaymentMethodForDate(
    db: Db,
    businessDate: string,
  ): Promise<Partial<Record<PosPaymentMethod, number>>> {
    const rows = await selectRows<PosPaymentMethodTotalRow>(
      db,
      `SELECT p.method, COALESCE(SUM(p.amount), 0) AS total
         FROM pos_payments p
         JOIN pos_orders po ON po.id = p.pos_order_id
        WHERE po.business_date = ? AND po.deleted_at IS NULL
        GROUP BY p.method`,
      [businessDate],
    );
    const result: Partial<Record<PosPaymentMethod, number>> = {};
    for (const row of rows) {
      result[row.method] = Number(row.total);
    }
    return result;
  }

  /* -------------------------------------------------------------- analytics */

  /**
   * Takings over a range, in one pass over the payment ledger.
   *
   * A void does not delete anything: it appends a negative row against the original, so a
   * plain `SUM(amount)` is already net and the two halves only have to be split back out by
   * `is_reversal`. That is also why the money side is not restricted to COMPLETED tickets —
   * a voided sale is CANCELLED, and excluding it would hide the very refund being measured.
   * The count is: a transaction is a settled ticket, and one bill split across cash and card
   * is still one of them.
   */
  async salesTotals(db: Db, range: PosAnalyticsRange): Promise<PosSalesTotalsRow | null> {
    return selectOne<PosSalesTotalsRow>(
      db,
      `SELECT COALESCE(SUM(p.amount), 0) AS net_sales,
              COALESCE(SUM(CASE WHEN p.is_reversal = 0 THEN p.amount ELSE 0 END), 0) AS gross_sales,
              -COALESCE(SUM(CASE WHEN p.is_reversal = 1 THEN p.amount ELSE 0 END), 0)
                AS refunded_amount,
              ${SETTLED_TRANSACTIONS} AS transaction_count
         FROM pos_payments p
         JOIN pos_orders po ON po.id = p.pos_order_id
        WHERE po.business_date BETWEEN ? AND ? AND po.deleted_at IS NULL`,
      [range.dateFrom, range.dateTo],
    );
  }

  /** The same figures broken down per business date, for the sparkline. */
  async salesByDay(db: Db, range: PosAnalyticsRange): Promise<PosSalesDayRow[]> {
    return selectRows<PosSalesDayRow>(
      db,
      `SELECT po.business_date AS business_date,
              COALESCE(SUM(p.amount), 0) AS net_sales,
              ${SETTLED_TRANSACTIONS} AS transaction_count
         FROM pos_payments p
         JOIN pos_orders po ON po.id = p.pos_order_id
        WHERE po.business_date BETWEEN ? AND ? AND po.deleted_at IS NULL
        GROUP BY po.business_date
        ORDER BY po.business_date ASC`,
      [range.dateFrom, range.dateTo],
    );
  }

  /** What was actually sold, from the lines rather than the ledger. */
  async itemTotals(db: Db, range: PosAnalyticsRange): Promise<PosItemTotalsRow | null> {
    return selectOne<PosItemTotalsRow>(
      db,
      `SELECT COALESCE(SUM(poi.quantity), 0) AS items_sold,
              COALESCE(SUM(poi.discount_amount), 0) AS discount_amount,
              COALESCE(SUM(poi.tax_amount), 0) AS tax_amount
         FROM pos_order_items poi
         JOIN pos_orders po ON po.id = poi.pos_order_id
        WHERE ${ANALYTICS_ITEM_CONDITIONS}`,
      [range.dateFrom, range.dateTo],
    );
  }

  /**
   * The best sellers of the range by revenue.
   *
   * Grouping carries `menu_item_id` alongside the names so an off-menu line — which has no
   * catalogue id at all — still collapses with the other lines someone typed the same name
   * for, instead of merging every custom line in the range into one row.
   */
  async topItems(db: Db, range: PosAnalyticsRange, limit: number): Promise<PosTopItemRow[]> {
    return selectRows<PosTopItemRow>(
      db,
      `SELECT poi.menu_item_id AS menu_item_id,
              poi.item_name    AS item_name,
              poi.variant_name AS variant_name,
              COALESCE(SUM(poi.quantity), 0) AS quantity,
              COALESCE(SUM(poi.line_total), 0) AS net_amount
         FROM pos_order_items poi
         JOIN pos_orders po ON po.id = poi.pos_order_id
        WHERE ${ANALYTICS_ITEM_CONDITIONS}
        GROUP BY poi.menu_item_id, poi.item_name, poi.variant_name
        ORDER BY net_amount DESC
        LIMIT ?`,
      [range.dateFrom, range.dateTo, limit],
    );
  }

  /**
   * When the tickets were rung up, by hour of the day.
   *
   * Keyed on `placed_at` rather than on the payment: the question the graph answers is when
   * the counter was busy, and that is when the order was taken.
   */
  async busyHours(db: Db, range: PosAnalyticsRange): Promise<PosBusyHourRow[]> {
    return selectRows<PosBusyHourRow>(
      db,
      `SELECT HOUR(po.placed_at) AS hour,
              COUNT(*) AS transaction_count,
              COALESCE(SUM(po.total_amount), 0) AS net_sales
         FROM pos_orders po
        WHERE po.business_date BETWEEN ? AND ?
          AND po.deleted_at IS NULL
          AND po.status = 'COMPLETED'
          AND po.placed_at IS NOT NULL
        GROUP BY HOUR(po.placed_at)
        ORDER BY hour ASC`,
      [range.dateFrom, range.dateTo],
    );
  }

  /* -------------------------------------------------------- catalogue reads */

  /**
   * Resolves the sellable configuration behind a POS line: its display name, its effective
   * price and the tax treatment in force.
   *
   * Price precedence matches the Menu Master's own: a per-menu catalogue price beats the
   * variant's list price, which beats the food item's base price. Tax precedence is the
   * variant's profile, falling back to the food item's — the inheritance rule 021 established.
   */
  async resolveSellable(
    db: Db,
    input: { menuItemId: string; variantId: string | null; menuId: string | null },
  ): Promise<SellableRow | null> {
    return selectOne<SellableRow>(
      db,
      `SELECT mi.id            AS menu_item_id,
              mi.name          AS item_name,
              mi.unit          AS item_unit,
              v.id             AS variant_id,
              v.name           AS variant_name,
              v.unit           AS variant_unit,
              v.allow_decimal_quantity AS allow_decimal_quantity,
              mi.base_price    AS base_price,
              v.price          AS variant_price,
              cp.price         AS catalog_price,
              tp.id            AS tax_profile_id,
              tp.gst_taxability, tp.gst_rate, tp.cgst_rate, tp.sgst_rate, tp.igst_rate,
              tp.cess_rate, tp.price_is_inclusive
         FROM menu_items mi
         LEFT JOIN menu_item_variants v
                ON v.id = ? AND v.food_item_id = mi.id AND v.deleted_at IS NULL
         LEFT JOIN menu_item_variant_catalog_prices cp
                ON cp.variant_id = v.id AND cp.menu_id = ? AND cp.status = 'ACTIVE'
               AND cp.deleted_at IS NULL
         LEFT JOIN tax_profiles tp
                ON tp.id = COALESCE(v.tax_profile_id, mi.tax_profile_id)
               AND tp.deleted_at IS NULL
        WHERE mi.id = ? AND mi.deleted_at IS NULL`,
      [input.variantId, input.menuId, input.menuItemId],
    );
  }
}

export const posRepository = new PosRepository();
