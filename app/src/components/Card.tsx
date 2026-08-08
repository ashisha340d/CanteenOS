import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';

export function Card({ children, style, ...rest }: ViewProps): React.JSX.Element {
  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.gray100,
    ...shadows.sm,
  },
});
