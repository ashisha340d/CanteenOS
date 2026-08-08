import type {
  CreateOrderItemRequest,
  CreateOrderRequest,
  OrderDto,
  OrderItemDto,
  OrderPriority,
  OrderStatus,
  UpdateOrderRequest,
} from '@menuboard/shared';
import { SyncOp } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { OrderItemRow, OrderRow } from '../models';
import { newId } from '../../utils/uuid';
import { nowIso } from '../../utils/date';
import { parseJsonArray, toJsonArray } from '../../utils/jsonArray';
import { syncQueueRepository } from './syncQueueRepository';
// One-way: threadRepository knows nothing about orders, so this cannot cycle.
import { threadRepository } from './threadRepository';

function toOrderDto(row: OrderRow): OrderDto {
  return {
    id: row.id,
    orderNumber: row.order_number,
    boardId: row.board_id,
    activityTypeId: row.activity_type_id,
    customActivity: row.custom_activity,
    venue: row.venue,
    pax: row.pax,
    requiredDate: row.required_date,
    requiredTime: row.required_time,
    priority: row.priority as OrderPriority,
    status: row.status as OrderStatus,
    createdBy: row.created_by,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    shoppingGeneratedAt: row.shopping_generated_at,
    billedAt: row.billed_at,
    billingExportId: row.billing_export_id,
    doneAt: row.done_at,
    doneBy: row.done_by,
    assignedTo: row.assigned_to,
    assignedAt: row.assigned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function toOrderItemDto(row: OrderItemRow): OrderItemDto {
  return {
    id: row.id,
    orderId: row.order_id,
    menuItemId: row.menu_item_id,
    customItemName: row.custom_item_name,
    quantity: row.quantity,
    unit: row.unit,
    notes: row.notes,
    mentionedUserIds: parseJsonArray(row.mentioned_user_ids),
    sortOrder: row.sort_order,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    replacedByItemId: row.replaced_by_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function orderToPayload(order: OrderDto, items: OrderItemDto[]): Record<string, unknown> {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    boardId: order.boardId,
    activityTypeId: order.activityTypeId,
    customActivity: order.customActivity,
    venue: order.venue,
    pax: order.pax,
    requiredDate: order.requiredDate,
    requiredTime: order.requiredTime,
    priority: order.priority,
    status: order.status,
    assignedTo: order.assignedTo,
    items: items.map((i) => ({
      id: i.id,
      menuItemId: i.menuItemId,
      customItemName: i.customItemName,
      quantity: i.quantity,
      unit: i.unit,
      notes: i.notes,
      mentionedUserIds: i.mentionedUserIds,
      sortOrder: i.sortOrder,
    })),
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

export const orderRepository = {
  /** Applied by the REST-to-SQLite population module — see src/sync/populateFromServer.ts. */
  async upsertMany(orders: OrderDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (orders.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const o of orders) {
        await db.runAsync(
          `INSERT INTO orders (id, order_number, board_id, activity_type_id,
             custom_activity, venue, pax, required_date, required_time, priority, status,
             completed_at, completed_by, shopping_generated_at, billed_at, billing_export_id,
             done_at, done_by, created_by, assigned_to, assigned_at,
             created_at, updated_at, deleted_at,
             revision, server_sync_seq, sync_state, sync_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', NULL)
           ON CONFLICT(id) DO UPDATE SET
             order_number = excluded.order_number,
             activity_type_id = excluded.activity_type_id, custom_activity = excluded.custom_activity,
             venue = excluded.venue, pax = excluded.pax, required_date = excluded.required_date,
             required_time = excluded.required_time, priority = excluded.priority,
             status = excluded.status, completed_at = excluded.completed_at,
             completed_by = excluded.completed_by,
             shopping_generated_at = excluded.shopping_generated_at,
             billed_at = excluded.billed_at, billing_export_id = excluded.billing_export_id,
             done_at = excluded.done_at, done_by = excluded.done_by,
             assigned_to = excluded.assigned_to, assigned_at = excluded.assigned_at,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at, revision = excluded.revision,
             server_sync_seq = excluded.server_sync_seq, sync_state = 'SYNCED', sync_error = NULL`,
          [
            o.id, o.orderNumber, o.boardId, o.activityTypeId, o.customActivity,
            o.venue, o.pax, o.requiredDate, o.requiredTime, o.priority, o.status,
            o.completedAt, o.completedBy, o.shoppingGeneratedAt, o.billedAt, o.billingExportId,
            o.doneAt, o.doneBy, o.createdBy, o.assignedTo, o.assignedAt,
            o.createdAt, o.updatedAt, o.deletedAt,
            o.revision, o.syncSeq,
          ],
        );
      }
    });
  },

  async upsertItems(items: OrderItemDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (items.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const i of items) {
        await db.runAsync(
          `INSERT INTO order_items (id, order_id, menu_item_id, custom_item_name, quantity,
             unit, notes, mentioned_user_ids, sort_order, cancelled_at, cancelled_by,
             replaced_by_item_id, created_at, updated_at, deleted_at, revision,
             server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')
           ON CONFLICT(id) DO UPDATE SET
             menu_item_id = excluded.menu_item_id,
             custom_item_name = excluded.custom_item_name, quantity = excluded.quantity,
             unit = excluded.unit, notes = excluded.notes,
             mentioned_user_ids = excluded.mentioned_user_ids, sort_order = excluded.sort_order,
             cancelled_at = excluded.cancelled_at, cancelled_by = excluded.cancelled_by,
             replaced_by_item_id = excluded.replaced_by_item_id,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq,
             sync_state = 'SYNCED'`,
          [
            i.id, i.orderId, i.menuItemId, i.customItemName, i.quantity, i.unit, i.notes,
            toJsonArray(i.mentionedUserIds), i.sortOrder, i.cancelledAt, i.cancelledBy,
            i.replacedByItemId, i.createdAt, i.updatedAt,
            i.deletedAt, i.revision, i.syncSeq,
          ],
        );
      }
    });
  },

  async replaceItemsForOrder(orderId: string, items: OrderItemDto[]): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM order_items WHERE order_id = ?', [orderId]);
    });
    await this.upsertItems(items);
  },

  async findById(id: string): Promise<OrderDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<OrderRow>(
      'SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toOrderDto(row) : null;
  },

  async listItemsForOrder(orderId: string): Promise<OrderItemDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<OrderItemRow>(
      'SELECT * FROM order_items WHERE order_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC',
      [orderId],
    );
    return rows.map(toOrderItemDto);
  },

  /**
   * Every order on a board, for the feed. Unlike the section lists this keeps cancelled and
   * billed orders in: the feed is a record of what happened, not a worklist.
   */
  async listForBoard(boardId: string): Promise<OrderDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<OrderRow>(
      'SELECT * FROM orders WHERE board_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
      [boardId],
    );
    return rows.map(toOrderDto);
  },

  /** Items for many orders at once, grouped by order id — one query for a whole feed. */
  async listItemsForOrders(orderIds: readonly string[]): Promise<Map<string, OrderItemDto[]>> {
    const map = new Map<string, OrderItemDto[]>();
    if (orderIds.length === 0) return map;
    const db = await getDb();
    const placeholders = orderIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<OrderItemRow>(
      `SELECT * FROM order_items WHERE order_id IN (${placeholders}) AND deleted_at IS NULL
       ORDER BY sort_order ASC`,
      [...orderIds],
    );
    for (const row of rows) {
      const list = map.get(row.order_id) ?? [];
      list.push(toOrderItemDto(row));
      map.set(row.order_id, list);
    }
    return map;
  },

  async listToday(boardId: string, isoDate: string): Promise<OrderDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<OrderRow>(
      `SELECT * FROM orders WHERE board_id = ? AND required_date = ? AND deleted_at IS NULL
       ORDER BY required_time ASC`,
      [boardId, isoDate],
    );
    return rows.map(toOrderDto);
  },

  async listUpcoming(boardId: string, afterIsoDate: string): Promise<OrderDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<OrderRow>(
      `SELECT * FROM orders WHERE board_id = ? AND required_date > ? AND deleted_at IS NULL
       AND status NOT IN ('DELIVERED', 'DONE', 'CANCELLED')
       ORDER BY required_date ASC, required_time ASC`,
      [boardId, afterIsoDate],
    );
    return rows.map(toOrderDto);
  },

  async listCompleted(boardId: string): Promise<OrderDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<OrderRow>(
      `SELECT * FROM orders WHERE board_id = ? AND status IN ('DELIVERED', 'DONE')
       AND deleted_at IS NULL
       ORDER BY COALESCE(done_at, completed_at) DESC`,
      [boardId],
    );
    return rows.map(toOrderDto);
  },

  async listAllOpenAcrossBoards(boardIds: readonly string[]): Promise<OrderDto[]> {
    if (boardIds.length === 0) return [];
    const db = await getDb();
    const placeholders = boardIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<OrderRow>(
      `SELECT * FROM orders WHERE board_id IN (${placeholders}) AND deleted_at IS NULL
       AND status NOT IN ('DELIVERED', 'DONE', 'CANCELLED')
       ORDER BY required_date ASC, required_time ASC`,
      [...boardIds],
    );
    return rows.map(toOrderDto);
  },

  /**
   * Everything finished, newest first — the Archive tab's list.
   *
   * `DELIVERED` and `DONE` both count as finished: an order that reached the venue belongs in
   * the archive whether or not anyone got round to formally closing it, which is what the
   * `archive_activity_item_summaries` mockup shows.
   */
  async listCompletedAcrossBoards(boardIds: readonly string[]): Promise<OrderDto[]> {
    if (boardIds.length === 0) return [];
    const db = await getDb();
    const placeholders = boardIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<OrderRow>(
      `SELECT * FROM orders WHERE board_id IN (${placeholders}) AND deleted_at IS NULL
         AND status IN ('DELIVERED', 'DONE')
       ORDER BY COALESCE(done_at, completed_at, required_date) DESC, required_time DESC`,
      [...boardIds],
    );
    return rows.map(toOrderDto);
  },

  /**
   * Archive header totals, computed in SQL rather than by summing a fetched list — the archive
   * grows without bound and the tiles must not pull every row into memory to add two numbers.
   */
  async completedTotals(boardIds: readonly string[]): Promise<{ orders: number; pax: number }> {
    if (boardIds.length === 0) return { orders: 0, pax: 0 };
    const db = await getDb();
    const placeholders = boardIds.map(() => '?').join(',');
    const row = await db.getFirstAsync<{ orders: number; pax: number | null }>(
      `SELECT COUNT(*) AS orders, SUM(pax) AS pax FROM orders
       WHERE board_id IN (${placeholders}) AND deleted_at IS NULL
         AND status IN ('DELIVERED', 'DONE')`,
      [...boardIds],
    );
    return { orders: row?.orders ?? 0, pax: row?.pax ?? 0 };
  },

  async listTodayAcrossBoards(boardIds: readonly string[], isoDate: string): Promise<OrderDto[]> {
    if (boardIds.length === 0) return [];
    const db = await getDb();
    const placeholders = boardIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<OrderRow>(
      `SELECT * FROM orders WHERE board_id IN (${placeholders}) AND required_date = ?
       AND deleted_at IS NULL ORDER BY required_time ASC`,
      [...boardIds, isoDate],
    );
    return rows.map(toOrderDto);
  },

  /**
   * Local-first create. Writes SQLite immediately (with a device-generated order number via
   * `buildOrderNumber`, computed by the caller) and enqueues the outbox row; the UI reads
   * the order back from SQLite right after this resolves.
   */
  async createLocal(request: CreateOrderRequest & { id: string; orderNumber: string; createdBy: string }): Promise<OrderDto> {
    const now = nowIso();
    const order: OrderDto = {
      id: request.id,
      orderNumber: request.orderNumber,
      boardId: request.boardId,
      activityTypeId: request.activityTypeId ?? null,
      customActivity: request.customActivity ?? null,
      venue: request.venue,
      pax: request.pax,
      requiredDate: request.requiredDate,
      requiredTime: request.requiredTime,
      priority: request.priority ?? 'NORMAL',
      status: 'PENDING',
      createdBy: request.createdBy,
      completedAt: null,
      completedBy: null,
      shoppingGeneratedAt: null,
      billedAt: null,
      billingExportId: null,
      doneAt: null,
      doneBy: null,
      assignedTo: null,
      assignedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncSeq: 0,
      revision: 1,
    };
    const items: OrderItemDto[] = request.items.map((item: CreateOrderItemRequest, index: number) => ({
      id: item.id ?? newId(),
      orderId: order.id,
      menuItemId: item.menuItemId ?? null,
      customItemName: item.customItemName ?? null,
      quantity: item.quantity,
      unit: item.unit ?? 'NOS',
      notes: item.notes ?? null,
      mentionedUserIds: item.mentionedUserIds ?? [],
      sortOrder: item.sortOrder ?? index,
      cancelledAt: null,
      cancelledBy: null,
      replacedByItemId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncSeq: 0,
      revision: 1,
    }));

    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO orders (id, order_number, board_id, activity_type_id,
           custom_activity, venue, pax, required_date, required_time, priority, status,
           completed_at, completed_by, created_by, created_at, updated_at, deleted_at,
           revision, server_sync_seq, sync_state, sync_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, 1, 0, 'PENDING', NULL)`,
        [
          order.id, order.orderNumber, order.boardId, order.activityTypeId,
          order.customActivity, order.venue, order.pax, order.requiredDate, order.requiredTime,
          order.priority, order.status, order.createdBy, order.createdAt, order.updatedAt,
        ],
      );
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO order_items (id, order_id, menu_item_id, custom_item_name, quantity,
             unit, notes, mentioned_user_ids, sort_order, created_at, updated_at, deleted_at,
             revision, server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, 'PENDING')`,
          [
            item.id, item.orderId, item.menuItemId, item.customItemName, item.quantity,
            item.unit, item.notes, toJsonArray(item.mentionedUserIds), item.sortOrder,
            item.createdAt, item.updatedAt,
          ],
        );
      }
    });

    await syncQueueRepository.enqueue({
      entity: 'orders',
      entityId: order.id,
      op: SyncOp.UPSERT,
      payload: orderToPayload(order, items),
    });

    // The feed is built entirely from thread_messages, so without this row a locally created
    // order is invisible on its own board until the server's copy syncs back. `buildEntries`
    // turns an ORDER_CREATED row into the structured order card.
    await threadRepository.recordSystemEventLocal(
      order.boardId,
      order.id,
      'ORDER_CREATED',
      { orderNumber: order.orderNumber, venue: order.venue, pax: order.pax },
      order.createdBy,
    );

    return order;
  },

  /** Local-first field/items update. */
  async updateLocal(orderId: string, patch: UpdateOrderRequest): Promise<OrderDto> {
    const existing = await this.findById(orderId);
    if (!existing) throw new Error(`Order ${orderId} not found locally`);
    const now = nowIso();
    const updated: OrderDto = {
      ...existing,
      activityTypeId: patch.activityTypeId !== undefined ? patch.activityTypeId : existing.activityTypeId,
      customActivity: patch.customActivity !== undefined ? patch.customActivity : existing.customActivity,
      venue: patch.venue ?? existing.venue,
      pax: patch.pax ?? existing.pax,
      requiredDate: patch.requiredDate ?? existing.requiredDate,
      requiredTime: patch.requiredTime ?? existing.requiredTime,
      priority: patch.priority ?? existing.priority,
      updatedAt: now,
      revision: existing.revision + 1,
    };

    const db = await getDb();
    await db.runAsync(
      `UPDATE orders SET activity_type_id = ?, custom_activity = ?, venue = ?,
         pax = ?, required_date = ?, required_time = ?, priority = ?, updated_at = ?,
         revision = ?, sync_state = 'PENDING' WHERE id = ?`,
      [
        updated.activityTypeId, updated.customActivity, updated.venue,
        updated.pax, updated.requiredDate, updated.requiredTime, updated.priority,
        updated.updatedAt, updated.revision, orderId,
      ],
    );

    let items = await this.listItemsForOrder(orderId);
    if (patch.items) {
      const newItems: OrderItemDto[] = patch.items.map((item, index) => ({
        id: item.id ?? newId(),
        orderId,
        menuItemId: item.menuItemId ?? null,
        customItemName: item.customItemName ?? null,
        quantity: item.quantity,
        unit: item.unit ?? 'NOS',
        notes: item.notes ?? null,
        mentionedUserIds: item.mentionedUserIds ?? [],
        sortOrder: item.sortOrder ?? index,
        cancelledAt: null,
        cancelledBy: null,
        replacedByItemId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        syncSeq: 0,
        revision: 1,
      }));
      await this.replaceItemsForOrder(orderId, newItems);
      items = newItems;
    }

    await syncQueueRepository.enqueue({
      entity: 'orders',
      entityId: orderId,
      op: SyncOp.UPSERT,
      payload: orderToPayload(updated, items),
      baseRevision: existing.revision,
    });

    return updated;
  },

  async updateStatusLocal(orderId: string, status: OrderStatus, userId: string): Promise<OrderDto> {
    const existing = await this.findById(orderId);
    if (!existing) throw new Error(`Order ${orderId} not found locally`);
    const now = nowIso();
    // Mirrors OrderRepository.updateStatus on the server: DELIVERED stamps completion, DONE
    // stamps its own timestamp and keeps the delivery stamp it was reached through, and an
    // undo that rewinds past either clears them.
    const isDelivered = status === 'DELIVERED';
    const isDone = status === 'DONE';
    const db = await getDb();
    await db.runAsync(
      `UPDATE orders
          SET status = ?,
              completed_at = ${isDelivered ? '?' : isDone ? 'completed_at' : 'NULL'},
              completed_by = ${isDelivered ? '?' : isDone ? 'completed_by' : 'NULL'},
              done_at = ${isDone ? '?' : 'NULL'},
              done_by = ${isDone ? '?' : 'NULL'},
              updated_at = ?, revision = revision + 1, sync_state = 'PENDING'
        WHERE id = ?`,
      [
        status,
        ...(isDelivered ? [now, userId] : []),
        ...(isDone ? [now, userId] : []),
        now,
        orderId,
      ],
    );
    const updated = await this.findById(orderId);
    if (!updated) throw new Error('Order disappeared after status update');
    const items = await this.listItemsForOrder(orderId);
    await syncQueueRepository.enqueue({
      entity: 'orders',
      entityId: orderId,
      op: SyncOp.UPSERT,
      payload: orderToPayload(updated, items),
      baseRevision: existing.revision,
    });

    // Status history *is* the thread (there is no history table), so the move has to be
    // recorded here or the change leaves no trace on the board until the server round-trips.
    await threadRepository.recordSystemEventLocal(
      updated.boardId,
      orderId,
      'ORDER_STATUS_CHANGED',
      { orderNumber: updated.orderNumber, from: existing.status, to: status },
      userId,
    );

    return updated;
  },

  /**
   * Hands the order to a board member, or returns it to the pool when `assignedTo` is null.
   *
   * Local-first like every other write here: SQLite moves immediately, the outbox carries the
   * change, and the server re-checks the capability and the "assignee must be on this board"
   * rule when the push lands. A rejection there comes back as `sync_state = 'FAILED'`.
   */
  async assignLocal(
    orderId: string,
    assignedTo: string | null,
    userId: string,
    assigneeName?: string | null,
  ): Promise<OrderDto> {
    const existing = await this.findById(orderId);
    if (!existing) throw new Error(`Order ${orderId} not found locally`);
    if (existing.assignedTo === assignedTo) return existing;

    const now = nowIso();
    const db = await getDb();
    await db.runAsync(
      `UPDATE orders
          SET assigned_to = ?, assigned_at = ?,
              updated_at = ?, revision = revision + 1, sync_state = 'PENDING'
        WHERE id = ?`,
      [assignedTo, assignedTo === null ? null : now, now, orderId],
    );

    const updated = await this.findById(orderId);
    if (!updated) throw new Error('Order disappeared after assignment');
    const items = await this.listItemsForOrder(orderId);
    await syncQueueRepository.enqueue({
      entity: 'orders',
      entityId: orderId,
      op: SyncOp.UPSERT,
      payload: orderToPayload(updated, items),
      baseRevision: existing.revision,
    });

    await threadRepository.recordSystemEventLocal(
      updated.boardId,
      orderId,
      'ORDER_ASSIGNED',
      {
        orderNumber: updated.orderNumber,
        from: existing.assignedTo,
        to: assignedTo,
        assigneeName: assigneeName ?? null,
      },
      userId,
    );

    return updated;
  },

  async countPendingSync(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM orders WHERE sync_state = 'PENDING'`,
    );
    return row?.c ?? 0;
  },
};
