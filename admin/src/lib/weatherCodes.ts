import {
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudHailIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudMoonIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  MoonStarIcon,
  SunIcon,
  type LucideIcon,
} from 'lucide-react';

/**
 * WMO 4677 present-weather codes, which is what Open-Meteo reports, reduced to the eleven
 * conditions worth drawing a different picture for. Codes that differ only by intensity share
 * a glyph and differ in wording — "light rain" and "heavy rain" are the same icon to a reader
 * glancing at a 260px card, but not the same information.
 */

interface Condition {
  label: string;
  /** Clear and partly-cloudy states need a night variant; rain at 2am looks like rain. */
  day: LucideIcon;
  night: LucideIcon;
}

const CONDITIONS: Record<number, Condition> = {
  0: { label: 'Clear', day: SunIcon, night: MoonStarIcon },
  1: { label: 'Mainly clear', day: SunIcon, night: MoonStarIcon },
  2: { label: 'Partly cloudy', day: CloudSunIcon, night: CloudMoonIcon },
  3: { label: 'Overcast', day: CloudIcon, night: CloudIcon },
  45: { label: 'Fog', day: CloudFogIcon, night: CloudFogIcon },
  48: { label: 'Freezing fog', day: CloudFogIcon, night: CloudFogIcon },
  51: { label: 'Light drizzle', day: CloudDrizzleIcon, night: CloudDrizzleIcon },
  53: { label: 'Drizzle', day: CloudDrizzleIcon, night: CloudDrizzleIcon },
  55: { label: 'Heavy drizzle', day: CloudDrizzleIcon, night: CloudDrizzleIcon },
  56: { label: 'Freezing drizzle', day: CloudDrizzleIcon, night: CloudDrizzleIcon },
  57: { label: 'Freezing drizzle', day: CloudDrizzleIcon, night: CloudDrizzleIcon },
  61: { label: 'Light rain', day: CloudRainIcon, night: CloudRainIcon },
  63: { label: 'Rain', day: CloudRainIcon, night: CloudRainIcon },
  65: { label: 'Heavy rain', day: CloudRainIcon, night: CloudRainIcon },
  66: { label: 'Freezing rain', day: CloudRainIcon, night: CloudRainIcon },
  67: { label: 'Freezing rain', day: CloudRainIcon, night: CloudRainIcon },
  71: { label: 'Light snow', day: CloudSnowIcon, night: CloudSnowIcon },
  73: { label: 'Snow', day: CloudSnowIcon, night: CloudSnowIcon },
  75: { label: 'Heavy snow', day: CloudSnowIcon, night: CloudSnowIcon },
  77: { label: 'Snow grains', day: CloudSnowIcon, night: CloudSnowIcon },
  80: { label: 'Light showers', day: CloudRainIcon, night: CloudRainIcon },
  81: { label: 'Showers', day: CloudRainIcon, night: CloudRainIcon },
  82: { label: 'Heavy showers', day: CloudRainIcon, night: CloudRainIcon },
  85: { label: 'Snow showers', day: CloudSnowIcon, night: CloudSnowIcon },
  86: { label: 'Snow showers', day: CloudSnowIcon, night: CloudSnowIcon },
  95: { label: 'Thunderstorm', day: CloudLightningIcon, night: CloudLightningIcon },
  96: { label: 'Storm with hail', day: CloudHailIcon, night: CloudHailIcon },
  99: { label: 'Storm with hail', day: CloudHailIcon, night: CloudHailIcon },
};

const UNKNOWN: Condition = { label: 'Unsettled', day: CloudIcon, night: CloudIcon };

export function weatherLabel(code: number): string {
  return (CONDITIONS[code] ?? UNKNOWN).label;
}

export function weatherIcon(code: number, isDay = true): LucideIcon {
  const condition = CONDITIONS[code] ?? UNKNOWN;
  return isDay ? condition.day : condition.night;
}
