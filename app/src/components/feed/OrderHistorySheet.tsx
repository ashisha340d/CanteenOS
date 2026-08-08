import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ThreadMessageDto } from '@menuboard/shared';
import { ThemedBottomSheet } from '../BottomSheet';
import { EmptyState } from '../EmptyState';
import { describeSystemEvent } from './systemEventText';
import { type Language } from '../../i18n';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * The order's story, from the moment it was raised.
 *
 * Every system event about an order used to be its own pill in the feed — "New order …",
 * "Menu changed", "Order updated", one after another — which pushed the actual conversation
 * off screen and made a busy board unreadable. They are still the edit history the
 * specification requires, so nothing is discarded; they are simply collected here, behind one
 * button on the order, and read as a dated timeline instead of as interruptions.
 *
 * Rendered oldest-first: this is a story, and a story starts at the beginning.
 */
export function OrderHistorySheet({
  isOpen,
  onClose,
  orderNumber,
  events,
  language = 'en',
}: {
  isOpen: boolean;
  onClose: () => void;
  orderNumber: string | null;
  events: readonly ThreadMessageDto[];
  language?: Language;
}): React.JSX.Element {
  let lastDay = '';

  return (
    <ThemedBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={orderNumber ?? 'History'}
      scrollable
      maxHeightRatio={0.75}
    >
      {events.length === 0 ? (
        <EmptyState title="Nothing has happened yet" subtitle="Changes to this order appear here." />
      ) : (
        <View style={styles.timeline}>
          {events.map((event) => {
            const day = dayLabel(event.createdAt, language);
            const showDay = day !== lastDay;
            lastDay = day;

            return (
              <View key={event.id}>
                {showDay ? <Text style={styles.day}>{day}</Text> : null}
                <View style={styles.row}>
                  <View style={styles.rail}>
                    <View style={styles.dot} />
                    <View style={styles.line} />
                  </View>
                  <View style={styles.body}>
                    <Text style={styles.time}>{formatTime(event.createdAt)}</Text>
                    <Text style={styles.text}>{describeSystemEvent(event, language)}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ThemedBottomSheet>
  );
}

function dayLabel(iso: string, language: Language): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(language === 'hi' ? 'hi-IN' : undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  timeline: { paddingBottom: spacing[2] },
  day: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    color: colors.outline,
    textTransform: 'uppercase',
    marginTop: spacing[3],
    marginBottom: spacing[2],
  },
  row: { flexDirection: 'row', gap: spacing[3] },
  rail: { alignItems: 'center', width: 12 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  line: { flex: 1, width: 2, backgroundColor: colors.outlineVariant, marginTop: 2 },
  body: { flex: 1, paddingBottom: spacing[3] },
  time: {
    fontFamily: fonts.mono,
    fontSize: typography.bodySm.size,
    color: colors.outline,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurface,
    marginTop: spacing[0.5],
  },
});
