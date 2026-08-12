import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { spacing, typography, fonts } from '../theme/tokens';
import { useThemeColors } from '../theme/useThemeColors';

export function LoadingScreen({ label }: { label?: string }): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
        label: {
          marginTop: spacing[3],
          color: colors.textSecondary,
          fontFamily: fonts.sansMedium,
          fontSize: typography.callout.size,
          fontWeight: typography.callout.weight,
        },
      }),
    [colors],
  );
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.taskBar} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}
