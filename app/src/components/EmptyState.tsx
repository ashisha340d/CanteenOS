import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, fonts } from '../theme/tokens';

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Ionicons name="cube-outline" size={40} color={colors.gray300} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: spacing[12], alignItems: 'center', paddingHorizontal: spacing[8] },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.title3.size,
    fontWeight: typography.title3.weight,
    color: colors.textSecondary,
    marginTop: spacing[3],
  },
  subtitle: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.callout.size,
    color: colors.gray500,
    marginTop: spacing[1.5],
    textAlign: 'center',
    lineHeight: typography.callout.lineHeight,
  },
});
