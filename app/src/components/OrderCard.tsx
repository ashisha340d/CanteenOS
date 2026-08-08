import React from 'react';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { StyleSheet, Text, View } from 'react-native';
import type { OrderDto } from '@menuboard/shared';
import { Card } from './Card';
import { PressableScale } from './PressableScale';
import { StatusBadge } from './StatusBadge';
import { AvatarStack } from './AvatarStack';
import { formatDateDisplay } from '../utils/date';
import { colors, radii, spacing, typography, fonts } from '../theme/tokens';

const PRIORITY_DOT: Record<string, string> = {
  LOW: colors.gray400,
  NORMAL: colors.success500,
  HIGH: colors.warning500,
  URGENT: colors.danger500,
};

interface Props {
  order: OrderDto;
  index?: number;
  participants?: string[];
  imageCount?: number;
  voiceCount?: number;
}

/**
 * A scannable, premium order row: status ribbon, priority halo, key meta, avatar stack,
 * attachment hints, and a "pending sync" cue. Reads as an object, not a table row.
 */
export function OrderCard({ order, index = 0, participants = [], imageCount = 0, voiceCount = 0 }: Props): React.JSX.Element {
  // Dimmed once the order has left the active set — delivered, closed out, or cancelled.
  const isDone =
    order.status === 'DELIVERED' ||
    order.status === 'DONE' ||
    order.status === 'CANCELLED';

  return (
    <Animated.View entering={FadeInUp.delay(index * 40).duration(320).springify()}>
      <PressableScale
        onPress={() => router.push({ pathname: '/orders/[orderId]', params: { orderId: order.id } })}
      >
        <Card style={styles.card}>
          <View style={styles.ribbon} />
          <View style={styles.inner}>
            <View style={styles.topRow}>
              <StatusBadge order={order} />
              <View style={styles.priorityDot}>
                <View style={[styles.pip, { backgroundColor: PRIORITY_DOT[order.priority] ?? colors.gray400 }]} />
                <Text style={styles.priorityText}>{order.priority}</Text>
              </View>
            </View>

            <View style={styles.body}>
              <Text style={[styles.orderNumber, isDone && styles.strike]}>{order.orderNumber}</Text>
              <Text style={[styles.venue, isDone && styles.strike]} numberOfLines={1}>
                {order.venue}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <View style={styles.metaPill}>
                <Ionicons name="calendar-outline" size={12} color={colors.gray500} />
                <Text style={styles.meta}>{formatDateDisplay(order.requiredDate)}</Text>
              </View>
              <View style={styles.metaPill}>
                <Ionicons name="time-outline" size={12} color={colors.gray500} />
                <Text style={styles.meta}>{order.requiredTime}</Text>
              </View>
              <View style={styles.metaPill}>
                <Ionicons name="people-outline" size={12} color={colors.gray500} />
                <Text style={styles.meta}>Pax {order.pax}</Text>
              </View>
            </View>

            <View style={styles.footer}>
              <AvatarStack names={participants} max={3} />
              <View style={styles.hints}>
                {imageCount > 0 ? (
                  <View style={styles.hint}>
                    <Ionicons name="image-outline" size={14} color={colors.gray500} />
                    <Text style={styles.hintText}>{imageCount}</Text>
                  </View>
                ) : null}
                {voiceCount > 0 ? (
                  <View style={styles.hint}>
                    <Ionicons name="mic-outline" size={14} color={colors.gray500} />
                    <Text style={styles.hintText}>{voiceCount}</Text>
                  </View>
                ) : null}
                {order.syncSeq === 0 ? <Text style={styles.pending}>Pending sync</Text> : null}
              </View>
            </View>
          </View>
        </Card>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: 'hidden', marginBottom: spacing[3] },
  ribbon: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.primary600,
    borderTopLeftRadius: radii.lg,
    borderBottomLeftRadius: radii.lg,
  },
  inner: { marginLeft: 6, padding: spacing[4] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  priorityDot: { flexDirection: 'row', alignItems: 'center' },
  pip: { width: 8, height: 8, borderRadius: 4, marginRight: spacing[1.5] },
  priorityText: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  body: { marginBottom: spacing[3] },
  orderNumber: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    fontWeight: typography.caption.weight,
    color: colors.gray500,
    marginBottom: spacing[1],
    letterSpacing: typography.caption.letterSpacing,
  },
  venue: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.title3.size,
    lineHeight: typography.title3.lineHeight,
    fontWeight: typography.title3.weight,
    color: colors.textPrimary,
  },
  strike: { textDecorationLine: 'line-through', color: colors.gray500 },
  metaRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray75,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    gap: spacing[1],
  },
  meta: { fontFamily: fonts.sansSemibold, fontSize: typography.caption.size, color: colors.textSecondary, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hints: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  hintText: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, color: colors.textSecondary, fontWeight: '700' },
  pending: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, color: colors.warning700, fontWeight: '700' },
});
