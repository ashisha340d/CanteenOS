import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { colors, fonts, radii, spacing, typography } from '../src/theme/tokens';

/**
 * Reached when a deep link or a stale notification points at a screen that no longer exists.
 * Without this file expo-router shows its own developer-facing error page, which is not
 * something a kitchen user can act on — this offers the way back instead.
 */
export default function NotFoundScreen(): React.JSX.Element {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Ionicons name="help-circle-outline" size={44} color={colors.gray300} />
      <Text style={styles.title}>This screen does not exist</Text>
      <Text style={styles.subtitle}>
        The link may be out of date, or the board or order it pointed at was removed.
      </Text>
      <Pressable style={styles.button} onPress={() => router.replace('/(tabs)/boards')}>
        <Text style={styles.buttonLabel}>Go to Boards</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    backgroundColor: colors.background,
  },
  title: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.title3.size,
    fontWeight: typography.title3.weight,
    color: colors.textPrimary,
    marginTop: spacing[3],
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: typography.callout.size,
    color: colors.textSecondary,
    marginTop: spacing[2],
    textAlign: 'center',
  },
  button: {
    marginTop: spacing[6],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[6],
    borderRadius: radii.lg,
    backgroundColor: colors.primary600,
  },
  buttonLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.callout.size,
    color: colors.white,
  },
});
