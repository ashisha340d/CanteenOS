import { useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MapPinOffIcon, WifiOffIcon } from 'lucide-react';
import { usePublicHolidays } from '@/hooks/useEnvironment';
import { useLaunchApp } from '@/services/useLaunchApp';
import { SETTINGS_APP_ID } from '@/services/appRegistry';
import { useWorkstationLocation } from '@/services/workstationLocation';
import type { PublicHoliday } from '@/api/environment';
import { localIsoDate, WidgetMessage, WidgetSkeleton } from './widgetUi';

/**
 * The month, with the days the country does not work on marked on it.
 *
 * A canteen roster is planned around public holidays more than around anything else, so the
 * holidays are not a separate list bolted under a calendar — they are drawn on the grid, and
 * the list underneath exists to name the ones the reader can already see.
 */

const MONTH_TITLE = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
const HOLIDAY_DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

/** India's week starts on Sunday, which is what `Intl` reports for the `IN` region. */
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Cell {
  day: number;
  iso: string;
}

function monthCells(year: number, month: number): (Cell | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const blanks: null[] = Array.from({ length: first.getDay() }, () => null);
  const cells: Cell[] = Array.from({ length: days }, (_, index) => {
    const date = new Date(year, month, index + 1);
    return { day: index + 1, iso: localIsoDate(date) };
  });
  return [...blanks, ...cells];
}

export function CalendarWidget(): JSX.Element {
  const location = useWorkstationLocation();
  const launch = useLaunchApp();
  const [offset, setOffset] = useState(0);

  const todayIso = localIsoDate(new Date());

  // Derived from the offset alone, and as plain numbers: a `Date` rebuilt on every render is
  // a new object every render, which would make every memo below it useless.
  const { year, month } = useMemo(() => {
    const base = new Date();
    const viewed = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    return { year: viewed.getFullYear(), month: viewed.getMonth() };
  }, [offset]);

  const holidays = usePublicHolidays(location, year);

  const byDate = useMemo(() => {
    const map = new Map<string, PublicHoliday>();
    for (const holiday of holidays.data ?? []) map.set(holiday.date, holiday);
    return map;
  }, [holidays.data]);

  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const title = MONTH_TITLE.format(new Date(year, month, 1));
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  const inMonth = (holidays.data ?? [])
    .filter((holiday) => holiday.date.startsWith(monthPrefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (location === null) {
    return (
      <WidgetMessage
        Icon={MapPinOffIcon}
        title="No location set"
        detail="Holidays depend on which country this canteen is in."
        action={{ label: 'Open Settings', onClick: () => launch(SETTINGS_APP_ID) }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="widget-nav"
          onClick={() => setOffset((prev) => prev - 1)}
          aria-label="Previous month"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className="text-xs font-semibold"
          onClick={() => setOffset(0)}
          title="Back to this month"
        >
          {title}
        </button>
        <button
          type="button"
          className="widget-nav"
          onClick={() => setOffset((prev) => prev + 1)}
          aria-label="Next month"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
      </div>

      <div className="widget-calendar" role="grid" aria-label={title}>
        {WEEKDAYS.map((initial, index) => (
          <span key={index} className="widget-calendar__weekday" aria-hidden>
            {initial}
          </span>
        ))}

        {cells.map((cell, index) => {
          if (cell === null) return <span key={`blank-${index}`} />;
          const holiday = byDate.get(cell.iso);
          return (
            <span
              key={cell.iso}
              className={[
                'widget-calendar__day',
                cell.iso === todayIso ? 'widget-calendar__day--today' : '',
                holiday ? 'widget-calendar__day--holiday' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={holiday?.name}
            >
              {cell.day}
            </span>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {holidays.isPending && <WidgetSkeleton lines={2} />}

        {holidays.isError && (
          <WidgetMessage
            Icon={WifiOffIcon}
            title="Holidays unavailable"
            detail="This workstation could not reach the holiday calendar."
          />
        )}

        {!holidays.isPending && !holidays.isError && inMonth.length === 0 && (
          <p className="text-muted-foreground py-2 text-center text-[0.6875rem]">
            No public holidays this month.
          </p>
        )}

        <ul className="flex flex-col gap-1">
          {inMonth.map((holiday) => (
            <li key={`${holiday.date}-${holiday.name}`} className="flex items-baseline gap-2">
              <span className="text-muted-foreground w-12 shrink-0 text-[0.6875rem] tabular-nums">
                {HOLIDAY_DATE.format(new Date(`${holiday.date}T00:00:00`))}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.6875rem]" title={holiday.name}>
                {holiday.name}
              </span>
              {/* A state holiday is not a national one; a roster planner has to know which. */}
              {!holiday.nationwide && (
                <span className="text-muted-foreground shrink-0 text-[0.625rem]">regional</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
