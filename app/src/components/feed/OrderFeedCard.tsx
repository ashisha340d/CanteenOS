import React, { useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  AcknowledgementDto,
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  OrderStatus,
  ThreadMessageDto,
} from '@menuboard/shared';
import { isOrderLocked } from '@menuboard/shared';
import { StatusBadge } from '../StatusBadge';
import { PressableScale } from '../PressableScale';
import { StatusReactionRow } from './StatusReactionRow';
import { OrderStatusFlow } from './OrderStatusFlow';
import { Avatar, AuthorLine, DataRow, feedStyles, LabelCaps } from './FeedPrimitives';
import { useCountdown, isPastDeadline } from '../../hooks/useCountdown';
import { orderLineName, orderLineUnit, t, weekdayName, type Language } from '../../i18n';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * An order as it appears on the board feed.
 *
 * This is the structured message the whole product turns on: what WhatsApp cannot do. It
 * carries the order's identity (date, time, venue, pax), its numbered requirement lines, the
 * acknowledgements it has collected, and the actions available on it — all in one block that
 * every member sees identically.
 *
 * Cancelled lines stay visible, struck through, with their replacement directly beneath, so
 * the card doubles as the edit history the specification asks for.
 */

export interface OrderFeedCardProps {
  order: OrderDto;
  items: OrderItemDto[];
  menuItems: Map<string, MenuItemDto>;
  acknowledgements: AcknowledgementDto[];
  /** The signed-in user's acknowledgement, when they have given one. */
  myAcknowledgement: AcknowledgementDto | undefined;
  authorName: string;
  time: string;
  language?: Language;
  /** Board swatch the Admin configured; tints the card's spine and header. */
  accentColor?: string | null;
  /** Name of whoever the order is assigned to, when it is. */
  assigneeName?: string | null;
  canAcknowledge: boolean;
  canChangeStatus: boolean;
  /** Everything that has happened to this order — read through the history button. */
  historyEvents?: ThreadMessageDto[];
  onAcknowledge: () => void;
  onChangeStatus: (next: OrderStatus) => void;
  /** Opens the chevron menu (recipe, shopping list, assign, reply). */
  onOpenMenu: () => void;
  onOpenHistory: () => void;
  onPressItem: (item: OrderItemDto) => void;
  onPress: () => void;
  /** The order's conversation, rendered inside the same block. */
  children?: React.ReactNode;
}

