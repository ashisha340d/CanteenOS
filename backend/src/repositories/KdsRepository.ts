import type {
  AvailabilityStatus,
  PosKdsLineStatus,
  PosOrderItemStatus,
  PosOrderStatus,
  PosOrderType,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow } from '../models/rows';
import type { InsertPosOrderItemInput } from './PosRepository';
import type { RowDataPacket } from 'mysql2/promise';
import { toDbDateTime, todayIsoDate } from '../utils/time';

/**
 * Persistence for the kitchen and customer displays: the routed queue views, the line-level
 * kitchen flow mutations, and the one read the customer display needs. All of it is a
 * projection over the POS tables (022) plus the routing tables — nothing here owns data of
 * its own, which is why there is no KDS table in the schema.
 *
 * Routing rule, in one place because every query shares it: a line belongs to a counter when
 * its menu item has an ACTIVE MENU_ITEM counter route to it, or — only when the item carries
 * no counter route at all — when the order itself sits at that counter. The kitchen scope is
 * the line's resolved printing group (first ACTIVE MENU_ITEM printing route by sort order).
 */

const PRINTING_GROUP_JOIN = `
  LEFT JOIN printing_groups pg ON pg.id = (
    SELECT pr.printing_group_id FROM printing_routes pr
     WHERE pr.entity_type = 'MENU_ITEM' AND pr.entity_id = poi.menu_item_id
       AND pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
     ORDER BY pr.sort_order ASC, pr.created_at ASC
     LIMIT 1)`;

/**
 * A line leaves the board only when the KDS serves it — the bill's own state is irrelevant.
 * DRAFT is a ticket still being typed and CANCELLED is dead; everything else (placed,
 * scheduled, already paid) keeps its unserved lines on the board until serve.
 */
const BOARD_ORDER_STATUSES = `po.status IN ('OPEN','SCHEDULED','COMPLETED')`;

/**
 * The routing rule for one line and one counter, as a SQL fragment over `poi` and `po`.
 * Takes the counter id twice: once for the explicit route, once for the fallback.
 *
 * A line belongs to a counter when its menu item is explicitly routed there, or — only when
 * the item carries no counter route at all — when the order itself was rung up at that
 * counter. An item routed to Counter 2 therefore never appears on Counter 1, whichever till
 * sold it, which is exactly what "this counter's own menu" means.
 */
function counterScope(itemAlias: string, orderAlias: string): string {
  return `(
    EXISTS (
      SELECT 1 FROM counter_routes cr
       WHERE cr.entity_type = 'MENU_ITEM' AND cr.entity_id = ${itemAlias}.menu_item_id
         AND cr.counter_id = ? AND cr.status = 'ACTIVE' AND cr.deleted_at IS NULL)
    OR (${orderAlias}.counter_id = ? AND NOT EXISTS (
      SELECT 1 FROM counter_routes crn
       WHERE crn.entity_type = 'MENU_ITEM' AND crn.entity_id = ${itemAlias}.menu_item_id
         AND crn.status = 'ACTIVE' AND crn.deleted_at IS NULL))
  )`;
}

const COUNTER_SCOPE = counterScope('poi', 'po');

/**
 * Served rows ride along only while *this counter* still has open work on the order — the card
 * shows each line's served/unserved state until the counter is done with it. Once this
 * counter's last line is served the whole card leaves the payload, even if another counter is
 * still working the same ticket. Takes the counter id twice, like COUNTER_SCOPE.
 */
const COUNTER_HAS_OPEN_LINES = `EXISTS (
    SELECT 1 FROM pos_order_items open_line
     WHERE open_line.pos_order_id = po.id AND open_line.status = 'ACTIVE'
       AND open_line.kds_status <> 'SERVED'
       AND ${counterScope('open_line', 'po')}
  )`;

/** The kitchen equivalent: the group still has unserved lines on this order. */
const GROUP_HAS_OPEN_LINES = `EXISTS (
    SELECT 1 FROM pos_order_items open_line
     WHERE open_line.pos_order_id = po.id AND open_line.status = 'ACTIVE'
       AND open_line.kds_status <> 'SERVED'
       AND (
         SELECT pr.printing_group_id FROM printing_routes pr
          WHERE pr.entity_type = 'MENU_ITEM' AND pr.entity_id = open_line.menu_item_id
            AND pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
          ORDER BY pr.sort_order ASC, pr.created_at ASC
          LIMIT 1) = ?
  )`;

