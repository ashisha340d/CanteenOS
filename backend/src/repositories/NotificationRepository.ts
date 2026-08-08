import type { NotificationType } from '@menuboard/shared';
import { allocateSyncSeqBlock } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, NotificationRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

export interface InsertNotificationInput {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  boardId: string | null;
  orderId: string | null;
  actorId: string | null;
  data: Record<string, unknown> | null;
}

const COLUMNS = `
  id, user_id, type, title, body, board_id, order_id, actor_id, data, read_at,
  created_at, updated_at, deleted_at, revision, sync_seq`;

export class NotificationRepository {
  async findById(db: Db, id: string) {
    return selectOne<NotificationRow>(
      db,
      `SELECT ${COLUMNS} FROM notifications WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async listForUser(
    db: Db,
    userId: string,
    options: { unreadOnly?: boolean; limit: number; offset: number },
  ): Promise<{ rows: NotificationRow[]; total: number }> {
    const conditions = ['user_id = ?', 'deleted_at IS NULL'];
    const params: unknown[] = [userId];
    if (options.unreadOnly === true) conditions.push('read_at IS NULL');

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await selectRows<NotificationRow>(
      db,
      `SELECT ${COLUMNS} FROM notifications ${where}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, options.limit, options.offset],
    );
    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM notifications ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  async countUnread(db: Db, userId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND read_at IS NULL AND deleted_at IS NULL',
      [userId],
    );
    return row === null ? 0 : Number(row.total);
  }

  /**
   * Fan-out insert. One statement and one cursor block for the whole recipient set, so a
   * mention of twenty people is not twenty round trips.
   */
  async insertMany(db: Db, inputs: readonly InsertNotificationInput[]): Promise<NotificationRow[]> {
    if (inputs.length === 0) return [];

    const firstSeq = await allocateSyncSeqBlock(db, inputs.length);
    const now = toDbDateTime();

    const placeholders = inputs.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)').join(', ');
    const params: unknown[] = [];
    inputs.forEach((input, index) => {
      params.push(
        input.id,
        input.userId,
        input.type,
        input.title,
        input.body,
        input.boardId,
        input.orderId,
        input.actorId,
        toJsonColumn(input.data),
        now,
        now,
        firstSeq + index,
      );
    });

    await mutate(
      db,
      `INSERT INTO notifications
        (id, user_id, type, title, body, board_id, order_id, actor_id, data,
         created_at, updated_at, revision, sync_seq)
       VALUES ${placeholders}`,
      params,
    );

    const ids = inputs.map((input) => input.id);
    return selectRows<NotificationRow>(
      db,
      `SELECT ${COLUMNS} FROM notifications WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids,
    );
  }

  async markRead(db: Db, userId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const firstSeq = await allocateSyncSeqBlock(db, ids.length);
    const now = toDbDateTime();
    let updated = 0;

    for (const [index, id] of ids.entries()) {
      const result = await mutate(
        db,
        `UPDATE notifications
            SET read_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
          WHERE id = ? AND user_id = ? AND read_at IS NULL AND deleted_at IS NULL`,
        [now, now, firstSeq + index, id, userId],
      );
      updated += result.affectedRows;
    }
    return updated;
  }

  /** Permanent removal from the user's inbox — a tombstone, so other devices sync the delete. */
  async softDelete(db: Db, userId: string, id: string): Promise<boolean> {
    const syncSeq = await allocateSyncSeqBlock(db, 1);
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE notifications
          SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id, userId],
    );
    return result.affectedRows > 0;
  }

  async markAllRead(db: Db, userId: string): Promise<number> {
    const unread = await selectRows<NotificationRow>(
      db,
      'SELECT id FROM notifications WHERE user_id = ? AND read_at IS NULL AND deleted_at IS NULL',
      [userId],
    );
    return this.markRead(
      db,
      userId,
      unread.map((row) => row.id),
    );
  }

  /** Notifications are private: a pull is always scoped to the requesting user. */
  async changedSince(
    db: Db,
    cursor: number,
    limit: number,
    userId: string,
  ): Promise<NotificationRow[]> {
    return selectRows<NotificationRow>(
      db,
      `SELECT ${COLUMNS} FROM notifications
        WHERE sync_seq > ? AND user_id = ?
        ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, userId, limit],
    );
  }
}

export const notificationRepository = new NotificationRepository();
