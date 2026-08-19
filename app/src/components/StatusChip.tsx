import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type {
  BoardStatus,
  EquipmentStatus,
  MaintenancePriority,
  MaintenanceTicketStatus,
  WarrantyStatus,
} from '@menuboard/shared';
import {
  EQUIPMENT_STATUS_LABELS,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_TICKET_STATUS_LABELS,
} from '@menuboard/shared';
import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * The badge-style chip from DESIGN.md: light background fill, dark text, hairline border.
 *
 * Deliberately lighter than a button — DESIGN.md is explicit that a status must be "visible
 * but not as heavy as a primary button", because a board full of chips that each shout would
 * leave nothing to notice.
 *
 * `StatusBadge` remains the component for *order* status, which derives its colour from the
 * shared state machine. This one is for board status and other plain labels.
 */

export interface ChipTone {
  bg: string;
  fg: string;
  border: string;
}

const BOARD_TONE: Record<BoardStatus, ChipTone> = {
  ACTIVE: colors.boardActive,
  ON_HOLD: colors.boardOnHold,
  ARCHIVED: colors.boardArchived,
};

const BOARD_LABEL: Record<BoardStatus, string> = {
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON HOLD',
  ARCHIVED: 'ARCHIVED',
};

interface StatusChipProps {
  label: string;
  tone: ChipTone;
  icon?: keyof typeof MaterialIcons.glyphMap;
  style?: ViewStyle;
}

export function StatusChip({ label, tone, icon, style }: StatusChipProps): React.JSX.Element {
  return (
    <View
      style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }, style]}
    >
      {icon !== undefined ? (
        <MaterialIcons name={icon} size={12} color={tone.fg} style={styles.icon} />
      ) : null}
      <Text style={[styles.label, { color: tone.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Convenience wrapper for the common case — a board's own status. */
export function BoardStatusChip({
  status,
  style,
}: {
  status: BoardStatus;
  style?: ViewStyle;
}): React.JSX.Element {
  return <StatusChip label={BOARD_LABEL[status]} tone={BOARD_TONE[status]} style={style} />;
}

/**
 * Equipment & maintenance tones.
 *
 * Reuses the order-status palette from `tokens.ts` rather than introducing a parallel one:
 * "working normally" is the emerald that already means delivered, work in progress keeps the
 * amber, and anything that stops service takes the danger red. A cook reading a chip should not
 * have to learn a second colour language for machines.
 */
const EQUIPMENT_TONE: Record<EquipmentStatus, ChipTone> = {
  OPERATIONAL: { ...colors.statusDelivered, border: colors.success100 },
  RUNNING: { ...colors.statusDelivered, border: colors.success100 },
  IDLE: { ...colors.statusPending, border: colors.gray300 },
  NEEDS_ATTENTION: { ...colors.statusWorkInProgress, border: colors.warning100 },
  PROBLEM: { ...colors.statusCancelled, border: colors.danger100 },
  UNDER_MAINTENANCE: { ...colors.statusPreparation, border: colors.warning100 },
  OUT_OF_SERVICE: { ...colors.statusCancelled, border: colors.danger100 },
  RETIRED: { ...colors.statusDone, border: colors.gray300 },
};

const TICKET_TONE: Record<MaintenanceTicketStatus, ChipTone> = {
  REPORTED: { ...colors.statusCancelled, border: colors.danger100 },
  ACKNOWLEDGED: { ...colors.statusAcknowledged, border: colors.primary200 },
  ASSIGNED: { ...colors.statusAcknowledged, border: colors.primary200 },
  SUPPLIER_CONTACTED: { ...colors.statusOnShopping, border: colors.info50 },
  TECHNICIAN_SCHEDULED: { ...colors.statusOnShopping, border: colors.info50 },
  UNDER_MAINTENANCE: { ...colors.statusWorkInProgress, border: colors.warning100 },
  WAITING_FOR_PARTS: { ...colors.statusPreparation, border: colors.warning100 },
  RESOLVED: { ...colors.statusDelivered, border: colors.success100 },
  VERIFIED: { ...colors.statusDelivered, border: colors.success100 },
  CLOSED: { ...colors.statusDone, border: colors.gray300 },
  CANCELLED: { ...colors.statusDone, border: colors.gray300 },
};

const PRIORITY_TONE: Record<MaintenancePriority, ChipTone> = {
  LOW: { ...colors.statusPending, border: colors.gray300 },
  NORMAL: { ...colors.statusAcknowledged, border: colors.primary200 },
  HIGH: { ...colors.statusWorkInProgress, border: colors.warning100 },
  CRITICAL: { ...colors.statusCancelled, border: colors.danger100 },
};

const WARRANTY_TONE: Record<WarrantyStatus, ChipTone> = {
  UNKNOWN: { ...colors.statusPending, border: colors.gray300 },
  ACTIVE: { ...colors.statusDelivered, border: colors.success100 },
  EXPIRING_SOON: { ...colors.statusWorkInProgress, border: colors.warning100 },
  EXPIRED: { ...colors.statusCancelled, border: colors.danger100 },
};

const WARRANTY_LABEL: Record<WarrantyStatus, string> = {
  UNKNOWN: 'No warranty on file',
  ACTIVE: 'In warranty',
  EXPIRING_SOON: 'Warranty expiring',
  EXPIRED: 'Warranty expired',
};

export function EquipmentStatusChip({
  status,
  style,
}: {
  status: EquipmentStatus;
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <StatusChip
      label={EQUIPMENT_STATUS_LABELS[status].toUpperCase()}
      tone={EQUIPMENT_TONE[status]}
      style={style}
    />
  );
}

export function TicketStatusChip({
  status,
  style,
}: {
  status: MaintenanceTicketStatus;
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <StatusChip
      label={MAINTENANCE_TICKET_STATUS_LABELS[status].toUpperCase()}
      tone={TICKET_TONE[status]}
      style={style}
    />
  );
}

export function PriorityChip({
  priority,
  style,
}: {
  priority: MaintenancePriority;
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <StatusChip
      label={MAINTENANCE_PRIORITY_LABELS[priority].toUpperCase()}
      tone={PRIORITY_TONE[priority]}
      icon={priority === 'CRITICAL' || priority === 'HIGH' ? 'priority-high' : undefined}
      style={style}
    />
  );
}

export function WarrantyChip({
  status,
  style,
}: {
  status: WarrantyStatus;
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <StatusChip
      label={WARRANTY_LABEL[status].toUpperCase()}
      tone={WARRANTY_TONE[status]}
      icon="verified-user"
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { marginRight: spacing[1] },
  label: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    lineHeight: typography.labelCaps.lineHeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
  },
});
