import { useEffect, useState } from 'react';
import { MapPinIcon } from 'lucide-react';
import { useWorkstationLocation } from '@/services/workstationLocation';

/**
 * The wall clock. Deliberately the machine's own time rather than the configured location's:
 * the workstation is standing in the canteen, so converting into the location's timezone
 * would only ever be able to disagree with the clock on the wall behind it.
 */

const TIME = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const SECONDS = new Intl.DateTimeFormat('en-IN', { second: '2-digit' });

const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });

const DATE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function ClockWidget(): JSX.Element {
  const location = useWorkstationLocation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full flex-col justify-center gap-1">
      <p className="flex items-baseline gap-1">
        {/* Tabular figures, or every digit change shifts the whole line sideways. */}
        <span className="text-[2.5rem] leading-none font-semibold tracking-tight tabular-nums">
          {TIME.format(now)}
        </span>
        <span className="text-muted-foreground text-base leading-none font-medium tabular-nums">
          {SECONDS.format(now)}
        </span>
      </p>

      <p className="text-sm font-medium">{WEEKDAY.format(now)}</p>
      <p className="text-muted-foreground text-xs">{DATE.format(now)}</p>

      {location && (
        <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[0.6875rem]">
          <MapPinIcon className="size-3 shrink-0" />
          <span className="truncate">{location.name}</span>
        </p>
      )}
    </div>
  );
}
