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
