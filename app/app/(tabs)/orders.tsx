import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { BoardDto, MenuItemDto, OrderDto, OrderItemDto } from '@menuboard/shared';
import {
  boardRepository,
  masterRepository,
  orderRepository,
} from '../../src/db/repositories';
import { useAuthStore } from '../../src/state/authStore';
import { useSyncStatusStore } from '../../src/state/syncStatusStore';
import { useLanguage } from '../../src/state/languageStore';
import { useSyncedFocusLoad } from '../../src/hooks/useSyncedFocusLoad';
import { TopAppBar } from '../../src/components/TopAppBar';
import { StatusBadge } from '../../src/components/StatusBadge';
import { EmptyState } from '../../src/components/EmptyState';
import { PressableScale } from '../../src/components/PressableScale';
import { SearchInput } from '../../src/components/SearchInput';
import { SegmentedTabs } from '../../src/components/SegmentedTabs';
import { ItemQuantityList } from '../../src/components/StructuredDataBlock';
import { DateRangeBar, defaultRange, type DateRange } from '../../src/components/order/DateRangeBar';
import { menuItemName, orderLineName, orderLineUnit, t } from '../../src/i18n';
import { formatDateDisplay, todayIsoDate } from '../../src/utils/date';
import { colors, fonts, radii, spacing, typography } from '../../src/theme/tokens';

/**
 * Orders — the fixed board.
 *
 * This is the printed sheet on the kitchen wall, not a worklist: every outstanding requirement
 * across the boards you belong to, today and ahead, laid out to be *read* rather than worked.
 * Nothing here is editable, and tapping a card opens the order rather than mutating it — the
 * board feed is where an order is discussed and changed.
 *
 * The Archive segment reports over a date window, in either of the two shapes people ask for:
 * every order in the window, or a tally of how many times each dish came up.
 */

type Mode = 'board' | 'archive';
type ArchiveView = 'orders' | 'summary';

interface Row {
  order: OrderDto;
  board: BoardDto | undefined;
  items: OrderItemDto[];
}

interface SummaryRow {
  key: string;
  name: string;
  times: number;
  quantity: number;
  unit: string;
}

