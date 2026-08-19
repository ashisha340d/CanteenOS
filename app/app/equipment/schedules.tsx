import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type {
  EquipmentDto,
  MaintenanceFrequency,
  MaintenanceScheduleDto,
} from '@menuboard/shared';
import {
  Capability,
  LIMITS,
  MAINTENANCE_FREQUENCY_LABELS,
  MaintenanceFrequency as Frequency,
} from '@menuboard/shared';
import { equipmentApi, equipmentErrorMessage, maintenanceApi } from '../../src/api/equipment';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { ThemedBottomSheet } from '../../src/components/BottomSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { FormInput } from '../../src/components/FormInput';
import { PickerSheet } from '../../src/components/PickerSheet';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { SearchInput } from '../../src/components/SearchInput';
import { TopAppBar } from '../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { toIsoDate, todayIsoDate } from '../../src/utils/date';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';

/**
 * Preventive maintenance, as a due list rather than a calendar.
 *
 * A schedule's only interesting property is how close it is, and "6 days overdue" answers that
 * faster than a square on a month view ever could. The two counters at the top are the shape of
 * the week; everything below is the queue in the order the server hands it back.
 *
 * The sweep that turns a due schedule into a ticket runs on the server on its own timer. The
 * button here only asks it to run *now*, and it is idempotent, so pressing it twice raises
 * nothing twice.
 */

const FREQUENCY_CHOICES: readonly Choice<MaintenanceFrequency>[] = [
  Frequency.DAILY,
  Frequency.WEEKLY,
  Frequency.MONTHLY,
  Frequency.QUARTERLY,
  Frequency.HALF_YEARLY,
  Frequency.YEARLY,
  Frequency.CUSTOM,
].map((frequency) => ({ value: frequency, label: MAINTENANCE_FREQUENCY_LABELS[frequency] }));

const PAGE_SIZE = 25;
const DUE_SOON_DAYS = 7;
const DEFAULT_REMINDER_DAYS = '7';

