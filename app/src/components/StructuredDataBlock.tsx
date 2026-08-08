import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LabelCaps } from './feed/FeedPrimitives';
import { colors, fonts, radii, spacing, typography } from '../theme/tokens';

/**
 * The logistics data block from DESIGN.md — "keys in `label-caps` (Gray-500), values in
 * `data-mono` (Neutral-900)".
 *
 * Two columns on a phone, matching `employee_view`'s `grid-cols-2`. The monospaced values are
 * the point: date, time and pax stack into columns a dispatcher can scan for a discrepancy
 * without reading each label.
 */

export interface DataField {
  label: string;
  value: string;
}

export function StructuredDataBlock({
  fields,
  style,
}: {
  fields: DataField[];
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <View style={[styles.block, style]}>
      {fields.map((field) => (
        <View key={field.label} style={styles.cell}>
          <LabelCaps>{field.label}</LabelCaps>
          <Text style={styles.value} numberOfLines={2}>
            {field.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export interface QuantityLine {
  id: string;
  name: string;
  /** Pre-formatted so the caller owns unit and localisation, e.g. "x45" or "50 प्लेट्स". */
  quantity: string;
  /** Struck through, for a cancelled line. */
  cancelled?: boolean;
}

/**
 * The menu-requirements list: dish on the left, monospaced quantity hard right.
 *
 * Rendered on the tinted `dataPanel` so it reads as system data rather than someone's message
 * — DESIGN.md calls for exactly that separation inside message cards.
 */
export function ItemQuantityList({
  title,
  items,
  style,
}: {
  title?: string;
  items: QuantityLine[];
  style?: ViewStyle;
}): React.JSX.Element {
  return (
    <View style={[styles.panel, style]}>
      {title !== undefined ? (
        <View style={styles.panelHeader}>
          <MaterialIcons name="restaurant-menu" size={14} color={colors.primary} />
          <Text style={styles.panelTitle}>{title}</Text>
        </View>
      ) : null}
      {items.map((item, index) => (
        <View
          key={item.id}
          style={[styles.line, index === items.length - 1 && styles.lineLast]}
        >
          <Text
            style={[styles.lineName, item.cancelled === true && styles.lineCancelled]}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          <Text
            style={[styles.lineQty, item.cancelled === true && styles.lineCancelled]}
            numberOfLines={1}
          >
            {item.quantity}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    padding: spacing.stackSm,
  },
  // Half-width minus the gutter, so two cells sit per row exactly as `grid-cols-2` does.
  cell: { width: '50%', paddingVertical: spacing[1], paddingRight: spacing[2] },
  value: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: typography.dataMono.weight,
    letterSpacing: typography.dataMono.letterSpacing,
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.unit,
  },

  panel: {
    backgroundColor: colors.dataPanel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.dataPanelBorder,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingBottom: spacing[2],
    marginBottom: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.dataPanelBorder,
  },
  panelTitle: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    lineHeight: typography.labelCaps.lineHeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[1],
  },
  lineLast: { paddingBottom: 0 },
  lineName: {
    flex: 1,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    fontWeight: typography.bodyMd.weight,
    color: colors.onSurface,
  },
  lineQty: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: typography.dataMono.weight,
    letterSpacing: typography.dataMono.letterSpacing,
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  lineCancelled: { textDecorationLine: 'line-through', color: colors.outline },
});
