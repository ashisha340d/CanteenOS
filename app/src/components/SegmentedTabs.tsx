import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from './PressableScale';
import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * A pill-track segmented control for switching between views of the *same* data — the board
 * and its archive, or the archive's list and summary modes.
 *
 * Deliberately not a tab bar: these are modes within one screen, so switching must not push a
 * route or change what the back button does.
 */
export interface Segment<T extends string> {
  id: T;
  label: string;
}

export function SegmentedTabs<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (id: T) => void;
}): React.JSX.Element {
  return (
    <View style={styles.track}>
      {segments.map((segment) => {
        const active = segment.id === value;
        return (
          <PressableScale
            key={segment.id}
            onPress={() => onChange(segment.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={styles.itemPress}
          >
            <View style={[styles.item, active && styles.itemActive]}>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {segment.label}
              </Text>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: spacing[1],
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.full,
    padding: spacing[1],
  },
  itemPress: { flex: 1 },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radii.full,
  },
  itemActive: { backgroundColor: colors.surfaceContainerLowest },
  label: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.bodySm.size,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  labelActive: { color: colors.primary, fontWeight: '700' },
});
