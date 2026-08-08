import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { PressableScale } from '../PressableScale';
import { type Language } from '../../i18n';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * The acknowledgement chip on an order card — "seen, understood" from someone who is not
 * necessarily the person cooking. Kept separate from the lifecycle stepper (OrderStatusFlow):
 * acknowledgement is a per-person record, not a single status.
 */
export function StatusReactionRow({
  acknowledged,
  canAcknowledge,
  language = 'en',
  onAcknowledge,
}: {
  acknowledged: boolean;
  canAcknowledge: boolean;
  language?: Language;
  onAcknowledge: () => void;
}): React.JSX.Element | null {
  if (!canAcknowledge) return null;

  return (
    <View style={styles.row}>
      <PressableScale accessibilityRole="button" accessibilityLabel="Got it" onPress={onAcknowledge}>
        <View style={[styles.chip, acknowledged && { backgroundColor: `${colors.primary}1A` }]}>
          <MaterialCommunityIcons
            name="thumb-up"
            size={18}
            color={acknowledged ? colors.primary : colors.outline}
          />
          <Text style={[styles.label, acknowledged && { color: colors.primary }]}>
            {language === 'hi' ? 'ठीक है' : 'Got it'}
          </Text>
        </View>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainer,
  },
  label: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
});
