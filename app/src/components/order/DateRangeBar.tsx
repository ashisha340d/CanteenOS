import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { PressableScale } from '../PressableScale';
import { PickerSheet } from '../PickerSheet';
import { toIsoDate, todayIsoDate } from '../../utils/date';
import { colors, radii, spacing, typography } from '../../theme/tokens';

/**
 * "Date X to X" — the window the archive reports over.
 *
 * Presets cover what people actually ask for (this week, last week, this month); the two
 * endpoints stay tappable underneath for anything else. Both pickers only offer days that have
 * already happened, because there is no such thing as archived future work.
 */

export interface DateRange {
  from: string;
  to: string;
}

type PresetId = 'last7' | 'last30' | 'thisMonth' | 'custom';

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
];

function shiftDays(days: number): string {
  const now = new Date();
  return toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

export function presetRange(id: Exclude<PresetId, 'custom'>): DateRange {
  const today = todayIsoDate();
  if (id === 'last7') return { from: shiftDays(-6), to: today };
  if (id === 'last30') return { from: shiftDays(-29), to: today };
  const now = new Date();
  return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

export function defaultRange(): DateRange {
  return presetRange('last7');
}

function formatShort(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

/** Every day from 90 days back up to today, newest first — the endpoint pickers' options. */
function pastDayOptions(): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 90; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push({
      id: toIsoDate(d),
      label:
        i === 0
          ? 'Today'
          : i === 1
            ? 'Yesterday'
            : d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
    });
  }
  return out;
}

export function DateRangeBar({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<'from' | 'to' | null>(null);
  const days = useMemo(() => pastDayOptions(), []);

  const activePreset = useMemo<PresetId>(() => {
    for (const preset of PRESETS) {
      const candidate = presetRange(preset.id as Exclude<PresetId, 'custom'>);
      if (candidate.from === range.from && candidate.to === range.to) return preset.id;
    }
    return 'custom';
  }, [range]);

  return (
    <View style={styles.wrap}>
      <View style={styles.presetRow}>
        {PRESETS.map((preset) => {
          const active = preset.id === activePreset;
          return (
            <PressableScale
              key={preset.id}
              onPress={() => onChange(presetRange(preset.id as Exclude<PresetId, 'custom'>))}
              style={styles.presetPress}
            >
              <View style={[styles.preset, active && styles.presetActive]}>
                <Text style={[styles.presetText, active && styles.presetTextActive]} numberOfLines={1}>
                  {preset.label}
                </Text>
              </View>
            </PressableScale>
          );
        })}
      </View>

      <View style={styles.endpointRow}>
        <Endpoint label="From" value={formatShort(range.from)} onPress={() => setEditing('from')} />
        <MaterialIcons name="arrow-forward" size={16} color={colors.outline} />
        <Endpoint label="To" value={formatShort(range.to)} onPress={() => setEditing('to')} />
      </View>

      <PickerSheet
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'to' ? 'To date' : 'From date'}
        options={days}
        selectedId={editing === 'to' ? range.to : range.from}
        onSelect={(option) => {
          // Whichever endpoint moved, keep from <= to rather than rejecting the tap: dragging
          // "from" past "to" reads as "I want that day", so the other end follows it.
          if (editing === 'to') {
            onChange({ from: option.id < range.from ? option.id : range.from, to: option.id });
          } else {
            onChange({ from: option.id, to: option.id > range.to ? option.id : range.to });
          }
        }}
      />
    </View>
  );
}

function Endpoint({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <PressableScale onPress={onPress} style={styles.endpointPress}>
      <View style={styles.endpoint}>
        <Text style={styles.endpointLabel}>{label.toUpperCase()}</Text>
        <View style={styles.endpointValueRow}>
          <MaterialIcons name="event" size={14} color={colors.primary} />
          <Text style={styles.endpointValue} numberOfLines={1}>
            {value}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[2] },
  presetRow: { flexDirection: 'row', gap: spacing[2] },
  presetPress: { flex: 1 },
  preset: {
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
  },
  presetActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: {
    fontFamily: typography.bodySm.fontFamily,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  presetTextActive: { color: colors.onPrimary, fontWeight: '700' },

  endpointRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  endpointPress: { flex: 1 },
  endpoint: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  endpointLabel: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.outline,
  },
  endpointValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: spacing[0.5],
  },
  endpointValue: {
    flex: 1,
    fontFamily: typography.bodyMd.fontFamily,
    fontSize: typography.bodyMd.size,
    fontWeight: '600',
    color: colors.onSurface,
  },
});
