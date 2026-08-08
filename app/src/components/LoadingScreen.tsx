import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, fonts } from '../theme/tokens';

export function LoadingScreen({ label }: { label?: string }): React.JSX.Element {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary600} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  label: {
    marginTop: spacing[3],
    color: colors.textSecondary,
    fontFamily: fonts.sansMedium,
    fontSize: typography.callout.size,
    fontWeight: typography.callout.weight,
  },
});
