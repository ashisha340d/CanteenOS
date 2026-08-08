import type { AcknowledgementDto } from '@menuboard/shared';
import { SyncOp } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { AcknowledgementRow } from '../models';
import { newId } from '../../utils/uuid';
import { nowIso } from '../../utils/date';
import { orderRepository } from './orderRepository';
import { syncQueueRepository } from './syncQueueRepository';
import { threadRepository } from './threadRepository';

function toDto(row: AcknowledgementRow, userName?: string): AcknowledgementDto {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    acknowledgedAt: row.acknowledged_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
    userName,
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

export const acknowledgementRepository = {
  async upsertMany(rows: AcknowledgementDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const a of rows) {
        await db.runAsync(
          `INSERT INTO acknowledgements (id, order_id, user_id, acknowledged_at, note,
             created_at, updated_at, deleted_at, revision, server_sync_seq, sync_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')
           ON CONFLICT(id) DO UPDATE SET
             acknowledged_at = excluded.acknowledged_at, note = excluded.note,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq,
             sync_state = 'SYNCED'`,
          [a.id, a.orderId, a.userId, a.acknowledgedAt, a.note, a.createdAt, a.updatedAt,
          a.deletedAt, a.revision, a.syncSeq],
        );
      }
    });
  },

  async listForOrder(orderId: string): Promise<AcknowledgementDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<AcknowledgementRow & { user_name: string | null }>(
      `SELECT a.*, u.name AS user_name FROM acknowledgements a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.order_id = ? AND a.deleted_at IS NULL ORDER BY a.acknowledged_at ASC`,
      [orderId],
    );
    return rows.map((r) => toDto(r, r.user_name ?? undefined));
  },

  /** Acknowledgements for many orders at once, grouped by order id — one query for a feed. */
  async listForOrders(orderIds: readonly string[]): Promise<Map<string, AcknowledgementDto[]>> {
    const map = new Map<string, AcknowledgementDto[]>();
    if (orderIds.length === 0) return map;
    const db = await getDb();
    const placeholders = orderIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<AcknowledgementRow & { user_name: string | null }>(
      `SELECT a.*, u.name AS user_name FROM acknowledgements a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.order_id IN (${placeholders}) AND a.deleted_at IS NULL
       ORDER BY a.acknowledged_at ASC`,
      [...orderIds],
    );
    for (const row of rows) {
      const list = map.get(row.order_id) ?? [];
      list.push(toDto(row, row.user_name ?? undefined));
      map.set(row.order_id, list);
    }
    return map;
  },

  async findForUser(orderId: string, userId: string): Promise<AcknowledgementDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<AcknowledgementRow>(
      `SELECT * FROM acknowledgements WHERE order_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [orderId, userId],
    );
    return row ? toDto(row) : null;
  },

  /** Local-first, idempotent per (orderId, userId) — matches the unique index in SQLite. */
  async acknowledgeLocal(orderId: string, userId: string, note?: string | null): Promise<AcknowledgementDto> {
    const existing = await this.findForUser(orderId, userId);
    if (existing) return existing;

    const now = nowIso();
    const ack: AcknowledgementDto = {
      id: newId(),
      orderId,
      userId,
      acknowledgedAt: now,
      note: note ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      syncSeq: 0,
      revision: 1,
    };
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO acknowledgements (id, order_id, user_id, acknowledged_at, note, created_at,
         updated_at, deleted_at, revision, server_sync_seq, sync_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 0, 'PENDING')`,
      [ack.id, ack.orderId, ack.userId, ack.acknowledgedAt, ack.note, ack.createdAt, ack.updatedAt],
    );
    await syncQueueRepository.enqueue({
      entity: 'acknowledgements',
      entityId: ack.id,
      op: SyncOp.UPSERT,
      payload: { id: ack.id, orderId: ack.orderId, note: ack.note },
    });
    // The feed row is board-scoped now, so the order's board has to be resolved first.
    const order = await orderRepository.findById(orderId);
    if (order !== null) {
      await threadRepository.recordSystemEventLocal(order.boardId, orderId, 'ORDER_ACKNOWLEDGED', {
        userId,
      });
    }
    return ack;
  },

  /** Withdraw your own acknowledgement — a tombstone, never a hard delete. */
  async withdrawLocal(orderId: string, userId: string): Promise<void> {
    const existing = await this.findForUser(orderId, userId);
    if (!existing) return;
    const now = nowIso();
    const db = await getDb();
    await db.runAsync(
      `UPDATE acknowledgements SET deleted_at = ?, updated_at = ?, revision = revision + 1,
         sync_state = 'PENDING' WHERE id = ?`,
      [now, now, existing.id],
    );
    await syncQueueRepository.enqueue({
      entity: 'acknowledgements',
      entityId: existing.id,
      op: SyncOp.DELETE,
      payload: null,
      baseRevision: existing.revision,
    });
  },
};
