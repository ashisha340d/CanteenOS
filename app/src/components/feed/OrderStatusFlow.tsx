import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OrderStatus } from '@menuboard/shared';
import { PressableScale } from '../PressableScale';
import { type Language } from '../../i18n';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

const STEPS: readonly { status: OrderStatus; label: { en: string; hi: string } }[] = [
  { status: OrderStatus.ACKNOWLEDGED, label: { en: 'Got it', hi: 'ठीक है' } },
  { status: OrderStatus.PREPARATION, label: { en: 'Preparing', hi: 'तैयारी' } },
  { status: OrderStatus.WORK_IN_PROGRESS, label: { en: 'Ready', hi: 'तैयार' } },
  { status: OrderStatus.DELIVERED, label: { en: 'Delivered', hi: 'पहुँचाया' } },
];

function stepIndex(status: OrderStatus): number {
  return STEPS.findIndex((step) => step.status === status);
}

/** One step forward, one step back — never a jump — through GOT IT → PREPARING → READY → DELIVERED. */
export function OrderStatusFlow({
  status,
  canChangeStatus,
  language = 'en',
  onChangeStatus,
}: {
  status: OrderStatus;
  canChangeStatus: boolean;
  language?: Language;
  onChangeStatus: (next: OrderStatus) => void;
}): React.JSX.Element | null {
  const index = stepIndex(status);
  // PENDING sits before the first step — "Got it" is what advances it.
  const current = index < 0 ? null : (STEPS[index] ?? null);
  const next = index < 0 ? STEPS[0] : STEPS[index + 1];
  const prev = index > 0 ? (STEPS[index - 1] ?? null) : null;

  if (current === undefined) return null;

  const label = (step: { label: { en: string; hi: string } } | null | undefined): string =>
    step === null || step === undefined ? '' : language === 'hi' ? step.label.hi : step.label.en;

  return (
    <View style={styles.row}>
      {prev !== null ? (
        <PressableScale
          disabled={!canChangeStatus}
          onPress={() => onChangeStatus(prev.status)}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${label(prev)}`}
        >
          <View style={styles.sideChip}>
            <Ionicons name="chevron-back" size={14} color={colors.outline} />
            <Text style={styles.sideLabel}>{label(prev)}</Text>
          </View>
        </PressableScale>
      ) : (
        <View style={styles.sideSpacer} />
      )}

      <View style={styles.currentChip}>
        <Text style={styles.currentLabel} numberOfLines={1}>
          {current === null ? label(next) : label(current)}
        </Text>
      </View>

      {current !== null && next !== undefined ? (
        <PressableScale
          disabled={!canChangeStatus}
          onPress={() => onChangeStatus(next.status)}
          accessibilityRole="button"
          accessibilityLabel={`Next: ${label(next)}`}
        >
          <View style={styles.sideChip}>
            <Text style={styles.sideLabel}>{label(next)}</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.outline} />
          </View>
        </PressableScale>
      ) : current === null ? (
        <PressableScale
          disabled={!canChangeStatus}
          onPress={() => onChangeStatus(STEPS[0]!.status)}
          accessibilityRole="button"
          accessibilityLabel={`Mark ${label(next)}`}
        >
          <View style={styles.sideChip}>
            <Text style={styles.sideLabel}>Mark</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.outline} />
          </View>
        </PressableScale>
      ) : (
        <View style={styles.sideSpacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  sideChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[0.5],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainer,
  },
  sideSpacer: { width: spacing[2] },
  sideLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.outline,
  },
  currentChip: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: radii.full,
    backgroundColor: colors.primaryFixed,
  },
  currentLabel: {
    fontFamily: fonts.sansBold,
    fontSize: typography.bodySm.size,
    fontWeight: '700',
    color: colors.onPrimaryFixedVariant,
  },
});
