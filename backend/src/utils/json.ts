/**
 * JSON columns are declared LONGTEXT + JSON_VALID for MySQL/MariaDB portability, so the
 * driver hands back strings. These helpers are the boundary where that becomes typed data.
 */

/** Parses a JSON column, returning `fallback` rather than throwing on malformed content. */
export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  // The driver does not always hand these columns back as text: MariaDB flags a
  // JSON_VALID-constrained LONGTEXT in a way mysql2 decodes for us, so objects, booleans
  // and numbers can arrive already parsed. Anything that is not a string needs no work —
  // returning `fallback` here silently discarded every stored scalar.
  if (typeof value !== 'string') return value as T;
  if (value.trim() === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    // The column is JSON_VALID-constrained, so text that will not parse means the driver
    // already decoded it and handed back the decoded string (`HIGH`, not `"HIGH"`). Use it
    // rather than discarding a value that is genuinely present.
    return value as unknown as T;
  }
}

export function parseIdArray(value: unknown): string[] {
  const parsed = parseJsonColumn<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string');
}

/** Serialises for storage. Empty arrays and objects are stored as NULL, not '[]'. */
export function toJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    return null;
  }
  return JSON.stringify(value);
}
