import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OrderDisplayStatus, OrderStatusFacts } from '@menuboard/shared';
import { deriveOrderDisplayStatus } from '@menuboard/shared';
import { colors, radii, spacing, typography, fonts } from '../theme/tokens';

/**
 * The order status pill.
 *
 * Keyed on `OrderDisplayStatus`, not on the stored status: On Shopping and Billed are
 * timestamps rather than lifecycle states, and `deriveOrderDisplayStatus` is the single
 * place that decides which of the three a pill should show. Passing an order rather than a
 * status is what keeps that rule from being re-implemented per screen.
 */
const PALETTE: Record<
  OrderDisplayStatus,
  { bg: string; fg: string; label: string; dot: string }
> = {
  PENDING: {
    bg: colors.statusPending.bg,
    fg: colors.statusPending.fg,
    dot: colors.statusPending.fg,
    label: 'Pending',
  },
  ACKNOWLEDGED: {
    bg: colors.statusAcknowledged.bg,
    fg: colors.statusAcknowledged.fg,
    dot: colors.statusAcknowledged.fg,
    label: 'Acknowledged',
  },
  PREPARATION: {
    bg: colors.statusPreparation.bg,
    fg: colors.statusPreparation.fg,
    dot: colors.statusPreparation.fg,
    label: 'Preparation',
  },
  WORK_IN_PROGRESS: {
    bg: colors.statusWorkInProgress.bg,
    fg: colors.statusWorkInProgress.fg,
    dot: colors.statusWorkInProgress.fg,
    label: 'Work in Progress',
  },
  DELIVERED: {
    bg: colors.statusDelivered.bg,
    fg: colors.statusDelivered.fg,
    dot: colors.statusDelivered.fg,
    label: 'Delivered',
  },
  DONE: {
    bg: colors.statusDone.bg,
    fg: colors.statusDone.fg,
    dot: colors.statusDone.fg,
    label: 'Done',
  },
  CANCELLED: {
    bg: colors.statusCancelled.bg,
    fg: colors.statusCancelled.fg,
    dot: colors.statusCancelled.fg,
    label: 'Cancelled',
  },
  ON_SHOPPING: {
    bg: colors.statusOnShopping.bg,
    fg: colors.statusOnShopping.fg,
    dot: colors.statusOnShopping.fg,
    label: 'On Shopping',
  },
  BILLED: {
    bg: colors.statusBilled.bg,
    fg: colors.statusBilled.fg,
    dot: colors.statusBilled.fg,
    label: 'Billed',
  },
};

export function StatusBadge({
  order,
  size = 'sm',
  plain = false,
  overrideLabel,
}: {
  order: OrderStatusFacts;
  size?: 'sm' | 'md';
  plain?: boolean;
  /** Shows this label/tint instead of the derived one — used for the client-only "Over" state. */
  overrideLabel?: { label: string; bg: string; fg: string };
}): React.JSX.Element {
  const derived = PALETTE[deriveOrderDisplayStatus(order)];
  const palette = overrideLabel
    ? { bg: overrideLabel.bg, fg: overrideLabel.fg, dot: overrideLabel.fg, label: overrideLabel.label }
    : derived;
  if (plain) {
    return (
      <Text style={[styles.plainText, { color: palette.fg }]} numberOfLines={1}>
        {palette.label}
      </Text>
    );
  }
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, size === 'md' && styles.badgeMd]}>
      <View style={[styles.dot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.text, { color: palette.fg }, size === 'md' && styles.textMd]}>
        {palette.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
  badgeMd: { paddingHorizontal: spacing[3], paddingVertical: spacing[1.5] },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: spacing[1.5] },
  text: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    fontWeight: typography.caption.weight,
    lineHeight: typography.caption.lineHeight,
  },
  textMd: { fontFamily: fonts.sansMedium, fontSize: typography.callout.size, lineHeight: typography.callout.lineHeight },
  plainText: {
    fontFamily: fonts.sansBold,
    fontSize: typography.bodySm.size,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: '700',
  },
});
