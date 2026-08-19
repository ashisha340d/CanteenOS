/** ISO-8601 UTC instant with milliseconds, matching the wire/SQLite convention. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Returns an ISO-8601 timestamp `offsetMs` milliseconds after `fromIso`. */
export function offsetIso(fromIso: string, offsetMs: number): string {
  return new Date(Date.parse(fromIso) + offsetMs).toISOString();
}

/** YYYY-MM-DD for the local calendar day. */
export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

/**
 * The local calendar day an ISO-8601 instant falls on.
 *
 * Never slice an instant's first ten characters to get this. `nowIso()` writes UTC, so at
 * UTC+5:30 anything sent between local midnight and 05:30 carries *yesterday's* UTC date — a
 * message posted at 2am read as a day old, dropped out of a "today only" filter, and put a
 * wrong date separator in the feed. Parsing and re-formatting in local time is the fix.
 *
 * Returns '' for an unparseable value so callers can compare without a crash.
 */
export function localDayOf(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '' : toIsoDate(parsed);
}

export function toIsoDate(date: Date): string {
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** HH:mm for the local wall clock. */
export function nowClockTime(): string {
  const date = new Date();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatDateDisplay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

export function formatDateTimeDisplay(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return isoDateTime;
  return date.toLocaleString();
}
