import { z } from 'zod';
import { LIMITS } from '@menuboard/shared';

/**
 * Reusable primitives. Every schema uses `.strict()` at the object level so unknown keys are
 * rejected rather than silently ignored — that is what keeps mass assignment out of services.
 */

export const uuid = z.string().uuid('Must be a valid UUID');

/** Calendar date with no timezone. Validated by construction, then by real-date check. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    // Round-trip check rejects 2026-02-30, which the regex alone would accept.
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, 'Not a real calendar date');

export const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time in HH:MM format');

export const isoDateTime = z.string().datetime({ offset: true });

/** Trimmed, non-empty string with an upper bound. */
export function text(max: number, label = 'This field') {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);
}

/** Trimmed optional string; empty input becomes null so the column stays clean. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
}

/** Query strings arrive as text, so numeric params are coerced then bounded. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).optional(),
  search: z.string().trim().max(200).optional(),
});

export const sortQuery = z.object({
  sortBy: z.string().trim().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const idParam = z.object({ id: uuid }).strict();
export const boardIdParam = z.object({ boardId: uuid }).strict();
export const orderIdParam = z.object({ orderId: uuid }).strict();

/**
 * Accepts a repeated query parameter (`?status=A&status=B`) or a comma-separated list
 * (`?status=A,B`), because clients differ on how they serialise arrays.
 */
export function enumList<T extends readonly [string, ...string[]]>(values: T) {
  const member = z.enum(values);
  return z
    .union([member, z.array(member), z.string()])
    .transform((value): z.infer<typeof member>[] => {
      if (Array.isArray(value)) return value;
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '') as z.infer<typeof member>[];
    })
    .pipe(z.array(member).min(1))
    .optional();
}

export const idList = z.array(uuid).max(LIMITS.MENTIONS_MAX);