export default function OrdersScreen(): React.JSX.Element {
  const router = useRouter();
  const language = useLanguage();
  const user = useAuthStore((s) => s.user);
  const isSyncing = useSyncStatusStore((s) => s.isSyncing);
  const refreshLocalData = useAuthStore((s) => s.refreshLocalData);

  const [mode, setMode] = useState<Mode>('board');
  const [archiveView, setArchiveView] = useState<ArchiveView>('orders');
  const [range, setRange] = useState<DateRange>(defaultRange);

  const [rows, setRows] = useState<Row[]>([]);
  const [archiveRows, setArchiveRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [menuItems, setMenuItems] = useState<Map<string, MenuItemDto>>(new Map());
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const boards = await boardRepository.listForUser(user.id);
    const boardIds = boards.map((board) => board.id);
    const boardsById = new Map(boards.map((board) => [board.id, board]));

    const [open, archived, summaryRows] = await Promise.all([
      orderRepository.listAllOpenAcrossBoards(boardIds),
      orderRepository.listArchivedInRange(boardIds, range.from, range.to),
      orderRepository.summariseItemsInRange(boardIds, range.from, range.to),
    ]);

    const itemsByOrder = await orderRepository.listItemsForOrders([
      ...open.map((order) => order.id),
      ...archived.map((order) => order.id),
    ]);

    // One catalogue lookup covers both lists and the summary, so a dish resolves to the same
    // name everywhere on the screen.
    const menuItemIds = new Set<string>();
    for (const items of itemsByOrder.values()) {
      for (const item of items) {
        if (item.menuItemId !== null) menuItemIds.add(item.menuItemId);
      }
    }
    for (const line of summaryRows) {
      if (line.menuItemId !== null) menuItemIds.add(line.menuItemId);
    }
    const catalogue = await masterRepository.mapMenuItemsByIds([...menuItemIds]);

    const toRow = (order: OrderDto): Row => ({
      order,
      board: boardsById.get(order.boardId),
      items: itemsByOrder.get(order.id) ?? [],
    });

    setMenuItems(catalogue);
    setRows(open.map(toRow));
    setArchiveRows(archived.map(toRow));
    setSummary(
      summaryRows.map((line, index) => ({
        key: line.menuItemId ?? line.customItemName ?? `line-${index}`,
        name:
          line.customItemName ??
          menuItemName(line.menuItemId === null ? undefined : catalogue.get(line.menuItemId), language) ??
          'Item',
        times: line.times,
        quantity: line.quantity,
        unit: line.unit,
      })),
    );
  }, [user, range, language]);

  useSyncedFocusLoad(load);

  const source = mode === 'board' ? rows : archiveRows;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return source;
    return source.filter(
      (row) =>
        row.order.venue.toLowerCase().includes(query) ||
        row.order.orderNumber.toLowerCase().includes(query) ||
        (row.order.customActivity ?? '').toLowerCase().includes(query) ||
        (row.board?.name ?? '').toLowerCase().includes(query),
    );
  }, [source, search]);

  const filteredSummary = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return summary;
    return summary.filter((line) => line.name.toLowerCase().includes(query));
  }, [summary, search]);

  const showingSummary = mode === 'archive' && archiveView === 'summary';

  const header = (
    <View style={styles.headerBlock}>
      <SegmentedTabs
        segments={[
          { id: 'board' as const, label: 'Board' },
          { id: 'archive' as const, label: 'Archive' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'archive' ? (
        <>
          <DateRangeBar range={range} onChange={setRange} />
          <SegmentedTabs
            segments={[
              { id: 'orders' as const, label: 'All orders' },
              { id: 'summary' as const, label: 'Summary' },
            ]}
            value={archiveView}
            onChange={setArchiveView}
          />
        </>
      ) : null}

      <SearchInput
        placeholder={showingSummary ? 'Search dishes…' : 'Search orders by venue or event…'}
        value={search}
        onChangeText={setSearch}
      />

      <Text style={styles.countLine}>
        {showingSummary
          ? `${filteredSummary.length} ${filteredSummary.length === 1 ? 'dish' : 'dishes'}`
          : `${filtered.length} ${filtered.length === 1 ? 'order' : 'orders'}`}
        {mode === 'board' ? ' · today and upcoming' : ''}
      </Text>
    </View>
  );

  const refreshControl = (
    <RefreshControl
      refreshing={isSyncing}
      onRefresh={async () => {
        await refreshLocalData();
        await load();
      }}
      tintColor={colors.primary}
    />
  );

  return (
    <View style={styles.screen}>
      <TopAppBar
        title={mode === 'board' ? 'Order Board' : 'Archived Orders'}
        leadingIcon="receipt-long"
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

      {showingSummary ? (
        <FlatList
          data={filteredSummary}
          keyExtractor={(line) => line.key}
          contentContainerStyle={styles.content}
          refreshControl={refreshControl}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              title="Nothing in this window"
              subtitle="No dishes were ordered between these dates."
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInUp.delay(index * 30).duration(280).springify()}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryRank}>{index + 1}.</Text>
                <Text style={styles.summaryName} numberOfLines={2}>
                  {item.name}
                </Text>
                <View style={styles.summaryCounts}>
                  <Text style={styles.summaryTimes}>
                    {item.times} {item.times === 1 ? 'time' : 'times'}
                  </Text>
                  <Text style={styles.summaryQty}>
                    {formatQuantity(item.quantity)} {item.unit}
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(row) => row.order.id}
          contentContainerStyle={styles.content}
          refreshControl={refreshControl}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              title={mode === 'board' ? t('noOrders', language) : 'Nothing in this window'}
              subtitle={
                mode === 'board'
                  ? "Today's and upcoming requirements across your boards appear here."
                  : 'No orders fell between these dates.'
              }
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInUp.delay(index * 40).duration(300).springify()}>
              <PressableScale
                onPress={() =>
                  router.push({
                    pathname: '/orders/[orderId]',
                    params: { orderId: item.order.id },
                  })
                }
              >
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.headline}>
                      <Text style={styles.title} numberOfLines={2}>
                        {item.order.requiredTime} — {item.order.customActivity ?? item.order.venue}
                      </Text>
                      {item.board !== undefined ? (
                        <Text style={styles.boardName} numberOfLines={1}>
                          {item.board.name}
                        </Text>
                      ) : null}
                    </View>
                    <StatusBadge order={item.order} size="sm" />
                  </View>

                  <View style={styles.facts}>
                    <Fact
                      icon="event"
                      text={`${formatDateDisplay(item.order.requiredDate)}${dayTag(item.order.requiredDate)}`}
                    />
                    <Fact icon="group" text={`${item.order.pax} Pax`} />
                    <Fact icon="place" text={item.order.venue} />
                  </View>

                  {item.items.length > 0 ? (
                    <ItemQuantityList
                      title={t('menuRequirements', language)}
                      items={item.items.map((line) => ({
                        id: line.id,
                        name: orderLineName(line, menuItems, language, 'Item'),
                        quantity: `${formatQuantity(line.quantity)} ${orderLineUnit(line, menuItems, language)}`.trim(),
                        cancelled: line.cancelledAt !== null,
                      }))}
                      style={styles.menuPanel}
                    />
                  ) : null}
                </View>
              </PressableScale>
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

