import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ApiError } from '../src/api/client';
import { useAuthStore } from '../src/state/authStore';
import { PressableScale } from '../src/components/PressableScale';
import { PinPad } from '../src/components/PinPad';
import { radii, spacing, typography, fonts } from '../src/theme/tokens';
import { useThemeColors } from '../src/theme/useThemeColors';

const PIN_LENGTH = 4;

export default function PinLoginScreen(): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const loginWithPin = useAuthStore((s) => s.loginWithPin);
  const switchToPasswordLogin = useAuthStore((s) => s.usePasswordInstead);
  const pinIdentifier = useAuthStore((s) => s.pinIdentifier);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onChange = async (next: string): Promise<void> => {
    setPin(next);
    setError(null);
    if (next.length === PIN_LENGTH) {
      setLoading(true);
      try {
        await loginWithPin(next);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.code === 'RATE_LIMITED'
              ? 'Too many attempts. Try again later.'
              : 'Incorrect PIN.'
            : 'Could not reach the server.',
        );
        setPin('');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <Animated.View entering={FadeIn.duration(400)} style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="lock-closed" size={28} color={colors.white} />
        </View>
        <Text style={styles.title}>Enter your PIN</Text>
        <Text style={styles.subtitle}>{pinIdentifier ?? ''}</Text>
      </Animated.View>

      {error ? <Text style={styles.error}>{error}</Text> : <View style={styles.errorSpacer} />}

      <PinPad value={pin} length={PIN_LENGTH} onChange={(next) => void onChange(next)} disabled={loading} />

      <PressableScale onPress={() => switchToPasswordLogin()} style={styles.altLoginWrap}>
        <Text style={styles.altLogin}>Use password instead</Text>
      </PressableScale>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', paddingTop: spacing[16] },
    header: { alignItems: 'center', marginBottom: spacing[6] },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: radii.full,
      backgroundColor: colors.taskBar,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[4],
    },
    title: {
      fontFamily: fonts.sansBold,
      fontSize: typography.title2.size,
      fontWeight: typography.title2.weight,
      color: colors.textPrimary,
    },
    subtitle: { fontFamily: fonts.sans, fontSize: typography.body.size, color: colors.textMuted, marginTop: spacing[1] },
    error: { color: colors.danger500, fontWeight: '600', marginBottom: spacing[4], height: 20, textAlign: 'center' },
    errorSpacer: { height: 20, marginBottom: spacing[4] },
    altLoginWrap: { marginTop: spacing[8], alignSelf: 'center' },
    altLogin: { fontFamily: fonts.sansSemibold, fontSize: typography.callout.size, color: colors.taskBar, fontWeight: '700' },
  });
}
