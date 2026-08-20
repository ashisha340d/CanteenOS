import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  CLEANING_TASK_PRIORITY_LABELS,
  CLEANING_TASK_STATUS_LABELS,
  CleaningTaskPriority,
  CleaningTaskStatus,
  type CleaningTaskDto,
} from '@menuboard/shared';
import { PressableScale } from '../PressableScale';
import { radii, spacing, typography } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import type { ColorPalette } from '../../theme/tokens';

/**
 * "Due in 2 h" / "40 min overdue" — the form a person reads a cleaning deadline in.
 *
 * Minutes below an hour, hours below a day, days after that: a job due in ninety minutes and
 * one due next week are different kinds of urgent and must not share a unit.
 */
export function dueLabel(dueAt: string | null, isOverdue: boolean): string {
  if (dueAt === null) return 'No deadline';
  const target = new Date(dueAt).getTime();
  if (Number.isNaN(target)) return '';
  const deltaMinutes = Math.round((target - Date.now()) / 60_000);
  const magnitude = Math.abs(deltaMinutes);
  const amount =
    magnitude < 60
      ? `${magnitude} min`
      : magnitude < 1440
        ? `${Math.round(magnitude / 60)} h`
        : `${Math.round(magnitude / 1440)} d`;
  if (deltaMinutes < 0 || isOverdue) return `${amount} overdue`;
  if (deltaMinutes === 0) return 'Due now';
  return `Due in ${amount}`;
}

/** Priority → the palette's own semantic pair. Never a colour invented here. */
function priorityColours(
  priority: CleaningTaskPriority,
  colors: ColorPalette,
): { bg: string; fg: string } {
  switch (priority) {
    case CleaningTaskPriority.CRITICAL:
      return { bg: colors.errorContainer, fg: colors.onErrorContainer };
    case CleaningTaskPriority.HIGH:
      return { bg: colors.tertiaryFixed, fg: colors.onTertiaryFixedVariant };
    case CleaningTaskPriority.NORMAL:
      return { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant };
    default:
      return { bg: colors.surfaceContainer, fg: colors.onSurfaceVariant };
  }
}

/** Status → the same three meanings the rest of the app uses: waiting, moving, done. */
function statusColours(
  status: CleaningTaskStatus,
  colors: ColorPalette,
): { bg: string; fg: string } {
  switch (status) {
    case CleaningTaskStatus.FAILED:
    case CleaningTaskStatus.RECLEAN_REQUIRED:
      return { bg: colors.errorContainer, fg: colors.onErrorContainer };
    case CleaningTaskStatus.VERIFIED:
    case CleaningTaskStatus.COMPLETED:
    case CleaningTaskStatus.RECLEANED:
    case CleaningTaskStatus.CLOSED:
      return { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer };
    case CleaningTaskStatus.STARTED:
    case CleaningTaskStatus.UNASSIGNED:
    case CleaningTaskStatus.VERIFICATION_REQUIRED:
    case CleaningTaskStatus.REVERIFICATION_REQUIRED:
      return { bg: colors.tertiaryFixed, fg: colors.onTertiaryFixedVariant };
    default:
      return { bg: colors.surfaceContainerHigh, fg: colors.onSurfaceVariant };
  }
}

/**
 * One cleaning task in a list.
 *
 * Leads with what and where, because a cleaner scanning their list is looking for the place,
 * not the rule that raised it. The deadline sits on the right in the one place the eye returns
 * to, and turns red the moment it lapses.
 */
export function CleaningTaskRow({
  task,
  onPress,
  showOwner = false,
}: {
  task: CleaningTaskDto;
  onPress: () => void;
  /**
   * Whose job it is. Off by default: on "My cleaning" every row is the reader's, so saying so
   * is noise. On a list of everybody's work it is the first thing worth knowing.
   */
  showOwner?: boolean;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const priority = priorityColours(task.priority, colors);
  const status = statusColours(task.status, colors);
  const progress =
    task.stepCount !== undefined && task.stepCount > 0
      ? `${task.stepsDone ?? 0}/${task.stepCount} steps`
      : null;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${task.taskName}, ${CLEANING_TASK_STATUS_LABELS[task.status]}`}
    >
      <View style={styles.card}>
        <View style={[styles.mark, { backgroundColor: priority.bg }]}>
          <MaterialIcons name="cleaning-services" size={20} color={priority.fg} />
        </View>

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {task.taskName}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {task.locationPath ?? task.areaName ?? ''}
          </Text>

          <View style={styles.chipRow}>
            <View style={[styles.chip, { backgroundColor: status.bg }]}>
              <Text style={[styles.chipText, { color: status.fg }]}>
                {CLEANING_TASK_STATUS_LABELS[task.status]}
              </Text>
            </View>
            {task.priority !== CleaningTaskPriority.NORMAL ? (
              <View style={[styles.chip, { backgroundColor: priority.bg }]}>
                <Text style={[styles.chipText, { color: priority.fg }]}>
                  {CLEANING_TASK_PRIORITY_LABELS[task.priority]}
                </Text>
              </View>
            ) : null}
            {progress !== null ? <Text style={styles.meta}>{progress}</Text> : null}
            {showOwner ? (
              <Text style={styles.meta} numberOfLines={1}>
                {task.assignedToName ?? 'no owner'}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.trailing}>
          <Text
            style={[styles.due, task.isOverdue ? { color: colors.error } : null]}
            numberOfLines={2}
          >
            {dueLabel(task.dueAt, task.isOverdue)}
          </Text>
          <MaterialIcons name="chevron-right" size={20} color={colors.onSurfaceVariant} />
        </View>
      </View>
    </PressableScale>
  );
}

function createStyles(colors: ColorPalette) {
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
    mark: {
      width: 44,
      height: 44,
      borderRadius: radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
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
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing[1.5],
      marginTop: spacing[1],
    },
    chip: {
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[0.5],
      borderRadius: radii.sm,
    },
    chipText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
    },
    trailing: { alignItems: 'flex-end', gap: spacing[0.5], maxWidth: 96 },
    due: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
      textAlign: 'right',
    },
  });
}
