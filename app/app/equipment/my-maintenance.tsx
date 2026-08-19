import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import type { MyMaintenanceDto } from '@menuboard/shared';
import { Capability } from '@menuboard/shared';
import { equipmentErrorMessage, maintenanceApi } from '../../src/api/equipment';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { EmptyState } from '../../src/components/EmptyState';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { ScheduleRow, TicketRow } from '../../src/components/equipment/TicketRow';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';

/**
 * My maintenance — the phone's answer to "what is mine, and what is due".
 *
 * Three lists, one at a time, because they are answers to three different questions and a single
 * merged feed would bury the one the reader came for. Counts sit on the tabs so the shape of the
 * day is visible before anything is tapped.
 */

type Tab = 'assigned' | 'reported' | 'dueToday';

const EMPTY: MyMaintenanceDto = { assigned: [], reported: [], dueToday: [] };

export default function MyMaintenanceScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const canReport = has(Capability.EQUIPMENT_REPORT_PROBLEM);

  const [data, setData] = useState<MyMaintenanceDto>(EMPTY);
  const [tab, setTab] = useState<Tab>('assigned');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setData(await maintenanceApi.mine());
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'Your maintenance list could not be loaded.'));
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
    { value: 'assigned', label: `Assigned to me (${data.assigned.length})` },
    { value: 'reported', label: `I reported (${data.reported.length})` },
    { value: 'dueToday', label: `Due today (${data.dueToday.length})` },
  ];

  const openTicket = (ticketId: string): void => {
    router.push({ pathname: '/equipment/tickets/[ticketId]', params: { ticketId } });
  };

  const emptyCopy: Record<Tab, { title: string; subtitle: string }> = {
    assigned: {
      title: 'Nothing assigned to you',
      subtitle: 'Work handed to you appears here the moment somebody assigns it.',
    },
    reported: {
      title: 'You have reported nothing',
      subtitle: 'Problems you raise stay here until they are closed, so you can follow them up.',
    },
    dueToday: {
      title: 'Nothing due today',
      subtitle: 'Preventive services fall due here on the day the schedule reaches them.',
    },
  };

  return (
    <View style={styles.screen}>
      <TopAppBar
        title="My maintenance"
        onBack={() => router.back()}
        actions={[
          {
            icon: 'inventory-2',
            onPress: () => router.push('/equipment'),
            accessibilityLabel: 'All equipment',
          },
        ]}
      />

      <View style={styles.tabWrap}>
        <ChoiceChips choices={tabs} selected={tab} onSelect={setTab} scroll />
      </View>

      {error !== null ? (
        <View style={styles.errorBar}>
          <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {tab === 'dueToday' ? (
        <FlatList
          data={data.dueToday}
          keyExtractor={(schedule) => schedule.id}
          contentContainerStyle={styles.list}
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
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={styles.loader} color={colors.taskBar} />
            ) : (
              <EmptyState {...emptyCopy.dueToday} />
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInUp.delay(Math.min(index, 8) * 40).duration(280)}>
              <ScheduleRow
                schedule={item}
                onPress={() =>
                  router.push({
                    pathname: '/equipment/[equipmentId]',
                    params: { equipmentId: item.equipmentId },
                  })
                }
              />
            </Animated.View>
          )}
        />
      ) : (
        <FlatList
          data={tab === 'assigned' ? data.assigned : data.reported}
          keyExtractor={(ticket) => ticket.id}
          contentContainerStyle={styles.list}
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
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={styles.loader} color={colors.taskBar} />
            ) : (
              <EmptyState {...emptyCopy[tab]} />
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInUp.delay(Math.min(index, 8) * 40).duration(280)}>
              <TicketRow ticket={item} onPress={() => openTicket(item.id)} />
            </Animated.View>
          )}
        />
      )}

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
    tabWrap: { paddingVertical: spacing[3] },
    list: { paddingHorizontal: spacing.marginMobile, paddingBottom: spacing[12] },
    loader: { marginVertical: spacing[6] },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginHorizontal: spacing.marginMobile,
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