export function OrderFeedCard({
  order,
  items,
  menuItems,
  acknowledgements,
  myAcknowledgement,
  authorName,
  time,
  language = 'en',
  accentColor,
  assigneeName,
  canAcknowledge,
  canChangeStatus,
  historyEvents = [],
  onAcknowledge,
  onChangeStatus,
  onOpenMenu,
  onOpenHistory,
  onPressItem,
  onPress,
  children,
}: OrderFeedCardProps): React.JSX.Element {
  const locked = isOrderLocked(order);
  // Past its required time and never delivered: closed out regardless of what stage it was
  // stuck at. Overrides every other status pill, and locks the reactions the same way a
  // delivered order does.
  const over =
    !['DELIVERED', 'DONE', 'CANCELLED'].includes(order.status) &&
    isPastDeadline(order.requiredDate, order.requiredTime);
  // Done and billed orders are dimmed rather than hidden: the feed is a record, and an order
  // that scrolled past still has to be findable where it happened.
  const settled = locked || order.doneAt !== null || order.status === 'CANCELLED' || over;

  const lastTap = useRef<number>(0);
  const DOUBLE_TAP_DELAY = 300;
  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_DELAY) {
      onPress();
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };

  // Only an order still being worked counts down; a delivered or cancelled one has no
  // deadline left to miss, and a ticker on it would be alarming for no reason.
  const countdown = useCountdown(
    order.requiredDate,
    order.requiredTime,
    30 * 60 * 1000,
    !settled && order.status !== 'DELIVERED',
  );

  /**
   * Lines in display order, with each replacement pulled up directly beneath the line it
   * superseded so a correction reads as a pair rather than as two unrelated entries.
   */
  const orderedItems = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    const claimed = new Set<string>();
    const output: OrderItemDto[] = [];

    for (const item of items) {
      if (claimed.has(item.id)) continue;
      output.push(item);
      claimed.add(item.id);

      let replacement =
        item.replacedByItemId === null ? undefined : byId.get(item.replacedByItemId);
      // Follow the chain, so a line replaced twice still renders in sequence.
      while (replacement !== undefined && !claimed.has(replacement.id)) {
        output.push(replacement);
        claimed.add(replacement.id);
        replacement =
          replacement.replacedByItemId === null
            ? undefined
            : byId.get(replacement.replacedByItemId);
      }
    }
    return output;
  }, [items]);

  const eventName = order.customActivity ?? order.venue;
  const dateLine = `${formatDate(order.requiredDate)}, ${weekdayName(order.requiredDate, language)}`;

  return (
    <View>
      {/* WhatsApp-style sender line: who raised this and when, sitting above the block. */}
      <AuthorLine name={authorName} time={time} />

      <View
        style={[
          feedStyles.card,
          settled && styles.settled,
          // An order counting down is the one thing on the board that needs attention now,
          // so it gets a coloured edge rather than another badge to read.
          countdown !== null && (countdown.overdue ? styles.cardOverdue : styles.cardUrgent),
        ]}
      >
        <PressableScale onPress={handlePress}>
          <View>
            {/* Identity ------------------------------------------------------ */}
            <View style={styles.header}>
              <View style={styles.headerTop}>
                <View style={styles.headerTitle}>
                  <Ionicons
                    name="calendar-outline"
                    size={17}
                    color={accentColor ?? colors.primary}
                  />
                  <Text
                    style={[styles.headerTime, accentColor ? { color: accentColor } : null]}
                    numberOfLines={1}
                  >
                    {formatTime(order.requiredTime)}
                  </Text>
                  <Text style={[styles.headerDash, accentColor ? { color: accentColor } : null]}>-</Text>
                  <Text
                    style={[styles.eventName, accentColor ? { color: accentColor } : null]}
                    numberOfLines={2}
                  >
                    {eventName}
                  </Text>
                </View>
                {/* The chevron, not a long press: a hidden gesture is not a menu. */}
                <PressableScale
                  onPress={onOpenMenu}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Order actions"
                >
                  <View style={styles.chevronButton}>
                    <Ionicons name="chevron-down" size={26} color={colors.primary} />
                  </View>
                </PressableScale>
              </View>
              <View style={styles.headerBottom}>
                <StatusBadge
                  order={order}
                  plain
                  overrideLabel={over ? { label: 'Over', bg: colors.dangerBg, fg: colors.danger } : undefined}
                />
              </View>
            </View>

            <View style={styles.identityRow}>
              <View style={styles.identityBlock}>
                <DataRow label={t('date', language)} value={dateLine} />
                <DataRow label={t('time', language)} value={formatTime(order.requiredTime)} />
                <DataRow label={t('venue', language)} value={order.venue} />
                <DataRow label={t('pax', language)} value={String(order.pax)} emphasis />
              </View>

              {countdown !== null ? (
                <View style={[styles.countdownRing, countdown.overdue && styles.countdownRingOverdue]}>
                  <Text
                    style={[styles.countdownText, countdown.overdue && styles.countdownTextOverdue]}
                    numberOfLines={1}
                  >
                    {countdown.text}
                  </Text>
                </View>
              ) : over || order.status === 'DELIVERED' || order.doneAt !== null ? (
                <View style={styles.deliveredMark}>
                  <Ionicons name="checkmark" size={22} color={colors.success500} />
                </View>
              ) : null}
            </View>

            {assigneeName ? (
              <View style={styles.assignee}>
                <Ionicons name="person-circle-outline" size={15} color={colors.primary} />
                <Text style={styles.assigneeText} numberOfLines={1}>
                  {assigneeName}
                </Text>
              </View>
            ) : null}

            {/* Requirements -------------------------------------------------- */}
            <View style={styles.menuPanel}>
              <LabelCaps style={styles.menuPanelTitle}>{t('menuRequirements', language)}</LabelCaps>
              {orderedItems.map((item, index) => {
                const cancelled = item.cancelledAt !== null;
                const isReplacement = orderedItems.some(
                  (other) => other.replacedByItemId === item.id,
                );

                return (
                  <PressableScale
                    key={item.id}
                    // Tapping the line opens that line's own menu. There is no card-wide
                    // "view recipe" any more: an order has many items, so a single button had
                    // to guess which one was meant, and it always guessed the first.
                    onPress={() => onPressItem(item)}
                  >
                    <View style={[styles.menuLine, index === orderedItems.length - 1 && styles.menuLineLast]}>
                      <Text
                        style={[styles.menuName, cancelled && styles.menuNameCancelled]}
                        numberOfLines={2}
                      >
                        {isReplacement ? '↳ ' : `${index + 1}. `}
                        {orderLineName(item, menuItems, language)}
                      </Text>
                      <Text style={[styles.menuQty, cancelled && styles.menuNameCancelled]}>
                        {formatQuantity(item.quantity)}
                      </Text>
                      <Text style={[styles.menuUnit, cancelled && styles.menuNameCancelled]}>
                        {orderLineUnit(item, menuItems, language)}
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>

            {/* Reactions ------------------------------------------------------ */}
            {!settled ? (
              <View style={styles.reactionBlock}>
                <OrderStatusFlow
                  status={order.status}
                  canChangeStatus={canChangeStatus && !locked}
                  language={language}
                  onChangeStatus={onChangeStatus}
                />
              </View>
            ) : null}

            {acknowledgements.length > 0 ? (
              <View style={styles.ackStack}>
                {acknowledgements.slice(0, 5).map((ack, index) => (
                  <View key={ack.id} style={[styles.ackAvatar, index > 0 && styles.ackAvatarOverlap]}>
                    <Avatar name={ack.userName ?? '?'} size={26} />
                  </View>
                ))}
                {acknowledgements.length > 5 ? (
                  <Text style={styles.ackMore}>+{acknowledgements.length - 5}</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.footer}>
              <View style={styles.footerPill}>
                <Text style={styles.footerMeta} numberOfLines={1}>
                  {t('newOrderPlaced', language)} {order.orderNumber} · {time}
                </Text>
              </View>
              <View style={styles.footerSpacer} />
              {locked ? (
                <View style={styles.lockedChip}>
                  <Ionicons name="lock-closed" size={10} color={colors.statusBilled.fg} />
                  <Text style={styles.lockedText}>Billed — locked</Text>
                </View>
              ) : null}
              {/* The order's story, right beside the number that identifies it. */}
              <PressableScale
                onPress={onOpenHistory}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Order history"
              >
                <View style={styles.historyButton}>
                  <Ionicons name="time-outline" size={13} color={colors.onSurfaceVariant} />
                  {historyEvents.length > 0 ? (
                    <Text style={styles.historyCount}>{historyEvents.length}</Text>
                  ) : null}
                </View>
              </PressableScale>
              {!settled ? (
                <StatusReactionRow
                  acknowledged={myAcknowledgement !== undefined}
                  canAcknowledge={canAcknowledge}
                  language={language}
                  onAcknowledge={onAcknowledge}
                />
              ) : null}
            </View>
          </View>
        </PressableScale>

        {children === undefined ? null : <View style={styles.thread}>{children}</View>}
      </View>
    </View>
  );
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(clock: string): string {
  const [hourText, minute] = clock.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

/** Trims the trailing zeros a DECIMAL(12,3) carries, so "50.000" reads as "50". */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  settled: {},
  cardUrgent: { borderColor: colors.warning100 },
  cardOverdue: { borderColor: colors.danger100 },

  countdownRing: {
    width: 52,
    height: 52,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.warning500,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing[2],
  },
  countdownRingOverdue: { borderColor: colors.danger500 },
  countdownText: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    fontWeight: '700',
    color: colors.warning700,
    fontVariant: ['tabular-nums'],
  },
  countdownTextOverdue: { color: colors.danger700 },
  deliveredMark: {
    width: 34,
    height: 34,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.success500,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing[2],
  },

  assignee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[3],
  },
  assigneeText: {
    flex: 1,
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.primary,
  },

  reactionBlock: { marginTop: spacing[3], gap: spacing[2] },

  header: {
    paddingBottom: spacing[2],
    marginBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  headerBottom: { flexDirection: 'row', alignItems: 'center', marginTop: spacing[1.5] },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1, flexWrap: 'wrap' },
  chevronButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTime: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.weight,
    color: colors.primary,
  },
  headerDash: {
    fontFamily: fonts.sans,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    color: colors.primaryContainer,
  },
  eventName: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: '500',
    color: colors.primaryContainer,
    flexShrink: 1,
  },

  identityRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing[3] },
  identityBlock: { flex: 1 },

  menuPanel: {
    backgroundColor: 'transparent',
    paddingTop: spacing[0.5],
  },
  menuPanelTitle: { color: colors.primaryContainer, marginBottom: spacing[2] },
  menuLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  menuLineLast: { marginBottom: 0 },
  menuName: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: typography.dataMono.weight,
    color: colors.onSurface,
  },
  menuNameCancelled: {
    textDecorationLine: 'line-through',
    color: colors.outline,
  },
  menuQty: {
    width: 44,
    textAlign: 'right',
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: '700',
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  menuUnit: {
    width: 42,
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
  },

  ackStack: { flexDirection: 'row', alignItems: 'center', marginTop: spacing[3] },
  ackAvatar: {
    borderWidth: 2,
    borderColor: colors.surfaceContainerLowest,
    borderRadius: radii.full,
  },
  ackAvatarOverlap: { marginLeft: -10 },
  ackMore: {
    marginLeft: spacing[1.5],
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    color: colors.outline,
    fontWeight: '600',
  },

  historyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainer,
  },
  historyCount: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    fontWeight: typography.labelCaps.weight,
    color: colors.onSurfaceVariant,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  thread: { marginTop: spacing[4] },
  footerSpacer: { flex: 1 },
  footerPill: {
    flexShrink: 1,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    backgroundColor: colors.dataPanel,
  },
  footerMeta: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.onSurfaceVariant,
  },
  lockedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
    borderRadius: radii.sm,
    backgroundColor: colors.statusBilled.bg,
  },
  lockedText: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    fontWeight: typography.labelCaps.weight,
    color: colors.statusBilled.fg,
  },
});
