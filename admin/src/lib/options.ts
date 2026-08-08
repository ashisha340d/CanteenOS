import type { SelectOption } from '@/components/form/fields';

/**
 * Enum values as select options, with the SCREAMING_SNAKE_CASE the API speaks turned into
 * something readable. Every filter and form in the portal did this inline; doing it once
 * keeps "WORK_IN_PROGRESS" rendering identically everywhere it appears.
 */
export function enumOptions(values: Record<string, string>): SelectOption[] {
  return Object.values(values).map((value) => ({
    value,
    label: humanise(value),
  }));
}

export function humanise(value: string): string {
  return value.replace(/_/g, ' ');
}

/** Options built from a list of records, for lookups like boards or stations. */
export function toOptions<T>(
  rows: T[],
  getValue: (row: T) => string,
  getLabel: (row: T) => string,
): SelectOption[] {
  return rows.map((row) => ({ value: getValue(row), label: getLabel(row) }));
}
