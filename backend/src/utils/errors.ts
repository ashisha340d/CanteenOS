import { ERROR_CODES, type ApiFieldError, type ErrorCode } from '@menuboard/shared';

/**
 * Typed error hierarchy. Services and repositories throw these; a single error handler
 * renders them. Anything that is not an AppError is treated as an unexpected fault and
 * reported as INTERNAL_ERROR without leaking its message to the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: ApiFieldError[];
  /** False for genuine faults; controls whether the stack is logged at error level. */
  readonly expected: boolean;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options?: { details?: ApiFieldError[]; expected?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    if (options?.details) this.details = options.details;
    this.expected = options?.expected ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: ApiFieldError[]) {
    super(400, ERROR_CODES.VALIDATION_FAILED, message, details ? { details } : undefined);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = ERROR_CODES.UNAUTHENTICATED) {
    super(401, code, message);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor() {
    // Deliberately generic: never reveal whether the identifier or the password was wrong.
    super(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid credentials');
  }
}

export class AccountInactiveError extends AppError {
  constructor(message = 'This account is not active') {
    super(403, ERROR_CODES.ACCOUNT_INACTIVE, message);
  }
}

/**
 * Raised when a non-Admin role attempts to sign in to (or keep a session on) the Admin
 * Portal. Only the `ADMIN` role may use the Admin Portal — not Super Admin, Manager, User
 * or Employee — so this is checked on both login and refresh.
 */
export class AdminRoleRequiredError extends AppError {
  constructor(message = 'Only Administrator accounts can access the Admin Portal') {
    super(403, ERROR_CODES.ADMIN_ROLE_REQUIRED, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, ERROR_CODES.FORBIDDEN, message);
  }
}

/**
 * Raised when a capability is blocked for the calling application rather than for the
 * user — e.g. an Admin attempting billing generation from the Android app.
 */
export class ClientNotPermittedError extends AppError {
  constructor(message = 'This operation is not available from this application') {
    super(403, ERROR_CODES.CLIENT_NOT_PERMITTED, message);
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'Resource', id?: string) {
    super(404, ERROR_CODES.NOT_FOUND, id ? `${entity} ${id} was not found` : `${entity} was not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state') {
    super(409, ERROR_CODES.CONFLICT, message);
  }
}

/** Optimistic concurrency failure — the caller edited a stale revision. */
export class StaleWriteError extends AppError {
  readonly currentRevision: number;

  constructor(currentRevision: number, message = 'This record was changed by someone else') {
    super(409, ERROR_CODES.STALE_WRITE, message);
    this.currentRevision = currentRevision;
  }
}

export class InvalidStatusTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(
      409,
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      `An order cannot move from ${from} to ${to}`,
    );
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'The uploaded file is too large') {
    super(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'This file type is not supported') {
    super(415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests, please slow down') {
    super(429, ERROR_CODES.RATE_LIMITED, message);
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred', cause?: unknown) {
    super(500, ERROR_CODES.INTERNAL_ERROR, message, { expected: false, cause });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** MySQL/MariaDB driver error shape, narrowed for constraint mapping. */
interface DriverError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
}

/**
 * Translates database constraint violations into domain errors so callers never see raw
 * SQL text. Anything unrecognised is re-thrown for the generic handler.
 */
export function translateDbError(error: unknown, context: { entity: string }): AppError {
  const driverError = error as DriverError;

  switch (driverError.code) {
    case 'ER_DUP_ENTRY':
      return new ConflictError(`${context.entity} already exists with one of these values`);
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return new ValidationError(`${context.entity} references a record that does not exist`);
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return new ConflictError(
        `${context.entity} is still in use and cannot be removed; deactivate it instead`,
      );
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return new ValidationError(`${context.entity} failed a database constraint`);
    case 'ER_DATA_TOO_LONG':
      return new ValidationError(`A value supplied for ${context.entity} is too long`);
    default:
      return new InternalError(`Database operation failed for ${context.entity}`, error);
  }
}
