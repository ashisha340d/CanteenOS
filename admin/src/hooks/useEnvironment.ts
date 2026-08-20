import { useQuery } from '@tanstack/react-query';
import {
  fetchPublicHolidays,
  fetchWeather,
  searchLocations,
  type LocationSuggestion,
  type PublicHoliday,
  type WeatherNow,
} from '../api/environment';
import type { WorkstationLocation } from '../services/workstationLocation';

/**
 * Weather and holidays come from third-party services, so the cache windows are set by how
 * fast the underlying fact actually changes rather than by how live the screen should feel.
 * Refetching either of these on a fifteen-second timer would be pure rudeness to a free API.
 */
const WEATHER_STALE_MS = 10 * 60_000;
const WEATHER_REFETCH_MS = 15 * 60_000;
const HOLIDAY_STALE_MS = 12 * 60 * 60_000;

/** Coordinates are the cache key, not the display name: two spellings of one place are one query. */
function locationKey(location: WorkstationLocation): string {
  return `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)},${location.timezone}`;
}

export function useWeather(location: WorkstationLocation | null) {
  return useQuery<WeatherNow>({
    queryKey: ['weather', location === null ? null : locationKey(location)],
    queryFn: ({ signal }) => fetchWeather(location as WorkstationLocation, signal),
    enabled: location !== null,
    staleTime: WEATHER_STALE_MS,
    refetchInterval: WEATHER_REFETCH_MS,
    // A canteen behind a firewall will never reach Open-Meteo; hammering it three times over
    // makes the widget slower to admit that, and no more likely to succeed.
    retry: 1,
  });
}

export function usePublicHolidays(location: WorkstationLocation | null, year: number) {
  return useQuery<PublicHoliday[]>({
    queryKey: ['public-holidays', location?.countryCode ?? null, year],
    queryFn: ({ signal }) =>
      fetchPublicHolidays((location as WorkstationLocation).countryCode, year, signal),
    enabled: location !== null,
    staleTime: HOLIDAY_STALE_MS,
    retry: 1,
  });
}

/** Typeahead behind the Location setting. Debouncing is the caller's business. */
export function useLocationSearch(query: string) {
  return useQuery<LocationSuggestion[]>({
    queryKey: ['location-search', query],
    queryFn: ({ signal }) => searchLocations(query, signal),
    enabled: query.trim().length >= 2,
    staleTime: HOLIDAY_STALE_MS,
    retry: 1,
  });
}
