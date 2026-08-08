import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LIMITS } from '@menuboard/shared';
import { ThemedBottomSheet } from '../BottomSheet';
import { PressableScale } from '../PressableScale';
import { PrimaryButton } from '../PrimaryButton';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * Changes one line's quantity.
 *
 * Deliberately a single-purpose sheet rather than routing to the edit-order screen: adjusting
 * a count mid-service is the most frequent edit there is, and it should not cost a screen
 * change, a form and a save that also rewrites every other line.
 */
export function QuantitySheet({
  isOpen,
  onClose,
  itemName,
  unit,
  quantity,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  unit: string;
  quantity: number;
  onSave: (next: number) => void;
}): React.JSX.Element {
  const [value, setValue] = useState(String(quantity));

  // Re-seed whenever the sheet is opened for a different line, or the same line after it
  // changed elsewhere — otherwise it would show the previous line's number.
  useEffect(() => {
    if (isOpen) setValue(String(quantity));
  }, [isOpen, quantity]);

  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= LIMITS.QUANTITY_MAX;

  const step = (delta: number): void => {
    const base = Number.isFinite(parsed) ? parsed : 0;
    setValue(String(Math.max(0, base + delta)));
  };

  return (
    <ThemedBottomSheet isOpen={isOpen} onClose={onClose} title="Edit quantity">
      <Text style={styles.item} numberOfLines={2}>
        {itemName}
      </Text>

      <View style={styles.stepper}>
        <PressableScale style={styles.stepButton} onPress={() => step(-1)} hitSlop={8}>
          <Ionicons name="remove" size={22} color={colors.primary} />
        </PressableScale>
        <View style={styles.valueWrap}>
          <TextInput
            style={styles.value}
            value={value}
            onChangeText={(text) => setValue(text.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric"
            selectTextOnFocus
            autoFocus
          />
          <Text style={styles.unit}>{unit}</Text>
        </View>
        <PressableScale style={styles.stepButton} onPress={() => step(1)} hitSlop={8}>
          <Ionicons name="add" size={22} color={colors.primary} />
        </PressableScale>
      </View>

      {!valid ? <Text style={styles.error}>Enter a quantity above zero.</Text> : null}

      <PrimaryButton
        label="Save"
        disabled={!valid || parsed === quantity}
        onPress={() => {
          onSave(parsed);
          onClose();
        }}
      />
    </ThemedBottomSheet>
  );
}

const styles = StyleSheet.create({
  item: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodyMd.size,
    fontWeight: '600',
    color: colors.onSurface,
    marginBottom: spacing[4],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
    marginBottom: spacing[4],
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainer,
  },
  valueWrap: { flex: 1, alignItems: 'center' },
  value: {
    fontFamily: fonts.mono,
    fontSize: 32,
    color: colors.onSurface,
    textAlign: 'center',
    padding: 0,
    minWidth: 100,
  },
  unit: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    color: colors.outline,
    textTransform: 'uppercase',
    marginTop: spacing[1],
  },
  error: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.danger500,
    marginBottom: spacing[3],
  },
});
