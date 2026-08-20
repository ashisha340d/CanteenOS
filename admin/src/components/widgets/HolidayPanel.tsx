import { useMemo } from 'react';
import { WifiOffIcon } from 'lucide-react';
import { usePublicHolidays } from '@/hooks/useEnvironment';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkstationLocation } from '@/services/workstationLocation';
import { localIsoDate } from './widgetUi';

/**
 * The public holidays a roster has to work around, as a short forward list.
 *
 * Deliberately not a month grid. A grid answers "what is the date of the 3rd Tuesday", which
 * nobody standing at a canteen desk asks; the question is always "what is the next day we are
 * closed, and how long have I got". So this shows the next few, with the distance to each.
 */

const HOLIDAY_DATE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  weekday: 'short',
});

const AHEAD = 4;
const DAY_MS = 24 * 60 * 60_000;

function daysUntil(iso: string, todayIso: string): number {
  const from = new Date(`${todayIso}T00:00:00`).getTime();
  const to = new Date(`${iso}T00:00:00`).getTime();
  return Math.round((to - from) / DAY_MS);
}

function distanceLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function HolidayPanel({ location }: { location: WorkstationLocation }): JSX.Element {
  const todayIso = localIsoDate(new Date());
  const year = Number(todayIso.slice(0, 4));

  const thisYear = usePublicHolidays(location, year);
  // December has to be able to see January, or the panel goes blank for the last weeks of
  // every year — exactly when the roster matters most.
  const nextYear = usePublicHolidays(location, year + 1);

  const upcoming = useMemo(
    () =>
      [...(thisYear.data ?? []), ...(nextYear.data ?? [])]
        .filter((holiday) => holiday.date >= todayIso)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, AHEAD),
    [thisYear.data, nextYear.data, todayIso],
  );

  if (thisYear.isPending) {
    return (
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    );
  }

  if (thisYear.isError) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-[0.6875rem]">
        <WifiOffIcon className="size-3.5 shrink-0" aria-hidden />
        Holiday calendar unreachable
      </p>
    );
  }

  if (upcoming.length === 0) {
    return (
      <p className="text-muted-foreground text-[0.6875rem]">
        No published holidays ahead for {location.country}.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {upcoming.map((holiday) => {
        const away = daysUntil(holiday.date, todayIso);
        return (
          <li key={`${holiday.date}-${holiday.name}`} className="flex items-baseline gap-2">
            <span
              className={`w-[4.5rem] shrink-0 text-[0.625rem] tabular-nums ${
                away === 0 ? 'text-tone-danger font-semibold' : 'text-muted-foreground'
              }`}
            >
              {HOLIDAY_DATE.format(new Date(`${holiday.date}T00:00:00`))}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.6875rem]" title={holiday.name}>
              {holiday.name}
            </span>
            <span className="text-muted-foreground shrink-0 text-[0.625rem]">
              {distanceLabel(away)}
              {/* A state holiday is not a national one; a roster planner has to know which. */}
              {!holiday.nationwide && ' · regional'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