const QUEUE_SELECT = `SELECT po.id AS order_id, po.order_number, po.daily_sequence,
       po.business_date, po.order_type, po.counter_id, c.name AS counter_name,
       po.entity_name, po.placed_at, po.created_at AS order_created_at, po.notes AS order_notes,
       poi.id AS line_id, poi.menu_item_id, poi.item_name, poi.variant_name, poi.custom_item_name, poi.quantity,
       poi.notes AS line_notes, poi.line_total, poi.kds_status, poi.acknowledged_at, poi.served_at,
       su.name AS served_by_name, pg.id AS printing_group_id, pg.name AS printing_group_name,
       mi.prep_seconds, mi.name_hi AS item_name_hi
  FROM pos_orders po
  JOIN pos_order_items poi ON poi.pos_order_id = po.id
  LEFT JOIN counters c ON c.id = po.counter_id
  LEFT JOIN users su ON su.id = poi.served_by
  LEFT JOIN menu_items mi ON mi.id = poi.menu_item_id
  ${PRINTING_GROUP_JOIN}`;

const QUEUE_ORDER = `ORDER BY COALESCE(po.placed_at, po.created_at) ASC, po.id ASC,
       poi.sort_order ASC, poi.created_at ASC`;

export interface KdsQueueRow extends RowDataPacket {
  order_id: string;
  order_number: string;
  daily_sequence: number;
  business_date: string;
  order_type: PosOrderType;
  counter_id: string | null;
  counter_name: string | null;
  entity_name: string | null;
  placed_at: string | null;
  order_created_at: string;
  order_notes: string | null;
  line_id: string;
  menu_item_id: string | null;
  item_name: string;
  variant_name: string | null;
  custom_item_name: string | null;
  quantity: string;
  line_notes: string | null;
  line_total: string;
  kds_status: PosKdsLineStatus;
  acknowledged_at: string | null;
  served_at: string | null;
  served_by_name: string | null;
  printing_group_id: string | null;
  printing_group_name: string | null;
  prep_seconds: number | null;
  /** Null for an ad-hoc line — `poi.menu_item_id` is null, so the join finds nothing. */
  item_name_hi: string | null;
}

export interface KdsLineRow extends RowDataPacket {
  line_id: string;
  order_id: string;
  line_status: PosOrderItemStatus;
  kds_status: PosKdsLineStatus;
  menu_item_id: string | null;
  order_status: PosOrderStatus;
  order_counter_id: string | null;
}

export interface KdsRecentActionRow extends RowDataPacket {
  line_id: string;
  order_id: string;
  order_number: string;
  item_name: string;
  /** Null for an ad-hoc line, whose `menu_item_id` is null. */
  item_name_hi: string | null;
  variant_name: string | null;
  quantity: string;
  served_at: string;
  served_by_name: string | null;
}

export interface KdsPendingRow extends RowDataPacket {
  pending_lines: number;
  pending_orders: number;
}

export interface KdsServedTodayRow extends RowDataPacket {
  served_lines: number;
  served_orders: number;
  avg_serve_seconds: string | null;
}

export interface KdsStationRow extends RowDataPacket {
  id: string;
  name: string;
  code: string | null;
}

export interface KdsStationOverrideRow extends RowDataPacket {
  menu_item_id: string;
  display_name: string | null;
  is_finished: number;
}

export interface KdsItemStockRow extends RowDataPacket {
  menu_item_id: string;
  opening_qty: string;
  registered_at: string;
}

export interface KdsStationMenuRow extends RowDataPacket {
  food_item_id: string;
  name: string;
  name_hi: string | null;
  category_name: string;
  availability: AvailabilityStatus;
  base_price: string | null;
  item_media_id: string | null;
  food_media_id: string | null;
  menu_sort_order: number;
}

export interface CdsOrderRow extends RowDataPacket {
  id: string;
  order_number: string;
  status: PosOrderStatus;
  completed_at: string | null;
  counter_name: string | null;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  round_off_amount: string;
  total_amount: string;
  updated_at: string;
}

interface ScopeRow extends RowDataPacket {
  id: string;
}

export class KdsRepository {
  /* ------------------------------------------------------------------ queues */

