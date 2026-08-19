import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { MaintenanceActivityDto, MaintenanceActivityType } from '@menuboard/shared';
import { radii, spacing, typography } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';

/**
 * The asset's user-facing history: one line per thing that happened, newest first.
 *
 * `summary` arrives already written for display — the clients never compose activity prose (see
 * `MaintenanceActivityDto`), so this renders it verbatim and adds only the glyph, the actor and
 * the time.
 */

const ICONS: Record<MaintenanceActivityType, keyof typeof MaterialIcons.glyphMap> = {
  EQUIPMENT_REGISTERED: 'add-circle-outline',
  EQUIPMENT_UPDATED: 'edit',
  STATUS_CHANGED: 'swap-horiz',
  LOCATION_CHANGED: 'place',
  DOCUMENT_UPLOADED: 'description',
  WARRANTY_RECORDED: 'verified-user',
  SCHEDULE_CREATED: 'event',
  SCHEDULE_UPDATED: 'event',
  PROBLEM_REPORTED: 'report-problem',
  TICKET_STATUS_CHANGED: 'autorenew',
  ATTACHMENT_ADDED: 'attach-file',
  NOTE_ADDED: 'note-add',
  SUPPLIER_CONTACTED: 'local-shipping',
  CALL_MADE: 'call',
  WHATSAPP_SENT: 'chat',
  TECHNICIAN_ASSIGNED: 'how-to-reg',
  TECHNICIAN_VISIT: 'engineering',
  PARTS_REQUIRED: 'build',
  PARTS_REPLACED: 'build',
  MAINTENANCE_COMPLETED: 'task-alt',
  PROBLEM_RESOLVED: 'check-circle',
  TICKET_VERIFIED: 'verified-user',
  TICKET_CLOSED: 'done',
};

function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ActivityTimeline({
  activities,
}: {
  activities: readonly MaintenanceActivityDto[];
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View>
      {activities.map((activity, index) => (
        <View key={activity.id} style={styles.row}>
          <View style={styles.rail}>
            <View style={styles.dot}>
              <MaterialIcons
                name={ICONS[activity.type] ?? 'radio-button-unchecked'}
                size={14}
                color={colors.taskBar}
              />
            </View>
            {index < activities.length - 1 ? <View style={styles.line} /> : null}
          </View>

          <View style={styles.body}>
            <Text style={styles.summary}>{activity.summary}</Text>
            {activity.detail !== null && activity.detail !== '' ? (
              <Text style={styles.detail}>{activity.detail}</Text>
            ) : null}
            <Text style={styles.meta}>
              {[activity.actorName ?? 'System', stamp(activity.createdAt)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing[3] },
    rail: { alignItems: 'center', width: 28 },
    dot: {
      width: 28,
      height: 28,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    line: {
      flex: 1,
      width: 2,
      minHeight: spacing[3],
      backgroundColor: colors.outlineVariant,
      marginVertical: spacing[1],
    },
    body: { flex: 1, paddingBottom: spacing[4], gap: spacing[0.5] },
    summary: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurface,
    },
    detail: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
    },
    meta: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.outline,
    },
  });
}
