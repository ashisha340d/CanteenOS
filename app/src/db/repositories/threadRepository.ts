import type { CreateThreadMessageRequest, MessageType, SystemEvent, ThreadMessageDto } from '@menuboard/shared';
import { SyncOp } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { ThreadMessageRow } from '../models';
import { newId } from '../../utils/uuid';
import { nowIso } from '../../utils/date';
import { parseJsonArray, parseJsonObject, toJsonArray, toJsonObject } from '../../utils/jsonArray';
import { syncQueueRepository } from './syncQueueRepository';

function toDto(row: ThreadMessageRow, authorName?: string): ThreadMessageDto {
  return {
    id: row.id,
    boardId: row.board_id,
    orderId: row.order_id,
    parentMessageId: row.parent_message_id,
    authorId: row.author_id,
    messageType: row.message_type as MessageType,
    body: row.body,
    mentionedUserIds: parseJsonArray(row.mentioned_user_ids),
    systemEvent: row.system_event as SystemEvent | null,
    systemMeta: parseJsonObject(row.system_meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
    authorName,
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

export const threadRepository = {
  async upsertMany(messages: ThreadMessageDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (messages.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const m of messages) {
        await db.runAsync(
          `INSERT INTO thread_messages (id, board_id, order_id, parent_message_id, author_id,
             message_type, body, mentioned_user_ids, system_event, system_meta, created_at,
             updated_at, deleted_at, revision, server_sync_seq, sync_state, sync_error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED', NULL)
           ON CONFLICT(id) DO UPDATE SET
             body = excluded.body, mentioned_user_ids = excluded.mentioned_user_ids,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq,
             sync_state = 'SYNCED', sync_error = NULL`,
          [
            m.id, m.boardId, m.orderId, m.parentMessageId, m.authorId, m.messageType, m.body,
            toJsonArray(m.mentionedUserIds), m.systemEvent, toJsonObject(m.systemMeta),
            m.createdAt, m.updatedAt, m.deletedAt, m.revision, m.syncSeq,
          ],
        );
      }
    });
  },

  /** The board feed: general posts and order-scoped messages, oldest first. */
  async listForBoard(boardId: string): Promise<ThreadMessageDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ThreadMessageRow & { author_name: string | null }>(
      `SELECT tm.*, u.name AS author_name FROM thread_messages tm
       LEFT JOIN users u ON u.id = tm.author_id
       WHERE tm.board_id = ? AND tm.deleted_at IS NULL
       ORDER BY tm.created_at ASC`,
      [boardId],
    );
    return rows.map((r) => toDto(r, r.author_name ?? undefined));
  },

  async listForOrder(orderId: string): Promise<ThreadMessageDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ThreadMessageRow & { author_name: string | null }>(
      `SELECT tm.*, u.name AS author_name FROM thread_messages tm
       LEFT JOIN users u ON u.id = tm.author_id
       WHERE tm.order_id = ? AND tm.deleted_at IS NULL
       ORDER BY tm.created_at ASC`,
      [orderId],
    );
    return rows.map((r) => toDto(r, r.author_name ?? undefined));
  },

  /** Distinct display names of thread participants per order, for order-card avatar stacks. */
  async distinctAuthorsForOrders(orderIds: readonly string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (orderIds.length === 0) return map;
    const db = await getDb();
    const placeholders = orderIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ order_id: string; author_name: string | null }>(
      `SELECT DISTINCT tm.order_id, u.name AS author_name FROM thread_messages tm
       LEFT JOIN users u ON u.id = tm.author_id
       WHERE tm.order_id IN (${placeholders}) AND tm.message_type = 'USER' AND tm.deleted_at IS NULL`,
      [...orderIds],
    );
    for (const row of rows) {
      const name = row.author_name ?? 'Member';
      const list = map.get(row.order_id) ?? [];
      if (!list.includes(name)) list.push(name);
      map.set(row.order_id, list);
    }
    return map;
  },

  /** Newest message per board, for the board list's last-activity line. */
  async lastActivityForBoards(
    boardIds: readonly string[],
  ): Promise<Map<string, ThreadMessageDto>> {
    const map = new Map<string, ThreadMessageDto>();
    if (boardIds.length === 0) return map;
    const db = await getDb();
    const placeholders = boardIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<ThreadMessageRow & { author_name: string | null }>(
      // The subquery alias must not be `inner`: that is a SQLite keyword (it opens INNER
      // JOIN), so `FROM thread_messages inner WHERE ...` fails with `near "WHERE"`.
      `SELECT tm.*, u.name AS author_name FROM thread_messages tm
       LEFT JOIN users u ON u.id = tm.author_id
       WHERE tm.board_id IN (${placeholders}) AND tm.deleted_at IS NULL
         AND tm.created_at = (
           SELECT MAX(latest.created_at) FROM thread_messages latest
            WHERE latest.board_id = tm.board_id AND latest.deleted_at IS NULL
         )`,
      [...boardIds],
    );
    for (const row of rows) {
      map.set(row.board_id, toDto(row, row.author_name ?? undefined));
    }
    return map;
  },

  /**
   * Local-first compose: writes SQLite immediately, enqueues the outbox row. `orderId` is
   * null for a general board post and set when the message is about that order.
   */
  async postLocal(
    boardId: string,
    authorId: string,
    request: CreateThreadMessageRequest,
  ): Promise<ThreadMessageDto> {
    const now = nowIso();
    const message: ThreadMessageDto = {
      id: request.id ?? newId(),
      boardId,
      orderId: request.orderId ?? null,
      parentMessageId: request.parentMessageId ?? null,
      authorId,
      messageType: 'USER',
      body: request.body ?? null,
      mentionedUserIds: request.mentionedUserIds ?? [],
      systemEvent: null,
      systemMeta: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncSeq: 0,
      revision: 1,
    };
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO thread_messages (id, board_id, order_id, parent_message_id, author_id, message_type,
         body, mentioned_user_ids, system_event, system_meta, created_at, updated_at,
         deleted_at, revision, server_sync_seq, sync_state, sync_error)
       VALUES (?, ?, ?, ?, ?, 'USER', ?, ?, NULL, NULL, ?, ?, NULL, 1, 0, 'PENDING', NULL)`,
      [
        message.id, message.boardId, message.orderId, message.parentMessageId, message.authorId,
        message.body, toJsonArray(message.mentionedUserIds), message.createdAt, message.updatedAt,
      ],
    );
    await syncQueueRepository.enqueue({
      entity: 'thread_messages',
      entityId: message.id,
      op: SyncOp.UPSERT,
      payload: {
        id: message.id,
        boardId: message.boardId,
        orderId: message.orderId,
        parentMessageId: message.parentMessageId,
        body: message.body,
        mentionedUserIds: message.mentionedUserIds,
        ...(request.attachmentIds ? { attachmentIds: request.attachmentIds } : {}),
      },
    });
    return message;
  },

  /**
   * Unsend: tombstones locally and queues the delete. Permission (own message, or a board
   * role holding THREAD_DELETE_ANY) is decided by the caller — the server re-checks it on
   * push, so a tampered client cannot delete someone else's message.
   */
  async deleteLocal(messageId: string): Promise<void> {
    const db = await getDb();
    const now = nowIso();
    await db.runAsync(
      `UPDATE thread_messages SET deleted_at = ?, updated_at = ?, sync_state = 'PENDING'
        WHERE id = ?`,
      [now, now, messageId],
    );
    await syncQueueRepository.enqueue({
      entity: 'thread_messages',
      entityId: messageId,
      op: SyncOp.DELETE,
      payload: null,
    });
  },

  /**
   * Records a device-local SYSTEM thread row for an action the user just took offline (e.g.
   * a status change), matching docs/SCOPE.md decision 2. The server produces its own
   * authoritative SYSTEM row on push; Phase 6 reconciles the two by entity id.
   */
  async recordSystemEventLocal(
    boardId: string,
    orderId: string,
    systemEvent: SystemEvent,
    systemMeta: Record<string, unknown> | null,
    /**
     * Who caused it. Stored so the feed can say *"Ramesh raised ORD-…"* rather than attributing
     * the row to nobody — `listForBoard` resolves the name through its join on `users`.
     */
    actorId: string | null = null,
    /** Joins an open transaction instead of opening its own. */
    tx?: SQLite.SQLiteDatabase,
  ): Promise<void> {
    const now = nowIso();
    const db = tx ?? (await getDb());
    await db.runAsync(
      `INSERT INTO thread_messages (id, board_id, order_id, parent_message_id, author_id, message_type,
         body, mentioned_user_ids, system_event, system_meta, created_at, updated_at,
         deleted_at, revision, server_sync_seq, sync_state, sync_error)
       VALUES (?, ?, ?, NULL, ?, 'SYSTEM', NULL, NULL, ?, ?, ?, ?, NULL, 1, 0, 'PENDING', NULL)`,
      [newId(), boardId, orderId, actorId, systemEvent, toJsonObject(systemMeta), now, now],
    );
  },
};