/** Marks the two dates a reader scanning a wall board actually needs to tell apart. */
function dayTag(isoDate: string): string {
  const today = todayIsoDate();
  if (isoDate === today) return ' · Today';
  const parsed = new Date(`${isoDate}T00:00:00`);
  const start = new Date(`${today}T00:00:00`);
  if (Math.round((parsed.getTime() - start.getTime()) / 86_400_000) === 1) return ' · Tomorrow';
  return '';
}

/** Quantities are REAL in SQLite; show 12 rather than 12.0, but keep 1.5 intact. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function Fact({
  icon,
  text,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  text: string;
}): React.JSX.Element {
  return (
    <View style={styles.fact}>
      <MaterialIcons name={icon} size={14} color={colors.outline} />
      <Text style={styles.factText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceContainerLow },
  content: { padding: spacing.marginMobile, paddingBottom: spacing[12] },
  headerBlock: { gap: spacing[3], marginBottom: spacing[3] },
  countLine: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
  },

  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.xl,
    padding: spacing.gutter,
    marginBottom: spacing[3],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingBottom: spacing[2],
    marginBottom: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.outlineVariant,
  },
  headline: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: typography.headlineMd.fontFamily,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.weight,
    color: colors.primary,
  },
  boardName: {
    fontFamily: typography.bodySm.fontFamily,
    fontSize: typography.bodySm.size,
    lineHeight: typography.bodySm.lineHeight,
    color: colors.onSurfaceVariant,
    marginTop: spacing[0.5],
  },
  facts: { gap: spacing[1], marginBottom: spacing[3] },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  factText: {
    flex: 1,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurface,
  },
  menuPanel: { marginTop: spacing[1] },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    marginBottom: spacing[2],
  },
  summaryRank: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    color: colors.outline,
    fontVariant: ['tabular-nums'],
    minWidth: 24,
  },
  summaryName: {
    flex: 1,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    fontWeight: '600',
    color: colors.onSurface,
  },
  summaryCounts: { alignItems: 'flex-end' },
  summaryTimes: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    fontWeight: '700',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  summaryQty: {
    fontFamily: typography.bodySm.fontFamily,
    fontSize: typography.bodySm.size,
    color: colors.onSurfaceVariant,
    marginTop: spacing[0.5],
  },
});
