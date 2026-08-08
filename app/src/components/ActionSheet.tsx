import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedBottomSheet } from './BottomSheet';
import { PressableScale } from './PressableScale';
import { colors, radii, spacing, typography, fonts } from '../theme/tokens';

export interface ActionSheetItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Shown under the label — use it to say *why* an action is unavailable, not just that it is. */
  subtitle?: string;
  disabled?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * The context menu, as a bottom sheet.
 *
 * Actions that the signed-in user may not perform are **omitted by the caller**, not passed
 * in disabled — a menu full of greyed-out rows teaches people to stop reading it. `disabled`
 * is reserved for the narrower case where the action exists for this user but not right now
 * (offline, or an item with no recipe), and there it always carries a `subtitle` saying so.
 */
export function ActionSheet({
  isOpen,
  onClose,
  title,
  items,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  items: readonly ActionSheetItem[];
}): React.JSX.Element {
  return (
    <ThemedBottomSheet isOpen={isOpen} onClose={onClose} {...(title ? { title } : {})}>
      <View>
        {items.map((item) => (
          <PressableScale
            key={item.id}
            disabled={item.disabled}
            onPress={() => {
              // Close first: leaving the sheet up while a second sheet opens behind it stacks
              // two overlays, and the one on top eats the taps meant for the one below.
              onClose();
              item.onPress();
            }}
          >
            <View style={[styles.row, item.disabled === true && styles.rowDisabled]}>
              <Ionicons
                name={item.icon}
                size={20}
                color={
                  item.disabled === true
                    ? colors.outline
                    : item.destructive === true
                      ? colors.danger500
                      : colors.onSurfaceVariant
                }
              />
              <View style={styles.text}>
                <Text
                  style={[
                    styles.label,
                    item.destructive === true && styles.labelDestructive,
                    item.disabled === true && styles.labelDisabled,
                  ]}
                >
                  {item.label}
                </Text>
                {item.subtitle !== undefined ? (
                  <Text style={styles.subtitle}>{item.subtitle}</Text>
                ) : null}
              </View>
            </View>
          </PressableScale>
        ))}
      </View>
    </ThemedBottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radii.lg,
  },
  rowDisabled: { opacity: 0.55 },
  text: { flex: 1 },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurface,
  },
  labelDestructive: { color: colors.danger500 },
  labelDisabled: { color: colors.outline },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.outline,
    marginTop: spacing[0.5],
  },
});
