import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../src/api/client';
import { useAuthStore } from '../src/state/authStore';
import { FormInput } from '../src/components/FormInput';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { PressableScale } from '../src/components/PressableScale';
import { Card } from '../src/components/Card';
import { colors, radii, spacing, typography, fonts } from '../src/theme/tokens';

export default function LoginScreen(): React.JSX.Element {
  const login = useAuthStore((s) => s.login);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    if (!identifier.trim() || !password) {
      setError('Enter your username/email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(identifier.trim(), password, rememberMe);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'INVALID_CREDENTIALS'
            ? 'Incorrect username or password.'
            : err.code === 'ACCOUNT_INACTIVE'
              ? 'This account is inactive. Contact your administrator.'
              : err.message,
        );
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeIn.delay(100).duration(600)} style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="restaurant-outline" size={36} color={colors.white} />
          </View>
          <Text style={styles.title}>MenuBoard</Text>
          <Text style={styles.subtitle}>Operational collaboration, offline-first</Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(250).duration(500).springify()}>
          <Card style={styles.formCard}>
            <FormInput
              label="Username or email"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. user1"
            />
            <FormInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
            />

            <PressableScale
              style={styles.rememberRow}
              onPress={() => setRememberMe((v) => !v)}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                {rememberMe ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
              </View>
              <Text style={styles.rememberLabel}>Remember me</Text>
            </PressableScale>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PrimaryButton label="Sign in" onPress={onSubmit} loading={loading} />
          </Card>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing[6] },
  brand: { alignItems: 'center', marginBottom: spacing[8] },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radii['2xl'],
    backgroundColor: colors.taskBar,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: typography.title1.size,
    lineHeight: typography.title1.lineHeight,
    fontWeight: typography.title1.weight,
    color: colors.textPrimary,
    letterSpacing: typography.title1.letterSpacing,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: typography.body.size,
    color: colors.textMuted,
    marginTop: spacing[1],
  },
  formCard: { padding: spacing[6] },
  rememberRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[5], gap: spacing[3] },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.gray300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.taskBar, borderColor: colors.taskBar },
  rememberLabel: { fontFamily: fonts.sansSemibold, fontSize: typography.body.size, color: colors.textSecondary, fontWeight: '600' },
  error: { color: colors.danger500, marginBottom: spacing[4], textAlign: 'center', fontWeight: '600' },
});
