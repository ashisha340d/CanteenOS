import { Expo, type ExpoPushTicket } from 'expo-server-sdk';
import type { NotificationDto, NotificationType } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { refreshTokenRepository } from '../repositories/RefreshTokenRepository';
import { settingsService } from './SettingsService';
import { logger } from '../utils/logger';

const PUSH_NOTIFICATION_TYPE_TO_EXPO: Record<
  NotificationType,
  | 'default'
  | 'mention'
  | 'message'
  | 'acknowledgement'
  | 'order'
  | 'invitation'
  | 'status'
  | 'alarm'
> = {
  NEW_ORDER: 'order',
  MENTION: 'mention',
  THREAD_REPLY: 'message',
  ACKNOWLEDGEMENT: 'acknowledgement',
  STATUS_CHANGED: 'status',
  BOARD_INVITATION: 'invitation',
  // Its own channel so the buzzer can bypass the quiet settings the other categories honour.
  ALERT: 'alarm',
};

interface PushTarget {
  userId: string;
  token: string;
  notification: NotificationDto;
}

/**
 * Sends Expo push notifications for in-app notifications created by NotificationService.
 *
 * - Gated on the `notifications.push_enabled` setting.
 * - Batches chunks through the Expo push service.
 * - Prunes tokens reported as `DeviceNotRegistered` so stale tokens stop consuming work.
 */
export class PushDispatchService {
  private expo = new Expo({ useFcmV1: true });

  async dispatch(notifications: readonly NotificationDto[]): Promise<void> {
    if (notifications.length === 0) return;

    const enabled = await settingsService.get<boolean>('notifications.push_enabled');
    if (!enabled) {
      logger.debug('push notifications disabled by notifications.push_enabled');
      return;
    }

    const userIds = [...new Set(notifications.map((n) => n.userId))];
    const tokens = await refreshTokenRepository.findPushTokensForUsers(getPool(), userIds);
    if (tokens.length === 0) return;

    const tokenByUser = new Map<string, string[]>();
    for (const { userId, pushToken } of tokens) {
      if (!Expo.isExpoPushToken(pushToken)) continue;
      const list = tokenByUser.get(userId) ?? [];
      list.push(pushToken);
      tokenByUser.set(userId, list);
    }

    const targets: PushTarget[] = [];
    for (const notification of notifications) {
      const userTokens = tokenByUser.get(notification.userId) ?? [];
      for (const token of userTokens) {
        targets.push({ userId: notification.userId, token, notification });
      }
    }
    if (targets.length === 0) return;

    const messages = targets.map((target) => ({
      to: target.token,
      sound: 'default' as const,
      title: target.notification.title,
      body: target.notification.body ?? undefined,
      data: {
        notificationId: target.notification.id,
        type: target.notification.type,
        boardId: target.notification.boardId,
        orderId: target.notification.orderId,
      },
      categoryId: PUSH_NOTIFICATION_TYPE_TO_EXPO[target.notification.type],
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    const ticketsChunks: ExpoPushTicket[][] = [];
    for (const chunk of chunks) {
      ticketsChunks.push(await this.expo.sendPushNotificationsAsync(chunk));
    }

    const invalidTokens = new Set<string>();
    let ticketIndex = 0;
    for (const tickets of ticketsChunks) {
      for (const ticket of tickets) {
        const token = targets[ticketIndex]?.token;
        if (ticket.status === 'error' && token) {
          logger.warn('push ticket error', {
            token,
            error: ticket.message,
            details: ticket.details,
          });
          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.add(token);
          }
        }
        ticketIndex += 1;
      }
    }

    if (invalidTokens.size > 0) {
      for (const token of invalidTokens) {
        await refreshTokenRepository.clearPushToken(getPool(), token);
      }
      logger.info('pruned invalid push tokens', { count: invalidTokens.size });
    }
  }
}

export const pushDispatchService = new PushDispatchService();
