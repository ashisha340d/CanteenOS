import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { NotificationDto, NotificationType } from '@menuboard/shared';
import { notificationsApi } from '../src/api/notifications';
import { notificationRepository, orderRepository } from '../src/db/repositories';
import { useAuthStore } from '../src/state/authStore';
import { useSyncedFocusLoad } from '../src/hooks/useSyncedFocusLoad';
import { EmptyState } from '../src/components/EmptyState';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { PressableScale } from '../src/components/PressableScale';
import { Card } from '../src/components/Card';
import { TopAppBar } from '../src/components/TopAppBar';
import { formatDateTimeDisplay, todayIsoDate } from '../src/utils/date';
import { colors, spacing, typography, fonts } from '../src/theme/tokens';

const TYPE_ICON: Record<NotificationType, keyof typeof Ionicons.glyphMap> = {
  NEW_ORDER: 'cart-outline',
  MENTION: 'at-outline',
  THREAD_REPLY: 'chatbubble-outline',
  ACKNOWLEDGEMENT: 'checkmark-circle-outline',
  STATUS_CHANGED: 'sync-outline',
  BOARD_INVITATION: 'people-outline',
  ALERT: 'alarm-outline',
  MAINTENANCE_DUE: 'calendar-outline',
  MAINTENANCE_OVERDUE: 'alert-circle-outline',
  MAINTENANCE_CRITICAL: 'warning-outline',
  MAINTENANCE_REPORTED: 'construct-outline',
  MAINTENANCE_ASSIGNED: 'person-add-outline',
  MAINTENANCE_COMPLETED: 'checkmark-done-outline',
  EQUIPMENT_OUT_OF_SERVICE: 'close-circle-outline',
  WARRANTY_EXPIRING: 'shield-outline',
  SUPPLIER_FOLLOW_UP: 'call-outline',

  CLEANING_TASK_ASSIGNED: 'sparkles-outline',
  CLEANING_TASK_DUE: 'time-outline',
  CLEANING_TASK_OVERDUE: 'alert-circle-outline',
  CLEANING_TASK_UNASSIGNED: 'help-circle-outline',
  CLEANING_VERIFICATION_REQUIRED: 'eye-outline',
  CLEANING_VERIFICATION_FAILED: 'close-circle-outline',
  CLEANING_RECLEAN_REQUIRED: 'refresh-circle-outline',
  CLEANING_CORRECTIVE_ACTION_ASSIGNED: 'build-outline',
  CLEANING_CORRECTIVE_ACTION_OVERDUE: 'warning-outline',
  HYGIENE_COMPLIANCE_ALERT: 'shield-half-outline',
};

/**
 * Equipment and cleaning notifications carry their subject in `data` rather than in a column,
 * because neither entity is board- or order-scoped.
 */
