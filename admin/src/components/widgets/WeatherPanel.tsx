import { DropletsIcon, WifiOffIcon, WindIcon } from 'lucide-react';
import { useWeather } from '@/hooks/useEnvironment';
import { weatherIcon, weatherLabel } from '@/lib/weatherCodes';
import type { WorkstationLocation } from '@/services/workstationLocation';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Conditions over the counter, and the two days after. A panel rather than a widget of its
 * own: weather is only ever read alongside the time, and two separate cards asking the same
 * question of the same location was two cards too many.
 */

const DAY_INITIAL = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });

function round(value: number): string {
  return `${Math.round(value)}°`;
}

export function WeatherPanel({ location }: { location: WorkstationLocation }): JSX.Element {
  const weather = useWeather(location);

  if (weather.isPending) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    );
  }

  if (weather.isError || weather.data === undefined) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-[0.6875rem]">
        <WifiOffIcon className="size-3.5 shrink-0" aria-hidden />
        Forecast unreachable
      </p>
    );
  }

  const now = weather.data;
  const Glyph = weatherIcon(now.code, now.isDay);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Glyph className="size-8 shrink-0" style={{ color: 'var(--widget-accent)' }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5">
            <span className="text-xl leading-none font-semibold tabular-nums">
              {round(now.temperature)}
            </span>
            <span className="truncate text-[0.6875rem] font-medium">{weatherLabel(now.code)}</span>
          </p>
          <p className="text-muted-foreground mt-1 flex items-center gap-2 text-[0.625rem]">
            <span className="flex items-center gap-0.5">
              <DropletsIcon className="size-2.5" aria-hidden />
              <span className="tabular-nums">{Math.round(now.humidity)}%</span>
            </span>
            <span className="flex items-center gap-0.5">
              <WindIcon className="size-2.5" aria-hidden />
              <span className="tabular-nums">{Math.round(now.windSpeed)} km/h</span>
            </span>
            <span className="tabular-nums">feels {round(now.feelsLike)}</span>
          </p>
        </div>
      </div>

      {/* Today is the reading above, so the strip starts at tomorrow. */}
      <ul className="grid grid-cols-3 gap-1">
        {now.forecast.slice(1, 4).map((day) => {
          const DayGlyph = weatherIcon(day.code);
          return (
            <li
              key={day.date}
              className="flex items-center justify-center gap-1 text-[0.625rem]"
              title={weatherLabel(day.code)}
            >
              <span className="text-muted-foreground">
                {DAY_INITIAL.format(new Date(`${day.date}T00:00:00`))}
              </span>
              <DayGlyph className="text-muted-foreground size-3" aria-hidden />
              <span className="font-medium tabular-nums">{round(day.high)}</span>
              <span className="text-muted-foreground tabular-nums">{round(day.low)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
