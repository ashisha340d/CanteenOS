import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  CLEANING_TRIGGER_EVENT_LABELS,
  Capability,
  type CleaningCorrectiveActionDto,
  type CleaningEventDto,
  type CleaningTaskDto,
  type MyCleaningDto,
} from '@menuboard/shared';
import { cleaningApi, cleaningErrorMessage } from '../../src/api/cleaning';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { EmptyState } from '../../src/components/EmptyState';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { CleaningTaskRow } from '../../src/components/cleaning/CleaningTaskRow';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';
import type { ColorPalette } from '../../src/theme/tokens';

/**
 * My cleaning — the phone's answer to "what is mine, and what is late".
 *
 * Four lists, one at a time, because they answer four different questions and a merged feed
 * would bury the one the reader came for. Counts sit on the tabs so the shape of the shift is
 * visible before anything is tapped.
 *
 * The verify tab only exists for somebody who may verify, and never contains their own work —
 * that filtering is the server's, not a client convenience.
 */

type Tab = 'assigned' | 'dueToday' | 'toVerify' | 'reported' | 'corrective';

const EMPTY: MyCleaningDto = {
  assigned: [],
  dueToday: [],
  toVerify: [],
  reported: [],
  correctiveActions: [],
  counts: { assigned: 0, dueToday: 0, overdue: 0, toVerify: 0, correctiveActions: 0 },
};

