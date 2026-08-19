import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, RefreshControl, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type {
  MaintenancePriority,
  MaintenanceRequestKind,
  MaintenanceTicketDto,
  MaintenanceTicketListQuery,
  MaintenanceTicketStatus,
} from '@menuboard/shared';
import {
  Capability,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_REQUEST_KIND_LABELS,
  MAINTENANCE_TICKET_STATUS_LABELS,
  MaintenancePriority as Priority,
  MaintenanceRequestKind as RequestKind,
  MaintenanceTicketStatus as TicketStatus,
} from '@menuboard/shared';
import { equipmentErrorMessage, maintenanceApi } from '../../../src/api/equipment';
import { useCapabilities } from '../../../src/permissions/useCapabilities';
import { EmptyState } from '../../../src/components/EmptyState';
import { PressableScale } from '../../../src/components/PressableScale';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { SearchInput } from '../../../src/components/SearchInput';
import { TopAppBar } from '../../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../../src/components/equipment/ChoiceChips';
import { TicketRow } from '../../../src/components/equipment/TicketRow';
import { radii, spacing, typography } from '../../../src/theme/tokens';
import { useThemeColors } from '../../../src/theme/useThemeColors';

/**
 * Every maintenance ticket, however it was raised.
 *
 * The server orders them by priority and then by how far up the ladder they have got, so a
 * critical fault nobody has acknowledged is the first row on the screen and no client-side
 * sorting is needed — or wanted, since a page is a window onto that order, not the whole set.
 *
 * Filtering is four separate one-line chip rows rather than a filter sheet. On a phone held in
 * one hand the questions worth asking are "what is still open", "what state", "how urgent" and
 * "what kind", and each should cost a single tap with the answer visible without opening
 * anything. Only one dimension of each is chosen at a time, which is exactly what the server's
 * query accepts.
 */

type OpenFilter = 'OPEN' | 'EVERYTHING';

const OPEN_CHOICES: readonly Choice<OpenFilter>[] = [
  { value: 'OPEN', label: 'Open only', icon: 'pending-actions' },
  { value: 'EVERYTHING', label: 'Everything', icon: 'inbox' },
];

const STATUS_CHOICES: readonly Choice<MaintenanceTicketStatus>[] = [
  TicketStatus.REPORTED,
  TicketStatus.ACKNOWLEDGED,
  TicketStatus.ASSIGNED,
  TicketStatus.SUPPLIER_CONTACTED,
  TicketStatus.TECHNICIAN_SCHEDULED,
  TicketStatus.UNDER_MAINTENANCE,
  TicketStatus.WAITING_FOR_PARTS,
  TicketStatus.RESOLVED,
  TicketStatus.VERIFIED,
  TicketStatus.CLOSED,
  TicketStatus.CANCELLED,
].map((status) => ({ value: status, label: MAINTENANCE_TICKET_STATUS_LABELS[status] }));

const PRIORITY_CHOICES: readonly Choice<MaintenancePriority>[] = [
  Priority.CRITICAL,
  Priority.HIGH,
  Priority.NORMAL,
  Priority.LOW,
].map((priority) => ({ value: priority, label: MAINTENANCE_PRIORITY_LABELS[priority] }));

const KIND_CHOICES: readonly Choice<MaintenanceRequestKind>[] = [
  RequestKind.PROBLEM,
  RequestKind.FAULT,
  RequestKind.MAINTENANCE,
  RequestKind.INSPECTION,
  RequestKind.SCHEDULED,
].map((kind) => ({ value: kind, label: MAINTENANCE_REQUEST_KIND_LABELS[kind] }));

const PAGE_SIZE = 25;

interface Filters {
  open: OpenFilter;
  status: MaintenanceTicketStatus | null;
  priority: MaintenancePriority | null;
  kind: MaintenanceRequestKind | null;
}

const NO_FILTERS: Filters = { open: 'OPEN', status: null, priority: null, kind: null };

function queryFor(filters: Filters, search: string, page: number): MaintenanceTicketListQuery {
  const query: MaintenanceTicketListQuery = { page, pageSize: PAGE_SIZE };
  if (search.trim() !== '') query.search = search.trim();
  if (filters.open === 'OPEN') query.openOnly = true;
  if (filters.status !== null) query.status = filters.status;
  if (filters.priority !== null) query.priority = filters.priority;
  if (filters.kind !== null) query.kind = filters.kind;
  return query;
}

function activeFilterCount(filters: Filters): number {
  return (
    (filters.open === 'OPEN' ? 1 : 0) +
    (filters.status === null ? 0 : 1) +
    (filters.priority === null ? 0 : 1) +
    (filters.kind === null ? 0 : 1)
  );
}

