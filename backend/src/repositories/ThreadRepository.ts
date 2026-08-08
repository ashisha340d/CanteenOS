import type { MessageType, SystemEvent } from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, ThreadMessageRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

export interface InsertThreadMessageInput {
  id: string;
  boardId: string;
  /** Null posts a general board message; set attaches it to that order. */
  orderId: string | null;
  parentMessageId: string | null;
  /** Null for SYSTEM messages, which have no human author. */
  authorId: string | null;
  messageType: MessageType;
  body: string | null;
  mentionedUserIds: string[];
  systemEvent: SystemEvent | null;
  systemMeta: Record<string, unknown> | null;
  createdAt?: Date;
}

const COLUMNS = `
  tm.id, tm.board_id, tm.order_id, tm.parent_message_id, tm.author_id, tm.message_type, tm.body,
  tm.mentioned_user_ids, tm.system_event, tm.system_meta,
  tm.created_at, tm.updated_at, tm.deleted_at, tm.revision, tm.sync_seq`;

export class ThreadRepository {
  async findById(db: Db, id: string, options: { includeDeleted?: boolean } = {}) {
    const deletedClause = options.includeDeleted === true ? '' : ' AND tm.deleted_at IS NULL';
    return selectOne<ThreadMessageRow>(
      db,
      `SELECT ${COLUMNS} FROM thread_messages tm WHERE tm.id = ?${deletedClause}`,
      [id],
    );
  }

  /**
   * Page of thread messages, newest first for the initial load. `before` is a keyset cursor
   * on created_at — offset paging would skip or repeat messages as new ones arrive.
   */
  async listForOrder(
    db: Db,
    orderId: string,
    options: { limit: number; before?: string } = { limit: 50 },
  ): Promise<ThreadMessageRow[]> {
    const params: unknown[] = [orderId];
    let beforeClause = '';
    if (options.before !== undefined) {
      beforeClause = ' AND tm.created_at < ?';
      params.push(options.before);
    }
    params.push(options.limit);

    return selectRows<ThreadMessageRow>(
      db,
      `SELECT ${COLUMNS}, u.name AS author_name
         FROM thread_messages tm
         LEFT JOIN users u ON u.id = tm.author_id
        WHERE tm.order_id = ? AND tm.deleted_at IS NULL${beforeClause}
        ORDER BY tm.created_at DESC, tm.id DESC
        LIMIT ?`,
      params,
    );
  }

  /**
   * The board feed: every message on the board, general posts and order-scoped ones alike,
   * in one page. Same keyset-on-created_at contract as `listForOrder`.
   */
  async listForBoard(
    db: Db,
    boardId: string,
    options: { limit: number; before?: string } = { limit: 50 },
  ): Promise<ThreadMessageRow[]> {
    const params: unknown[] = [boardId];
    let beforeClause = '';
    if (options.before !== undefined) {
      beforeClause = ' AND tm.created_at < ?';
      params.push(options.before);
    }
    params.push(options.limit);

    return selectRows<ThreadMessageRow>(
      db,
      `SELECT ${COLUMNS}, u.name AS author_name
         FROM thread_messages tm
         LEFT JOIN users u ON u.id = tm.author_id
        WHERE tm.board_id = ? AND tm.deleted_at IS NULL${beforeClause}
        ORDER BY tm.created_at DESC, tm.id DESC
        LIMIT ?`,
      params,
    );
  }

  async countForOrder(db: Db, orderId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM thread_messages
        WHERE order_id = ? AND deleted_at IS NULL AND message_type = 'USER'`,
      [orderId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async countForOrders(
    db: Db,
    orderIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const placeholders = orderIds.map(() => '?').join(', ');
    const rows = await selectRows<CountRow & { order_id: string }>(
      db,
      `SELECT order_id, COUNT(*) AS total FROM thread_messages
        WHERE order_id IN (${placeholders}) AND deleted_at IS NULL AND message_type = 'USER'
        GROUP BY order_id`,
      orderIds,
    );
    return new Map(rows.map((row) => [row.order_id, Number(row.total)]));
  }

  async insert(db: Db, input: InsertThreadMessageInput): Promise<ThreadMessageRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const createdAt = input.createdAt ? toDbDateTime(input.createdAt) : now;

    await mutate(
      db,
      `INSERT INTO thread_messages
        (id, board_id, order_id, parent_message_id, author_id, message_type, body, mentioned_user_ids,
         system_event, system_meta, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.boardId,
        input.orderId,
        input.parentMessageId,
        input.authorId,
        input.messageType,
        input.body,
        toJsonColumn(input.mentionedUserIds),
        input.systemEvent,
        toJsonColumn(input.systemMeta),
        createdAt,
        now,
        syncSeq,
      ],
    );

    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted thread message could not be read back');
    return row;
  }

  /** Thread messages are append-only; the only mutation is a tombstone. */
  async softDelete(db: Db, id: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE thread_messages
          SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
  }

  /** Board members other than the actor — the recipient set for reply notifications. */
  async findThreadParticipants(
    db: Db,
    orderId: string,
    excludeUserId: string,
  ): Promise<string[]> {
    const rows = await selectRows<ThreadMessageRow & { participant_id: string }>(
      db,
      `SELECT DISTINCT participant_id FROM (
          SELECT author_id AS participant_id FROM thread_messages
            WHERE order_id = ? AND author_id IS NOT NULL AND deleted_at IS NULL
          UNION
          SELECT created_by AS participant_id FROM orders WHERE id = ?
        ) AS participants
        WHERE participant_id <> ?`,
      [orderId, orderId, excludeUserId],
    );
    return rows.map((row) => row.participant_id);
  }

  async changedSince(
    db: Db,
    cursor: number,
    limit: number,
    boardIds: readonly string[],
  ): Promise<ThreadMessageRow[]> {
    if (boardIds.length === 0) return [];
    const placeholders = boardIds.map(() => '?').join(', ');
    // Scoped by the message's own board_id, not by a join through orders — a general board
    // post has no order to join to.
    return selectRows<ThreadMessageRow>(
      db,
      `SELECT ${COLUMNS}
         FROM thread_messages tm
        WHERE tm.sync_seq > ? AND tm.board_id IN (${placeholders})
        ORDER BY tm.sync_seq ASC LIMIT ?`,
      [cursor, ...boardIds, limit],
    );
  }
}

export const threadRepository = new ThreadRepository();
