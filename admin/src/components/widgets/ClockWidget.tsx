import { useEffect, useState } from 'react';
import { MapPinIcon, MapPinOffIcon } from 'lucide-react';
import { SETTINGS_APP_ID } from '@/services/appRegistry';
import { useLaunchApp } from '@/services/useLaunchApp';
import { useWorkstationLocation } from '@/services/workstationLocation';
import { HolidayPanel } from './HolidayPanel';
import { WeatherPanel } from './WeatherPanel';
import type { WidgetBodyProps } from './widgetTypes';

/**
 * The one ambient card: the time, and optionally the two other things a shift is planned
 * around — the weather over the counter and the next public holiday.
 *
 * All three used to be separate widgets and it was wrong. They are read in the same glance,
 * they all answer "what is today like", and two of the three depend on the same Location
 * setting. Long-press the card to switch the extra panels on or off.
 *
 * The clock is the machine's own time, never converted into the configured location's
 * timezone: the workstation is standing in the canteen, so a conversion could only ever
 * disagree with the clock on the wall behind it.
 */

const TIME = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const SECONDS = new Intl.DateTimeFormat('en-IN', { second: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });
const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export function ClockWidget({ options }: WidgetBodyProps): JSX.Element {
  const location = useWorkstationLocation();
  const launch = useLaunchApp();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const wantsLocation = options['weather'] === true || options['holidays'] === true;

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <p className="flex items-baseline gap-1">
          {/* Tabular figures, or every digit change shifts the whole line sideways. */}
          <span className="text-[2.25rem] leading-none font-semibold tracking-tight tabular-nums">
            {TIME.format(now)}
          </span>
          <span className="text-muted-foreground text-sm leading-none font-medium tabular-nums">
            {SECONDS.format(now)}
          </span>
        </p>
        <p className="mt-1.5 text-sm font-medium">{WEEKDAY.format(now)}</p>
        <p className="text-muted-foreground text-xs">{DATE.format(now)}</p>
      </div>

      {wantsLocation && location === null && (
        <p className="text-muted-foreground flex items-start gap-1.5 border-t pt-2 text-[0.6875rem]">
          <MapPinOffIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Weather and holidays need a location.{' '}
            <button type="button" className="widget-link" onClick={() => launch(SETTINGS_APP_ID)}>
              Set one
            </button>
          </span>
        </p>
      )}

      {location !== null && options['weather'] === true && (
        <div className="border-t pt-2">
          <WeatherPanel location={location} />
        </div>
      )}

      {location !== null && options['holidays'] === true && (
        <div className="border-t pt-2">
          <p className="text-muted-foreground mb-1 text-[0.625rem] font-medium tracking-wide uppercase">
            Upcoming holidays
          </p>
          <HolidayPanel location={location} />
        </div>
      )}

      {location !== null && !wantsLocation && (
        <p className="text-muted-foreground mt-auto flex items-center gap-1 text-[0.6875rem]">
          <MapPinIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{location.name}</span>
        </p>
      )}
    </div>
  );
}
