import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { BoardDto, BoardStatus, StationDto, ThreadMessageDto } from '@menuboard/shared';
import { Capability } from '@menuboard/shared';
import {
  boardRepository,
  masterRepository,
  orderRepository,
  threadRepository,
} from '../../src/db/repositories';
import { useAuthStore } from '../../src/state/authStore';
import { useSyncStatusStore } from '../../src/state/syncStatusStore';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { useSyncedFocusLoad } from '../../src/hooks/useSyncedFocusLoad';
import { EmptyState } from '../../src/components/EmptyState';
import { PressableScale } from '../../src/components/PressableScale';
import { SearchInput } from '../../src/components/SearchInput';
import { TopAppBar } from '../../src/components/TopAppBar';
import { BoardStatusChip } from '../../src/components/StatusChip';
import { colors, radii, spacing, typography, fonts } from '../../src/theme/tokens';
import { todayIsoDate } from '../../src/utils/date';

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
  /** `YYYY-MM-DDTHH:mm` of the soonest live order, or undefined when the board has none. */
  nextDue: string | undefined;
  lastMessage: ThreadMessageDto | undefined;
}

/**
 * Board order: what needs attention soonest, first.
 *
 * 1. Status — a paused or archived board never outranks one people are working on.
 * 2. Live work — a board carrying today's or tomorrow's orders beats a quiet one, and among
 *    those the earliest deadline wins. This is the ordering the product is actually about.
 * 3. Recency — with no live work left, the board that was last talked on comes first.
 * 4. Name, so the list is stable rather than arbitrary when everything else ties.
 */
function compareBoardRows(a: BoardRow, b: BoardRow): number {
  const byStatus = STATUS_ORDER[a.board.status] - STATUS_ORDER[b.board.status];
  if (byStatus !== 0) return byStatus;

  if ((a.nextDue === undefined) !== (b.nextDue === undefined)) return a.nextDue === undefined ? 1 : -1;
  if (a.nextDue !== undefined && b.nextDue !== undefined && a.nextDue !== b.nextDue) {
    return a.nextDue.localeCompare(b.nextDue);
  }

  const aAt = a.lastMessage?.createdAt ?? '';
  const bAt = b.lastMessage?.createdAt ?? '';
  if (aAt !== bAt) return bAt.localeCompare(aAt);

  return a.board.name.localeCompare(b.board.name);
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
  const { has } = useCapabilities();
  const user = useAuthStore((s) => s.user);
  // `syncStatusStore` is what the sync engine actually writes to; `authStore.isSyncing` only
  // ever moves during a manual `refreshLocalData`, so the spinner sat still through every
  // background pull. Every other list screen already reads it from here.
  const isSyncing = useSyncStatusStore((s) => s.isSyncing);
  const refreshLocalData = useAuthStore((s) => s.refreshLocalData);
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [stationsById, setStationsById] = useState<Map<string, StationDto>>(new Map());
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const boards = await boardRepository.listForUser(user.id);
    const boardIds = boards.map((board) => board.id);
    const stations = await masterRepository.listActiveStations();
    setStationsById(new Map(stations.map((station) => [station.id, station])));

    // Three grouped queries rather than one per board: the counts used to be an N+1 that
    // re-queried the orders table once for every row on screen.
    const [lastActivity, openCounts, nextDue] = await Promise.all([
      threadRepository.lastActivityForBoards(boardIds),
      orderRepository.openCountsByBoard(boardIds),
      orderRepository.nextDueByBoard(boardIds),
    ]);

    setRows(
      boards
        .map((board) => ({
          board,
          openCount: openCounts.get(board.id) ?? 0,
          nextDue: nextDue.get(board.id),
          lastMessage: lastActivity.get(board.id),
        }))
        .sort(compareBoardRows),
    );
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
  //
  // Stations follow their boards rather than sorting by name. Alphabetical station headings
  // silently threw away the whole ordering computed above: a station called "Annexe" holding
  // one archived board sat above the station holding everything due this morning, so the list
  // looked unsorted. A station now takes the rank of its best board — first station heading
  // is wherever the most urgent work is — and boards keep their order inside it.
  const listItems = useMemo<ListItem[]>(() => {
    const byStation = new Map<string, BoardRow[]>();
    for (const row of filteredRows) {
      const list = byStation.get(row.board.stationId) ?? [];
      list.push(row);
      byStation.set(row.board.stationId, list);
    }

    // `filteredRows` is already sorted, so the first row seen for a station is its best one.
    const stationIds = [...byStation.keys()].sort((a, b) => {
      const bestA = byStation.get(a)?.[0];
      const bestB = byStation.get(b)?.[0];
      if (bestA === undefined || bestB === undefined) return 0;
      const byRank = compareBoardRows(bestA, bestB);
      if (byRank !== 0) return byRank;
      return (stationsById.get(a)?.name ?? 'Other').localeCompare(stationsById.get(b)?.name ?? 'Other');
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
          // Equipment is a stack route rather than a sixth tab: the bottom bar is the four
          // Stitch destinations, and monitoring is reached the same way Settings and
          // Notifications are — from the bar at the top of the landing screen.
          //
          // Shown for a reporter as well as a monitor, because they land on different screens:
          // a Manager gets the monitoring hub, a User gets scan-and-report. Withholding the
          // door from the person who has to report the fault would defeat the module.
          ...(has(Capability.EQUIPMENT_VIEW) || has(Capability.EQUIPMENT_REPORT_PROBLEM)
            ? [
              {
                icon: 'build' as const,
                onPress: () => router.push('/equipment'),
                accessibilityLabel: 'Equipment',
              },
            ]
            : []),
          // Cleaning sits beside Equipment for the same reason and on the same terms: it is a
          // stack route off the landing screen, shown to anybody who may see cleaning work or
          // report something. `cleaning.view` reaches Employee, so in practice this is
          // everybody — which is the point.
          ...(has(Capability.CLEANING_VIEW) || has(Capability.CLEANING_REPORT_INCIDENT)
            ? [
              {
                icon: 'cleaning-services' as const,
                onPress: () => router.push('/cleaning'),
                accessibilityLabel: 'Cleaning',
              },
            ]
            : []),
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

/**
 * What the board was last doing — an order, a message, or nothing yet.
 *
 * A board with live work leads with when that work is due instead of with the last thing
 * anyone typed: "what do I have to get out today" is the question this screen exists to
 * answer, and it was previously buried under whatever chat happened to be most recent.
 */
function previewOf(row: BoardRow): string {
  if (row.nextDue !== undefined) {
    const [due, clock = ''] = row.nextDue.split('T');
    const when = due === todayIsoDate() ? 'Today' : formatDueDay(due ?? '');
    return `Next: ${when} ${clock}`.trim();
  }

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

/** "Tomorrow" or a weekday — how a due day reads on the board card. */
function formatDueDay(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  const start = new Date(`${todayIsoDate()}T00:00:00`);
  const delta = Math.round((parsed.getTime() - start.getTime()) / 86_400_000);
  if (delta === 1) return 'Tomorrow';
  if (delta < 7) return parsed.toLocaleDateString(undefined, { weekday: 'long' });
  return parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
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
