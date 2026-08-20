import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  CLEANING_TASK_PRIORITY_LABELS,
  CLEANING_TASK_STATUS_LABELS,
  Capability,
  CleaningTaskPriority,
  CleaningTaskStatus,
  type CleaningTaskDto,
  type CleaningTaskListQuery,
} from '@menuboard/shared';
import { cleaningApi, cleaningErrorMessage } from '../../src/api/cleaning';
import { EmptyState } from '../../src/components/EmptyState';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { SearchInput } from '../../src/components/SearchInput';
import { TopAppBar } from '../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { CleaningTaskRow } from '../../src/components/cleaning/CleaningTaskRow';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';
import type { ColorPalette } from '../../src/theme/tokens';

/**
 * All cleaning work, not just the reader's own.
 *
 * "My cleaning" answers what one person owes today; this answers what the shift owes, which is
 * a supervisor's question and the one assignment starts from. Without it, handing a task to
 * somebody was reachable only by following a notification — so an unowned task nobody had been
 * paged about could not be given to anyone from the floor.
 *
 * The default view is deliberately "needs an owner": it is the state the module pages a
 * supervisor about, and the one that costs nothing to fix while somebody is still standing in
 * the kitchen.
 */

type Scope = 'UNASSIGNED' | 'OPEN' | 'OVERDUE' | 'EVERYTHING';

const SCOPE_CHOICES: readonly Choice<Scope>[] = [
  { value: 'UNASSIGNED', label: 'Needs an owner', icon: 'person-search' },
  { value: 'OPEN', label: 'Open', icon: 'pending-actions' },
  { value: 'OVERDUE', label: 'Overdue', icon: 'schedule' },
  { value: 'EVERYTHING', label: 'Everything', icon: 'inbox' },
];

const STATUS_CHOICES: readonly Choice<CleaningTaskStatus>[] = [
  CleaningTaskStatus.UNASSIGNED,
  CleaningTaskStatus.ASSIGNED,
  CleaningTaskStatus.STARTED,
  CleaningTaskStatus.COMPLETED,
  CleaningTaskStatus.VERIFICATION_REQUIRED,
  CleaningTaskStatus.FAILED,
  CleaningTaskStatus.RECLEAN_REQUIRED,
  CleaningTaskStatus.VERIFIED,
  CleaningTaskStatus.CLOSED,
].map((status) => ({ value: status, label: CLEANING_TASK_STATUS_LABELS[status] }));

const PRIORITY_CHOICES: readonly Choice<CleaningTaskPriority>[] = [
  CleaningTaskPriority.CRITICAL,
  CleaningTaskPriority.HIGH,
  CleaningTaskPriority.NORMAL,
  CleaningTaskPriority.LOW,
].map((priority) => ({ value: priority, label: CLEANING_TASK_PRIORITY_LABELS[priority] }));

const PAGE_SIZE = 25;

interface Filters {
  scope: Scope;
  status: CleaningTaskStatus | null;
  priority: CleaningTaskPriority | null;
}

const DEFAULT_FILTERS: Filters = { scope: 'UNASSIGNED', status: null, priority: null };

function queryFor(filters: Filters, search: string, page: number): CleaningTaskListQuery {
  const query: CleaningTaskListQuery = { page, pageSize: PAGE_SIZE };
  if (search.trim() !== '') query.search = search.trim();
  if (filters.scope === 'UNASSIGNED') query.unassignedOnly = true;
  if (filters.scope === 'OPEN') query.openOnly = true;
  if (filters.scope === 'OVERDUE') query.overdueOnly = true;
  if (filters.status !== null) query.status = filters.status;
  if (filters.priority !== null) query.priority = filters.priority;
  return query;
}

