import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ApiError } from '../src/api/client';
import { useAuthStore } from '../src/state/authStore';
import { useUiStore, type ThemePreference } from '../src/state/uiStore';
import { useSyncStatusStore } from '../src/state/syncStatusStore';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { PressableScale } from '../src/components/PressableScale';
import { FormInput } from '../src/components/FormInput';
import { Card } from '../src/components/Card';
import { TopAppBar } from '../src/components/TopAppBar';
import { PinPad } from '../src/components/PinPad';
import { formatDateTimeDisplay } from '../src/utils/date';
import { radii, spacing, typography, fonts } from '../src/theme/tokens';
import { useThemeColors } from '../src/theme/useThemeColors';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasPin = useAuthStore((s) => s.hasPin);
  const setPin = useAuthStore((s) => s.setPin);
  const removePin = useAuthStore((s) => s.removePin);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const soundEnabled = useUiStore((s) => s.notificationSoundEnabled);
  const setSoundEnabled = useUiStore((s) => s.setNotificationSoundEnabled);
  const { pendingCount, lastSyncAt, refresh } = useSyncStatusStore();

  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [pinPassword, setPinPassword] = useState('');
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onLogout = async (): Promise<void> => {
    // Leaving the user stranded on a signed-out session is worse than a failed server-side
    // revoke, so the redirect happens either way.
    try {
      await logout();
    } catch (error) {
      console.warn('[AUTH] Logout did not complete cleanly', error);
    }
    router.replace('/login');
  };

  const onSavePin = async (): Promise<void> => {
    if (!/^\d{4}$/.test(pinValue)) {
      setPinError('PIN must be exactly 4 digits.');
      return;
    }
    setPinLoading(true);
    setPinError(null);
    try {
      await setPin(pinPassword, pinValue);
      setPinFormOpen(false);
      setPinPassword('');
      setPinValue('');
    } catch (err) {
      setPinError(err instanceof ApiError ? err.message : 'Could not set PIN.');
    } finally {
      setPinLoading(false);
    }
  };

  const onRemovePin = async (): Promise<void> => {
    if (!pinPassword) {
      setPinError('Enter your current password to remove your PIN.');
      return;
    }
    setPinLoading(true);
    setPinError(null);
    try {
      await removePin(pinPassword);
      setPinFormOpen(false);
      setPinPassword('');
    } catch (err) {
      setPinError(err instanceof ApiError ? err.message : 'Could not remove PIN.');
    } finally {
      setPinLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TopAppBar title="Settings" onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/boards'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInUp.duration(400).springify()}>
          <Card style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(user?.name ?? '')}</Text>
            </View>
            <Text style={styles.name}>{user?.name ?? '—'}</Text>
            <Text style={styles.username}>{user?.username ?? '—'}</Text>
            <View style={styles.rolePill}>
              <Text style={styles.roleText}>{user?.role ?? '—'}</Text>
            </View>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(80).duration(400).springify()}>
          <Section title="Sync status">
            <Row label="Changes waiting" value={String(pendingCount)} icon="cloud-upload-outline" />
            <Row label="Last synced" value={lastSyncAt ? formatDateTimeDisplay(lastSyncAt) : 'Never'} icon="time-outline" />
          </Section>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(160).duration(400).springify()}>
          <Section title="Appearance">
            <View style={styles.themeRow}>
              {THEME_OPTIONS.map((option) => (
                <PressableScale key={option.value} style={{ flex: 1 }} onPress={() => setTheme(option.value)}>
                  <View style={[styles.themeChip, theme === option.value && styles.themeChipSelected]}>
                    <Ionicons name={option.icon} size={18} color={theme === option.value ? colors.white : colors.gray500} />
                    <Text style={[styles.themeLabel, theme === option.value && styles.themeLabelSelected]}>{option.label}</Text>
                  </View>
                </PressableScale>
              ))}
            </View>
          </Section>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(240).duration(400).springify()}>
          <Section title="Notifications">
            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Ionicons name="volume-high-outline" size={18} color={colors.gray500} style={{ marginRight: spacing[2] }} />
                <Text style={styles.rowLabel}>Notification sound</Text>
              </View>
              <Switch value={soundEnabled} onValueChange={setSoundEnabled} trackColor={{ false: colors.gray200, true: colors.taskOnline }} thumbColor={colors.white} />
            </View>
          </Section>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(280).duration(400).springify()}>
          <Section title="Security">
            <PressableScale onPress={() => router.push('/change-password')}>
              <View style={styles.row}>
                <View style={styles.rowLabelWrap}>
                  <Ionicons name="key-outline" size={16} color={colors.gray500} style={{ marginRight: spacing[2] }} />
                  <Text style={styles.rowLabel}>Change password</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.gray400} />
              </View>
            </PressableScale>

            <View style={styles.divider} />

            <View style={styles.switchRow}>
              <View style={styles.switchLabel}>
                <Ionicons name="keypad-outline" size={16} color={colors.gray500} style={{ marginRight: spacing[2] }} />
                <Text style={styles.rowLabel}>Unlock with PIN</Text>
              </View>
              <Switch
                value={hasPin}
                onValueChange={(next) => {
                  setPinError(null);
                  setPinPassword('');
                  setPinValue('');
                  setPinFormOpen(next || hasPin);
                  if (!next && !hasPin) setPinFormOpen(false);
                }}
                trackColor={{ false: colors.gray200, true: colors.taskOnline }}
                thumbColor={colors.white}
              />
            </View>

            {pinFormOpen ? (
              <View style={styles.pinForm}>
                <FormInput
                  label="Current password"
                  value={pinPassword}
                  onChangeText={setPinPassword}
                  secureTextEntry
                />
                {!hasPin ? (
                  <View style={styles.pinPadWrap}>
                    <Text style={styles.pinPadLabel}>New 4-digit PIN</Text>
                    <PinPad value={pinValue} length={4} onChange={setPinValue} disabled={pinLoading} />
                  </View>
                ) : null}
                {pinError ? <Text style={styles.error}>{pinError}</Text> : null}
                <View style={styles.pinFormActions}>
                  {hasPin ? (
                    <PrimaryButton label="Remove PIN" variant="danger" size="sm" onPress={onRemovePin} loading={pinLoading} />
                  ) : (
                    <PrimaryButton label="Save PIN" size="sm" onPress={onSavePin} loading={pinLoading} />
                  )}
                  <PrimaryButton
                    label="Cancel"
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      setPinFormOpen(false);
                      setPinError(null);
                      setPinPassword('');
                      setPinValue('');
                    }}
                  />
                </View>
              </View>
            ) : null}
          </Section>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(360).duration(400).springify()}>
          <PrimaryButton label="Sign out" variant="danger" onPress={onLogout} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </Card>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <Ionicons name={icon} size={16} color={colors.gray500} style={{ marginRight: spacing[2] }} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing[4], paddingBottom: spacing[12] },
    profileCard: { alignItems: 'center', paddingVertical: spacing[6] },
    section: { marginBottom: spacing[5] },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary100,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[3],
    },
    avatarText: { fontFamily: fonts.sansBold, fontSize: typography.title1.size, fontWeight: '800', color: colors.primary700 },
    name: { fontFamily: fonts.sansBold, fontSize: typography.title2.size, fontWeight: typography.title2.weight, color: colors.textPrimary },
    username: { fontFamily: fonts.sans, fontSize: typography.body.size, color: colors.textMuted, marginTop: spacing[1] },
    rolePill: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radii.full,
      backgroundColor: colors.gray100,
      marginTop: spacing[3],
    },
    roleText: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, fontWeight: '700', color: colors.textSecondary },
    sectionTitle: {
      fontFamily: fonts.sansBold,
      fontSize: typography.caption.size,
      fontWeight: typography.caption.weight,
      color: colors.textMuted,
      marginBottom: spacing[3],
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3] },
    rowLabelWrap: { flexDirection: 'row', alignItems: 'center' },
    rowLabel: { fontFamily: fonts.sansSemibold, fontSize: typography.body.size, color: colors.textSecondary, fontWeight: '600' },
    rowValue: { fontFamily: fonts.sansBold, fontSize: typography.body.size, color: colors.textPrimary, fontWeight: '700' },
    themeRow: { flexDirection: 'row', gap: spacing[3] },
    themeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[1.5],
      paddingVertical: spacing[3],
      borderRadius: radii.md,
      backgroundColor: colors.white,
      borderWidth: 1,
      borderColor: colors.gray200,
    },
    themeChipSelected: { backgroundColor: colors.taskBar, borderColor: colors.taskBar },
    themeLabel: { fontFamily: fonts.sansBold, fontSize: typography.callout.size, fontWeight: '700', color: colors.textSecondary },
    themeLabelSelected: { color: colors.white },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[2] },
    switchLabel: { flexDirection: 'row', alignItems: 'center' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.gray200, marginVertical: spacing[1] },
    pinForm: { marginTop: spacing[3], paddingTop: spacing[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.gray200 },
    pinPadWrap: { marginTop: spacing[2], marginBottom: spacing[4], alignItems: 'center' },
    pinPadLabel: {
      fontFamily: fonts.sansBold,
      fontSize: typography.callout.size,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: spacing[3],
    },
    pinFormActions: { flexDirection: 'row', gap: spacing[3], justifyContent: 'center' },
    error: { color: colors.danger500, marginBottom: spacing[3], fontWeight: '600' },
  });
}
