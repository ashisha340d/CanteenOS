import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { MaintenanceScheduleDto, MaintenanceTicketDto } from '@menuboard/shared';
import { PROBLEM_CATEGORY_LABELS } from '@menuboard/shared';
import { PressableScale } from '../PressableScale';
import { PriorityChip, TicketStatusChip } from '../StatusChip';
import { radii, spacing, typography } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';

/** 14 Mar, 09:30 — short enough for a list row, unambiguous across a month boundary. */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * One maintenance ticket in a list.
 *
 * Leads with the ticket's own title rather than its number: the number is what gets quoted to a
 * supplier, the title is what tells the reader whether this is the one they came looking for.
 */
export function TicketRow({
  ticket,
  onPress,
}: {
  ticket: MaintenanceTicketDto;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${ticket.ticketNumber}, ${ticket.title}`}
    >
      <View style={styles.card}>
        {ticket.equipmentImageUrl !== null && ticket.equipmentImageUrl !== undefined ? (
          <Image source={{ uri: ticket.equipmentImageUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <MaterialIcons name="handyman" size={22} color={colors.onSurfaceVariant} />
          </View>
        )}

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {ticket.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[ticket.assetId, ticket.equipmentName].filter(Boolean).join(' · ')}
          </Text>
          {ticket.problemCategory !== null ? (
            <Text style={styles.meta} numberOfLines={1}>
              {PROBLEM_CATEGORY_LABELS[ticket.problemCategory]}
            </Text>
          ) : null}

          <View style={styles.chipRow}>
            <TicketStatusChip status={ticket.status} />
            <PriorityChip priority={ticket.priority} />
          </View>
        </View>

        <View style={styles.trailing}>
          <Text style={styles.number} numberOfLines={1}>
            {ticket.ticketNumber}
          </Text>
          <Text style={styles.stamp} numberOfLines={1}>
            {stamp(ticket.reportedAt)}
          </Text>
          {ticket.attachmentCount !== undefined && ticket.attachmentCount > 0 ? (
            <View style={styles.attachRow}>
              <MaterialIcons name="attach-file" size={13} color={colors.outline} />
              <Text style={styles.stamp}>{ticket.attachmentCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

/**
 * A preventive service that has fallen due. Not a ticket — no number, no status, and the only
 * thing worth showing is what it is, on what, and how late it is.
 */
export function ScheduleRow({
  schedule,
  onPress,
}: {
  schedule: MaintenanceScheduleDto;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const days = schedule.daysUntilDue;
  const overdue = days !== undefined && days < 0;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${schedule.title}, ${schedule.equipmentName ?? ''}`}
    >
      <View style={styles.card}>
        <View style={[styles.photo, styles.photoFallback]}>
          <MaterialIcons
            name="event"
            size={22}
            color={overdue ? colors.error : colors.onSurfaceVariant}
          />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {schedule.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[schedule.assetId, schedule.equipmentName].filter(Boolean).join(' · ')}
          </Text>
          <Text style={[styles.meta, overdue && styles.metaOverdue]} numberOfLines={1}>
            {days === undefined
              ? `Due ${schedule.nextDueAt}`
              : overdue
                ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
                : days === 0
                  ? 'Due today'
                  : `Due in ${days} day${days === 1 ? '' : 's'}`}
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
      </View>
    </PressableScale>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[3],
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      padding: spacing[3],
      marginBottom: spacing[3],
    },
    photo: {
      width: 48,
      height: 48,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerLow,
    },
    photoFallback: { alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, gap: spacing[0.5] },
    title: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.headlineMd.lineHeight,
      color: colors.onSurface,
    },
    meta: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
    },
    metaOverdue: { fontFamily: typography.headlineMd.fontFamily, color: colors.error },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing[1.5],
      marginTop: spacing[1],
    },
    trailing: { alignItems: 'flex-end', gap: spacing[0.5] },
    number: {
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.bodySm.size,
      letterSpacing: typography.dataMono.letterSpacing,
      color: colors.onSurfaceVariant,
    },
    stamp: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.outline,
    },
    attachRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[0.5] },
  });
}
