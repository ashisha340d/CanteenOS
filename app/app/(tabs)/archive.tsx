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
import { StatusChip } from '../../src/components/StatusChip';
import { EmptyState } from '../../src/components/EmptyState';
import { PressableScale } from '../../src/components/PressableScale';
import { SearchInput } from '../../src/components/SearchInput';
import {
  ItemQuantityList,
  StructuredDataBlock,
} from '../../src/components/StructuredDataBlock';
import { orderLineName, t } from '../../src/i18n';
import { formatDateDisplay } from '../../src/utils/date';
import { colors, fonts, radii, spacing, typography } from '../../src/theme/tokens';

/**
 * Archive — what has already been delivered.
 *
 * The two header tiles are local aggregates over synced SQLite rows, not a server report: the
 * offline-first rule says a screen renders from the device database, and a kitchen with no
 * signal should still see what it got through. They are counted in SQL so the archive can grow
 * without the tiles pulling every row into memory.
 *
 * Each card leads with the activity and a *sum of items*, which is the number the
 * `archive_activity_item_summaries` mockup treats as the headline — how much was actually
 * produced, not how many orders were raised.
 */

interface Row {
  order: OrderDto;
  board: BoardDto | undefined;
  items: OrderItemDto[];
  itemTotal: number;
}

export default function ArchiveScreen(): React.JSX.Element {
  const router = useRouter();
  const language = useLanguage();
  const user = useAuthStore((s) => s.user);
  const isSyncing = useSyncStatusStore((s) => s.isSyncing);
  const refreshLocalData = useAuthStore((s) => s.refreshLocalData);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ orders: 0, pax: 0 });
  const [menuItems, setMenuItems] = useState<Map<string, MenuItemDto>>(new Map());
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const boards = await boardRepository.listForUser(user.id);
    const boardIds = boards.map((board) => board.id);
    const boardsById = new Map(boards.map((board) => [board.id, board]));

    const [orders, completedTotals] = await Promise.all([
      orderRepository.listCompletedAcrossBoards(boardIds),
      orderRepository.completedTotals(boardIds),
    ]);
    const itemsByOrder = await orderRepository.listItemsForOrders(orders.map((o) => o.id));

    const menuItemIds = new Set<string>();
    for (const items of itemsByOrder.values()) {
      for (const item of items) {
        if (item.menuItemId !== null) menuItemIds.add(item.menuItemId);
      }
    }

    setTotals(completedTotals);
    setMenuItems(await masterRepository.mapMenuItemsByIds([...menuItemIds]));
    setRows(
      orders.map((order) => {
        const items = itemsByOrder.get(order.id) ?? [];
        return {
          order,
          board: boardsById.get(order.boardId),
          items,
          // Cancelled lines were never produced, so they must not inflate the headline.
          itemTotal: items
            .filter((item) => item.cancelledAt === null)
            .reduce((sum, item) => sum + item.quantity, 0),
        };
      }),
    );
  }, [user]);

  useSyncedFocusLoad(load);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return rows;
    return rows.filter(
      (row) =>
        row.order.venue.toLowerCase().includes(query) ||
        (row.order.customActivity ?? '').toLowerCase().includes(query) ||
        (row.board?.name ?? '').toLowerCase().includes(query),
    );
  }, [rows, search]);

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="Archive"
        leadingIcon="inventory-2"
        actions={[
          {
            icon: 'settings',
            onPress: () => router.push('/settings'),
            accessibilityLabel: 'Settings',
          },
        ]}
      />

      <FlatList
        data={filtered}
        keyExtractor={(row) => row.order.id}
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
            <StatTile
              icon="local-shipping"
              label="Total orders delivered"
              value={totals.orders}
              tone="primary"
            />
            <StatTile
              icon="restaurant"
              label="Total pax served"
              value={totals.pax}
              tone="secondary"
            />
            <SearchInput
              placeholder="Search orders by venue or event…"
              value={search}
              onChangeText={setSearch}
              containerStyle={styles.search}
            />
            <Text style={styles.sectionTitle}>Completed Orders</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Nothing archived yet"
            subtitle="Delivered and closed orders collect here."
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
                <StatusChip
                  label={item.order.status === 'DONE' ? 'COMPLETED' : 'DELIVERED'}
                  tone={colors.boardActive}
                  icon="check-circle"
                />

                <Text style={styles.activityLabel}>Activity</Text>
                <Text style={styles.activity} numberOfLines={1}>
                  {item.order.customActivity ?? item.board?.name ?? item.order.venue}
                </Text>

                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>Sum of items</Text>
                  <Text style={styles.sumValue}>{formatQuantity(item.itemTotal)}</Text>
                </View>

                <View style={styles.venueRow}>
                  <MaterialIcons name="place" size={14} color={colors.outline} />
                  <Text style={styles.venueText} numberOfLines={1}>
                    {item.order.venue}
                  </Text>
                </View>

                <StructuredDataBlock
                  fields={[
                    {
                      label: t('date', language),
                      value: `${formatDateDisplay(item.order.requiredDate)}, ${item.order.requiredTime}`,
                    },
                    {
                      label: t('pax', language),
                      value: `${item.order.pax} / ${item.items.length} items`,
                    },
                  ]}
                  style={styles.dataBlock}
                />

                {item.items.length > 0 ? (
                  <ItemQuantityList
                    items={item.items.slice(0, 6).map((line) => ({
                      id: line.id,
                      name: orderLineName(line, menuItems, language, 'Item'),
                      quantity: `x${formatQuantity(line.quantity)}`,
                      cancelled: line.cancelledAt !== null,
                    }))}
                    style={styles.itemList}
                  />
                ) : null}
              </View>
            </PressableScale>
          </Animated.View>
        )}
      />
    </View>
  );
}

