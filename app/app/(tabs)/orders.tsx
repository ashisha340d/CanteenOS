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
import { ItemQuantityList } from '../../src/components/StructuredDataBlock';
import { orderLineName, orderLineUnit, t } from '../../src/i18n';
import { formatDateDisplay } from '../../src/utils/date';
import { colors, radii, spacing, typography } from '../../src/theme/tokens';

/**
 * Orders — every outstanding requirement across the boards you belong to.
 *
 * Follows the `create_new_order` mockup's "Pending Requirements" list: each card leads with
 * the time and the activity, because that is what someone standing in a kitchen at 6am is
 * scanning for, then carries the date/pax facts and the menu the order actually asks for.
 *
 * Boards are the *place* work happens; this tab is the *work itself*, flattened across every
 * board so nothing outstanding hides one level down.
 */

interface Row {
  order: OrderDto;
  board: BoardDto | undefined;
  items: OrderItemDto[];
}

export default function OrdersScreen(): React.JSX.Element {
  const router = useRouter();
  const language = useLanguage();
  const user = useAuthStore((s) => s.user);
  const isSyncing = useSyncStatusStore((s) => s.isSyncing);
  const refreshLocalData = useAuthStore((s) => s.refreshLocalData);

  const [rows, setRows] = useState<Row[]>([]);
  const [menuItems, setMenuItems] = useState<Map<string, MenuItemDto>>(new Map());
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const boards = await boardRepository.listForUser(user.id);
    const boardsById = new Map(boards.map((board) => [board.id, board]));
    const orders = await orderRepository.listAllOpenAcrossBoards(boards.map((b) => b.id));
    const itemsByOrder = await orderRepository.listItemsForOrders(orders.map((o) => o.id));

    const menuItemIds = new Set<string>();
    for (const items of itemsByOrder.values()) {
      for (const item of items) {
        if (item.menuItemId !== null) menuItemIds.add(item.menuItemId);
      }
    }

    setMenuItems(await masterRepository.mapMenuItemsByIds([...menuItemIds]));
    setRows(
      orders.map((order) => ({
        order,
        board: boardsById.get(order.boardId),
        items: itemsByOrder.get(order.id) ?? [],
      })),
    );
  }, [user]);

  useSyncedFocusLoad(load);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return rows;
    return rows.filter(
      (row) =>
        row.order.venue.toLowerCase().includes(query) ||
        row.order.orderNumber.toLowerCase().includes(query) ||
        (row.order.customActivity ?? '').toLowerCase().includes(query) ||
        (row.board?.name ?? '').toLowerCase().includes(query),
    );
  }, [rows, search]);

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="Pending Requirements"
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
          <SearchInput
            placeholder="Search orders by venue or event…"
            value={search}
            onChangeText={setSearch}
            containerStyle={styles.search}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={t('noOrders', language)}
            subtitle="Outstanding requirements across your boards appear here."
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
                    <Text style={styles.title} numberOfLines={1}>
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
                  <Fact icon="event" text={formatDateDisplay(item.order.requiredDate)} />
                  <Fact icon="group" text={`${item.order.pax} Pax`} />
                  <Fact icon="place" text={item.order.venue} />
                </View>

                {item.items.length > 0 ? (
                  <ItemQuantityList
                    title={t('menuRequirements', language)}
                    items={item.items.map((line) => ({
                      id: line.id,
                      name: orderLineName(line, menuItems, language, 'Item'),
                      quantity: `${line.quantity} ${orderLineUnit(line, menuItems, language)}`.trim(),
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
    </View>
  );
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
  search: { marginBottom: spacing[3] },
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
});
