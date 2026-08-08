/** SQLite stores `mentioned_user_ids` / `system_meta` / `notifications.data` as JSON TEXT. */
export function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function toJsonArray(values: readonly string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  return JSON.stringify(values);
}

export function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toJsonObject(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  return JSON.stringify(value);
}
