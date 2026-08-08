import type { ShoppingListStatus } from '@menuboard/shared';
import { allocateSyncSeq, allocateSyncSeqBlock } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { ShoppingListItemRow, ShoppingListRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

export interface InsertShoppingListInput {
  id: string;
  boardId: string;
  title: string;
  orderIds: string[];
  notes: string | null;
  generatedBy: string;
}

export interface ShoppingListItemInput {
  id: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  notes: string | null;
  sortOrder: number;
  sourceOrderIds: string[];
}

const LIST_COLUMNS = `
  sl.id, sl.board_id, sl.title, sl.status, sl.order_ids, sl.notes, sl.generated_by,
  sl.generated_at, sl.created_at, sl.updated_at, sl.deleted_at, sl.revision, sl.sync_seq`;

const ITEM_COLUMNS = `
  id, shopping_list_id, ingredient_name, quantity, unit, purchased, notes, sort_order,
  source_order_ids, created_at, updated_at, deleted_at, revision, sync_seq`;

export class ShoppingListRepository {
  async findById(db: Db, id: string): Promise<ShoppingListRow | null> {
    return selectOne<ShoppingListRow>(
      db,
      `SELECT ${LIST_COLUMNS}, u.name AS generated_by_name
         FROM shopping_lists sl
         LEFT JOIN users u ON u.id = sl.generated_by
        WHERE sl.id = ? AND sl.deleted_at IS NULL`,
      [id],
    );
  }

  async listForBoard(
    db: Db,
    boardId: string,
    filter: { status?: ShoppingListStatus; limit: number } = { limit: 50 },
  ): Promise<ShoppingListRow[]> {
    const conditions = ['sl.board_id = ?', 'sl.deleted_at IS NULL'];
    const params: unknown[] = [boardId];
    if (filter.status !== undefined) {
      conditions.push('sl.status = ?');
      params.push(filter.status);
    }
    return selectRows<ShoppingListRow>(
      db,
      `SELECT ${LIST_COLUMNS}, u.name AS generated_by_name
         FROM shopping_lists sl
         LEFT JOIN users u ON u.id = sl.generated_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY sl.generated_at DESC
        LIMIT ?`,
      [...params, filter.limit],
    );
  }

  async listItems(db: Db, shoppingListId: string): Promise<ShoppingListItemRow[]> {
    return selectRows<ShoppingListItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM shopping_list_items
        WHERE shopping_list_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC`,
      [shoppingListId],
    );
  }

  async listItemsForLists(
    db: Db,
    listIds: readonly string[],
  ): Promise<ShoppingListItemRow[]> {
    if (listIds.length === 0) return [];
    const placeholders = listIds.map(() => '?').join(', ');
    return selectRows<ShoppingListItemRow>(
      db,
      `SELECT ${ITEM_COLUMNS} FROM shopping_list_items
        WHERE shopping_list_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY shopping_list_id ASC, sort_order ASC`,
      listIds,
    );
  }

  async insert(db: Db, input: InsertShoppingListInput): Promise<ShoppingListRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO shopping_lists
        (id, board_id, title, status, order_ids, notes, generated_by, generated_at,
         created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.boardId,
        input.title,
        toJsonColumn(input.orderIds),
        input.notes,
        input.generatedBy,
        now,
        now,
        now,
        syncSeq,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Shopping list ${input.id} could not be read back`);
    return row;
  }

  async insertItems(
    db: Db,
    shoppingListId: string,
    items: readonly ShoppingListItemInput[],
  ): Promise<void> {
    if (items.length === 0) return;
    const firstSeq = await allocateSyncSeqBlock(db, items.length);
    const now = toDbDateTime();

    const placeholders = items.map(() => '(?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1, ?)').join(', ');
    const params: unknown[] = [];
    items.forEach((item, index) => {
      params.push(
        item.id,
        shoppingListId,
        item.ingredientName,
        item.quantity,
        item.unit,
        item.notes,
        item.sortOrder,
        toJsonColumn(item.sourceOrderIds),
        now,
        now,
        firstSeq + index,
      );
    });

    await mutate(
      db,
      `INSERT INTO shopping_list_items
        (id, shopping_list_id, ingredient_name, quantity, unit, purchased, notes, sort_order,
         source_order_ids, created_at, updated_at, revision, sync_seq)
       VALUES ${placeholders}`,
      params,
    );
  }

  async updateStatus(db: Db, id: string, status: ShoppingListStatus): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE shopping_lists
          SET status = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [status, now, syncSeq, id],
    );
  }

  async updateNotes(db: Db, id: string, notes: string | null): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE shopping_lists
          SET notes = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [notes, now, syncSeq, id],
    );
  }

  /** Ticking a line off, or correcting what was actually bought. */
  async updateItem(
    db: Db,
    itemId: string,
    input: { purchased?: boolean; quantity?: number },
  ): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (input.purchased !== undefined) {
      assignments.push('purchased = ?');
      params.push(input.purchased ? 1 : 0);
    }
    if (input.quantity !== undefined) {
      assignments.push('quantity = ?');
      params.push(input.quantity);
    }
    if (assignments.length === 0) return;

    const syncSeq = await allocateSyncSeq(db);
    await mutate(
      db,
      `UPDATE shopping_list_items
          SET ${assignments.join(', ')}, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), syncSeq, itemId],
    );
  }

  /* -------------------------------------------------------------- sync pull */

  async changedSince(
    db: Db,
    cursor: number,
    limit: number,
    boardIds: readonly string[],
  ): Promise<ShoppingListRow[]> {
    if (boardIds.length === 0) return [];
    const placeholders = boardIds.map(() => '?').join(', ');
    return selectRows<ShoppingListRow>(
      db,
      `SELECT ${LIST_COLUMNS} FROM shopping_lists sl
        WHERE sl.sync_seq > ? AND sl.board_id IN (${placeholders})
        ORDER BY sl.sync_seq ASC LIMIT ?`,
      [cursor, ...boardIds, limit],
    );
  }

  async itemsChangedSince(
    db: Db,
    cursor: number,
    limit: number,
    boardIds: readonly string[],
  ): Promise<ShoppingListItemRow[]> {
    if (boardIds.length === 0) return [];
    const placeholders = boardIds.map(() => '?').join(', ');
    return selectRows<ShoppingListItemRow>(
      db,
      `SELECT sli.id, sli.shopping_list_id, sli.ingredient_name, sli.quantity, sli.unit,
              sli.purchased, sli.notes, sli.sort_order, sli.source_order_ids,
              sli.created_at, sli.updated_at, sli.deleted_at, sli.revision, sli.sync_seq
         FROM shopping_list_items sli
        INNER JOIN shopping_lists sl ON sl.id = sli.shopping_list_id
        WHERE sli.sync_seq > ? AND sl.board_id IN (${placeholders})
        ORDER BY sli.sync_seq ASC LIMIT ?`,
      [cursor, ...boardIds, limit],
    );
  }
}

export const shoppingListRepository = new ShoppingListRepository();
