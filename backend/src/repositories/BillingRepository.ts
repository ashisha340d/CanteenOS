import type { BillingSnapshot, BillingStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import type { BillingExportRow, CountRow, OrderRow } from '../models/rows';
import { parseJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

export interface InsertBillingExportInput {
  id: string;
  boardId: string | null;
  periodFrom: string;
  periodTo: string;
  billingVersion: number;
  totalOrders: number;
  totalPax: number;
  snapshot: BillingSnapshot;
  checksum: string;
  notes: string | null;
  generatedBy: string;
}

export interface BillingListFilter {
  boardId?: string;
  status?: BillingStatus;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

/** Row shape for the snapshot query: one order joined to its display names. */
export interface BillingSourceOrderRow extends OrderRow {
  board_name: string;
  activity_name: string | null;
  created_by_name: string;
}

export interface BillingSourceItemRow extends RowDataPacket {
  order_id: string;
  /** Null on an ad-hoc line; `item_name` then carries the typed dish name. */
  menu_item_id: string | null;
  category_name: string;
  item_name: string;
  quantity: string;
  unit: string;
  notes: string | null;
}

/** Category shown on an invoice for lines typed on the spot, which have no master category. */
export const AD_HOC_CATEGORY_NAME = 'Custom items';

const LIST_COLUMNS = `
  be.id, be.board_id, be.period_from, be.period_to, be.billing_version, be.status,
  be.total_orders, be.total_pax, be.checksum, be.notes, be.generated_by, be.generated_at`;

/**
 * Billing is Admin-only and one-way. This repository can insert a snapshot and change an
 * export's status, but there is no method to rewrite `snapshot` — an immutable record is
 * the entire point.
 */
export class BillingRepository {
  async findById(db: Db, id: string): Promise<BillingExportRow | null> {
    return selectOne<BillingExportRow>(
      db,
      `SELECT ${LIST_COLUMNS}, be.snapshot FROM billing_exports be WHERE be.id = ?`,
      [id],
    );
  }

  async findSnapshot(db: Db, id: string): Promise<BillingSnapshot | null> {
    const row = await selectOne<BillingExportRow>(
      db,
      'SELECT snapshot FROM billing_exports WHERE id = ?',
      [id],
    );
    if (row === null) return null;
    return parseJsonColumn<BillingSnapshot | null>(row.snapshot, null);
  }

  async list(
    db: Db,
    filter: BillingListFilter,
  ): Promise<{ rows: BillingExportRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.boardId !== undefined) {
      conditions.push('be.board_id = ?');
      params.push(filter.boardId);
    }
    if (filter.status !== undefined) {
      conditions.push('be.status = ?');
      params.push(filter.status);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('be.period_to >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('be.period_from <= ?');
      params.push(filter.dateTo);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await selectRows<BillingExportRow>(
      db,
      `SELECT ${LIST_COLUMNS}, u.name AS generated_by_name
         FROM billing_exports be
        INNER JOIN users u ON u.id = be.generated_by
        ${where}
        ORDER BY be.generated_at DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );

    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM billing_exports be ${where}`,
      params,
    );

    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  /**
   * Next version number for a board/period. Regenerating the same period produces version
   * 2, 3, … rather than replacing the earlier snapshot.
   */
  async nextVersion(
    db: Db,
    boardId: string | null,
    periodFrom: string,
    periodTo: string,
  ): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(billing_version), 0) AS total
         FROM billing_exports
        WHERE period_from = ? AND period_to = ?
          AND ((board_id IS NULL AND ? IS NULL) OR board_id = ?)`,
      [periodFrom, periodTo, boardId, boardId],
    );
    return (row === null ? 0 : Number(row.total)) + 1;
  }

  async insert(db: Db, input: InsertBillingExportInput): Promise<BillingExportRow> {
    await mutate(
      db,
      `INSERT INTO billing_exports
        (id, board_id, period_from, period_to, billing_version, status, total_orders, total_pax,
         snapshot, checksum, notes, generated_by, generated_at)
       VALUES (?, ?, ?, ?, ?, 'GENERATED', ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.boardId,
        input.periodFrom,
        input.periodTo,
        input.billingVersion,
        input.totalOrders,
        input.totalPax,
        JSON.stringify(input.snapshot),
        input.checksum,
        input.notes,
        input.generatedBy,
        toDbDateTime(),
      ],
    );

    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted billing export could not be read back');
    return row;
  }

  async updateStatus(db: Db, id: string, status: BillingStatus): Promise<boolean> {
    const result = await mutate(db, 'UPDATE billing_exports SET status = ? WHERE id = ?', [
      status,
      id,
    ]);
    return result.affectedRows > 0;
  }

  /* --------------------------------------------------- snapshot source queries */

  /**
   * The orders that will be frozen into a snapshot. Billing follows finished work, so only
   * DELIVERED and DONE qualify; an order already tied to an earlier export is skipped so a
   * regenerated period cannot bill the same order twice.
   */
  async findSnapshotOrders(
    db: Db,
    boardId: string | null,
    periodFrom: string,
    periodTo: string,
  ): Promise<BillingSourceOrderRow[]> {
    const conditions = [
      "o.status IN ('DELIVERED','DONE')",
      'o.billed_at IS NULL',
      'o.deleted_at IS NULL',
      'o.required_date >= ?',
      'o.required_date <= ?',
    ];
    const params: unknown[] = [periodFrom, periodTo];

    if (boardId !== null) {
      conditions.push('o.board_id = ?');
      params.push(boardId);
    }

    return selectRows<BillingSourceOrderRow>(
      db,
      `SELECT o.id, o.order_number, o.board_id, o.activity_type_id,
              o.custom_activity, o.venue, o.pax, o.required_date, o.required_time,
              o.priority, o.status, o.completed_at, o.completed_by, o.created_by,
              o.created_at, o.updated_at, o.deleted_at, o.revision, o.sync_seq,
              b.name AS board_name,
              COALESCE(at.name, o.custom_activity) AS activity_name,
              cu.name AS created_by_name
         FROM orders o
        INNER JOIN boards b ON b.id = o.board_id
         LEFT JOIN activity_types at ON at.id = o.activity_type_id
        INNER JOIN users cu ON cu.id = o.created_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY o.required_date ASC, o.required_time ASC, o.order_number ASC`,
      params,
    );
  }

  async findSnapshotItems(
    db: Db,
    orderIds: readonly string[],
  ): Promise<BillingSourceItemRow[]> {
    if (orderIds.length === 0) return [];
    const placeholders = orderIds.map(() => '?').join(', ');
    // LEFT JOIN, not INNER: an ad-hoc line has no `menu_items` row, and dropping it would
    // understate the invoice. Such a line bills under its typed name in a synthetic category.
    return selectRows<BillingSourceItemRow>(
      db,
      `SELECT oi.order_id, oi.menu_item_id, oi.quantity, oi.unit, oi.notes,
              COALESCE(mi.name, oi.custom_item_name) AS item_name,
              COALESCE(mc.name, ?) AS category_name
         FROM order_items oi
         LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
         LEFT JOIN menu_categories mc ON mc.id = mi.category_id
        WHERE oi.order_id IN (${placeholders}) AND oi.deleted_at IS NULL
        ORDER BY oi.order_id ASC, oi.sort_order ASC`,
      [AD_HOC_CATEGORY_NAME, ...orderIds],
    );
  }
}

export const billingRepository = new BillingRepository();