function stringFromData(
  data: Record<string, unknown> | null,
  key: 'ticketId' | 'equipmentId' | 'taskId' | 'correctiveActionId',
): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export default function NotificationsScreen(): React.JSX.Element {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<NotificationDto[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const all = await notificationRepository.listForUser(user.id);

    // Only today's and upcoming orders are relevant to act on; a notification about an order
    // that has already passed its required date is noise. Notifications with no linked order
    // (mentions, board invitations, …) are never date-filtered.
    const today = todayIsoDate();
    const filtered = await Promise.all(
      all.map(async (n) => {
        if (!n.orderId) return n;
        const order = await orderRepository.findById(n.orderId);
        if (order && order.requiredDate < today) return null;
        return n;
      }),
    );
    setItems(filtered.filter((n): n is NotificationDto => n !== null));
  }, [user]);

  useSyncedFocusLoad(load);

  const onMarkAllRead = async (): Promise<void> => {
    if (!user) return;
    await notificationRepository.markAllReadLocal(user.id);
    await load();
  };

  const onOpen = async (notification: NotificationDto): Promise<void> => {
    await notificationRepository.markReadLocal([notification.id]);
    await load();

    // A maintenance notification points at a ticket, or failing that at the asset itself; a
    // cleaning one points at the task. Checked before the order/board fallbacks because
    // neither module's notifications carry either column.
    const ticketId = stringFromData(notification.data, 'ticketId');
    const equipmentId = stringFromData(notification.data, 'equipmentId');
    const isCleaning = notification.type.startsWith('CLEANING');
    // A corrective action carries its parent task too, and both would open something true — but
    // the fix is what the reader was paged about, so it wins.
    const correctiveActionId = isCleaning
      ? stringFromData(notification.data, 'correctiveActionId')
      : null;
    const cleaningTaskId = isCleaning ? stringFromData(notification.data, 'taskId') : null;
    if (correctiveActionId !== null) {
      router.push({
        pathname: '/cleaning/corrective/[actionId]',
        params: { actionId: correctiveActionId },
      });
    } else if (cleaningTaskId !== null) {
      router.push({ pathname: '/cleaning/[taskId]', params: { taskId: cleaningTaskId } });
    } else if (ticketId !== null) {
      router.push({ pathname: '/equipment/tickets/[ticketId]', params: { ticketId } });
    } else if (equipmentId !== null) {
      router.push({ pathname: '/equipment/[equipmentId]', params: { equipmentId } });
    } else if (notification.orderId) {
      router.push({ pathname: '/orders/[orderId]', params: { orderId: notification.orderId } });
    } else if (notification.boardId) {
      router.push({ pathname: '/boards/[boardId]', params: { boardId: notification.boardId } });
    }
  };

  const onRemove = async (notification: NotificationDto): Promise<void> => {
    // Optimistic: drop it from the list immediately, then confirm with the server. Notifications
    // are not a pushable entity, so there is no outbox to fall back on if this call fails —
    // reload restores it in that case rather than leaving the UI silently wrong.
    setItems((prev) => prev.filter((n) => n.id !== notification.id));
    try {
      await notificationsApi.remove(notification.id);
      await notificationRepository.removeLocal(notification.id);
    } catch {
      await load();
    }
  };

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <View style={styles.container}>
      <TopAppBar title="Notifications" onBack={() => router.back()} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(n) => n.id}
        ListHeaderComponent={
          unreadCount > 0 ? (
            <View style={styles.headerActions}>
              <PrimaryButton label="Mark all as read" variant="secondary" onPress={onMarkAllRead} size="sm" />
            </View>
          ) : null
        }
        ListEmptyComponent={<EmptyState title="No notifications" />}
        renderItem={({ item, index }) => {
          const icon = TYPE_ICON[item.type] ?? 'notifications-outline';
          return (
            <Animated.View entering={FadeInUp.delay(index * 30).duration(300).springify()}>
              <PressableScale onPress={() => onOpen(item)}>
                <Card style={[styles.card, !item.readAt && styles.unread]}>
                  <View style={styles.row}>
                    <View style={[styles.iconCircle, !item.readAt && styles.iconCircleUnread]}>
                      <Ionicons name={icon} size={18} color={!item.readAt ? colors.primary600 : colors.gray500} />
                    </View>
                    <View style={styles.body}>
                      <Text style={styles.title}>{item.title}</Text>
                      {item.body ? <Text style={styles.bodyText}>{item.body}</Text> : null}
                      <Text style={styles.time}>{formatDateTimeDisplay(item.createdAt)}</Text>
                    </View>
                    {!item.readAt ? <View style={styles.unreadDot} /> : null}
                    <PressableScale
                      onPress={() => onRemove(item)}
                      accessibilityLabel="Remove notification"
                      accessibilityRole="button"
                    >
                      <View style={styles.removeButton}>
                        <Ionicons name="close" size={16} color={colors.gray500} />
                      </View>
                    </PressableScale>
                  </View>
                </Card>
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing[4], paddingBottom: spacing[12] },
  headerActions: { marginBottom: spacing[3], alignItems: 'flex-end' },
  card: { marginBottom: spacing[3], padding: spacing[3] },
  unread: { borderColor: colors.primary200, backgroundColor: colors.primary50 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  iconCircleUnread: { backgroundColor: colors.primary100 },
  body: { flex: 1, marginRight: spacing[2] },
  title: { fontFamily: fonts.sansBold, fontSize: typography.body.size, fontWeight: '700', color: colors.textPrimary, lineHeight: typography.body.lineHeight },
  bodyText: { fontFamily: fonts.sansMedium, fontSize: typography.callout.size, color: colors.textSecondary, marginTop: spacing[1], lineHeight: typography.callout.lineHeight },
  time: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, color: colors.gray500, marginTop: spacing[1] },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary600, marginTop: spacing[2] },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing[1],
  },
});
