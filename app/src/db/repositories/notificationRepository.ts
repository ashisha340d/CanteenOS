import type { NotificationDto, NotificationType } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { NotificationRow } from '../models';
import { nowIso } from '../../utils/date';
import { parseJsonObject } from '../../utils/jsonArray';

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    boardId: row.board_id,
    orderId: row.order_id,
    actorId: row.actor_id,
    data: parseJsonObject(row.data),
    readAt: row.read_at,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
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

export const notificationRepository = {
  async upsertMany(rows: NotificationDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const n of rows) {
        await db.runAsync(
          `INSERT INTO notifications (id, user_id, type, title, body, board_id, order_id,
             actor_id, data, read_at, created_at, deleted_at, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             read_at = excluded.read_at, deleted_at = excluded.deleted_at,
             server_sync_seq = excluded.server_sync_seq`,
          [n.id, n.userId, n.type, n.title, n.body, n.boardId, n.orderId, n.actorId,
          n.data ? JSON.stringify(n.data) : null, n.readAt, n.createdAt, n.deletedAt, n.syncSeq],
        );
      }
    });
  },

  async listForUser(userId: string, unreadOnly = false): Promise<NotificationDto[]> {
    const db = await getDb();
    const rows = unreadOnly
      ? await db.getAllAsync<NotificationRow>(
        `SELECT * FROM notifications
          WHERE user_id = ? AND read_at IS NULL AND deleted_at IS NULL
          ORDER BY created_at DESC`,
        [userId],
      )
      : await db.getAllAsync<NotificationRow>(
        `SELECT * FROM notifications WHERE user_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 200`,
        [userId],
      );
    return rows.map(toDto);
  },

  async unreadCount(userId: string): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM notifications
        WHERE user_id = ? AND read_at IS NULL AND deleted_at IS NULL`,
      [userId],
    );
    return row?.c ?? 0;
  },

  /**
   * Removes the local cached copy right away, so the list updates without waiting for the
   * next sync pull. Call only after the server confirms the delete (`notificationsApi.remove`)
   * — notifications are not a pushable entity, so there is no outbox row to reconcile.
   */
  async removeLocal(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM notifications WHERE id = ?', [id]);
  },

  /**
   * Marks read locally. The server copy of "read" state is reconciled by Phase 5/6's sync
   * of the `notifications` entity (server-authored, not pushable — see PUSHABLE_ENTITIES);
   * for now this is a local read-flag only, matching the "no push wiring" scope for Phase 4.
   */
  async markReadLocal(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDb();
    const now = nowIso();
    const placeholders = ids.map(() => '?').join(',');
    await db.runAsync(
      `UPDATE notifications SET read_at = ? WHERE id IN (${placeholders}) AND read_at IS NULL`,
      [now, ...ids],
    );
  },

  async markAllReadLocal(userId: string): Promise<void> {
    const db = await getDb();
    const now = nowIso();
    await db.runAsync(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
      [now, userId],
    );
  },
};