  /**
   * The board is today's work only: a line from an older business date is stale backlog, not
   * something today's counter can still hand over.
   */
  async listCounterQueue(db: Db, counterId: string): Promise<KdsQueueRow[]> {
    return selectRows<KdsQueueRow>(
      db,
      `${QUEUE_SELECT}
        WHERE po.deleted_at IS NULL AND ${BOARD_ORDER_STATUSES} AND poi.status = 'ACTIVE'
          AND (poi.kds_status <> 'SERVED' OR ${COUNTER_HAS_OPEN_LINES})
          AND po.business_date = ?
          AND ${COUNTER_SCOPE}
        ${QUEUE_ORDER}`,
      [counterId, counterId, todayIsoDate(), counterId, counterId],
    );
  }

  async listKitchenQueue(db: Db, printingGroupId: string): Promise<KdsQueueRow[]> {
    return selectRows<KdsQueueRow>(
      db,
      `${QUEUE_SELECT}
        WHERE po.deleted_at IS NULL AND ${BOARD_ORDER_STATUSES} AND poi.status = 'ACTIVE'
          AND (poi.kds_status <> 'SERVED' OR ${GROUP_HAS_OPEN_LINES})
          AND po.business_date = ?
          AND pg.id = ?
        ${QUEUE_ORDER}`,
      [printingGroupId, todayIsoDate(), printingGroupId],
    );
  }

  /* -------------------------------------------------------------- line flow */

  async findLine(db: Db, lineId: string): Promise<KdsLineRow | null> {
    return selectOne<KdsLineRow>(
      db,
      `SELECT poi.id AS line_id, poi.pos_order_id AS order_id, poi.status AS line_status,
              poi.kds_status, poi.menu_item_id, po.status AS order_status,
              po.counter_id AS order_counter_id
         FROM pos_order_items poi
         JOIN pos_orders po ON po.id = poi.pos_order_id
        WHERE poi.id = ? AND po.deleted_at IS NULL`,
      [lineId],
    );
  }

