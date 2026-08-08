import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { BoardStatus } from '@menuboard/shared';
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
