import type { PushableEntity, SyncOp } from '@menuboard/shared';
import { SyncState } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { SyncQueueRow } from '../models';
import { newId } from '../../utils/uuid';
import { nowIso } from '../../utils/date';
import { nudgeSync } from '../../sync/syncNudge';

/**
 * Durable local outbox matching `sync_queue` in docs/sqlite-schema.sql.
 *
 * Phase 5+ drains this queue through `/api/v1/sync/push`, handles per-item results,
 * retries transient failures with exponential backoff, and surfaces terminal failures
 * to the UI via `sync_state = 'FAILED'` on the owning entity row.
 */

const ENTITY_TABLES: Record<string, { table: string; hasErrorColumn: boolean }> = {
  users: { table: 'users', hasErrorColumn: false },
  boards: { table: 'boards', hasErrorColumn: true },
  board_members: { table: 'board_members', hasErrorColumn: false },
  stations: { table: 'stations', hasErrorColumn: false },
  activity_types: { table: 'activity_types', hasErrorColumn: false },
  menu_categories: { table: 'menu_categories', hasErrorColumn: false },
  menu_items: { table: 'menu_items', hasErrorColumn: false },
  orders: { table: 'orders', hasErrorColumn: true },
  order_items: { table: 'order_items', hasErrorColumn: false },
  attachments: { table: 'attachments', hasErrorColumn: true },
  thread_messages: { table: 'thread_messages', hasErrorColumn: true },
  acknowledgements: { table: 'acknowledgements', hasErrorColumn: false },
};

export const syncQueueRepository = {
  async enqueue(params: {
    entity: PushableEntity;
    entityId: string;
    op: SyncOp;
    payload: Record<string, unknown> | null;
    baseRevision?: number;
  }): Promise<void> {
    const db = await getDb();
    const maxRow = await db.getFirstAsync<{ maxSeq: number | null }>(
      'SELECT MAX(sequence) as maxSeq FROM sync_queue',
    );
    const nextSequence = (maxRow?.maxSeq ?? 0) + 1;
    const now = nowIso();
    await db.runAsync(
      `INSERT INTO sync_queue (id, entity, entity_id, op, payload, base_revision, attempts,
         last_attempt_at, next_attempt_at, last_error, status, created_at, sequence)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 'PENDING', ?, ?)`,
      [
        newId(),
        params.entity,
        params.entityId,
        params.op,
        params.payload ? JSON.stringify(params.payload) : null,
        params.baseRevision ?? null,
        now,
        nextSequence,
      ],
    );
    // Push this change right away instead of waiting for the periodic timer — this is what
    // makes an order created here appear on other devices within a second or two.
    nudgeSync();
  },

  async countPending(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM sync_queue WHERE status IN ('PENDING', 'FAILED')`,
    );
    return row?.c ?? 0;
  },

  async listPending(limit = 200): Promise<SyncQueueRow[]> {
    const db = await getDb();
    return db.getAllAsync<SyncQueueRow>(
      `SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY sequence ASC LIMIT ?`,
      [limit],
    );
  },

  /**
   * Rows ready for the next push drain: PENDING or FAILED whose backoff has expired.
   * Ordered by sequence so dependencies created offline are pushed in creation order.
   */
  async listPendingForDrain(limit = 200): Promise<SyncQueueRow[]> {
    const db = await getDb();
    const now = nowIso();
    return db.getAllAsync<SyncQueueRow>(
      `SELECT * FROM sync_queue
       WHERE status IN ('PENDING', 'FAILED')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY sequence ASC
       LIMIT ?`,
      [now, limit],
    );
  },

  async remove(id: string, tx?: SQLite.SQLiteDatabase): Promise<void> {
    const db = tx ?? (await getDb());
    await db.runAsync('DELETE FROM sync_queue WHERE id = ?', [id]);
  },

  async markFailed(
    id: string,
    attempts: number,
    nextAttemptAt: string | null,
    error: string | null,
    tx?: SQLite.SQLiteDatabase,
  ): Promise<void> {
    const db = tx ?? (await getDb());
    const now = nowIso();
    await db.runAsync(
      `UPDATE sync_queue
       SET status = 'FAILED', attempts = ?, last_attempt_at = ?, next_attempt_at = ?,
           last_error = ?
       WHERE id = ?`,
      [attempts, now, nextAttemptAt, error, id],
    );
  },

  /**
   * After a transient failure that affects the whole batch (network/auth), mark every
   * row that was in this batch with the same backoff so the next drain retries them.
   */
  async markBatchFailed(
    ids: readonly string[],
    error: string | null,
    computeNextAttemptAt: (attempts: number) => string | null,
    tx?: SQLite.SQLiteDatabase,
  ): Promise<void> {
    if (ids.length === 0) return;
    const db = tx ?? (await getDb());
    const rows = await db.getAllAsync<SyncQueueRow>(
      `SELECT * FROM sync_queue WHERE id IN (${ids.map(() => '?').join(',')})`,
      [...ids],
    );
    for (const row of rows) {
      const nextAttempt = computeNextAttemptAt(row.attempts + 1);
      await this.markFailed(row.id, row.attempts + 1, nextAttempt, error, db);
    }
  },

  /**
   * Reflects the result of a push attempt on the owning entity row. REJECTED rows become
   * `sync_state = 'FAILED'` with the server message; everything else is marked `SYNCED`.
   */
  async updateEntitySyncState(
    entity: string,
    entityId: string,
    state: SyncState,
    error: string | null = null,
    tx?: SQLite.SQLiteDatabase,
  ): Promise<void> {
    const meta = ENTITY_TABLES[entity];
    if (!meta) return;
    const db = tx ?? (await getDb());
    if (meta.hasErrorColumn) {
      await db.runAsync(
        `UPDATE ${meta.table} SET sync_state = ?, sync_error = ? WHERE id = ?`,
        [state, error, entityId],
      );
    } else {
      await db.runAsync(
        `UPDATE ${meta.table} SET sync_state = ? WHERE id = ?`,
        [state, entityId],
      );
    }
  },
};
