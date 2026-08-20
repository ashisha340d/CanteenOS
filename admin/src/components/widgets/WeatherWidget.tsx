import { DropletsIcon, MapPinOffIcon, ThermometerIcon, WifiOffIcon, WindIcon } from 'lucide-react';
import { useWeather } from '@/hooks/useEnvironment';
import { useLaunchApp } from '@/services/useLaunchApp';
import { SETTINGS_APP_ID } from '@/services/appRegistry';
import { useWorkstationLocation } from '@/services/workstationLocation';
import { weatherIcon, weatherLabel } from '@/lib/weatherCodes';
import { WidgetMessage, WidgetSkeleton } from './widgetUi';

/**
 * Conditions over the counter, and the three days after.
 *
 * Not decoration in a canteen: rain decides how many people walk to the outdoor seating, and
 * a heat warning decides how much cold stock the counter should be holding. So the forecast
 * is given as much room as the current reading.
 */

const DAY_INITIAL = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });

function round(value: number): string {
  return `${Math.round(value)}°`;
}

export function WeatherWidget(): JSX.Element {
  const location = useWorkstationLocation();
  const launch = useLaunchApp();
  const weather = useWeather(location);

  if (location === null) {
    return (
      <WidgetMessage
        Icon={MapPinOffIcon}
        title="No location set"
        detail="The forecast needs to know where this canteen is."
        action={{ label: 'Open Settings', onClick: () => launch(SETTINGS_APP_ID) }}
      />
    );
  }

  if (weather.isPending) return <WidgetSkeleton lines={2} />;

  if (weather.isError || weather.data === undefined) {
    return (
      <WidgetMessage
        Icon={WifiOffIcon}
        title="Forecast unavailable"
        detail="This workstation could not reach the weather service."
        action={{ label: 'Try again', onClick: () => void weather.refetch() }}
      />
    );
  }

  const now = weather.data;
  const Glyph = weatherIcon(now.code, now.isDay);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start gap-3">
        <Glyph className="text-primary size-10 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-3xl leading-none font-semibold tabular-nums">
            {round(now.temperature)}
          </p>
          <p className="mt-1 truncate text-xs font-medium">{weatherLabel(now.code)}</p>
          <p className="text-muted-foreground truncate text-[0.6875rem]">{location.name}</p>
        </div>
      </div>

      <dl className="text-muted-foreground grid grid-cols-3 gap-1 text-[0.6875rem]">
        <div className="flex items-center gap-1">
          <ThermometerIcon className="size-3 shrink-0" aria-hidden />
          <dt className="sr-only">Feels like</dt>
          <dd className="tabular-nums">{round(now.feelsLike)}</dd>
        </div>
        <div className="flex items-center gap-1">
          <DropletsIcon className="size-3 shrink-0" aria-hidden />
          <dt className="sr-only">Humidity</dt>
          <dd className="tabular-nums">{Math.round(now.humidity)}%</dd>
        </div>
        <div className="flex items-center gap-1">
          <WindIcon className="size-3 shrink-0" aria-hidden />
          <dt className="sr-only">Wind</dt>
          <dd className="tabular-nums">{Math.round(now.windSpeed)} km/h</dd>
        </div>
      </dl>

      {/* Today is already the headline above, so the strip starts at tomorrow. */}
      <ul className="mt-auto grid grid-cols-3 gap-1.5 border-t pt-2">
        {now.forecast.slice(1, 4).map((day) => {
          const DayGlyph = weatherIcon(day.code);
          return (
            <li key={day.date} className="flex flex-col items-center gap-0.5">
              <span className="text-muted-foreground text-[0.625rem] font-medium">
                {DAY_INITIAL.format(new Date(`${day.date}T00:00:00`))}
              </span>
              <DayGlyph className="text-muted-foreground size-4" aria-hidden />
              <span className="text-[0.6875rem] font-medium tabular-nums">{round(day.high)}</span>
              <span className="text-muted-foreground text-[0.625rem] tabular-nums">
                {round(day.low)}
              </span>
              {day.rainChance !== null && day.rainChance >= 30 && (
                <span className="text-tone-info text-[0.625rem] tabular-nums">
                  {day.rainChance}%
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
