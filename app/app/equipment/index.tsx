import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { EquipmentDto, EquipmentListQuery, EquipmentStatus } from '@menuboard/shared';
import { Capability, EQUIPMENT_STATUS_LABELS, EquipmentStatus as Status } from '@menuboard/shared';
import { equipmentApi, equipmentErrorMessage } from '../../src/api/equipment';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { EmptyState } from '../../src/components/EmptyState';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { SearchInput } from '../../src/components/SearchInput';
import { TopAppBar } from '../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { EquipmentRow } from '../../src/components/equipment/EquipmentRow';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';

/**
 * The asset register, as a searchable list.
 *
 * Online-only (see `src/api/equipment.ts`): the list is a server query with paging and filters,
 * so it is fetched rather than read from SQLite. A failed request leaves the last good page on
 * screen with the reason above it, because a store room with no signal should still show the
 * assets it just showed.
 *
 * The filter row is one horizontal line of chips rather than a filter sheet: on this screen
 * there are exactly two questions worth asking — "what is broken?" and "what state is this in?"
 * — and both should cost one tap.
 */

type Filter = 'ALL' | 'PROBLEMS' | 'OVERDUE' | EquipmentStatus;

const FILTERS: readonly Choice<Filter>[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PROBLEMS', label: 'Open problems', icon: 'report-problem' },
  { value: 'OVERDUE', label: 'Service overdue', icon: 'event' },
  { value: Status.OPERATIONAL, label: EQUIPMENT_STATUS_LABELS.OPERATIONAL },
  { value: Status.RUNNING, label: EQUIPMENT_STATUS_LABELS.RUNNING },
  { value: Status.IDLE, label: EQUIPMENT_STATUS_LABELS.IDLE },
  { value: Status.NEEDS_ATTENTION, label: EQUIPMENT_STATUS_LABELS.NEEDS_ATTENTION },
  { value: Status.PROBLEM, label: EQUIPMENT_STATUS_LABELS.PROBLEM },
  { value: Status.UNDER_MAINTENANCE, label: EQUIPMENT_STATUS_LABELS.UNDER_MAINTENANCE },
  { value: Status.OUT_OF_SERVICE, label: EQUIPMENT_STATUS_LABELS.OUT_OF_SERVICE },
];

const PAGE_SIZE = 25;

function queryFor(filter: Filter, search: string, page: number): EquipmentListQuery {
  const base: EquipmentListQuery = { page, pageSize: PAGE_SIZE };
  if (search.trim() !== '') base.search = search.trim();
  if (filter === 'PROBLEMS') base.hasOpenProblems = true;
  else if (filter === 'OVERDUE') base.maintenanceOverdue = true;
  else if (filter !== 'ALL') base.status = filter;
  return base;
}

export default function EquipmentListScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();

  const canReport = has(Capability.EQUIPMENT_REPORT_PROBLEM);
  const canCreate = has(Capability.EQUIPMENT_CREATE);
  const canSeeMaintenance = has(Capability.MAINTENANCE_VIEW);

  const [items, setItems] = useState<EquipmentDto[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  /** Bumped on every focus, so returning from a ticket re-reads the list. */
  const [focusCount, setFocusCount] = useState(0);
  const pageRef = useRef(1);

  const load = useCallback(
    async (nextFilter: Filter, nextSearch: string): Promise<void> => {
      setError(null);
      try {
        const result = await equipmentApi.list(queryFor(nextFilter, nextSearch, 1));
        pageRef.current = 1;
        setTotalPages(result.totalPages);
        setItems(result.items);
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'Equipment could not be loaded.'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      setFocusCount((count) => count + 1);
    }, []),
  );

  // The single loader for the screen: first paint, every focus, and every filter or search
  // change all funnel through here, debounced so typing an asset id is one request rather than
  // one per keystroke.
  React.useEffect(() => {
    const handle = setTimeout(() => {
      void load(filter, search);
    }, 250);
    return () => clearTimeout(handle);
  }, [filter, search, focusCount, load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore || loading || pageRef.current >= totalPages) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const result = await equipmentApi.list(queryFor(filter, search, next));
      pageRef.current = next;
      setTotalPages(result.totalPages);
      setItems((current) => [...current, ...result.items]);
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The next page could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  }, [filter, loading, loadingMore, search, totalPages]);

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="Equipment"
        onBack={() => router.back()}
        actions={[
          {
            icon: 'qr-code-scanner',
            onPress: () => router.push('/equipment/scan'),
            accessibilityLabel: 'Find by asset id',
          },
          ...(canSeeMaintenance
            ? [
              {
                icon: 'assignment-ind' as const,
                onPress: () => router.push('/equipment/my-maintenance'),
                accessibilityLabel: 'My maintenance',
              },
            ]
            : []),
          ...(canCreate
            ? [
              {
                icon: 'add' as const,
                onPress: () => router.push('/equipment/register'),
                accessibilityLabel: 'Register equipment',
              },
            ]
            : []),
        ]}
      />

      <View style={styles.searchWrap}>
        <SearchInput
          placeholder="Search name, asset id or brand…"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
      </View>

      <View style={styles.filterWrap}>
        <ChoiceChips choices={FILTERS} selected={filter} onSelect={setFilter} scroll />
      </View>

      {error !== null ? (
        <PressableScale onPress={() => void load(filter, search)} accessibilityRole="button">
          <View style={styles.errorBar}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.retryText}>RETRY</Text>
          </View>
        </PressableScale>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(filter, search);
            }}
            tintColor={colors.taskBar}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.taskBar} />
          ) : (
            <EmptyState
              title={search.trim() === '' ? 'No equipment yet' : 'Nothing matches that search'}
              subtitle={
                filter === 'ALL'
                  ? 'Registered assets appear here with their location and status.'
                  : 'Try another filter, or clear it to see everything.'
              }
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.loader} color={colors.taskBar} />
          ) : null
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(Math.min(index, 8) * 40).duration(280)}>
            <EquipmentRow
              equipment={item}
              onPress={() =>
                router.push({
                  pathname: '/equipment/[equipmentId]',
                  params: { equipmentId: item.id },
                })
              }
            />
          </Animated.View>
        )}
      />

      {canReport ? (
        <View style={styles.reportBar}>
          <PrimaryButton
            label="Report a problem"
            onPress={() => router.push('/equipment/report')}
          />
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    searchWrap: {
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[3],
      paddingBottom: spacing[2],
    },
    filterWrap: { paddingBottom: spacing[3] },
    list: { paddingHorizontal: spacing.marginMobile, paddingBottom: spacing[12] },
    loader: { marginVertical: spacing[6] },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginHorizontal: spacing.marginMobile,
      marginBottom: spacing[3],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2.5],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onErrorContainer,
    },
    retryText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onErrorContainer,
    },
    reportBar: {
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[2],
      paddingBottom: spacing[4],
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
    },
  });
}