/** Quantities are REAL in SQLite; show 12 rather than 12.0, but keep 1.5 intact. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: number;
  tone: 'primary' | 'secondary';
}): React.JSX.Element {
  const isPrimary = tone === 'primary';
  return (
    <View style={styles.tile}>
      <View
        style={[
          styles.tileIcon,
          { backgroundColor: isPrimary ? colors.primary : colors.secondaryContainer },
        ]}
      >
        <MaterialIcons
          name={icon}
          size={22}
          color={isPrimary ? colors.onPrimary : colors.onSecondaryContainer}
        />
      </View>
      <View style={styles.tileText}>
        <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
        <Text style={[styles.tileValue, { color: isPrimary ? colors.primary : colors.secondary }]}>
          {value.toLocaleString()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceContainerLow },
  content: { padding: spacing.marginMobile, paddingBottom: spacing[12] },
  search: { marginTop: spacing[1], marginBottom: spacing[4] },
  sectionTitle: {
    fontFamily: typography.headlineMd.fontFamily,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.weight,
    color: colors.onSurface,
    marginBottom: spacing[3],
  },

  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.xl,
    padding: spacing.gutter,
    marginBottom: spacing[3],
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { flex: 1, minWidth: 0 },
  tileLabel: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    lineHeight: typography.labelCaps.lineHeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.onSurfaceVariant,
  },
  tileValue: {
    fontFamily: typography.headlineLg.fontFamily,
    fontSize: typography.headlineLg.size,
    lineHeight: typography.headlineLg.lineHeight,
    fontWeight: typography.headlineLg.weight,
    marginTop: spacing[0.5],
  },

  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.xl,
    padding: spacing.gutter,
    marginBottom: spacing[3],
  },
  activityLabel: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    lineHeight: typography.labelCaps.lineHeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.outline,
    textTransform: 'uppercase',
    marginTop: spacing[3],
  },
  activity: {
    fontFamily: typography.headlineMd.fontFamily,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.weight,
    color: colors.primary,
    marginBottom: spacing[2],
  },
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.boardActive.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.boardActive.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  sumLabel: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.boardActive.fg,
    textTransform: 'uppercase',
  },
  sumValue: {
    fontFamily: fonts.mono,
    fontSize: typography.headlineMd.size,
    lineHeight: typography.headlineMd.lineHeight,
    color: colors.boardActive.fg,
    fontVariant: ['tabular-nums'],
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: spacing[3],
    marginBottom: spacing[2],
  },
  venueText: {
    flex: 1,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
  },
  dataBlock: { marginBottom: spacing[2] },
  itemList: { marginTop: spacing[1] },
});
