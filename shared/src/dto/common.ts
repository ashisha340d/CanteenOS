import type { ErrorCode } from '../constants';

/** Every successful response body is wrapped exactly once. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level detail for VALIDATION_FAILED. */
    details?: ApiFieldError[];
    requestId: string;
  };
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export interface PageQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** ISO-8601 UTC instant with milliseconds, e.g. 2026-08-05T09:30:00.000Z. */
export type IsoDateTime = string;
/** Calendar date, YYYY-MM-DD, with no timezone. */
export type IsoDate = string;
/** Wall-clock time, HH:mm, with no timezone. */
export type ClockTime = string;
export type Uuid = string;

/** Fields present on every syncable entity. */
export interface SyncMeta {
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
  /** Global monotonic cursor; clients pull everything greater than their last value. */
  syncSeq: number;
  /** Incremented on each server-applied update; used for optimistic concurrency. */
  revision: number;
}