export default function MaintenanceTicketsScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();

  const canView = has(Capability.MAINTENANCE_VIEW);
  const canCreate = has(Capability.MAINTENANCE_CREATE);

  const [items, setItems] = useState<MaintenanceTicketDto[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  /** Bumped on every focus, so returning from a ticket re-reads the list. */
  const [focusCount, setFocusCount] = useState(0);
  const pageRef = useRef(1);

  const load = useCallback(
    async (nextFilters: Filters, nextSearch: string): Promise<void> => {
      setError(null);
      try {
        const result = await maintenanceApi.listTickets(queryFor(nextFilters, nextSearch, 1));
        pageRef.current = 1;
        setTotalPages(result.totalPages);
        setTotal(result.total);
        setItems(result.items);
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'Maintenance tickets could not be loaded.'));
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

  // One loader for first paint, every focus, and every filter or search change — debounced so
  // typing a ticket number is one request rather than one per keystroke.
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
      const result = await maintenanceApi.listTickets(queryFor(filters, search, next));
      pageRef.current = next;
      setTotalPages(result.totalPages);
      setTotal(result.total);
      setItems((current) => [...current, ...result.items]);
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The next page could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  }, [filters, loading, loadingMore, search, totalPages]);

  if (!canView) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Maintenance" onBack={() => router.back()} />
        <EmptyState
          title="Not available"
          subtitle="Your account cannot read maintenance tickets."
        />
      </View>
    );
  }

  const filterCount = activeFilterCount(filters);
  const searching = search.trim() !== '';

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="Maintenance"
        onBack={() => router.back()}
        actions={[
          {
            icon: 'assignment-ind',
            onPress: () => router.push('/equipment/my-maintenance'),
            accessibilityLabel: 'My maintenance',
          },
          {
            icon: 'event-repeat',
            onPress: () => router.push('/equipment/schedules'),
            accessibilityLabel: 'Preventive schedules',
          },
        ]}
      />

      <View style={styles.searchWrap}>
        <SearchInput
          placeholder="Search ticket, problem or asset…"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText} numberOfLines={1}>
          {loading
            ? 'Loading…'
            : `${total} ${filters.open === 'OPEN' ? 'open' : 'total'} ${total === 1 ? 'ticket' : 'tickets'}`}
        </Text>
        <PressableScale
          onPress={() => setShowFilters((current) => !current)}
          accessibilityRole="button"
          accessibilityLabel={showFilters ? 'Hide filters' : 'Show filters'}
        >
          <View style={styles.filterToggle}>
            <MaterialIcons name="tune" size={16} color={colors.taskBar} />
            <Text style={styles.filterToggleText}>
              {filterCount === 0 ? 'Filter' : `Filters · ${filterCount}`}
            </Text>
            <MaterialIcons
              name={showFilters ? 'expand-less' : 'expand-more'}
              size={16}
              color={colors.taskBar}
            />
          </View>
        </PressableScale>
      </View>

      {showFilters ? (
        <Animated.View entering={FadeInUp.duration(200)} style={styles.filterPanel}>
          <FilterBlock label="Show">
            <ChoiceChips
              choices={OPEN_CHOICES}
              selected={filters.open}
              onSelect={(open) => setFilters((current) => ({ ...current, open }))}
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
          <FilterBlock label="Type">
            <ChoiceChips
              choices={KIND_CHOICES}
              selected={filters.kind}
              onSelect={(kind) =>
                setFilters((current) => ({ ...current, kind: current.kind === kind ? null : kind }))
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
                setFilters({ ...NO_FILTERS, open: 'EVERYTHING' });
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
              title={
                searching || filterCount > 1
                  ? 'Nothing matches that'
                  : filters.open === 'OPEN'
                    ? 'Nothing is broken'
                    : 'No tickets yet'
              }
              subtitle={
                searching || filterCount > 1
                  ? 'Try another filter, or clear them to see every ticket.'
                  : 'Problems reported from the floor and services raised by the preventive sweep both land here.'
              }
            />
          )
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.loader} color={colors.taskBar} /> : null
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(Math.min(index, 8) * 40).duration(280)}>
            <TicketRow
              ticket={item}
              onPress={() =>
                router.push({
                  pathname: '/equipment/tickets/[ticketId]',
                  params: { ticketId: item.id },
                })
              }
            />
          </Animated.View>
        )}
      />

      {canCreate ? (
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

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
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
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
    },
    filterToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
      minHeight: 36,
      paddingHorizontal: spacing[3],
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    filterToggleText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.taskBar,
    },

    filterPanel: {
      paddingBottom: spacing[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outlineVariant,
    },
    filterBlock: { paddingBottom: spacing[2] },
    filterLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.marginMobile,
      paddingBottom: spacing[1.5],
    },
    clearWrap: { paddingHorizontal: spacing.marginMobile, paddingTop: spacing[1] },

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
