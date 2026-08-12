import React, { useMemo } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { radii, shadows, spacing } from '../theme/tokens';
import { useThemeColors } from '../theme/useThemeColors';

export function Card({ children, style, ...rest }: ViewProps): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          borderRadius: radii.lg,
          padding: spacing[4],
          borderWidth: 1,
          borderColor: colors.gray100,
          ...shadows.sm,
        },
      }),
    [colors],
  );
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}
