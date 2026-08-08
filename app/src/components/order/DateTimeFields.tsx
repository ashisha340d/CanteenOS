import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '../PressableScale';
import { PickerSheet } from '../PickerSheet';
import { toIsoDate, todayIsoDate } from '../../utils/date';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

function roundUpToStep(date: Date, stepMinutes: number): Date {
  const ms = stepMinutes * 60000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

export function defaultRequiredDate(): string {
  return todayIsoDate();
}

export function defaultRequiredTime(): string {
  const rounded = roundUpToStep(new Date(Date.now() + 30 * 60000), 15);
  return `${String(rounded.getHours()).padStart(2, '0')}:${String(rounded.getMinutes()).padStart(2, '0')}`;
}

function formatClockLabel(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function formatClockLabelFromValue(clock: string): string {
  const parts = clock.split(':').map(Number);
  const hour = parts[0];
  const minute = parts[1];
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    return clock;
  }
  return formatClockLabel(hour, minute);
}

function dateOptions(days = 30): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const today = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const iso = toIsoDate(d);
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
    out.push({ id: iso, label });
  }
  return out;
}

export function timeOptions(isoDate: string, stepMinutes = 15): { id: string; label: string }[] {
  const isToday = isoDate === todayIsoDate();
  const min = isToday ? roundUpToStep(new Date(), stepMinutes) : null;
  const out: { id: string; label: string }[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) {
    const hour = Math.floor(m / 60);
    const minute = m % 60;
    if (min !== null && (hour < min.getHours() || (hour === min.getHours() && minute < min.getMinutes()))) {
      continue;
    }
    out.push({ id: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, label: formatClockLabel(hour, minute) });
  }
  return out;
}

export function DateTimeFields({
  date,
  time,
  onChangeDate,
  onChangeTime,
}: {
  date: string;
  time: string;
  onChangeDate: (value: string) => void;
  onChangeTime: (value: string) => void;
}): React.JSX.Element {
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const dates = useMemo(() => dateOptions(), []);
  const times = useMemo(() => timeOptions(date), [date]);

  return (
    <View style={styles.row2}>
      <View style={styles.flex1}>
        <Text style={styles.fieldLabel}>Date</Text>
        <PressableScale onPress={() => setShowDate(true)}>
          <View style={styles.field}>
            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
            <Text style={styles.fieldValue} numberOfLines={1}>
              {dates.find((d) => d.id === date)?.label ?? date}
            </Text>
          </View>
        </PressableScale>
      </View>
      <View style={styles.flex1}>
        <Text style={styles.fieldLabel}>Time</Text>
        <PressableScale onPress={() => setShowTime(true)}>
          <View style={styles.field}>
            <Ionicons name="time-outline" size={16} color={colors.primary} />
            <Text style={styles.fieldValue} numberOfLines={1}>
              {formatClockLabelFromValue(time)}
            </Text>
          </View>
        </PressableScale>
      </View>

      <PickerSheet
        isOpen={showDate}
        onClose={() => setShowDate(false)}
        title="Date"
        options={dates}
        selectedId={date}
        onSelect={(option) => {
          onChangeDate(option.id);
          const validTimes = timeOptions(option.id);
          if (!validTimes.some((t) => t.id === time) && validTimes[0]) onChangeTime(validTimes[0].id);
        }}
      />
      <PickerSheet
        isOpen={showTime}
        onClose={() => setShowTime(false)}
        title="Time"
        options={times}
        selectedId={time}
        onSelect={(option) => onChangeTime(option.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row2: { flexDirection: 'row', gap: spacing[3] },
  flex1: { flex: 1 },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: typography.callout.size,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing[1.5],
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    backgroundColor: colors.white,
  },
  fieldValue: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.body.size,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
});
