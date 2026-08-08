import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { AcknowledgementRow, CountRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

const COLUMNS = `
  a.id, a.order_id, a.user_id, a.acknowledged_at, a.note,
  a.created_at, a.updated_at, a.deleted_at, a.revision, a.sync_seq`;

export class AcknowledgementRepository {
  async find(db: Db, orderId: string, userId: string): Promise<AcknowledgementRow | null> {
    return selectOne<AcknowledgementRow>(
      db,
      `SELECT ${COLUMNS} FROM acknowledgements a WHERE a.order_id = ? AND a.user_id = ?`,
      [orderId, userId],
    );
  }

  async listForOrder(db: Db, orderId: string): Promise<AcknowledgementRow[]> {
    return selectRows<AcknowledgementRow>(
      db,
      `SELECT ${COLUMNS}, u.name AS user_name
         FROM acknowledgements a
        INNER JOIN users u ON u.id = a.user_id
        WHERE a.order_id = ? AND a.deleted_at IS NULL
        ORDER BY a.acknowledged_at ASC`,
      [orderId],
    );
  }

  async listForOrders(db: Db, orderIds: readonly string[]): Promise<AcknowledgementRow[]> {
    if (orderIds.length === 0) return [];
    const placeholders = orderIds.map(() => '?').join(', ');
    return selectRows<AcknowledgementRow>(
      db,
      `SELECT ${COLUMNS}, u.name AS user_name
         FROM acknowledgements a
        INNER JOIN users u ON u.id = a.user_id
        WHERE a.order_id IN (${placeholders}) AND a.deleted_at IS NULL
        ORDER BY a.acknowledged_at ASC`,
      orderIds,
    );
  }

  async countForOrder(db: Db, orderId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      'SELECT COUNT(*) AS total FROM acknowledgements WHERE order_id = ? AND deleted_at IS NULL',
      [orderId],
    );
    return row === null ? 0 : Number(row.total);
  }

  /**
   * Acknowledging twice is a no-op rather than an error: the operation is idempotent by
   * `(order_id, user_id)`, which is what makes it conflict-free under offline sync.
   *
   * Returns the row plus whether this call actually created it, so the service knows
   * whether to raise a notification.
   */
  async upsert(
    db: Db,
    input: { id: string; orderId: string; userId: string; note: string | null; at?: Date },
  ): Promise<{ row: AcknowledgementRow; created: boolean }> {
    const existing = await this.find(db, input.orderId, input.userId);
    if (existing !== null && existing.deleted_at === null) {
      return { row: existing, created: false };
    }

    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const acknowledgedAt = input.at ? toDbDateTime(input.at) : now;

    await mutate(
      db,
      `INSERT INTO acknowledgements
        (id, order_id, user_id, acknowledged_at, note, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         acknowledged_at = VALUES(acknowledged_at),
         note            = VALUES(note),
         deleted_at      = NULL,
         updated_at      = VALUES(updated_at),
         revision        = acknowledgements.revision + 1,
         sync_seq        = VALUES(sync_seq)`,
      [input.id, input.orderId, input.userId, acknowledgedAt, input.note, now, now, syncSeq],
    );

    const row = await this.find(db, input.orderId, input.userId);
    if (row === null) throw new Error('Upserted acknowledgement could not be read back');
    return { row, created: true };
  }

  async softDelete(db: Db, orderId: string, userId: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE acknowledgements
          SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE order_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, orderId, userId],
    );
  }

  /**
   * Active board members who have not yet acknowledged. Drives the "Pending Users" list on
   * the Order Detail screen.
   */
  async findPendingUserIds(db: Db, orderId: string, boardId: string): Promise<string[]> {
    const rows = await selectRows<AcknowledgementRow & { user_id: string }>(
      db,
      `SELECT bm.user_id
         FROM board_members bm
        WHERE bm.board_id = ? AND bm.status = 'ACTIVE' AND bm.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM acknowledgements a
             WHERE a.order_id = ? AND a.user_id = bm.user_id AND a.deleted_at IS NULL
          )`,
      [boardId, orderId],
    );
    return rows.map((row) => row.user_id);
  }

  async changedSince(
    db: Db,
    cursor: number,
    limit: number,
    boardIds: readonly string[],
  ): Promise<AcknowledgementRow[]> {
    if (boardIds.length === 0) return [];
    const placeholders = boardIds.map(() => '?').join(', ');
    return selectRows<AcknowledgementRow>(
      db,
      `SELECT ${COLUMNS}
         FROM acknowledgements a
        INNER JOIN orders o ON o.id = a.order_id
        WHERE a.sync_seq > ? AND o.board_id IN (${placeholders})
        ORDER BY a.sync_seq ASC LIMIT ?`,
      [cursor, ...boardIds, limit],
    );
  }
}

export const acknowledgementRepository = new AcknowledgementRepository();
