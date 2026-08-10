import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/state/authStore';
import { useUiStore, type ThemePreference } from '../src/state/uiStore';
import { useSyncStatusStore } from '../src/state/syncStatusStore';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { PressableScale } from '../src/components/PressableScale';
import { Card } from '../src/components/Card';
import { formatDateTimeDisplay } from '../src/utils/date';
import { colors, radii, spacing, typography, fonts } from '../src/theme/tokens';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const soundEnabled = useUiStore((s) => s.notificationSoundEnabled);
  const setSoundEnabled = useUiStore((s) => s.setNotificationSoundEnabled);
  const { pendingCount, lastSyncAt, refresh } = useSyncStatusStore();

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

  return (
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
            <Switch value={soundEnabled} onValueChange={setSoundEnabled} trackColor={{ false: colors.gray200, true: colors.primary200 }} thumbColor={soundEnabled ? colors.primary600 : colors.white} />
          </View>
        </Section>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(320).duration(400).springify()}>
        <PrimaryButton label="Sign out" variant="danger" onPress={onLogout} />
      </Animated.View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </Card>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }): React.JSX.Element {
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

const styles = StyleSheet.create({
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
  themeChipSelected: { backgroundColor: colors.primary600, borderColor: colors.primary600 },
  themeLabel: { fontFamily: fonts.sansBold, fontSize: typography.callout.size, fontWeight: '700', color: colors.textSecondary },
  themeLabelSelected: { color: colors.white },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[2] },
  switchLabel: { flexDirection: 'row', alignItems: 'center' },
});
