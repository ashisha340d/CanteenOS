import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { BoardDto, BoardStatus, StationDto, ThreadMessageDto } from '@menuboard/shared';
import {
  boardRepository,
  masterRepository,
  orderRepository,
  threadRepository,
} from '../../src/db/repositories';
import { useAuthStore } from '../../src/state/authStore';
import { useSyncedFocusLoad } from '../../src/hooks/useSyncedFocusLoad';
import { EmptyState } from '../../src/components/EmptyState';
import { PressableScale } from '../../src/components/PressableScale';
import { SearchInput } from '../../src/components/SearchInput';
import { TopAppBar } from '../../src/components/TopAppBar';
import { BoardStatusChip } from '../../src/components/StatusChip';
import { colors, radii, spacing, typography, fonts } from '../../src/theme/tokens';

/**
 * My Boards — the home of the app.
 *
 * Each board is a card carrying its last activity, so the list answers "where is something
 * happening?" at a glance rather than requiring a visit to each board in turn. The layout
 * follows `.claude/appscreen/my_boards_multi_board_home`.
 */

interface BoardRow {
  board: BoardDto;
  openCount: number;
  lastMessage: ThreadMessageDto | undefined;
}

/**
 * A board is never a station — this is purely a display grouping so the home screen answers
 * "where is this board?" before "what's happening on it". `station` is `undefined` only for
 * a board whose station hasn't synced yet, never a real fallback state.
 */
type ListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'board'; key: string; row: BoardRow };

/** Sort weight per board status — lower sorts higher up the list. */
const STATUS_ORDER: Record<BoardStatus, number> = { ACTIVE: 0, ON_HOLD: 1, ARCHIVED: 2 };

/** Deterministic per-board icon, so a board keeps the same glyph across sessions. */
const BOARD_ICONS: readonly (keyof typeof Ionicons.glyphMap)[] = [
  'sunny-outline',
  'briefcase-outline',
  'sparkles-outline',
  'people-outline',
  'restaurant-outline',
  'flame-outline',
];

function iconFor(boardId: string): keyof typeof Ionicons.glyphMap {
  let hash = 0;
  for (let index = 0; index < boardId.length; index += 1) {
    hash = (hash * 31 + boardId.charCodeAt(index)) >>> 0;
  }
  return BOARD_ICONS[hash % BOARD_ICONS.length] as keyof typeof Ionicons.glyphMap;
}

