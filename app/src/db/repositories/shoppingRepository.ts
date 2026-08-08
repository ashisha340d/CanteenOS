import type * as SQLite from 'expo-sqlite';
import type { ShoppingListDto, ShoppingListItemDto, ShoppingListStatus } from '@menuboard/shared';
import { getDb } from '../client';
import { toJsonArray, parseJsonArray } from '../../utils/jsonArray';

/**
 * Shopping lists, cached for offline reading.
 *
 * The device never generates one — that is a server-side roll-up over recipes, and a phone
 * with a stale recipe cache would compute a total that disagrees with the office's. Ticking a
 * line off while walking a market *is* offline-first, so `purchased` is written locally and
 * pushed. Everything else here is read-only mirror.
 */

interface ShoppingListRow {
  id: string;
  board_id: string;
  title: string;
  status: string;
  order_ids: string | null;
  notes: string | null;
  generated_by: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

interface ShoppingListItemRow {
  id: string;
  shopping_list_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  purchased: number;
  notes: string | null;
  sort_order: number;
  source_order_ids: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

function toItem(row: ShoppingListItemRow): ShoppingListItemDto {
  return {
    id: row.id,
    shoppingListId: row.shopping_list_id,
    ingredientName: row.ingredient_name,
    quantity: row.quantity,
    unit: row.unit,
    purchased: row.purchased === 1,
    notes: row.notes,
    sortOrder: row.sort_order,
    sourceOrderIds: parseJsonArray(row.source_order_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    syncSeq: row.server_sync_seq,
  };
}

function toList(row: ShoppingListRow, items: ShoppingListItemDto[]): ShoppingListDto {
  return {
    id: row.id,
    boardId: row.board_id,
    orderIds: parseJsonArray(row.order_ids),
    title: row.title,
    status: row.status as ShoppingListStatus,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    notes: row.notes,
    items,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    syncSeq: row.server_sync_seq,
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

export const shoppingRepository = {
  async upsertMany(rows: ShoppingListDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const list of rows) {
        await db.runAsync(
          `INSERT INTO shopping_lists (id, board_id, title, status, order_ids, notes,
             generated_by, generated_at, created_at, updated_at, deleted_at, revision,
             server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')
           ON CONFLICT(id) DO UPDATE SET
             board_id = excluded.board_id, title = excluded.title, status = excluded.status,
             order_ids = excluded.order_ids, notes = excluded.notes,
             generated_by = excluded.generated_by, generated_at = excluded.generated_at,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq,
             sync_state = 'SYNCED'`,
          [
            list.id, list.boardId, list.title, list.status, toJsonArray(list.orderIds), list.notes,
            list.generatedBy, list.generatedAt, list.createdAt, list.updatedAt, list.deletedAt,
            list.revision, list.syncSeq,
          ],
        );
        if (list.items.length > 0) await this.upsertItems(list.items, db);
      }
    });
  },

  async upsertItems(rows: ShoppingListItemDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const item of rows) {
        await db.runAsync(
          `INSERT INTO shopping_list_items (id, shopping_list_id, ingredient_name, quantity, unit,
             purchased, notes, sort_order, source_order_ids, created_at, updated_at, deleted_at,
             revision, server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')
           ON CONFLICT(id) DO UPDATE SET
             shopping_list_id = excluded.shopping_list_id,
             ingredient_name = excluded.ingredient_name, quantity = excluded.quantity,
             unit = excluded.unit, purchased = excluded.purchased, notes = excluded.notes,
             sort_order = excluded.sort_order, source_order_ids = excluded.source_order_ids,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq,
             sync_state = 'SYNCED'`,
          [
            item.id, item.shoppingListId, item.ingredientName, item.quantity, item.unit,
            item.purchased ? 1 : 0, item.notes, item.sortOrder, toJsonArray(item.sourceOrderIds),
            item.createdAt, item.updatedAt, item.deletedAt, item.revision, item.syncSeq,
          ],
        );
      }
    });
  },

  async findById(id: string): Promise<ShoppingListDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<ShoppingListRow>(
      'SELECT * FROM shopping_lists WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row === null ? null : toList(row, await this.listItems(row.id));
  },

  /** The newest list covering this order, which is what the order card links to. */
  async findLatestForOrder(orderId: string): Promise<ShoppingListDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<ShoppingListRow>(
      `SELECT * FROM shopping_lists
        WHERE deleted_at IS NULL AND order_ids LIKE ?
        ORDER BY generated_at DESC LIMIT 1`,
      [`%${orderId}%`],
    );
    return row === null ? null : toList(row, await this.listItems(row.id));
  },

  async listForBoard(boardId: string): Promise<ShoppingListDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ShoppingListRow>(
      `SELECT * FROM shopping_lists WHERE board_id = ? AND deleted_at IS NULL
       ORDER BY generated_at DESC`,
      [boardId],
    );
    const lists: ShoppingListDto[] = [];
    for (const row of rows) lists.push(toList(row, await this.listItems(row.id)));
    return lists;
  },

  async listItems(shoppingListId: string): Promise<ShoppingListItemDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ShoppingListItemRow>(
      `SELECT * FROM shopping_list_items WHERE shopping_list_id = ? AND deleted_at IS NULL
       ORDER BY sort_order ASC`,
      [shoppingListId],
    );
    return rows.map(toItem);
  },

  /**
   * Ticks a line off locally. Marked PENDING rather than queued through the outbox: shopping
   * lists are not a pushable entity, so this is a display-only optimism that the next pull
   * confirms or corrects. The screen also calls the API when there is a connection.
   */
  async setPurchasedLocal(itemId: string, purchased: boolean): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE shopping_list_items SET purchased = ?, sync_state = 'PENDING' WHERE id = ?`,
      [purchased ? 1 : 0, itemId],
    );
  },
};
