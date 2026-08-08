import { NotificationType, type NotificationDto } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { currentSyncSeq } from '../db/syncSeq';
import type { Db } from '../db/types';
import { mapNotification } from '../models/mappers';
import {
  notificationRepository,
  type InsertNotificationInput,
} from '../repositories/NotificationRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { pushDispatchService } from './PushDispatchService';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';

export interface NotificationTarget {
  userIds: readonly string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  boardId?: string | null;
  orderId?: string | null;
  actorId?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Creates in-app notifications and hints the recipient's devices to sync.
 *
 * Notification rows are written inside the caller's transaction so they commit with the event
 * that caused them; the realtime hint is emitted separately, after commit, by the caller.
 */
export class NotificationService {
  /**
   * Fans out to a recipient set. The actor is always excluded — nobody needs telling about
   * their own action — and duplicates are collapsed so a user mentioned twice gets one row.
   */
  async notify(db: Db, target: NotificationTarget): Promise<NotificationDto[]> {
    const recipients = [...new Set(target.userIds)].filter(
      (userId) => userId !== target.actorId && userId !== '',
    );
    if (recipients.length === 0) return [];

    const inputs: InsertNotificationInput[] = recipients.map((userId) => ({
      id: newId(),
      userId,
      type: target.type,
      title: target.title,
      body: target.body ?? null,
      boardId: target.boardId ?? null,
      orderId: target.orderId ?? null,
      actorId: target.actorId ?? null,
      data: target.data ?? null,
    }));

    const rows = await notificationRepository.insertMany(db, inputs);
    return rows.map(mapNotification);
  }

  /**
   * Emits the per-user socket hints for notifications created in a committed transaction.
   * Called after commit so a device that reacts instantly finds the data already visible.
   */
  publish(notifications: readonly NotificationDto[]): void {
    for (const notification of notifications) {
      realtime.emitNotification(notification.userId, notification.id, notification.syncSeq);
    }

    // Push delivery is best-effort and must not block socket/realtime emission.
    pushDispatchService.dispatch(notifications).catch((error) => {
      logger.warn('push dispatch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async list(
    userId: string,
    query: { unreadOnly?: boolean; page?: number; pageSize?: number },
  ) {
    const { page, pageSize, offset } = resolvePaging(query);
    const { rows, total } = await notificationRepository.listForUser(getPool(), userId, {
      ...(query.unreadOnly !== undefined ? { unreadOnly: query.unreadOnly } : {}),
      limit: pageSize,
      offset,
    });
    return buildPage(rows.map(mapNotification), total, page, pageSize);
  }

  async unreadCount(userId: string): Promise<number> {
    return notificationRepository.countUnread(getPool(), userId);
  }

  async markRead(userId: string, ids: readonly string[]): Promise<{ updated: number; cursor: number }> {
    const pool = getPool();
    const updated = await notificationRepository.markRead(pool, userId, ids);
    const cursor = await currentSyncSeq(pool);
    if (updated > 0) realtime.emitSyncHint(userId, cursor);
    return { updated, cursor };
  }

  async markAllRead(userId: string): Promise<{ updated: number; cursor: number }> {
    const pool = getPool();
    const updated = await notificationRepository.markAllRead(pool, userId);
    const cursor = await currentSyncSeq(pool);
    if (updated > 0) realtime.emitSyncHint(userId, cursor);
    return { updated, cursor };
  }

  /**
   * Removes one notification from the caller's own inbox permanently. Implemented as a
   * tombstone (`deleted_at`) rather than a hard delete so other signed-in devices pick up the
   * removal on their next sync pull, same as every other synced entity.
   */
  async remove(userId: string, id: string): Promise<{ removed: boolean; cursor: number }> {
    const pool = getPool();
    const removed = await notificationRepository.softDelete(pool, userId, id);
    const cursor = await currentSyncSeq(pool);
    if (removed) realtime.emitSyncHint(userId, cursor);
    return { removed, cursor };
  }
}

export const notificationService = new NotificationService();