/** YYYY-MM-DD `days` from today on the local calendar. */
function isoDateFromToday(days: number): string {
  const now = new Date();
  return toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

/** "6 days overdue" / "Due in 12 days" — negative `daysUntilDue` means it is already late. */
function dueLabel(days: number | undefined): string {
  if (days === undefined) return 'Due date unknown';
  if (days < 0) {
    const late = Math.abs(days);
    return `${late} day${late === 1 ? '' : 's'} overdue`;
  }
  if (days === 0) return 'Due today';
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

function dateLabel(iso: string | null): string {
  if (iso === null || iso === '') return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** The server takes a plain `YYYY-MM-DD`; anything else is a typo, not an anchor date. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

export default function MaintenanceSchedulesScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();

  const canView = has(Capability.MAINTENANCE_VIEW);
  const canSchedule = has(Capability.MAINTENANCE_SCHEDULE);

  const [schedules, setSchedules] = useState<MaintenanceScheduleDto[]>([]);
  const [total, setTotal] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [dueSoon, setDueSoon] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'sweep' | 'create' | 'delete'>(null);

  const [createSheet, setCreateSheet] = useState(false);
  const [removing, setRemoving] = useState<MaintenanceScheduleDto | null>(null);
  const pageRef = useRef(1);

  /**
   * The first page, plus the two counters.
   *
   * The counters are counted by the server through `dueBefore` rather than tallied over the rows
   * on screen: the list is paged, and a number that grows as you scroll is worse than no number.
   * Three requests in parallel is one round trip's worth of waiting.
   */
  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [page, late, week] = await Promise.all([
        maintenanceApi.listSchedules({ page: 1, pageSize: PAGE_SIZE }),
        maintenanceApi.listSchedules({ pageSize: 1, dueBefore: isoDateFromToday(-1) }),
        maintenanceApi.listSchedules({ pageSize: 1, dueBefore: isoDateFromToday(DUE_SOON_DAYS) }),
      ]);
      pageRef.current = 1;
      setSchedules(page.items);
      setTotal(page.total);
      setTotalPages(page.totalPages);
      setOverdue(late.total);
      setDueSoon(Math.max(week.total - late.total, 0));
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'Preventive schedules could not be loaded.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore || loading || pageRef.current >= totalPages) return;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const page = await maintenanceApi.listSchedules({ page: next, pageSize: PAGE_SIZE });
      pageRef.current = next;
      setTotalPages(page.totalPages);
      setSchedules((current) => [...current, ...page.items]);
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The next page could not be loaded.'));
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, totalPages]);

  useFocusEffect(
    useCallback(() => {
      if (!canView) return;
      void load();
    }, [canView, load]),
  );

  const runSweep = useCallback(async (): Promise<void> => {
    setBusy('sweep');
    setError(null);
    setNotice(null);
    try {
      const result = await maintenanceApi.runSweep();
      setNotice(
        result.ticketsRaised === 0 &&
          result.remindersSent === 0 &&
          result.overdueEscalated === 0 &&
          result.warrantiesFlagged === 0
          ? 'Sweep done — nothing had fallen due, so nothing was raised.'
          : `Sweep done — ${result.ticketsRaised} ticket(s) raised, ${result.remindersSent} reminder(s) sent, ${result.overdueEscalated} escalated, ${result.warrantiesFlagged} warranty flag(s).`,
      );
      await load();
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The sweep could not be run.'));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const confirmRemove = useCallback(async (): Promise<void> => {
    if (removing === null) return;
    setBusy('delete');
    setError(null);
    try {
      await maintenanceApi.removeSchedule(removing.id);
      setNotice(`"${removing.title}" is no longer scheduled. Tickets it already raised are intact.`);
      setRemoving(null);
      await load();
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The schedule was not removed.'));
    } finally {
      setBusy(null);
    }
  }, [load, removing]);

  if (!canView) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Schedules" onBack={() => router.back()} />
        <EmptyState
          title="Not available"
          subtitle="Your account cannot read preventive maintenance schedules."
        />
      </View>
    );
  }

  // `GET /maintenance/schedules` takes no text search, so this filters the pages already loaded
  // rather than pretending to have searched the ones that are not. Scrolling widens what it sees.
  const needle = search.trim().toLowerCase();
  const rows =
    needle === ''
      ? schedules
      : schedules.filter(
        (row) =>
          row.title.toLowerCase().includes(needle) ||
          (row.equipmentName ?? '').toLowerCase().includes(needle) ||
          (row.assetId ?? '').toLowerCase().includes(needle),
      );

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="Schedules"
        onBack={() => router.back()}
        actions={[
          {
            icon: 'handyman',
            onPress: () => router.push('/equipment/tickets'),
            accessibilityLabel: 'All maintenance tickets',
          },
          ...(canSchedule
            ? [
              {
                icon: 'add' as const,
                onPress: () => setCreateSheet(true),
                accessibilityLabel: 'New schedule',
              },
            ]
            : []),
        ]}
      />

      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.taskBar}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.loader} color={colors.taskBar} /> : null
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.lede}>
              The server raises the ticket when a service falls due, so nobody has to remember.
            </Text>

            <View style={styles.counterRow}>
              <Counter label="Overdue" value={overdue} tone={overdue > 0 ? 'danger' : 'neutral'} />
              <Counter label="Due this week" value={dueSoon} tone="warning" />
              <Counter label="Active" value={total} tone="neutral" />
            </View>

            <View style={styles.searchWrap}>
              <SearchInput
                placeholder="Search schedule, asset or machine…"
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
              />
            </View>

            {canSchedule ? (
              <View style={styles.sweepRow}>
                <PrimaryButton
                  label="Run sweep now"
                  variant="secondary"
                  size="sm"
                  loading={busy === 'sweep'}
                  disabled={busy !== null}
                  onPress={() => void runSweep()}
                />
              </View>
            ) : null}

            {notice !== null ? (
              <PressableScale
                onPress={() => setNotice(null)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
              >
                <View style={styles.noticeBar}>
                  <MaterialIcons
                    name="check-circle-outline"
                    size={18}
                    color={colors.onTertiaryContainer}
                  />
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              </PressableScale>
            ) : null}

            {error !== null ? (
              <PressableScale onPress={() => void load()} accessibilityRole="button">
                <View style={styles.errorBar}>
                  <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
                  <Text style={styles.errorText}>{error}</Text>
                  <Text style={styles.retryText}>RETRY</Text>
                </View>
              </PressableScale>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loader} color={colors.taskBar} />
          ) : (
            <EmptyState
              title={needle === '' ? 'No preventive schedules' : 'Nothing matches that'}
              subtitle={
                needle === ''
                  ? 'Registering an asset in a category with a recommended interval creates one automatically.'
                  : 'Try a different asset id or machine name.'
              }
            />
          )
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(Math.min(index, 8) * 40).duration(280)}>
            <ScheduleCard
              schedule={item}
              onPress={() =>
                router.push({
                  pathname: '/equipment/[equipmentId]',
                  params: { equipmentId: item.equipmentId },
                })
              }
              {...(canSchedule ? { onRemove: () => setRemoving(item) } : {})}
            />
          </Animated.View>
        )}
      />

      {canSchedule ? (
        <>
          <ScheduleCreateSheet
            isOpen={createSheet}
            onClose={() => setCreateSheet(false)}
            busy={busy === 'create'}
            onBusyChange={(value) => setBusy(value ? 'create' : null)}
            onCreated={(title) => {
              setCreateSheet(false);
              setNotice(`"${title}" is now scheduled.`);
              void load();
            }}
          />

          <ThemedBottomSheet
            isOpen={removing !== null}
            onClose={() => setRemoving(null)}
            title="Stop scheduling this?"
          >
            <Text style={styles.confirmText}>
              &quot;{removing?.title}&quot; will no longer raise a ticket when it falls due. Tickets
              it has already raised are untouched.
            </Text>
            <PrimaryButton
              label="Remove schedule"
              variant="danger"
              loading={busy === 'delete'}
              onPress={() => void confirmRemove()}
            />
          </ThemedBottomSheet>
        </>
      ) : null}
    </View>
  );
}

