import type {
  AcknowledgementDto,
  AttachmentDto,
  BoardDto,
  OrderDto,
  OrderItemDto,
  SyncPushItem,
  SyncPushItemResult,
  ThreadMessageDto,
} from '@menuboard/shared';
import { LIMITS, PushableEntity, SyncOp, SyncResultStatus } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { syncApi } from '../api';
import { getDb } from '../db/client';
import {
  acknowledgementRepository,
  attachmentRepository,
  boardRepository,
  orderRepository,
  syncQueueRepository,
  threadRepository,
} from '../db/repositories';
import type { SyncQueueRow } from '../db/models';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { computeNextAttemptAtIso } from './backoff';
import { useSyncStatusStore } from '../state/syncStatusStore';

export async function runPushDrain(): Promise<void> {
  const rows = await syncQueueRepository.listPendingForDrain(LIMITS.SYNC_PUSH_BATCH_MAX);
  if (rows.length === 0) return;

  const deviceId = await getOrCreateDeviceId();
  const items: SyncPushItem[] = rows.map((row) => ({
    clientOpId: row.id,
    entity: row.entity as PushableEntity,
    entityId: row.entity_id,
    op: row.op as SyncOp,
    payload: row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : null,
    clientTimestamp: row.created_at,
    baseRevision: row.base_revision ?? undefined,
  }));

  try {
    const response = await syncApi.push({ deviceId, items });
    await handlePushResponse(response.results, rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network or server error';
    await handleBatchFailure(rows, message);
  }
}

async function handlePushResponse(
  results: SyncPushItemResult[],
  queuedRows: SyncQueueRow[],
): Promise<void> {
  const rowByClientOpId = new Map(queuedRows.map((r) => [r.id, r]));
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    for (const result of results) {
      const row = rowByClientOpId.get(result.clientOpId);
      if (!row) continue;
      await handleItemResult(result, row, db);
    }
  });

  useSyncStatusStore.getState().refresh();
}

async function handleItemResult(
  result: SyncPushItemResult,
  row: SyncQueueRow,
  tx: SQLite.SQLiteDatabase,
): Promise<void> {
  switch (result.status) {
    case SyncResultStatus.APPLIED:
    case SyncResultStatus.DUPLICATE:
      if (result.serverEntity) {
        await adoptServerEntity(result.entity, result.serverEntity, tx);
      }
      await syncQueueRepository.remove(row.id, tx);
      await syncQueueRepository.updateEntitySyncState(
        row.entity,
        row.entity_id,
        'SYNCED',
        null,
        tx,
      );
      break;

    case SyncResultStatus.SUPERSEDED:
      await adoptServerEntity(result.entity, result.serverEntity, tx);
      await syncQueueRepository.remove(row.id, tx);
      await syncQueueRepository.updateEntitySyncState(
        row.entity,
        row.entity_id,
        'SYNCED',
        null,
        tx,
      );
      break;

    case SyncResultStatus.REJECTED:
      await syncQueueRepository.remove(row.id, tx);
      await syncQueueRepository.updateEntitySyncState(
        row.entity,
        row.entity_id,
        'FAILED',
        result.errorMessage ?? result.errorCode ?? 'Rejected by server',
        tx,
      );
      useSyncStatusStore
        .getState()
        .setError(`${result.entity} ${result.entityId}: ${result.errorMessage ?? result.errorCode ?? 'Rejected'}`);
      break;

    case SyncResultStatus.FAILED:
      await syncQueueRepository.markFailed(
        row.id,
        row.attempts + 1,
        computeNextAttemptAtIso(row.attempts + 1),
        result.errorMessage ?? result.errorCode ?? 'Failed',
        tx,
      );
      break;
  }
}

async function handleBatchFailure(
  rows: SyncQueueRow[],
  error: string | null,
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      await syncQueueRepository.markFailed(
        row.id,
        row.attempts + 1,
        computeNextAttemptAtIso(row.attempts + 1),
        error,
        db,
      );
    }
  });
  useSyncStatusStore.getState().refresh();
}

async function adoptServerEntity(
  entity: PushableEntity,
  serverEntity: unknown,
  tx: SQLite.SQLiteDatabase,
): Promise<void> {
  switch (entity) {
    case 'boards':
      await boardRepository.upsertMany([serverEntity as BoardDto], tx);
      break;
    case 'orders':
      await orderRepository.upsertMany([serverEntity as OrderDto], tx);
      break;
    case 'order_items':
      await orderRepository.upsertItems([serverEntity as OrderItemDto], tx);
      break;
    case 'attachments':
      await attachmentRepository.upsertMany([serverEntity as AttachmentDto], new Map(), tx);
      break;
    case 'thread_messages':
      await threadRepository.upsertMany([serverEntity as ThreadMessageDto], tx);
      break;
    case 'acknowledgements':
      await acknowledgementRepository.upsertMany([serverEntity as AcknowledgementDto], tx);
      break;
    default:
      break;
  }
}
