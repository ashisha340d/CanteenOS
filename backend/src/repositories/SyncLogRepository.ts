import type { SyncDirection } from '@menuboard/shared';
import { mutate, type Db } from '../db/types';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

export interface SyncLogInput {
  id: string;
  userId: string | null;
  deviceId: string | null;
  direction: SyncDirection;
  cursorFrom: number | null;
  cursorTo: number | null;
  entityCounts: Record<string, number> | null;
  pushedCount: number;
  appliedCount: number;
  conflictCount: number;
  failedCount: number;
  status: 'OK' | 'PARTIAL' | 'ERROR';
  error: string | null;
  startedAt: Date;
}

/**
 * Diagnostics for the sync pipeline. Written outside the sync transaction so a logging
 * failure can never roll back applied data.
 */
export class SyncLogRepository {
  async insert(db: Db, input: SyncLogInput): Promise<void> {
    const finishedAt = new Date();
    await mutate(
      db,
      `INSERT INTO sync_logs
        (id, user_id, device_id, direction, cursor_from, cursor_to, entity_counts,
         pushed_count, applied_count, conflict_count, failed_count, status, error,
         started_at, finished_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.deviceId,
        input.direction,
        input.cursorFrom,
        input.cursorTo,
        toJsonColumn(input.entityCounts),
        input.pushedCount,
        input.appliedCount,
        input.conflictCount,
        input.failedCount,
        input.status,
        // Truncated to the column width so an oversized driver message cannot fail the insert.
        input.error === null ? null : input.error.slice(0, 1000),
        toDbDateTime(input.startedAt),
        toDbDateTime(finishedAt),
        finishedAt.getTime() - input.startedAt.getTime(),
      ],
    );
  }
}

export const syncLogRepository = new SyncLogRepository();