/**
 * Creating a schedule.
 *
 * Its own component so the form's eight pieces of state die with the sheet — a half-filled
 * schedule surviving a close and reappearing on the next open reads as a bug, not a convenience.
 */
function ScheduleCreateSheet({
  isOpen,
  onClose,
  busy,
  onBusyChange,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onCreated: (title: string) => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [equipment, setEquipment] = useState<EquipmentDto | null>(null);
  const [candidates, setCandidates] = useState<EquipmentDto[]>([]);
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const [equipmentSheet, setEquipmentSheet] = useState(false);
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<MaintenanceFrequency>(Frequency.MONTHLY);
  const [intervalDays, setIntervalDays] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const [reminderDays, setReminderDays] = useState(DEFAULT_REMINDER_DAYS);
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Debounced so a manager typing an asset id makes one request, not one per character.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const page = await equipmentApi.list({
            pageSize: 25,
            ...(equipmentSearch.trim() === '' ? {} : { search: equipmentSearch.trim() }),
          });
          setCandidates(page.items);
        } catch (caught) {
          setError(equipmentErrorMessage(caught, 'The equipment list could not be loaded.'));
        }
      })();
    }, 250);
    return () => clearTimeout(handle);
  }, [equipmentSearch, isOpen]);

  const submit = useCallback(async (): Promise<void> => {
    if (equipment === null) {
      setError('Choose which asset this services.');
      return;
    }
    const custom = frequency === Frequency.CUSTOM;
    const interval = Number(intervalDays);
    if (custom && (intervalDays.trim() === '' || !Number.isInteger(interval) || interval < 1)) {
      setError('A custom schedule needs a whole number of days.');
      return;
    }
    if (custom && interval > LIMITS.MAINTENANCE_INTERVAL_DAYS_MAX) {
      setError(`The longest interval is ${LIMITS.MAINTENANCE_INTERVAL_DAYS_MAX} days.`);
      return;
    }
    if (anchorDate.trim() !== '' && !isIsoDate(anchorDate.trim())) {
      setError('Write the start date as YYYY-MM-DD, or leave it empty.');
      return;
    }
    const reminder = reminderDays.trim() === '' ? 0 : Number(reminderDays);
    if (
      !Number.isInteger(reminder) ||
      reminder < 0 ||
      reminder > LIMITS.MAINTENANCE_REMINDER_DAYS_MAX
    ) {
      setError(`Remind between 0 and ${LIMITS.MAINTENANCE_REMINDER_DAYS_MAX} days ahead.`);
      return;
    }

    onBusyChange(true);
    setError(null);
    try {
      const created = await maintenanceApi.createSchedule({
        equipmentId: equipment.id,
        frequency,
        ...(title.trim() === '' ? {} : { title: title.trim() }),
        intervalDays: custom ? interval : null,
        ...(anchorDate.trim() === '' ? {} : { anchorDate: anchorDate.trim() }),
        reminderDays: reminder,
        instructions: instructions.trim() === '' ? null : instructions.trim(),
      });
      setEquipment(null);
      setEquipmentSearch('');
      setTitle('');
      setFrequency(Frequency.MONTHLY);
      setIntervalDays('');
      setAnchorDate('');
      setReminderDays(DEFAULT_REMINDER_DAYS);
      setInstructions('');
      onCreated(created.title);
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The schedule was not created.'));
    } finally {
      onBusyChange(false);
    }
  }, [
    anchorDate,
    equipment,
    frequency,
    instructions,
    intervalDays,
    onBusyChange,
    onCreated,
    reminderDays,
    title,
  ]);

  return (
    <>
      <ThemedBottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title="New maintenance schedule"
        scrollable
      >
        {error !== null ? (
          <View style={styles.errorBarFlush}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.sheetLabel}>Equipment</Text>
        <PressableScale
          onPress={() => setEquipmentSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="Choose equipment"
        >
          <View style={styles.selectRow}>
            <Text
              style={[styles.selectValue, equipment === null && styles.selectPlaceholder]}
              numberOfLines={1}
            >
              {equipment === null ? 'Choose the asset' : `${equipment.assetId} · ${equipment.name}`}
            </Text>
            <MaterialIcons name="expand-more" size={22} color={colors.outline} />
          </View>
        </PressableScale>

        <View style={styles.sheetField}>
          <FormInput
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Quarterly service"
            maxLength={LIMITS.MAINTENANCE_TITLE_MAX}
            helper="Leave it empty and the server names it from the category."
          />
        </View>

        <Text style={styles.sheetLabel}>Every</Text>
        <ChoiceChips choices={FREQUENCY_CHOICES} selected={frequency} onSelect={setFrequency} />

        {frequency === Frequency.CUSTOM ? (
          <View style={styles.sheetField}>
            <FormInput
              label="Interval in days"
              value={intervalDays}
              onChangeText={setIntervalDays}
              placeholder="45"
              keyboardType="number-pad"
            />
          </View>
        ) : null}

        <View style={styles.sheetField}>
          <FormInput
            label="Count from (optional)"
            value={anchorDate}
            onChangeText={setAnchorDate}
            placeholder={todayIsoDate()}
            autoCapitalize="none"
            autoCorrect={false}
            helper="Defaults to the asset's installation or purchase date."
          />
        </View>

        <View style={styles.sheetField}>
          <FormInput
            label="Remind this many days ahead"
            value={reminderDays}
            onChangeText={setReminderDays}
            keyboardType="number-pad"
          />
        </View>

        <View style={styles.sheetField}>
          <FormInput
            label="Instructions (optional)"
            value={instructions}
            onChangeText={setInstructions}
            placeholder="Descale the boiler, check the door seal"
            multiline
            maxLength={LIMITS.MAINTENANCE_INSTRUCTIONS_MAX}
            helper="Copied onto every ticket this schedule raises."
          />
        </View>

        <PrimaryButton
          label="Create schedule"
          loading={busy}
          disabled={equipment === null}
          onPress={() => void submit()}
        />
      </ThemedBottomSheet>

      {/* A sibling of the sheet above, never a child: two Gorhom sheets nested inside one another
          stack their containers, and the outer one swallows the taps meant for the inner. */}
      <PickerSheet
        isOpen={equipmentSheet}
        onClose={() => setEquipmentSheet(false)}
        title="Equipment"
        searchable
        options={candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.name,
          subtitle: [candidate.assetId, candidate.locationPath].filter(Boolean).join(' · '),
        }))}
        selectedId={equipment?.id ?? null}
        onSelect={(option) => {
          setEquipment(candidates.find((candidate) => candidate.id === option.id) ?? null);
        }}
      />
    </>
  );
}