export default function CleaningTasksScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const canView = has(Capability.CLEANING_VIEW);

  const [items, setItems] = useState<CleaningTaskDto[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  /** Bumped on every focus, so coming back from an assignment re-reads the list. */
  const [focusCount, setFocusCount] = useState(0);
  const pageRef = useRef(1);

  const load = useCallback(async (nextFilters: Filters, nextSearch: string): Promise<void> => {
    setError(null);
    try {
      const result = await cleaningApi.listTasks(queryFor(nextFilters, nextSearch, 1));
      pageRef.current = 1;
      setTotalPages(result.totalPages);
      setTotal(result.total);
      setItems(result.items);
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'Cleaning tasks could not be loaded.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocusCount((count) => count + 1);
    }, []),
  );

  // One loader for first paint, every focus and every filter or search change — debounced so
  // typing an asset name is one request rather than one per keystroke.
  useEffect(() => {
    if (!canView) return undefined;
    const handle = setTimeout(() => {
      void load(filters, search);
    }, 250);
    return () => clearTimeout(handle);
  }, [canView, filters, search, focusCount, load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore || loading || pageRef.current >= totalPages) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const result = await cleaningApi.listTasks(queryFor(filters, search, next));
      pageRef.current = next;
      setTotalPages(result.totalPages);
      setTotal(result.total);
      setItems((current) => [...current, ...result.items]);
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'The next page could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  }, [filters, loading, loadingMore, search, totalPages]);

  if (!canView) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="All cleaning" onBack={() => router.back()} />
        <EmptyState title="Not available" subtitle="Your account cannot read cleaning work." />
      </View>
    );
  }

  const filterCount =
    (filters.scope === 'EVERYTHING' ? 0 : 1) +
    (filters.status === null ? 0 : 1) +
    (filters.priority === null ? 0 : 1);
  const searching = search.trim() !== '';

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="All cleaning"
        onBack={() => router.back()}
        actions={[
          {
            icon: 'qr-code-scanner',
            onPress: () => router.push('/cleaning/scan'),
            accessibilityLabel: 'Find something by its label',
          },
        ]}
      />

      <View style={styles.searchWrap}>
        <SearchInput
          placeholder="Search task, asset or area…"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText} numberOfLines={1}>
          {loading ? 'Loading…' : `${total} ${total === 1 ? 'task' : 'tasks'}`}
        </Text>
        <PressableScale
          onPress={() => setShowFilters((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={showFilters ? 'Hide filters' : 'Show filters'}
        >
          <View style={styles.filterToggle}>
            <MaterialIcons name="tune" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.filterToggleText}>
              {filterCount === 0 ? 'Filter' : `Filters · ${filterCount}`}
            </Text>
            <MaterialIcons
              name={showFilters ? 'expand-less' : 'expand-more'}
              size={16}
              color={colors.onSurfaceVariant}
            />
          </View>
        </PressableScale>
      </View>

      {showFilters ? (
        <Animated.View entering={FadeInUp.duration(200)} style={styles.filterPanel}>
          <FilterBlock label="Show">
            <ChoiceChips
              choices={SCOPE_CHOICES}
              selected={filters.scope}
              onSelect={(scope) => setFilters((current) => ({ ...current, scope }))}
              scroll
            />
          </FilterBlock>
          <FilterBlock label="Status">
            <ChoiceChips
              choices={STATUS_CHOICES}
              selected={filters.status}
              onSelect={(status) =>
                setFilters((current) => ({
                  ...current,
                  status: current.status === status ? null : status,
                }))
              }
              scroll
            />
          </FilterBlock>
          <FilterBlock label="Priority">
            <ChoiceChips
              choices={PRIORITY_CHOICES}
              selected={filters.priority}
              onSelect={(priority) =>
                setFilters((current) => ({
                  ...current,
                  priority: current.priority === priority ? null : priority,
                }))
              }
              scroll
            />
          </FilterBlock>
          <View style={styles.clearWrap}>
            <PrimaryButton
              label="Clear filters"
              variant="ghost"
              size="sm"
              disabled={filterCount === 0 && !searching}
              onPress={() => {
                setFilters({ scope: 'EVERYTHING', status: null, priority: null });
                setSearch('');
              }}
            />
          </View>
        </Animated.View>
      ) : null}

      {error !== null ? (
        <PressableScale onPress={() => void load(filters, search)} accessibilityRole="button">
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
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(filters, search);
            }}
            tintColor={colors.primary}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <EmptyState
              title={
                searching || filters.status !== null || filters.priority !== null
                  ? 'Nothing matches that'
                  : filters.scope === 'UNASSIGNED'
                    ? 'Everything has an owner'
                    : filters.scope === 'OVERDUE'
                      ? 'Nothing is late'
                      : 'No cleaning tasks'
              }
              subtitle={
                filters.scope === 'UNASSIGNED'
                  ? 'Work the engine could not hand out on its own waits here for a decision.'
                  : 'Scheduled cleans and anything reported from the floor both land here.'
              }
            />
          )
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : null
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(Math.min(index, 8) * 40).duration(280)}>
            <CleaningTaskRow
              task={item}
              showOwner
              onPress={() =>
                router.push({ pathname: '/cleaning/[taskId]', params: { taskId: item.id } })
              }
            />
          </Animated.View>
        )}
      />
    </View>
  );
}

function FilterBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.filterBlock}>
      <Text style={styles.filterLabel}>{label}</Text>
      {children}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    searchWrap: {
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[3],
      paddingBottom: spacing[2],
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[2],
      paddingHorizontal: spacing.marginMobile,
      paddingBottom: spacing[2],
    },
    summaryText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
    },
    filterToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
      borderRadius: radii.full,
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[1],
      backgroundColor: colors.surfaceContainerLow,
    },
    filterToggleText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      color: colors.onSurfaceVariant,
    },
    filterPanel: {
      paddingHorizontal: spacing.marginMobile,
      paddingBottom: spacing[2],
      gap: spacing[2],
    },
    filterBlock: { gap: spacing[1] },
    filterLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      color: colors.onSurfaceVariant,
    },
    clearWrap: { alignItems: 'flex-start' },
    list: { paddingHorizontal: spacing.marginMobile, paddingBottom: spacing[16], gap: spacing[2] },
    loader: { marginTop: spacing[8] },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginHorizontal: spacing.marginMobile,
      marginBottom: spacing[2],
      borderRadius: radii.lg,
      padding: spacing[3],
      backgroundColor: colors.errorContainer,
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onErrorContainer,
    },
    retryText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      color: colors.onErrorContainer,
    },
  });
}
