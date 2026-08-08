import type { OrderPriority, OrderStatus } from '@menuboard/shared';
import { allocateSyncSeq, allocateSyncSeqBlock } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, OrderItemRow, OrderRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime, toDbTime } from '../utils/time';

export interface OrderListFilter {
  boardIds?: readonly string[];
  boardId?: string;
  status?: readonly OrderStatus[];
  priority?: readonly OrderPriority[];
  activityTypeId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  includeDeleted?: boolean;
  limit: number;
  offset: number;
}

export interface InsertOrderInput {
  id: string;
  orderNumber: string;
  boardId: string;
  activityTypeId: string | null;
  customActivity: string | null;
  venue: string;
  pax: number;
  requiredDate: string;
  requiredTime: string;
  priority: OrderPriority;
  status: OrderStatus;
  createdBy: string;
  /** Honoured on sync push so an offline-created order keeps its original creation time. */
  createdAt?: Date;
}

/** Exactly one of `menuItemId` / `customItemName` is set — see `OrderItemDto` in shared. */
export interface OrderItemInput {
  id: string;
  menuItemId: string | null;
  customItemName: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
  mentionedUserIds: string[];
  sortOrder: number;
}

const ORDER_COLUMNS = `
  id, order_number, board_id, activity_type_id, custom_activity, venue, pax,
  required_date, required_time, priority, status, completed_at, completed_by,
  shopping_generated_at, billed_at, billing_export_id, done_at, done_by, created_by,
  assigned_to, assigned_at,
  created_at, updated_at, deleted_at, revision, sync_seq`;

