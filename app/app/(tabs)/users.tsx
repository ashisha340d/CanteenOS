import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { UserDto, UserRole } from '@menuboard/shared';
import { Capability } from '@menuboard/shared';
import { boardRepository, userRepository } from '../../src/db/repositories';
import { useAuthStore } from '../../src/state/authStore';
import { useSyncStatusStore } from '../../src/state/syncStatusStore';
import { useSyncedFocusLoad } from '../../src/hooks/useSyncedFocusLoad';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { TopAppBar } from '../../src/components/TopAppBar';
import { StatusChip, type ChipTone } from '../../src/components/StatusChip';
import { EmptyState } from '../../src/components/EmptyState';
import { SearchInput } from '../../src/components/SearchInput';
import { Avatar } from '../../src/components/feed/FeedPrimitives';
import { colors, radii, spacing, typography } from '../../src/theme/tokens';

/**
 * Manage Users — who has access, and to which boards.
 *
 * Read-only in this pass, and that is a real constraint rather than an unfinished screen:
 * `users` and `board_members` are in `SYNC_ENTITIES` but *not* in `PUSHABLE_ENTITIES`, so a
 * device has no outbox path to create or reassign a user. Wiring the write would mean either
 * adding those entities to the shared push contract or accepting an online-only REST call —
 * both decisions that belong outside this screen. Until then, showing a working list beats
 * offering an "Add User" button that cannot succeed offline.
 *
 * Gated on `USER_READ`, which Manager and above hold.
 */

const ROLE_TONE: Record<UserRole, ChipTone> = {
  SUPER_ADMIN: { bg: colors.primaryFixed, fg: colors.onPrimaryFixed, border: colors.primaryFixedDim },
  ADMIN: { bg: colors.primaryFixed, fg: colors.onPrimaryFixedVariant, border: colors.primaryFixedDim },
  MANAGER: { bg: colors.tertiaryFixed, fg: colors.onTertiaryFixedVariant, border: colors.tertiaryFixedDim },
  USER: { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant, border: colors.outlineVariant },
  EMPLOYEE: { bg: colors.surfaceContainer, fg: colors.outline, border: colors.outlineVariant },
};

const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: 'SUPER ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  USER: 'USER',
  EMPLOYEE: 'EMPLOYEE',
};

interface Row {
  user: UserDto;
  boards: { boardId: string; boardName: string; role: string }[];
}

export default function UsersScreen(): React.JSX.Element {
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const isSyncing = useSyncStatusStore((s) => s.isSyncing);
  const refreshLocalData = useAuthStore((s) => s.refreshLocalData);
  const { has } = useCapabilities();
  const canRead = has(Capability.USER_READ);

  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!canRead) return;
    const [users, memberships] = await Promise.all([
      userRepository.listAll(),
      boardRepository.membershipsByUser(),
    ]);
    setRows(users.map((user) => ({ user, boards: memberships.get(user.id) ?? [] })));
  }, [canRead]);

  useSyncedFocusLoad(load);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return rows;
    return rows.filter(
      (row) =>
        row.user.name.toLowerCase().includes(query) ||
        row.user.username.toLowerCase().includes(query) ||
        (row.user.phone ?? '').includes(query) ||
        row.boards.some((board) => board.boardName.toLowerCase().includes(query)),
    );
  }, [rows, search]);

  const bar = (
    <TopAppBar
      title="Manage Users"
      leadingIcon="group"
      actions={[
        {
          icon: 'settings',
          onPress: () => router.push('/settings'),
          accessibilityLabel: 'Settings',
        },
      ]}
    />
  );

  if (!canRead) {
    return (
      <View style={styles.screen}>
        {bar}
        <EmptyState
          title="Not available"
          subtitle="Your role does not include access to user management."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {bar}
      <FlatList
        data={filtered}
        keyExtractor={(row) => row.user.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={async () => {
              await refreshLocalData();
              await load();
            }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.subtitle}>
              Access and board assignments across the operation.
            </Text>
            <SearchInput
              placeholder="Search by name, username or board…"
              value={search}
              onChangeText={setSearch}
              containerStyle={styles.search}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No users yet"
            subtitle="People appear here once the directory syncs."
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(index * 35).duration(300).springify()}>
            <View style={styles.card}>
              <View style={styles.headerRow}>
                <Avatar name={item.user.name} size={44} />
                <View style={styles.identity}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.user.name}
                    </Text>
                    {item.user.id === currentUser?.id ? (
                      <Text style={styles.you}>YOU</Text>
                    ) : null}
                  </View>
                  <Text style={styles.username} numberOfLines={1}>
                    {item.user.phone ?? item.user.username}
                  </Text>
                </View>
                <StatusChip
                  label={ROLE_LABEL[item.user.role]}
                  tone={ROLE_TONE[item.user.role]}
                />
              </View>

              {item.user.status !== 'ACTIVE' ? (
                <StatusChip
                  label={item.user.status}
                  tone={{
                    bg: colors.errorContainer,
                    fg: colors.onErrorContainer,
                    border: colors.errorContainer,
                  }}
                  style={styles.inactiveChip}
                />
              ) : null}

              <Text style={styles.boardsLabel}>Assigned boards</Text>
              {item.boards.length === 0 ? (
                <Text style={styles.noBoards}>No board assignments</Text>
              ) : (
                <View style={styles.boardList}>
                  {item.boards.map((board) => (
                    <View key={board.boardId} style={styles.boardRow}>
                      <MaterialIcons name="dashboard" size={14} color={colors.primary} />
                      <Text style={styles.boardName} numberOfLines={1}>
                        {board.boardName}
                      </Text>
                      <Text style={styles.boardRole}>{board.role}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceContainerLow },
  content: { padding: spacing.marginMobile, paddingBottom: spacing[12] },
  subtitle: {
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
    marginBottom: spacing[3],
  },
  search: { marginBottom: spacing[3] },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.xl,
    padding: spacing.gutter,
    marginBottom: spacing[3],
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  identity: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  name: {
    fontFamily: typography.headlineMd.fontFamily,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.weight,
    color: colors.onSurface,
    flexShrink: 1,
  },
  you: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: 10,
    letterSpacing: typography.labelCaps.letterSpacing,
    color: colors.primary,
  },
  username: {
    fontFamily: typography.bodySm.fontFamily,
    fontSize: typography.bodySm.size,
    lineHeight: typography.bodySm.lineHeight,
    color: colors.onSurfaceVariant,
    marginTop: spacing[0.5],
  },
  inactiveChip: { marginTop: spacing[2] },
  boardsLabel: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    lineHeight: typography.labelCaps.lineHeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.outline,
    textTransform: 'uppercase',
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  noBoards: {
    fontFamily: typography.bodySm.fontFamily,
    fontSize: typography.bodySm.size,
    color: colors.outline,
  },
  boardList: { gap: spacing[1.5] },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  boardName: {
    flex: 1,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurface,
  },
  boardRole: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.onSurfaceVariant,
  },
});
