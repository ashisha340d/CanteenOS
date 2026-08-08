import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LIMITS } from '@menuboard/shared';
import { ApiError } from '../src/api/client';
import { useAuthStore } from '../src/state/authStore';
import { FormInput } from '../src/components/FormInput';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { Card } from '../src/components/Card';
import { colors, spacing, typography, fonts } from '../src/theme/tokens';

export default function ChangePasswordScreen(): React.JSX.Element {
  const changePassword = useAuthStore((s) => s.changePassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    if (newPassword.length < LIMITS.PASSWORD_MIN) {
      setError(`New password must be at least ${LIMITS.PASSWORD_MIN} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Animated.View entering={FadeInUp.duration(500).springify()} style={styles.introCard}>
        <View style={styles.iconCircle}>
          <Ionicons name="lock-closed-outline" size={28} color={colors.primary600} />
        </View>
        <Text style={styles.title}>Update your password</Text>
        <Text style={styles.subtitle}>
          For security, please set a new password before continuing. This signs you out of other
          devices.
        </Text>
      </Animated.View>

      <Card>
        <FormInput
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
        />
        <FormInput label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <FormInput
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Change password" onPress={onSubmit} loading={loading} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing[6], paddingBottom: spacing[12], backgroundColor: colors.background, flexGrow: 1 },
  introCard: { alignItems: 'center', marginBottom: spacing[6], paddingVertical: spacing[4] },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: typography.title2.size,
    lineHeight: typography.title2.lineHeight,
    fontWeight: typography.title2.weight,
    color: colors.textPrimary,
    marginBottom: spacing[2],
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing[4],
  },
  error: { color: colors.danger500, marginBottom: spacing[4], fontWeight: '600' },
});