function ScheduleCard({
  schedule,
  onPress,
  onRemove,
}: {
  schedule: MaintenanceScheduleDto;
  onPress: () => void;
  onRemove?: () => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const days = schedule.daysUntilDue;
  const overdue = days !== undefined && days < 0;

  return (
    <View style={styles.card}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${schedule.title}, ${schedule.equipmentName ?? 'equipment'}`}
        style={styles.cardPress}
      >
        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {schedule.title}
            </Text>
            <View style={[styles.dueBadge, overdue && styles.dueBadgeOverdue]}>
              <Text style={[styles.dueBadgeText, overdue && styles.dueBadgeTextOverdue]}>
                {dueLabel(days)}
              </Text>
            </View>
          </View>

          <Text style={styles.cardAsset} numberOfLines={1}>
            {[schedule.assetId, schedule.equipmentName].filter(Boolean).join(' · ')}
          </Text>

          <Text style={styles.cardMeta} numberOfLines={2}>
            Every {MAINTENANCE_FREQUENCY_LABELS[schedule.frequency].toLowerCase()}
            {schedule.frequency === Frequency.CUSTOM && schedule.intervalDays !== null
              ? ` (${schedule.intervalDays} days)`
              : ''}
            {' · last done '}
            {dateLabel(schedule.lastPerformedAt)}
          </Text>

          <Text style={styles.cardOwner} numberOfLines={1}>
            {schedule.assignedToName ?? schedule.supplierName ?? 'Nobody assigned'}
          </Text>
        </View>
      </PressableScale>

      {onRemove !== undefined ? (
        <PressableScale
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${schedule.title}`}
        >
          <View style={styles.removeButton}>
            <MaterialIcons name="delete-outline" size={20} color={colors.error} />
          </View>
        </PressableScale>
      ) : null}
    </View>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'danger' | 'warning' | 'neutral';
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const valueColor =
    tone === 'danger'
      ? colors.error
      : tone === 'warning'
        ? colors.onTertiaryContainer
        : colors.onSurface;
  return (
    <View style={styles.counter}>
      <Text style={[styles.counterValue, { color: valueColor }]}>{value}</Text>
      <Text style={styles.counterLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    list: { paddingHorizontal: spacing.marginMobile, paddingBottom: spacing[12] },
    loader: { marginVertical: spacing[6] },

    lede: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
      paddingTop: spacing[3],
      paddingBottom: spacing[3],
    },

    counterRow: { flexDirection: 'row', gap: spacing[2] },
    counter: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing[3],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    counterValue: {
      fontFamily: typography.headlineLg.fontFamily,
      fontSize: typography.headlineLg.size,
      lineHeight: typography.headlineLg.lineHeight,
    },
    counterLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      lineHeight: typography.labelCaps.lineHeight,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: spacing[0.5],
    },

    searchWrap: { paddingTop: spacing[4] },
    sweepRow: { paddingTop: spacing[3], alignItems: 'flex-start' },

    noticeBar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      marginTop: spacing[3],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.tertiaryFixed,
    },
    noticeText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onTertiaryContainer,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginTop: spacing[3],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    errorBarFlush: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginBottom: spacing[3],
      padding: spacing[3],
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

    card: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: spacing[2],
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      marginTop: spacing[3],
    },
    cardPress: { flex: 1 },
    cardBody: { padding: spacing[3], gap: spacing[0.5] },
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginBottom: spacing[0.5],
    },
    cardTitle: {
      flex: 1,
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.headlineMd.lineHeight,
      color: colors.onSurface,
    },
    dueBadge: {
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[0.5],
      borderRadius: radii.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLow,
    },
    dueBadgeOverdue: { backgroundColor: colors.errorContainer, borderColor: colors.danger100 },
    dueBadgeText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      lineHeight: typography.labelCaps.lineHeight,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
    },
    dueBadgeTextOverdue: { color: colors.onErrorContainer },
    cardAsset: {
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.bodySm.size,
      letterSpacing: typography.dataMono.letterSpacing,
      color: colors.onSurfaceVariant,
    },
    cardMeta: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
    },
    cardOwner: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.outline,
    },
    removeButton: {
      width: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.outlineVariant,
    },

    confirmText: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurfaceVariant,
      marginBottom: spacing[4],
    },

    sheetField: { marginTop: spacing[3] },
    sheetLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginTop: spacing[3],
      marginBottom: spacing[1.5],
    },
    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      minHeight: 48,
      paddingHorizontal: spacing[3],
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.gray200,
      backgroundColor: colors.surfaceContainerLowest,
    },
    selectValue: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.textPrimary,
    },
    selectPlaceholder: { color: colors.gray400 },
  });
}
