import type { WorkstationLocation } from '@/services/workstationLocation';

/**
 * The two things Canteen OS knows about the world outside the kitchen: the weather over the
 * counter and the public holidays the roster has to work around.
 *
 * Deliberately not routed through `api/client.ts`. That client carries this workstation's
 * bearer token and points at the MenuBoard backend; these are keyless third-party reads that
 * must never be sent an access token, so they use `fetch` directly and are never retried
 * against our own API.
 *
 * Open-Meteo (geocoding + forecast) and Nager.Date (holidays) are both free and require no
 * key or registration.
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOLIDAYS_URL = 'https://date.nager.at/api/v3/PublicHolidays';

/** A widget that cannot reach the internet says so; it must not surface a raw fetch error. */
export class EnvironmentUnavailableError extends Error {
  constructor(what: string) {
    super(`${what} is unavailable — this workstation could not reach the internet.`);
    this.name = 'EnvironmentUnavailableError';
  }
}

async function getJson<T>(url: string, what: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ?? null, headers: { accept: 'application/json' } });
  } catch {
    throw new EnvironmentUnavailableError(what);
  }
  if (!response.ok) throw new EnvironmentUnavailableError(what);
  return (await response.json()) as T;
}

/* ------------------------------------------------------------------------ geocoding */

interface GeocodingResponse {
  results?: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    timezone?: string;
  }[];
}

export interface LocationSuggestion extends WorkstationLocation {
  /** Open-Meteo's own id, stable enough to key a list on. */
  id: number;
}

/** Turns what somebody typed into places with coordinates, a country and a timezone. */
export async function searchLocations(
  query: string,
  signal?: AbortSignal,
): Promise<LocationSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = `${GEOCODING_URL}?name=${encodeURIComponent(trimmed)}&count=8&language=en&format=json`;
  const body = await getJson<GeocodingResponse>(url, 'Location search', signal);

  return (body.results ?? [])
    .filter((row) => typeof row.country_code === 'string' && typeof row.timezone === 'string')
    .map((row) => ({
      id: row.id,
      name: row.name,
      region: row.admin1 ?? null,
      country: row.country ?? '',
      countryCode: (row.country_code as string).toUpperCase(),
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: row.timezone as string,
    }));
}

/* -------------------------------------------------------------------------- weather */

interface ForecastResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    is_day: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

export interface WeatherDay {
  date: string;
  code: number;
  high: number;
  low: number;
  /** Percent, or null where the provider has no figure for that day. */
  rainChance: number | null;
}

export interface WeatherNow {
  observedAt: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  code: number;
  isDay: boolean;
  /** Today first, then the next three days. */
  forecast: WeatherDay[];
}

export async function fetchWeather(
  location: WorkstationLocation,
  signal?: AbortSignal,
): Promise<WeatherNow> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: location.timezone,
    forecast_days: '4',
  });

  const body = await getJson<ForecastResponse>(`${FORECAST_URL}?${params.toString()}`, 'Weather', signal);

  return {
    observedAt: body.current.time,
    temperature: body.current.temperature_2m,
    feelsLike: body.current.apparent_temperature,
    humidity: body.current.relative_humidity_2m,
    windSpeed: body.current.wind_speed_10m,
    code: body.current.weather_code,
    isDay: body.current.is_day === 1,
    forecast: body.daily.time.map((date, index) => ({
      date,
      code: body.daily.weather_code[index] ?? 0,
      high: body.daily.temperature_2m_max[index] ?? 0,
      low: body.daily.temperature_2m_min[index] ?? 0,
      rainChance: body.daily.precipitation_probability_max[index] ?? null,
    })),
  };
}

/* ------------------------------------------------------------------------- holidays */

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  global: boolean;
  counties: string[] | null;
}

export interface PublicHoliday {
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  /** The English name, when it differs from the local one. */
  englishName: string | null;
  /** False for a holiday only some states of the country observe. */
  nationwide: boolean;
}

/**
 * A year of public holidays for a country.
 *
 * Nager.Date covers a fixed list of countries and answers 404 for the rest. That is not an
 * error worth alarming anybody with — it means "we do not publish holidays for there" — so it
 * comes back as an empty year and the widget renders its own designed empty state.
 */
export async function fetchPublicHolidays(
  countryCode: string,
  year: number,
  signal?: AbortSignal,
): Promise<PublicHoliday[]> {
  let response: Response;
  try {
    response = await fetch(`${HOLIDAYS_URL}/${year}/${countryCode}`, {
      signal: signal ?? null,
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new EnvironmentUnavailableError('The holiday calendar');
  }

  if (response.status === 404) return [];
  if (!response.ok) throw new EnvironmentUnavailableError('The holiday calendar');

  const rows = (await response.json()) as NagerHoliday[];
  return rows.map((row) => ({
    date: row.date,
    name: row.localName,
    englishName: row.name === row.localName ? null : row.name,
    nationwide: row.global,
  }));
}
