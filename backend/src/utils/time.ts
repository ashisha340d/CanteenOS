/**
 * Time helpers.
 *
 * The database session runs in UTC with `dateStrings: true`, so DATETIME(3) values arrive
 * as 'YYYY-MM-DD HH:MM:SS.sss' with no zone. These helpers are the only place that
 * conversion happens, keeping timezone handling in one auditable spot.
 */

/** MariaDB DATETIME(3) literal for the given instant, in UTC. */
export function toDbDateTime(date: Date = new Date()): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

/** Parses a DATETIME(3) string from the driver into an ISO-8601 UTC instant. */
export function fromDbDateTime(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const normalised = value.includes('T') ? value : value.replace(' ', 'T');
  return normalised.endsWith('Z') ? normalised : `${normalised}Z`;
}

export function fromDbDateTimeRequired(value: string | Date): string {
  const result = fromDbDateTime(value);
  if (result === null) throw new Error('Expected a non-null datetime');
  return result;
}

/** DATE column → 'YYYY-MM-DD'. Never constructs a Date, so no zone shift is possible. */
export function fromDbDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/** TIME column → 'HH:MM'. MariaDB returns 'HH:MM:SS'; seconds are not part of the domain. */
export function fromDbTime(value: string | null): string | null {
  if (value === null) return null;
  return value.slice(0, 5);
}

/** 'HH:MM' → 'HH:MM:00' for storage in a TIME column. */
export function toDbTime(value: string): string {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time value: ${value}`);
  return `${match[1]}:${match[2]}:${match[3] ?? '00'}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Today in UTC as 'YYYY-MM-DD'. */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