export default function MyCleaningScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const canReport = has(Capability.CLEANING_REPORT_INCIDENT);
  const canVerify = has(Capability.CLEANING_VERIFY);
  const canAssign = has(Capability.CLEANING_ASSIGN);

  const [data, setData] = useState<MyCleaningDto>(EMPTY);
  const [tab, setTab] = useState<Tab>('assigned');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setData(await cleaningApi.mine());
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'Your cleaning list could not be loaded.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const tabs: readonly Choice<Tab>[] = [
    { value: 'assigned', label: `Mine (${data.counts.assigned})` },
    { value: 'dueToday', label: `Due today (${data.counts.dueToday})` },
    ...(canVerify
      ? ([{ value: 'toVerify', label: `To check (${data.counts.toVerify})` }] as const)
      : []),
    { value: 'reported', label: `I reported (${data.reported.length})` },
    ...(data.counts.correctiveActions > 0
      ? ([
          { value: 'corrective', label: `Fixes (${data.counts.correctiveActions})` },
        ] as const)
      : []),
  ];

  const openTask = (taskId: string): void => {
    router.push({ pathname: '/cleaning/[taskId]', params: { taskId } });
  };

  const emptyCopy: Record<Tab, { title: string; subtitle: string }> = {
    assigned: {
      title: 'Nothing assigned to you',
      subtitle: 'Cleaning handed to you appears here the moment the schedule reaches it.',
    },
    dueToday: {
      title: 'Nothing due today',
      subtitle: 'Your deadlines for today land here as the shift runs.',
    },
    toVerify: {
      title: 'Nothing to check',
      subtitle: 'Cleaning somebody else has finished waits here for a second pair of eyes.',
    },
    reported: {
      title: 'You have reported nothing',
      subtitle: 'Anything you report stays here so you can see what came of it.',
    },
    corrective: {
      title: 'No fixes assigned to you',
      subtitle: 'A failed hygiene check raises a corrective action with an owner.',
    },
  };

  const taskList = (rows: CleaningTaskDto[]): React.JSX.Element => (
    <FlatList
      data={rows}
      keyExtractor={(task) => task.id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.primary}
        />
      }
      renderItem={({ item }) => (
        <CleaningTaskRow task={item} onPress={() => openTask(item.id)} />
      )}
      ListEmptyComponent={
        loading ? null : (
          <EmptyState {...emptyCopy[tab]} />
        )
      }
    />
  );

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="Cleaning"
        onBack={() => router.back()}
        actions={[
          // Everything, not just mine — where an unowned task gets picked up and handed out.
          // Behind `cleaning.assign` rather than `cleaning.view`, because there is nothing an
          // employee can do to a task that is not theirs: the server withholds `canStart` on
          // anything unassigned, so for them the pool would be a list of dead ends.
          ...(canAssign
            ? ([
                {
                  icon: 'format-list-bulleted' as const,
                  onPress: () => router.push('/cleaning/tasks'),
                  accessibilityLabel: 'All cleaning tasks',
                },
              ] as const)
            : []),
          {
            icon: 'qr-code-scanner',
            onPress: () => router.push('/cleaning/scan'),
            accessibilityLabel: 'Find something by its label',
          },
        ]}
      />

      {data.counts.overdue > 0 ? (
        <View style={styles.overdueBar}>
          <MaterialIcons name="schedule" size={18} color={colors.onErrorContainer} />
          <Text style={styles.overdueText}>
            {data.counts.overdue} of your cleaning task
            {data.counts.overdue === 1 ? ' is' : 's are'} overdue
          </Text>
        </View>
      ) : null}

      <View style={styles.tabWrap}>
        <ChoiceChips choices={tabs} selected={tab} onSelect={setTab} scroll />
      </View>

      {error !== null ? (
        <View style={styles.errorBar}>
          <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      ) : tab === 'reported' ? (
        <FlatList
          data={data.reported}
          keyExtractor={(event) => event.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => <ReportRow event={item} colors={colors} />}
          ListEmptyComponent={
            <EmptyState {...emptyCopy.reported} />
          }
        />
      ) : tab === 'corrective' ? (
        <FlatList
          data={data.correctiveActions}
          keyExtractor={(action) => action.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <CorrectiveRow
              action={item}
              colors={colors}
              onPress={() =>
                router.push({
                  pathname: '/cleaning/corrective/[actionId]',
                  params: { actionId: item.id },
                })
              }
            />
          )}
          ListEmptyComponent={
            <EmptyState {...emptyCopy.corrective} />
          }
        />
      ) : tab === 'toVerify' ? (
        taskList(data.toVerify)
      ) : tab === 'dueToday' ? (
        taskList(data.dueToday)
      ) : (
        taskList(data.assigned)
      )}

      {canReport ? (
        <View style={styles.footer}>
          <PrimaryButton
            label="Report something to clean"
            onPress={() => router.push('/cleaning/report')}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A report the reader filed, and what it produced. The second line is the whole point. */
function ReportRow({
  event,
  colors,
}: {
  event: CleaningEventDto;
  colors: ColorPalette;
}): React.JSX.Element {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.plainCard}>
      <Text style={styles.plainTitle} numberOfLines={2}>
        {event.note ?? CLEANING_TRIGGER_EVENT_LABELS[event.eventType]}
      </Text>
      <Text style={styles.plainMeta} numberOfLines={1}>
        {event.cleanableAssetName ?? event.areaName ?? ''} ·{' '}
        {new Date(event.occurredAt).toLocaleString(undefined, {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
      <Text
        style={[
          styles.plainMeta,
          { color: event.tasksCreated === 0 ? colors.error : colors.onSecondaryContainer },
        ]}
      >
        {event.tasksCreated === 0
          ? 'No cleaning task was raised — a supervisor will decide'
          : `${event.tasksCreated} cleaning task${event.tasksCreated === 1 ? '' : 's'} raised`}
      </Text>
    </View>
  );
}

function CorrectiveRow({
  action,
  colors,
  onPress,
}: {
  action: CleaningCorrectiveActionDto;
  colors: ColorPalette;
  onPress: () => void;
}): React.JSX.Element {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.plainCard}>
      <Text style={styles.plainTitle} numberOfLines={2} onPress={onPress}>
        {action.failureSummary}
      </Text>
      <Text style={styles.plainMeta} numberOfLines={1}>
        {action.cleanableAssetName ?? ''} · {action.areaName ?? ''}
      </Text>
      <Text style={[styles.plainMeta, action.isOverdue ? { color: colors.error } : null]}>
        {action.status}
        {action.isOverdue ? ' · overdue' : ''}
      </Text>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    tabWrap: { paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    list: { padding: spacing[3], paddingBottom: spacing[16] },
    loader: { marginTop: spacing[8] },
    footer: {
      padding: spacing[3],
      borderTopWidth: 1,
      borderTopColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    overdueBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginHorizontal: spacing[3],
      marginTop: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    overdueText: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onErrorContainer,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginHorizontal: spacing[3],
      marginBottom: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onErrorContainer,
    },
    plainCard: {
      padding: spacing[3],
      marginBottom: spacing[3],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
      gap: spacing[0.5],
    },
    plainTitle: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    plainMeta: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
    },
  });
}
