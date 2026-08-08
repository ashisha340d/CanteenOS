import { isAxiosError } from 'axios';
import type { ApiErrorBody } from '@menuboard/shared';

const FRIENDLY: Partial<Record<string, string>> = {
  VALIDATION_FAILED: 'Some fields need attention.',
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_INVALID: 'Your session is no longer valid. Please sign in again.',
  REFRESH_REUSED: 'This session was used elsewhere and has been signed out for safety.',
  FORBIDDEN: "You don't have permission to do that.",
  CLIENT_NOT_PERMITTED: 'This action is not permitted from the Admin Portal.',
  NOT_FOUND: 'The item you were looking for could not be found.',
  CONFLICT: 'This could not be completed because of a conflict with existing data.',
  STALE_WRITE: 'Someone else changed this record. Reload and try again.',
  INVALID_STATUS_TRANSITION: 'That status change is not allowed from the current status.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  PAYLOAD_TOO_LARGE: 'The file is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'That file type is not supported.',
  ACCOUNT_INACTIVE: 'This account is not active.',
  INVALID_CREDENTIALS: 'Incorrect username or password.',
  ADMIN_ROLE_REQUIRED: 'Only Administrator accounts can access the Admin Portal.',
  INTERNAL_ERROR: 'Something went wrong on the server. Please try again.',
};

export interface ReadableError {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
}

/** Extracts a human-readable message from any error thrown by the API client, keyed on `code`. */
export function readError(error: unknown): ReadableError {
  if (isAxiosError<ApiErrorBody>(error)) {
    const body = error.response?.data;
    if (body && body.success === false) {
      const code = body.error.code;
      return {
        code,
        message: FRIENDLY[code] ?? body.error.message,
        details: body.error.details,
      };
    }
    if (error.code === 'ERR_NETWORK') {
      return { code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection.' };
    }
  }
  if (error instanceof Error) {
    return { code: 'UNKNOWN', message: error.message };
  }
  return { code: 'UNKNOWN', message: 'An unexpected error occurred.' };
}
