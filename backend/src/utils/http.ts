import type { Response } from 'express';
import type { ApiSuccess, Paginated } from '@menuboard/shared';
import { LIMITS } from '@menuboard/shared';

/** Every success response is wrapped exactly once, by these helpers only. */
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  res.status(200).json(body);
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ success: true, data } satisfies ApiSuccess<T>);
}

export function noContent(res: Response): void {
  res.status(204).end();
}

export function paginated<T>(res: Response, page: Paginated<T>): void {
  ok(res, page.items, {
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: page.totalPages,
  });
}

export function buildPage<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  };
}

/** Clamps client-supplied paging into a safe range and returns the SQL offset. */
export function resolvePaging(input: { page?: number; pageSize?: number }): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(
    LIMITS.PAGE_SIZE_MAX,
    Math.max(1, Math.trunc(input.pageSize ?? LIMITS.PAGE_SIZE_DEFAULT)),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}
