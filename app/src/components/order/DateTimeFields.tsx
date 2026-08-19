import React, { useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '../PressableScale';
import { toIsoDate, todayIsoDate } from '../../utils/date';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * Date and time for an order, as two dropdowns.
 *
 * The window is deliberately short: today plus the next six days. Catering is planned inside
 * the week — a date further out is a planning decision that does not belong in the compose
 * flow, and a longer list made the common case ("today" or "tomorrow") harder to hit.
 */

/** How far ahead an order can be scheduled, counting today as day one. */
const DAYS_AHEAD = 7;

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

/** Today through the next six days — the only dates an order may be placed on. */
export function dateOptions(days = DAYS_AHEAD): { id: string; label: string; subtitle: string }[] {
  const out: { id: string; label: string; subtitle: string }[] = [];
  const today = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' });
    out.push({
      id: toIsoDate(d),
      label,
      subtitle: d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }),
    });
  }
  return out;
}

/**
 * Quarter-hour slots for the given day. On today, everything already past is dropped — an
 * order cannot be required before it was raised.
 */
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
    out.push({
      id: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      label: formatClockLabel(hour, minute),
    });
  }
  return out;
}

/**
 * Whether a date/time pair is valid to submit. Callers use this rather than re-deriving the
 * rule, so the composer and the edit screen cannot drift apart on what "in the future" means.
 */
export function isValidRequiredDateTime(isoDate: string, clock: string): boolean {
  return (
    dateOptions().some((option) => option.id === isoDate) &&
    timeOptions(isoDate).some((option) => option.id === clock)
  );
}

/**
 * Date and time as two scrolling chip rows.
 *
 * Both used to open a bottom sheet: two taps and a sheet animation to say "tomorrow at 7pm",
 * which is the single most common thing anyone does on this screen. The options are few enough
 * to sit on the page, so picking is now one tap with the choices already visible.
 */
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
  const dates = useMemo(() => dateOptions(), []);
  const times = useMemo(() => timeOptions(date), [date]);
  const timeRef = useRef<ScrollView>(null);

  const selectDate = (iso: string): void => {
    onChangeDate(iso);
    // Moving onto today can invalidate the chosen time — snap it to the first slot that is
    // still ahead rather than leaving a time that has already passed.
    const validTimes = timeOptions(iso);
    if (!validTimes.some((t) => t.id === time) && validTimes[0]) {
      onChangeTime(validTimes[0].id);
      timeRef.current?.scrollTo({ x: 0, animated: true });
    }
  };

  return (
    <View style={styles.wrap}>
      <View>
        <Text style={styles.fieldLabel}>Date</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          {dates.map((option) => {
            const active = option.id === date;
            return (
              <PressableScale key={option.id} onPress={() => selectDate(option.id)}>
                <View style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {option.label}
                  </Text>
                  <Text style={[styles.chipSub, active && styles.chipSubActive]}>
                    {option.subtitle}
                  </Text>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      <View>
        <Text style={styles.fieldLabel}>Time</Text>
        {times.length === 0 ? (
          <Text style={styles.noTimes}>No slots left today — pick another day.</Text>
        ) : (
          <ScrollView
            ref={timeRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            keyboardShouldPersistTaps="handled"
          >
            {times.map((option) => {
              const active = option.id === time;
              return (
                <PressableScale key={option.id} onPress={() => onChangeTime(option.id)}>
                  <View style={[styles.timeChip, active && styles.chipActive]}>
                    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                      {option.label}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[3] },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: typography.callout.size,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing[1.5],
  },
  chipRow: { gap: spacing[2], paddingRight: spacing[2] },
  chip: {
    alignItems: 'center',
    minWidth: 84,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.white,
  },
  timeChip: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.body.size,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chipLabelActive: { color: colors.white, fontWeight: '700' },
  chipSub: {
    fontFamily: fonts.sans,
    fontSize: typography.caption.size,
    color: colors.textMuted,
    marginTop: spacing[0.5],
  },
  chipSubActive: { color: colors.white },
  noTimes: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.callout.size,
    color: colors.textMuted,
    paddingVertical: spacing[2],
  },
});
