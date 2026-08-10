import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';
import { wa } from '../../theme/whatsapp';

/**
 * Small shared pieces of the board feed.
 *
 * Kept together because they are meaningless apart — each exists only to express one rule
 * from the design system (label-caps for keys, data-mono for values, hairlines for
 * separation) in one place rather than restating it on every card.
 */

/** An uppercase key in a structured data block. */
export function LabelCaps({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}): React.JSX.Element {
  return <Text style={[styles.labelCaps, style]}>{children}</Text>;
}

/** A monospaced value. Quantities and times align into columns so discrepancies show. */
export function DataMono({
  children,
  strong = false,
  muted = false,
}: {
  children: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}): React.JSX.Element {
  return (
    <Text style={[styles.dataMono, strong && styles.dataMonoStrong, muted && styles.dataMonoMuted]}>
      {children}
    </Text>
  );
}

/** One key/value line inside an order card's header block. */
export function DataRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.dataRow}>
      <View style={styles.dataRowLabel}>
        <LabelCaps>{label}</LabelCaps>
      </View>
      <View style={styles.dataRowValue}>
        <DataMono strong={emphasis}>{value}</DataMono>
      </View>
    </View>
  );
}

/** The floating "TODAY" / date chip between groups of feed entries, as WhatsApp draws it. */
export function DateSeparator({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={styles.separator}>
      <View style={styles.datePill}>
        <Text style={styles.datePillLabel}>{label.toUpperCase()}</Text>
      </View>
    </View>
  );
}

export interface AuthorTint {
  bg: string;
  border: string;
  fg: string;
}

const AUTHOR_TINTS: readonly AuthorTint[] = [
  { bg: '#eef2ff', border: '#c7d2fe', fg: '#3730a3' },
  { bg: '#ecfeff', border: '#a5f3fc', fg: '#155e75' },
  { bg: '#fdf2f8', border: '#fbcfe8', fg: '#9d174d' },
  { bg: '#f0fdf4', border: '#bbf7d0', fg: '#166534' },
  { bg: '#fff7ed', border: '#fed7aa', fg: '#9a3412' },
  { bg: '#f5f3ff', border: '#ddd6fe', fg: '#5b21b6' },
  { bg: '#fefce8', border: '#fef08a', fg: '#854d0e' },
  { bg: '#f0f9ff', border: '#bae6fd', fg: '#075985' },
];

/** A stable light tint per person, so each name keeps the same colour across the feed. */
export function authorTint(key: string | null | undefined): AuthorTint {
  const text = key ?? '?';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return AUTHOR_TINTS[hash % AUTHOR_TINTS.length] as AuthorTint;
}

/** A circular initials avatar. Used wherever a real photo is unavailable. */
export function Avatar({
  name,
  size = 24,
}: {
  name: string | null | undefined;
  size?: number;
}): React.JSX.Element {
  const initials = (name ?? '?')
    .split(' ')
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  const tint = authorTint(name);

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.4, color: tint.fg }]}>
        {initials || '?'}
      </Text>
    </View>
  );
}

/** Author + timestamp line above a feed entry. */
export function AuthorLine({
  name,
  time,
  system = false,
  align = 'left',
  avatarName,
}: {
  name: string;
  time: string;
  system?: boolean;
  align?: 'left' | 'right';
  avatarName?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.authorLine, align === 'right' && styles.authorLineRight]}>
      <Avatar name={system ? 'S' : avatarName ?? name} size={22} />
      <Text style={styles.authorName}>{name}</Text>
      <Text style={styles.authorTime}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  labelCaps: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    lineHeight: typography.labelCaps.lineHeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.outline,
    textTransform: 'uppercase',
  },
  dataMono: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: typography.dataMono.weight,
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  dataMonoStrong: { fontWeight: '700', color: colors.primary },
  dataMonoMuted: { color: colors.outline },
  dataRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[0.5] },
  // Fixed key column so values line up down the card, per the design system's data blocks.
  dataRowLabel: { width: 64 },
  dataRowValue: { flex: 1, marginLeft: spacing[2] },

  separator: { alignItems: 'center', marginVertical: spacing[2] },
  datePill: {
    backgroundColor: wa.datePillBg,
    borderRadius: 7.5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    elevation: 1,
    shadowColor: '#0B141A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.13,
    shadowRadius: 0.5,
  },
  datePillLabel: {
    fontSize: 12.2,
    fontWeight: '500',
    letterSpacing: 0.2,
    color: wa.datePillText,
  },

  avatar: {
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.onPrimaryFixedVariant, fontWeight: '700' },

  authorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingLeft: spacing[1],
    marginBottom: spacing[1],
  },
  authorLineRight: { alignSelf: 'flex-end', paddingLeft: 0, paddingRight: spacing[1] },
  authorName: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.onSurface,
  },
  authorTime: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    letterSpacing: 0,
    fontWeight: '400',
    color: colors.outline,
  },
});

export const feedStyles = StyleSheet.create({
  /** Level 1: pure white card on the tinted page, with a hairline outline. */
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii['2xl'],
    padding: spacing.gutter,
    overflow: 'hidden',
  },
});
