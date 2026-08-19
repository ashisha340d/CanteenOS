import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PressableScale } from '../PressableScale';
import { radii, spacing, typography } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
}

/**
 * A single-select row of filled chips — the module's one selection control for short closed
 * sets (equipment status, problem category, priority). A bottom-sheet `PickerSheet` is right
 * for a lookup list of unknown length; a fault category has ten members and a cook reporting a
 * broken oven should see all of them at once and touch exactly one of them.
 *
 * Chips are 44pt tall so they stay a comfortable target with wet hands.
 */
export function ChoiceChips<T extends string>({
  choices,
  selected,
  onSelect,
  scroll = false,
}: {
  choices: readonly Choice<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  /** Lay the chips out in one scrolling line instead of wrapping. */
  scroll?: boolean;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const chips = choices.map((choice) => {
    const active = choice.value === selected;
    return (
      <PressableScale
        key={choice.value}
        onPress={() => onSelect(choice.value)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={choice.label}
      >
        <View style={[styles.chip, active && styles.chipActive]}>
          {choice.icon !== undefined ? (
            <MaterialIcons
              name={choice.icon}
              size={16}
              color={active ? colors.onTaskBar : colors.onSurfaceVariant}
            />
          ) : null}
          <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
            {choice.label}
          </Text>
        </View>
      </PressableScale>
    );
  });

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollRow}
      >
        {chips}
      </ScrollView>
    );
  }
  return <View style={styles.wrapRow}>{chips}</View>;
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    scrollRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing.marginMobile },
    wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1.5],
      minHeight: 44,
      paddingHorizontal: spacing[4],
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    chipActive: { backgroundColor: colors.taskBar, borderColor: colors.taskBar },
    label: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurfaceVariant,
    },
    labelActive: { fontFamily: typography.headlineMd.fontFamily, color: colors.onTaskBar },
  });
}