const ITEM_COLUMNS = `
  id, order_id, menu_item_id, custom_item_name, quantity, unit, notes, mentioned_user_ids,
  sort_order, cancelled_at, cancelled_by, replaced_by_item_id,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class OrderRepository {
  async findById(db: Db, id: string, options: { includeDeleted?: boolean } = {}) {
    const deletedClause = options.includeDeleted === true ? '' : ' AND deleted_at IS NULL';
    return selectOne<OrderRow>(
      db,
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?${deletedClause}`,
      [id],
    );
  }

  /**
   * Locks the row for the remainder of the transaction. Used by every status change and by
   * sync push, so two devices writing the same order serialise instead of interleaving.
   */
  async findByIdForUpdate(db: Db, id: string): Promise<OrderRow | null> {
    return selectOne<OrderRow>(
      db,
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ? FOR UPDATE`,
      [id],
    );
  }

  async findByOrderNumber(db: Db, orderNumber: string) {
    return selectOne<OrderRow>(
      db,
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE order_number = ?`,
      [orderNumber],
    );
  }

  async list(db: Db, filter: OrderListFilter): Promise<{ rows: OrderRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.includeDeleted !== true) conditions.push('deleted_at IS NULL');

    if (filter.boardId !== undefined) {
      conditions.push('board_id = ?');
      params.push(filter.boardId);
    } else if (filter.boardIds !== undefined) {
      // An empty accessible-board set must return nothing, not everything.
      if (filter.boardIds.length === 0) return { rows: [], total: 0 };
      conditions.push(`board_id IN (${filter.boardIds.map(() => '?').join(', ')})`);
      params.push(...filter.boardIds);
    }

    if (filter.status !== undefined && filter.status.length > 0) {
      conditions.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
      params.push(...filter.status);
    }
    if (filter.priority !== undefined && filter.priority.length > 0) {
      conditions.push(`priority IN (${filter.priority.map(() => '?').join(', ')})`);
      params.push(...filter.priority);
    }
    if (filter.activityTypeId !== undefined) {
      conditions.push('activity_type_id = ?');
      params.push(filter.activityTypeId);
    }
    if (filter.createdBy !== undefined) {
      conditions.push('created_by = ?');
      params.push(filter.createdBy);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('required_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('required_date <= ?');
      params.push(filter.dateTo);
    }
    if (filter.search !== undefined && filter.search !== '') {
      conditions.push('(order_number LIKE ? OR venue LIKE ? OR custom_activity LIKE ?)');
      const like = `%${filter.search}%`;
      params.push(like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await selectRows<OrderRow>(
      db,
      `SELECT ${ORDER_COLUMNS} FROM orders ${where}
        ORDER BY required_date DESC, required_time DESC, created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM orders ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async insert(db: Db, input: InsertOrderInput): Promise<OrderRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const createdAt = input.createdAt ? toDbDateTime(input.createdAt) : now;

    await mutate(
      db,
      `INSERT INTO orders
        (id, order_number, board_id, activity_type_id, custom_activity, venue, pax,
         required_date, required_time, priority, status, created_by,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.orderNumber,
        input.boardId,
        input.activityTypeId,
        input.customActivity,
        input.venue,
        input.pax,
        input.requiredDate,
        toDbTime(input.requiredTime),
        input.priority,
        input.status,
        input.createdBy,
        createdAt,
        now,
        syncSeq,
      ],
    );

    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Inserted order ${input.id} could not be read back`);
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: {
      activityTypeId?: string | null;
      customActivity?: string | null;
      venue?: string;
      pax?: number;
      requiredDate?: string;
      requiredTime?: string;
      priority?: OrderPriority;
    },
  ): Promise<OrderRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (input.activityTypeId !== undefined) {
      assignments.push('activity_type_id = ?');
      params.push(input.activityTypeId);
    }
    if (input.customActivity !== undefined) {
      assignments.push('custom_activity = ?');
      params.push(input.customActivity);
    }
    if (input.venue !== undefined) {
      assignments.push('venue = ?');
      params.push(input.venue);
    }
    if (input.pax !== undefined) {
      assignments.push('pax = ?');
      params.push(input.pax);
    }
    if (input.requiredDate !== undefined) {
      assignments.push('required_date = ?');
      params.push(input.requiredDate);
    }
    if (input.requiredTime !== undefined) {
      assignments.push('required_time = ?');
      params.push(toDbTime(input.requiredTime));
    }
    if (input.priority !== undefined) {
      assignments.push('priority = ?');
      params.push(input.priority);
    }
    if (assignments.length === 0) return this.findById(db, id);

    const syncSeq = await allocateSyncSeq(db);
    assignments.push('updated_at = ?', 'revision = revision + 1', 'sync_seq = ?');
    params.push(toDbDateTime(), syncSeq, id);

    await mutate(
      db,
      `UPDATE orders SET ${assignments.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
    return this.findById(db, id);
  }

  /**
   * Writes a lifecycle status.
   *
   * Reaching DELIVERED stamps completion; reaching DONE stamps `done_at`. Both are cleared
   * when an undo rewinds past them, so the timestamps never outlive the state they record.
   */
  async updateStatus(
    db: Db,
    id: string,
    status: OrderStatus,
    actorId: string,
  ): Promise<OrderRow | null> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const isDelivered = status === 'DELIVERED';
    const isDone = status === 'DONE';

    // DONE keeps the delivery stamp it was reached through; anything earlier clears both.
    const completedAssignment = isDelivered ? '?' : isDone ? 'completed_at' : 'NULL';
    const completedByAssignment = isDelivered ? '?' : isDone ? 'completed_by' : 'NULL';
    const doneAssignment = isDone ? '?' : 'NULL';
    const doneByAssignment = isDone ? '?' : 'NULL';

    const params: unknown[] = [status];
    if (isDelivered) params.push(now, actorId);
    if (isDone) params.push(now, actorId);
    params.push(now, syncSeq, id);

    await mutate(
      db,
      `UPDATE orders
          SET status = ?,
              completed_at = ${completedAssignment},
              completed_by = ${completedByAssignment},
              done_at = ${doneAssignment},
              done_by = ${doneByAssignment},
              updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      params,
    );
    return this.findById(db, id);
  }

  /** Hands the order to a board member, or returns it to the pool when `assignedTo` is null. */
  async updateAssignee(
    db: Db,
    id: string,
    assignedTo: string | null,
  ): Promise<OrderRow | null> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE orders
          SET assigned_to = ?, assigned_at = ?,
              updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [assignedTo, assignedTo === null ? null : now, now, syncSeq, id],
    );
    return this.findById(db, id);
  }

  /**
   * Stamps the orders a shopping list was raised from. Idempotent by design — regenerating
   * a list keeps the first timestamp, so the On Shopping pill does not flicker forward.
   */
  async markShoppingGenerated(db: Db, orderIds: readonly string[]): Promise<void> {
    if (orderIds.length === 0) return;
    const firstSeq = await allocateSyncSeqBlock(db, orderIds.length);
    const now = toDbDateTime();
    for (const [index, id] of orderIds.entries()) {
      await mutate(
        db,
        `UPDATE orders
            SET shopping_generated_at = COALESCE(shopping_generated_at, ?),
                updated_at = ?, revision = revision + 1, sync_seq = ?
          WHERE id = ? AND deleted_at IS NULL`,
        [now, now, firstSeq + index, id],
      );
    }
  }

  /** Freezes orders against an export. After this nobody may edit them (`isOrderLocked`). */
  async markBilled(
    db: Db,
    orderIds: readonly string[],
    billingExportId: string,
  ): Promise<void> {
    if (orderIds.length === 0) return;
    const firstSeq = await allocateSyncSeqBlock(db, orderIds.length);
    const now = toDbDateTime();
    for (const [index, id] of orderIds.entries()) {
      await mutate(
        db,
        `UPDATE orders
            SET billed_at = COALESCE(billed_at, ?), billing_export_id = COALESCE(billing_export_id, ?),
                updated_at = ?, revision = revision + 1, sync_seq = ?
          WHERE id = ? AND deleted_at IS NULL`,
        [now, billingExportId, now, firstSeq + index, id],
      );
    }
  }

  async softDelete(db: Db, id: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE orders SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
  }

  async changedSince(db: Db, cursor: number, limit: number, boardIds: readonly string[]) {
    if (boardIds.length === 0) return [];
    const placeholders = boardIds.map(() => '?').join(', ');
    return selectRows<OrderRow>(
      db,
      `SELECT ${ORDER_COLUMNS} FROM orders
        WHERE sync_seq > ? AND board_id IN (${placeholders})
        ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, ...boardIds, limit],
    );
  }

  /* ------------------------------------------------------------------- items */

  async listItems(db: Db, orderId: string): Promise<OrderItemRow[]> {
    return selectRows<OrderItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM order_items
        WHERE order_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,
      [orderId],
    );
  }

  async listItemsForOrders(db: Db, orderIds: readonly string[]): Promise<OrderItemRow[]> {
    if (orderIds.length === 0) return [];
    const placeholders = orderIds.map(() => '?').join(', ');
    return selectRows<OrderItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM order_items
        WHERE order_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY order_id ASC, sort_order ASC`,
      orderIds,
    );
  }

  async findItemById(db: Db, id: string): Promise<OrderItemRow | null> {
    return selectOne<OrderItemRow>(db, `SELECT ${ITEM_COLUMNS} FROM order_items WHERE id = ?`, [
      id,
    ]);
  }

  /** One cursor per row, allocated as a block so a 30-item order costs one round trip. */
  async insertItems(db: Db, orderId: string, items: readonly OrderItemInput[]): Promise<void> {
    if (items.length === 0) return;

    const firstSeq = await allocateSyncSeqBlock(db, items.length);
    const now = toDbDateTime();

    const placeholders = items.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').join(', ');
    const params: unknown[] = [];
    items.forEach((item, index) => {
      params.push(
        item.id,
        orderId,
        item.menuItemId,
        item.customItemName,
        item.quantity,
        item.unit,
        item.notes,
        toJsonColumn(item.mentionedUserIds),
        item.sortOrder,
        now,
        now,
        firstSeq + index,
      );
    });

    await mutate(
      db,
      `INSERT INTO order_items
        (id, order_id, menu_item_id, custom_item_name, quantity, unit, notes,
         mentioned_user_ids, sort_order, created_at, updated_at, revision, sync_seq)
       VALUES ${placeholders}`,
      params,
    );
  }

  /**
   * Replaces an order's item set. Items absent from `items` are tombstoned rather than
   * deleted so the removal reaches offline devices; surviving items are updated in place so
   * their ids stay stable for anything that already references them.
   */
  async replaceItems(db: Db, orderId: string, items: readonly OrderItemInput[]): Promise<void> {
    const existing = await this.listItems(db, orderId);
    const existingIds = new Set(existing.map((row) => row.id));
    const incomingIds = new Set(items.map((item) => item.id));

    const removedIds = [...existingIds].filter((id) => !incomingIds.has(id));
    if (removedIds.length > 0) {
      const firstSeq = await allocateSyncSeqBlock(db, removedIds.length);
      const now = toDbDateTime();
      for (const [index, id] of removedIds.entries()) {
        await mutate(
          db,
          `UPDATE order_items
              SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
            WHERE id = ?`,
          [now, now, firstSeq + index, id],
        );
      }
    }

    const toInsert = items.filter((item) => !existingIds.has(item.id));
    const toUpdate = items.filter((item) => existingIds.has(item.id));

    if (toUpdate.length > 0) {
      const firstSeq = await allocateSyncSeqBlock(db, toUpdate.length);
      const now = toDbDateTime();
      for (const [index, item] of toUpdate.entries()) {
        await mutate(
          db,
          `UPDATE order_items
              SET menu_item_id = ?, custom_item_name = ?, quantity = ?, unit = ?, notes = ?,
                  mentioned_user_ids = ?, sort_order = ?, deleted_at = NULL, updated_at = ?,
                  revision = revision + 1, sync_seq = ?
            WHERE id = ?`,
          [
            item.menuItemId,
            item.customItemName,
            item.quantity,
            item.unit,
            item.notes,
            toJsonColumn(item.mentionedUserIds),
            item.sortOrder,
            now,
            firstSeq + index,
            item.id,
          ],
        );
      }
    }

    await this.insertItems(db, orderId, toInsert);
  }

  /** Changes one line's quantity. Used by the quantity/pax edit path, which logs the delta. */
  async updateItemQuantity(db: Db, itemId: string, quantity: number): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE order_items
          SET quantity = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [quantity, now, syncSeq, itemId],
    );
  }

  /**
   * Strikes a line out without removing it. `replacedByItemId` links it to its successor so
   * the feed can render the correction as a pair.
   */
  async cancelItem(
    db: Db,
    itemId: string,
    actorId: string,
    replacedByItemId: string | null = null,
  ): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE order_items
          SET cancelled_at = COALESCE(cancelled_at, ?), cancelled_by = COALESCE(cancelled_by, ?),
              replaced_by_item_id = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, actorId, replacedByItemId, now, syncSeq, itemId],
    );
  }

  async itemsChangedSince(
    db: Db,
    cursor: number,
    limit: number,
    boardIds: readonly string[],
  ): Promise<OrderItemRow[]> {
    if (boardIds.length === 0) return [];
    const placeholders = boardIds.map(() => '?').join(', ');
    return selectRows<OrderItemRow>(
      db,
      `SELECT oi.id, oi.order_id, oi.menu_item_id, oi.custom_item_name, oi.quantity, oi.unit,
              oi.notes, oi.mentioned_user_ids, oi.sort_order, oi.cancelled_at, oi.cancelled_by,
              oi.replaced_by_item_id, oi.created_at, oi.updated_at,
              oi.deleted_at, oi.revision, oi.sync_seq
         FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE oi.sync_seq > ? AND o.board_id IN (${placeholders})
        ORDER BY oi.sync_seq ASC LIMIT ?`,
      [cursor, ...boardIds, limit],
    );
  }
}

export const orderRepository = new OrderRepository();