/** A `#RRGGBB` tint at the given opacity, for the icon-wrap fill behind a board's color. */
function tintOf(hex: string, alphaHex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alphaHex}` : hex;
}

/** `photoPath` is only renderable here when it is a full URL — a bare storage path needs the
 * signed-media flow attachments use, which board photos don't have yet (docs/API.md gap). */
function isRenderablePhoto(photoPath: string | null): boolean {
  return typeof photoPath === 'string' && /^https?:\/\//.test(photoPath);
}

export default function BoardsScreen(): React.JSX.Element {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isSyncing = useAuthStore((s) => s.isSyncing);
  const refreshLocalData = useAuthStore((s) => s.refreshLocalData);
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [stationsById, setStationsById] = useState<Map<string, StationDto>>(new Map());
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const boards = await boardRepository.listForUser(user.id);
    const stations = await masterRepository.listActiveStations();
    setStationsById(new Map(stations.map((station) => [station.id, station])));

    const lastActivity = await threadRepository.lastActivityForBoards(
      boards.map((board) => board.id),
    );
    const withCounts = await Promise.all(
      boards.map(async (board) => ({
        board,
        openCount: (await orderRepository.listAllOpenAcrossBoards([board.id])).length,
        lastMessage: lastActivity.get(board.id),
      })),
    );

    // Active boards first, then on-hold, then archived; most recently active first inside each
    // group. A paused board should never sit above one people are working on today.
    withCounts.sort((a, b) => {
      const byStatus = STATUS_ORDER[a.board.status] - STATUS_ORDER[b.board.status];
      if (byStatus !== 0) return byStatus;
      const aAt = a.lastMessage?.createdAt ?? '';
      const bAt = b.lastMessage?.createdAt ?? '';
      if (aAt !== bAt) return bAt.localeCompare(aAt);
      return a.board.name.localeCompare(b.board.name);
    });

    setRows(withCounts);
  }, [user]);

  useSyncedFocusLoad(load);

  const filteredRows = useMemo(() => {
    if (search.trim() === '') return rows;
    const query = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        row.board.name.toLowerCase().includes(query) ||
        (row.board.description ?? '').toLowerCase().includes(query) ||
        (stationsById.get(row.board.stationId)?.name ?? '').toLowerCase().includes(query),
    );
  }, [rows, search, stationsById]);

  // Station -> Board is the real-world hierarchy (see docs/DATABASE.md); a station groups
  // its boards here but is never itself a board and never gets its own card or navigation.
  // Boards keep the status/activity ordering computed above *within* their station; the
  // stations themselves sort by name so the grouping is stable across refreshes.
  const listItems = useMemo<ListItem[]>(() => {
    const byStation = new Map<string, BoardRow[]>();
    for (const row of filteredRows) {
      const list = byStation.get(row.board.stationId) ?? [];
      list.push(row);
      byStation.set(row.board.stationId, list);
    }

    const stationIds = [...byStation.keys()].sort((a, b) => {
      const nameA = stationsById.get(a)?.name ?? 'Other';
      const nameB = stationsById.get(b)?.name ?? 'Other';
      return nameA.localeCompare(nameB);
    });

    const items: ListItem[] = [];
    for (const stationId of stationIds) {
      const label = stationsById.get(stationId)?.name ?? 'Other';
      items.push({ kind: 'header', key: `station-${stationId}`, label });
      for (const row of byStation.get(stationId) ?? []) {
        items.push({ kind: 'board', key: row.board.id, row });
      }
    }
    return items;
  }, [filteredRows, stationsById]);

  return (
    <View style={styles.container}>
      <TopAppBar
        title="VSK Order"
        leadingIcon="dashboard"
        actions={[
          {
            icon: 'notifications-none',
            onPress: () => router.push('/notifications'),
            accessibilityLabel: 'Notifications',
          },
          {
            icon: 'settings',
            onPress: () => router.push('/settings'),
            accessibilityLabel: 'Settings',
          },
        ]}
      />
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>My Boards</Text>
          <Text style={styles.subtitle}>Manage ongoing operations</Text>
        </View>
      </View>

      <SearchInput
        placeholder="Search boards…"
        value={search}
        onChangeText={setSearch}
        containerStyle={styles.search}
      />

      <FlatList
        data={listItems}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
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
        ListEmptyComponent={
          <EmptyState
            title="No boards yet"
            subtitle="Boards you belong to appear here once they sync."
          />
        }
        renderItem={({ item, index }) => {
          // A station heading — display only, never navigable and never a board itself.
          if (item.kind === 'header') {
            return <Text style={styles.stationHeading}>{item.label}</Text>;
          }

          const dimmed = item.row.board.status !== 'ACTIVE';
          const boardColor = item.row.board.color;
          const hasPhoto = isRenderablePhoto(item.row.board.photoPath);

          return (
            <Animated.View entering={FadeInUp.delay(index * 45).duration(300).springify()}>
              <PressableScale
                onPress={() =>
                  router.push({
                    pathname: '/boards/[boardId]',
                    params: { boardId: item.row.board.id },
                  })
                }
              >
                <View style={[styles.card, dimmed && styles.cardDimmed]}>
                  {/* The board's own color marks it in the list; a board with unresolved work
                      that has no admin-assigned color falls back to the indigo spine. */}
                  <View
                    style={[
                      styles.spine,
                      { backgroundColor: boardColor ?? colors.primary },
                      !boardColor && item.row.openCount === 0 && !dimmed
                        ? styles.spineHidden
                        : null,
                    ]}
                  />

                  {hasPhoto ? (
                    <Image
                      source={{ uri: item.row.board.photoPath as string }}
                      style={styles.photo}
                    />
                  ) : (
                    <View
                      style={[
                        styles.iconWrap,
                        boardColor ? { backgroundColor: tintOf(boardColor, '26') } : null,
                      ]}
                    >
                      <Ionicons
                        name={iconFor(item.row.board.id)}
                        size={22}
                        color={boardColor ?? colors.primary}
                      />
                    </View>
                  )}

                  <View style={styles.body}>
                    <View style={styles.titleRow}>
                      <Text style={styles.boardName} numberOfLines={1}>
                        {item.row.board.name}
                      </Text>
                      <Text style={styles.timestamp}>
                        {item.row.lastMessage ? formatRelative(item.row.lastMessage.createdAt) : ''}
                      </Text>
                    </View>

                    <View style={styles.previewRow}>
                      <Text style={styles.preview} numberOfLines={1}>
                        {previewOf(item.row)}
                      </Text>
                      {item.row.openCount > 0 ? (
                        <View style={styles.countBadge}>
                          <Text style={styles.countText}>{item.row.openCount}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <BoardStatusChip status={item.row.board.status} />
                </View>
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}

/** What the board was last doing — an order, a message, or nothing yet. */
function previewOf(row: BoardRow): string {
  const message = row.lastMessage;
  if (message === undefined) return row.board.description ?? 'No activity yet';

  if (message.messageType === 'SYSTEM') {
    const meta = message.systemMeta ?? {};
    const orderNumber = typeof meta.orderNumber === 'string' ? meta.orderNumber : '';
    switch (message.systemEvent) {
      case 'ORDER_CREATED':
        return `New order ${orderNumber}`.trim();
      case 'ORDER_STATUS_CHANGED':
        return `${orderNumber} → ${String(meta.to ?? '').toLowerCase().replace(/_/g, ' ')}`.trim();
      case 'SHOPPING_LIST_GENERATED':
        return 'Shopping list generated';
      case 'ORDER_BILLED':
        return `${orderNumber} billed`.trim();
      default:
        return 'Order updated';
    }
  }

  const author = message.authorName ? `${message.authorName}: ` : '';
  return `${author}${message.body ?? 'Voice message'}`;
}

/** WhatsApp-style: clock today, "Yesterday", weekday this week, else a date. */
function formatRelative(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDelta = Math.floor((startOfToday.getTime() - startOfDay(then).getTime()) / 86_400_000);

  if (dayDelta <= 0) {
    return then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < 7) return then.toLocaleDateString(undefined, { weekday: 'short' });
  return then.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  headerText: { flex: 1 },
  title: {
    fontFamily: fonts.sansBold,
    fontSize: typography.headlineLg.size,
    lineHeight: typography.headlineLg.lineHeight,
    fontWeight: typography.headlineLg.weight,
    color: colors.onSurface,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: typography.bodyMd.size,
    color: colors.onSurfaceVariant,
    marginTop: spacing[0.5],
  },
  search: { marginHorizontal: spacing.marginMobile, marginBottom: spacing[3] },
  list: { paddingHorizontal: spacing.marginMobile, paddingBottom: spacing[12] },

  // A station groups the boards below it — display only, never a card, never navigable.
  stationHeading: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    marginTop: spacing[3],
    marginBottom: spacing[1.5],
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing[3],
    marginBottom: spacing[3],
    overflow: 'hidden',
  },
  cardDimmed: { opacity: 0.6 },
  spine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  spineHidden: { opacity: 0 },

  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radii.lg,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: 48,
    height: 48,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
  },
  body: { flex: 1, gap: spacing[1] },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  boardName: {
    flex: 1,
    fontFamily: fonts.sansSemibold,
    fontSize: typography.headlineMd.size,
    fontWeight: typography.headlineMd.weight,
    color: colors.onSurface,
  },
  timestamp: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    fontWeight: typography.dataMono.weight,
    color: colors.outline,
    fontVariant: ['tabular-nums'],
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  preview: { flex: 1, fontFamily: fonts.sans, fontSize: typography.bodyMd.size, color: colors.onSurfaceVariant },
  countBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: spacing[1.5],
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: colors.onPrimary, fontSize: 11, fontWeight: '700' },

  statusPill: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
    borderRadius: radii.sm,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
  },
});