  async markAcknowledged(db: Db, lineId: string, userId: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE pos_order_items
          SET kds_status = 'ACKNOWLEDGED', acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
        WHERE id = ? AND status = 'ACTIVE' AND kds_status = 'QUEUED'`,
      [now, userId, now, lineId],
    );
  }

  async markServed(db: Db, lineIds: readonly string[], userId: string): Promise<void> {
    if (lineIds.length === 0) return;
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE pos_order_items
          SET kds_status = 'SERVED', served_at = ?, served_by = ?, updated_at = ?
        WHERE id IN (${lineIds.map(() => '?').join(', ')})
          AND status = 'ACTIVE' AND kds_status IN ('QUEUED','ACKNOWLEDGED')`,
      [now, userId, now, ...lineIds],
    );
  }

  async markReverted(db: Db, lineId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE pos_order_items
          SET kds_status = 'ACKNOWLEDGED', served_at = NULL, served_by = NULL, updated_at = ?
        WHERE id = ? AND status = 'ACTIVE' AND kds_status = 'SERVED'`,
      [toDbDateTime(), lineId],
    );
  }

  /** Lines of one order that a counter may still serve, in ticket order. */
  async listServeableLines(db: Db, orderId: string, counterId: string): Promise<ScopeRow[]> {
    return selectRows<ScopeRow>(
      db,
      `SELECT poi.id AS id
         FROM pos_orders po
         JOIN pos_order_items poi ON poi.pos_order_id = po.id
        WHERE po.id = ? AND po.deleted_at IS NULL
          AND poi.status = 'ACTIVE' AND poi.kds_status IN ('QUEUED','ACKNOWLEDGED')
          AND ${COUNTER_SCOPE}
        ORDER BY poi.sort_order ASC, poi.created_at ASC`,
      [orderId, counterId, counterId],
    );
  }

  /**
   * The undo list: a counter's most recent serves, newest first. Also the revert guard's
   * source of truth — a served line may come back only while it is still on this list.
   */
  async listRecentServed(db: Db, counterId: string, limit: number): Promise<KdsRecentActionRow[]> {
    return selectRows<KdsRecentActionRow>(
      db,
      `SELECT poi.id AS line_id, po.id AS order_id, po.order_number, poi.item_name,
              mi.name_hi AS item_name_hi,
              poi.variant_name, poi.quantity, poi.served_at, su.name AS served_by_name
         FROM pos_orders po
         JOIN pos_order_items poi ON poi.pos_order_id = po.id
         LEFT JOIN users su ON su.id = poi.served_by
         LEFT JOIN menu_items mi ON mi.id = poi.menu_item_id
        WHERE po.deleted_at IS NULL
          AND poi.status = 'ACTIVE'
          AND poi.kds_status = 'SERVED'
          AND poi.served_at IS NOT NULL
          AND ${COUNTER_SCOPE}
        ORDER BY poi.served_at DESC, poi.id DESC
        LIMIT ?`,
      [counterId, counterId, limit],
    );
  }

  /* ----------------------------------------------------------------- metrics */

  async pendingCounts(db: Db, counterId: string): Promise<KdsPendingRow | null> {
    return selectOne<KdsPendingRow>(
      db,
      `SELECT COUNT(*) AS pending_lines, COUNT(DISTINCT po.id) AS pending_orders
         FROM pos_orders po
         JOIN pos_order_items poi ON poi.pos_order_id = po.id
        WHERE po.deleted_at IS NULL AND ${BOARD_ORDER_STATUSES} AND poi.status = 'ACTIVE'
          AND poi.kds_status IN ('QUEUED','ACKNOWLEDGED')
          AND po.business_date = ?
          AND ${COUNTER_SCOPE}`,
      [todayIsoDate(), counterId, counterId],
    );
  }

  async servedTodayCounts(db: Db, counterId: string, businessDate: string): Promise<KdsServedTodayRow | null> {
    return selectOne<KdsServedTodayRow>(
      db,
      `SELECT COUNT(*) AS served_lines, COUNT(DISTINCT po.id) AS served_orders,
              AVG(TIMESTAMPDIFF(SECOND, po.created_at, poi.served_at)) AS avg_serve_seconds
         FROM pos_orders po
         JOIN pos_order_items poi ON poi.pos_order_id = po.id
        WHERE po.deleted_at IS NULL AND po.business_date = ?
          AND poi.kds_status = 'SERVED' AND poi.served_at IS NOT NULL
          AND ${COUNTER_SCOPE}`,
      [businessDate, counterId, counterId],
    );
  }

  /**
   * `defaultPrepSeconds` is inlined as a literal, not bound: it comes from server-side
   * settings (never the request), and a placeholder inside INTERVAL is not portable.
   */
  async overdueCount(db: Db, counterId: string, defaultPrepSeconds: number): Promise<number> {
    const fallback = Math.max(0, Math.trunc(defaultPrepSeconds));
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total
         FROM pos_orders po
         JOIN pos_order_items poi ON poi.pos_order_id = po.id
         LEFT JOIN menu_items mi ON mi.id = poi.menu_item_id
        WHERE po.deleted_at IS NULL AND ${BOARD_ORDER_STATUSES} AND poi.status = 'ACTIVE'
          AND poi.kds_status <> 'SERVED'
          AND po.business_date = ?
          AND UTC_TIMESTAMP() > DATE_ADD(po.created_at, INTERVAL COALESCE(mi.prep_seconds, ${fallback}) SECOND)
          AND ${COUNTER_SCOPE}`,
      [todayIsoDate(), counterId, counterId],
    );
    return row === null ? 0 : Number(row.total);
  }

  /* ----------------------------------------------------------------- exchange */

  /** Cancels the given ACTIVE lines. Returns how many were actually cancelled. */
  async cancelLines(
    db: Db,
    orderId: string,
    lineIds: readonly string[],
    reason: string,
    userId: string,
  ): Promise<number> {
    if (lineIds.length === 0) return 0;
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE pos_order_items
          SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?
        WHERE pos_order_id = ? AND status = 'ACTIVE'
          AND id IN (${lineIds.map(() => '?').join(', ')})`,
      [now, userId, reason, now, orderId, ...lineIds],
    );
    return result.affectedRows;
  }

  /** FOR UPDATE: the exchange inserts after this maximum, so concurrent line edits serialise. */
  async maxLineSortOrder(db: Db, orderId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(sort_order), -1) AS total
         FROM pos_order_items WHERE pos_order_id = ? FOR UPDATE`,
      [orderId],
    );
    return row === null ? -1 : Number(row.total);
  }

  /** Additive counterpart to PosRepository.replaceItems — an exchange keeps every old line. */
  async insertLines(db: Db, orderId: string, lines: readonly InsertPosOrderItemInput[]): Promise<void> {
    if (lines.length === 0) return;

    const now = toDbDateTime();
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
    const params: unknown[] = [];
    for (const line of lines) {
      params.push(
        line.id,
        orderId,
        line.menuItemId,
        line.variantId,
        line.customItemName,
        line.itemName,
        line.variantName,
        line.quantity,
        line.unit,
        line.unitPrice,
        line.grossAmount,
        line.discountType,
        line.discountValue,
        line.discountAmount,
        line.taxableAmount,
        line.taxProfileId,
        line.taxRate,
        line.cgstAmount,
        line.sgstAmount,
        line.igstAmount,
        line.cessAmount,
        line.taxAmount,
        line.lineTotal,
        line.allowDecimalQuantity ? 1 : 0,
        line.notes,
        line.sortOrder,
        now,
        now,
      );
    }

    await mutate(
      db,
      `INSERT INTO pos_order_items (${INSERT_COLUMNS.join(', ')}, status)
       VALUES ${lines.map(() => row).join(', ')}`,
      params,
    );
  }

  /* ------------------------------------------------------------- emit scopes */

  /**
   * Every counter and kitchen a set of lines touches: the explicit routes of their menu
   * items, plus the order's own counter for any line whose item carries no route. The
   * service emits `kds:changed` to exactly this set — a board is never nudged for a line it
   * does not show.
   */
  async scopesForLines(
    db: Db,
    lineIds: readonly string[],
  ): Promise<{ counterIds: string[]; printingGroupIds: string[] }> {
    if (lineIds.length === 0) return { counterIds: [], printingGroupIds: [] };
    const placeholders = lineIds.map(() => '?').join(', ');

    const [routed, fallback, groups] = await Promise.all([
      selectRows<ScopeRow>(
        db,
        `SELECT DISTINCT cr.counter_id AS id
           FROM pos_order_items poi
           JOIN counter_routes cr
             ON cr.entity_type = 'MENU_ITEM' AND cr.entity_id = poi.menu_item_id
            AND cr.status = 'ACTIVE' AND cr.deleted_at IS NULL
          WHERE poi.id IN (${placeholders})`,
        [...lineIds],
      ),
      selectRows<ScopeRow>(
        db,
        `SELECT DISTINCT po.counter_id AS id
           FROM pos_order_items poi
           JOIN pos_orders po ON po.id = poi.pos_order_id
          WHERE poi.id IN (${placeholders}) AND po.counter_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM counter_routes crn
               WHERE crn.entity_type = 'MENU_ITEM' AND crn.entity_id = poi.menu_item_id
                 AND crn.status = 'ACTIVE' AND crn.deleted_at IS NULL)`,
        [...lineIds],
      ),
      selectRows<ScopeRow>(
        db,
        `SELECT DISTINCT pr.printing_group_id AS id
           FROM pos_order_items poi
           JOIN printing_routes pr
             ON pr.entity_type = 'MENU_ITEM' AND pr.entity_id = poi.menu_item_id
            AND pr.status = 'ACTIVE' AND pr.deleted_at IS NULL
          WHERE poi.id IN (${placeholders})`,
        [...lineIds],
      ),
    ]);

    return {
      counterIds: [...new Set([...routed, ...fallback].map((row) => row.id))],
      printingGroupIds: [...new Set(groups.map((row) => row.id))],
    };
  }

  /* --------------------------------------------------------------------- cds */

  /**
   * The ticket a customer display shows.
   *
   * An open bill always wins — that is the one being rung up. Failing that, a bill settled in
   * the last `holdSeconds` still shows: the customer has to scan the QR and read the total
   * *after* the cashier presses done, so a bill that vanished at checkout would take the pay
   * screen with it. Older completed bills are none of the customer's business.
   */
  async findCdsOrderForCounter(
    db: Db,
    counterId: string,
    holdSeconds: number,
  ): Promise<CdsOrderRow | null> {
    const hold = Math.max(0, Math.trunc(holdSeconds));
    return selectOne<CdsOrderRow>(
      db,
      `SELECT po.id, po.order_number, po.status, c.name AS counter_name, po.subtotal_amount,
              po.discount_amount, po.tax_amount, po.round_off_amount, po.total_amount,
              po.completed_at, po.updated_at
         FROM pos_orders po
         LEFT JOIN counters c ON c.id = po.counter_id
        WHERE po.counter_id = ? AND po.deleted_at IS NULL
          AND (
            po.status = 'OPEN'
            OR (po.status = 'COMPLETED'
                AND po.completed_at IS NOT NULL
                AND po.completed_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${hold} SECOND))
          )
        ORDER BY (po.status = 'OPEN') DESC, po.updated_at DESC, po.id DESC
        LIMIT 1`,
      [counterId],
    );
  }

  /* --------------------------------------------------------- station pickers */

  /**
   * Which menu a counter sells from. The counter's most recent order answers; a counter that
   * has never billed falls back to the first published menu in sort order.
   */
  async menuIdForCounter(db: Db, counterId: string): Promise<string | null> {
    const recent = await selectOne<{ menu_id: string | null } & RowDataPacket>(
      db,
      `SELECT menu_id FROM pos_orders
        WHERE counter_id = ? AND menu_id IS NOT NULL AND deleted_at IS NULL
        ORDER BY updated_at DESC LIMIT 1`,
      [counterId],
    );
    if (recent?.menu_id) return recent.menu_id;
    const fallback = await selectOne<{ id: string } & RowDataPacket>(
      db,
      `SELECT id FROM menus
        WHERE status = 'ACTIVE' AND published_at IS NOT NULL AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC LIMIT 1`,
    );
    return fallback?.id ?? null;
  }

  /**
   * Does this order have any line that belongs to this counter?
   *
   * Deliberately the board's own `COUNTER_SCOPE` rather than `pos_orders.counter_id`: an order
   * reaches a counter because its *items* are routed there, and the column is null on every
   * order the till writes. Anything checking the column instead would decide that no order is
   * ever on any counter — which is precisely what tagging a chat message to an order used to
   * conclude.
   *
   * Served lines count. A message about an order the counter has just handed over is still a
   * message about that counter's order.
   */
  async orderTouchesCounter(db: Db, orderId: string, counterId: string): Promise<boolean> {
    const row = await selectOne<{ hit: number } & RowDataPacket>(
      db,
      `SELECT 1 AS hit
         FROM pos_orders po
         JOIN pos_order_items poi ON poi.pos_order_id = po.id
        WHERE po.id = ? AND po.deleted_at IS NULL AND poi.status = 'ACTIVE'
          AND ${COUNTER_SCOPE}
        LIMIT 1`,
      [orderId, counterId, counterId],
    );
    return row !== null;
  }

  async listActiveCounters(db: Db): Promise<KdsStationRow[]> {
    return selectRows<KdsStationRow>(
      db,
      `SELECT id, name, code FROM counters
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
        ORDER BY sort_order ASC, name ASC`,
    );
  }

  async listActivePrintingGroups(db: Db): Promise<KdsStationRow[]> {
    return selectRows<KdsStationRow>(
      db,
      `SELECT id, name, code FROM printing_groups
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
        ORDER BY sort_order ASC, name ASC`,
    );
  }

  /* ------------------------------------------------------ station menu file */

  /**
   * The station menu file in one query.
   *
   * Deliberately *not* `MenuMasterService.getMenuTree`: that resolves variants, modifier groups
   * and a four-level media fallback with one round trip per dish, which is the right shape for a
   * till but absurd for a list a wall screen re-reads every minute. This asks only what the
   * screen shows — name, category, availability, price, one photo — for every published menu at
   * once, deduplicating a dish that appears on more than one menu.
   */
  async listStationMenuRows(db: Db): Promise<KdsStationMenuRow[]> {
    return selectRows<KdsStationMenuRow>(
      db,
      `SELECT mia.food_item_id,
              COALESCE(mia.display_name, mi.name) AS name,
              COALESCE(mia.display_name_hi, mi.name_hi) AS name_hi,
              COALESCE(mca.display_name, mc.name, 'Uncategorized') AS category_name,
              mia.availability,
              mi.base_price,
              (SELECT ma.media_id
                 FROM media_assignments ma
                WHERE ma.entity_type = 'MENU_ITEM_ASSIGNMENT' AND ma.entity_id = mia.id
                  AND ma.is_primary = 1 AND ma.status = 'ACTIVE' AND ma.deleted_at IS NULL
                LIMIT 1) AS item_media_id,
              (SELECT ma.media_id
                 FROM media_assignments ma
                WHERE ma.entity_type = 'MENU_ITEM' AND ma.entity_id = mia.food_item_id
                  AND ma.is_primary = 1 AND ma.status = 'ACTIVE' AND ma.deleted_at IS NULL
                LIMIT 1) AS food_media_id,
              m.sort_order AS menu_sort_order
         FROM menu_item_assignments mia
         JOIN menus m ON m.id = mia.menu_id
              AND m.status = 'ACTIVE' AND m.published_at IS NOT NULL AND m.deleted_at IS NULL
         JOIN menu_items mi ON mi.id = mia.food_item_id AND mi.deleted_at IS NULL
         LEFT JOIN menu_category_assignments mca
              ON mca.id = mia.category_assignment_id AND mca.deleted_at IS NULL
         LEFT JOIN menu_categories mc ON mc.id = mca.category_id
        WHERE mia.status = 'ACTIVE' AND mia.deleted_at IS NULL
        ORDER BY m.sort_order ASC, mca.sort_order ASC, mia.sort_order ASC, name ASC`,
    );
  }

  /** Every published menu, in board order — the station menu file spans all of them. */
  async publishedMenuCodes(db: Db): Promise<string[]> {
    const rows = await selectRows<{ code: string } & RowDataPacket>(
      db,
      `SELECT code FROM menus
        WHERE status = 'ACTIVE' AND published_at IS NOT NULL AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC`,
    );
    return rows.map((row) => row.code);
  }

  /** Dishes explicitly routed to this counter — the counter's own menu. */
  async menuItemIdsRoutedToCounter(db: Db, counterId: string): Promise<string[]> {
    const rows = await selectRows<{ entity_id: string } & RowDataPacket>(
      db,
      `SELECT DISTINCT entity_id FROM counter_routes
        WHERE entity_type = 'MENU_ITEM' AND counter_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [counterId],
    );
    return rows.map((row) => row.entity_id);
  }

  /** Dishes routed to any counter at all — an unrouted dish sells everywhere. */
  async menuItemIdsWithCounterRoutes(db: Db): Promise<string[]> {
    const rows = await selectRows<{ entity_id: string } & RowDataPacket>(
      db,
      `SELECT DISTINCT entity_id FROM counter_routes
        WHERE entity_type = 'MENU_ITEM' AND status = 'ACTIVE' AND deleted_at IS NULL`,
    );
    return rows.map((row) => row.entity_id);
  }

  async menuItemIdsRoutedToPrintingGroup(db: Db, printingGroupId: string): Promise<string[]> {
    const rows = await selectRows<{ entity_id: string } & RowDataPacket>(
      db,
      `SELECT DISTINCT entity_id FROM printing_routes
        WHERE entity_type = 'MENU_ITEM' AND printing_group_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL`,
      [printingGroupId],
    );
    return rows.map((row) => row.entity_id);
  }

  async menuItemIdsWithPrintingRoutes(db: Db): Promise<string[]> {
    const rows = await selectRows<{ entity_id: string } & RowDataPacket>(
      db,
      `SELECT DISTINCT entity_id FROM printing_routes
        WHERE entity_type = 'MENU_ITEM' AND status = 'ACTIVE' AND deleted_at IS NULL`,
    );
    return rows.map((row) => row.entity_id);
  }



  /** A kitchen screen has no billing history to follow — it reads the first published menu. */
  async defaultPublishedMenuId(db: Db): Promise<string | null> {
    const row = await selectOne<{ id: string } & RowDataPacket>(
      db,
      `SELECT id FROM menus
        WHERE status = 'ACTIVE' AND published_at IS NOT NULL AND deleted_at IS NULL
        ORDER BY sort_order ASC, name ASC LIMIT 1`,
    );
    return row?.id ?? null;
  }

  async menuItemExists(db: Db, menuItemId: string): Promise<boolean> {
    const row = await selectOne<{ id: string } & RowDataPacket>(
      db,
      `SELECT id FROM menu_items WHERE id = ? AND deleted_at IS NULL`,
      [menuItemId],
    );
    return row !== null;
  }

  async listStationOverrides(
    db: Db,
    stationKind: string,
    stationId: string,
  ): Promise<KdsStationOverrideRow[]> {
    return selectRows<KdsStationOverrideRow>(
      db,
      `SELECT menu_item_id, display_name, is_finished
         FROM kds_station_item_overrides
        WHERE station_kind = ? AND station_id = ?`,
      [stationKind, stationId],
    );
  }

  async upsertStationOverride(
    db: Db,
    input: {
      id: string;
      stationKind: string;
      stationId: string;
      menuItemId: string;
      displayName: string | null;
      isFinished: boolean;
      updatedBy: string;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO kds_station_item_overrides
         (id, station_kind, station_id, menu_item_id, display_name, is_finished, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         is_finished = VALUES(is_finished),
         updated_by = VALUES(updated_by)`,
      [
        input.id,
        input.stationKind,
        input.stationId,
        input.menuItemId,
        input.displayName,
        input.isFinished ? 1 : 0,
        input.updatedBy,
      ],
    );
  }

  async deleteStationOverride(
    db: Db,
    stationKind: string,
    stationId: string,
    menuItemId: string,
  ): Promise<void> {
    await mutate(
      db,
      `DELETE FROM kds_station_item_overrides
        WHERE station_kind = ? AND station_id = ? AND menu_item_id = ?`,
      [stationKind, stationId, menuItemId],
    );
  }

  /* ------------------------------------------------------------- counted stock */

  async listStock(
    db: Db,
    counterId: string,
    businessDate: string,
    shift: string,
  ): Promise<KdsItemStockRow[]> {
    return selectRows<KdsItemStockRow>(
      db,
      `SELECT menu_item_id, opening_qty, registered_at
         FROM kds_item_stock
        WHERE counter_id = ? AND business_date = ? AND shift = ?`,
      [counterId, businessDate, shift],
    );
  }

  async upsertStock(
    db: Db,
    input: {
      id: string;
      counterId: string;
      menuItemId: string;
      businessDate: string;
      shift: string;
      openingQty: number;
      registeredBy: string;
    },
  ): Promise<void> {
    // Re-registering restarts the clock: a fresh tray is a fresh count, and portions sold
    // against the previous one are already accounted for in that shift's history.
    await mutate(
      db,
      `INSERT INTO kds_item_stock
         (id, counter_id, menu_item_id, business_date, shift, opening_qty, registered_at, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         opening_qty = VALUES(opening_qty),
         registered_at = VALUES(registered_at),
         registered_by = VALUES(registered_by)`,
      [
        input.id,
        input.counterId,
        input.menuItemId,
        input.businessDate,
        input.shift,
        input.openingQty,
        toDbDateTime(),
        input.registeredBy,
      ],
    );
  }

  async deleteStock(
    db: Db,
    counterId: string,
    menuItemId: string,
    businessDate: string,
    shift: string,
  ): Promise<void> {
    await mutate(
      db,
      `DELETE FROM kds_item_stock
        WHERE counter_id = ? AND menu_item_id = ? AND business_date = ? AND shift = ?`,
      [counterId, menuItemId, businessDate, shift],
    );
  }

  /**
   * How much of each counted dish this counter has issued since its count was taken.
   *
   * "Issued" is what the till sold through this counter — the same routing rule the board uses,
   * so a dish routed here counts here whichever till rang it. Cancelled lines and cancelled
   * tickets do not count: an order that was voided never left the counter.
   */
  async issuedQtyForStock(
    db: Db,
    counterId: string,
    businessDate: string,
    items: { menuItemId: string; registeredAt: string }[],
  ): Promise<Map<string, number>> {
    if (items.length === 0) return new Map();

    const clauses = items.map(() => `(poi.menu_item_id = ? AND poi.created_at >= ?)`).join(' OR ');
    const params: unknown[] = [];
    for (const item of items) params.push(item.menuItemId, item.registeredAt);

    const rows = await selectRows<{ menu_item_id: string; issued: string } & RowDataPacket>(
      db,
      `SELECT poi.menu_item_id, COALESCE(SUM(poi.quantity), 0) AS issued
         FROM pos_orders po
         JOIN pos_order_items poi ON poi.pos_order_id = po.id
        WHERE po.deleted_at IS NULL AND po.business_date = ?
          AND po.status IN ('OPEN','SCHEDULED','COMPLETED')
          AND poi.status = 'ACTIVE'
          AND (${clauses})
          AND ${COUNTER_SCOPE}
        GROUP BY poi.menu_item_id`,
      [businessDate, ...params, counterId, counterId],
    );
    return new Map(rows.map((row) => [row.menu_item_id, Number(row.issued)]));
  }

  /** Every counter that has counted stock for this dish in the current shift. */
  async countersWithStockForItem(
    db: Db,
    menuItemId: string,
    businessDate: string,
    shift: string,
  ): Promise<string[]> {
    const rows = await selectRows<{ counter_id: string } & RowDataPacket>(
      db,
      `SELECT counter_id FROM kds_item_stock
        WHERE menu_item_id = ? AND business_date = ? AND shift = ?`,
      [menuItemId, businessDate, shift],
    );
    return rows.map((row) => row.counter_id);
  }
}

export const kdsRepository = new KdsRepository();
