import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { ERROR_CODES, type ApiErrorBody } from '@menuboard/shared';
import {
  AppError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
  isAppError,
} from '../utils/errors';
import { logger } from '../utils/logger';

/** 404 for any unmatched route, so the client always receives the standard envelope. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `No route matches ${req.method} ${req.path}`,
      requestId: req.context?.requestId ?? '',
    },
  } satisfies ApiErrorBody);
}

/**
 * The single place errors become responses.
 *
 * Expected errors render their own message. Anything else is logged in full and reported as a
 * generic INTERNAL_ERROR — an unexpected fault must never leak SQL text, file paths or stack
 * frames to a client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Streaming already started: nothing coherent can be sent, so hand back to Express.
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = req.context?.requestId ?? '';
  const appError = normalise(error);

  // Expected errors (bad input, wrong credentials, a refused transition) are ordinary client
  // behaviour — they go to the client in the envelope and nowhere else. Only a genuine fault
  // is worth a log line.
  if (!appError.expected) {
    logger.error(
      'Unhandled request error',
      {
        requestId,
        path: req.originalUrl.split('?')[0],
        method: req.method,
        userId: req.auth?.userId,
      },
      error,
    );
  }

  const body: ApiErrorBody = {
    success: false,
    error: {
      code: appError.code,
      message: appError.expected ? appError.message : 'An unexpected error occurred',
      requestId,
      ...(appError.details ? { details: appError.details } : {}),
    },
  };

  res.status(appError.statusCode).json(body);
}

function normalise(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) {
    return new ValidationError(
      'The request could not be validated',
      error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }

  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return new PayloadTooLargeError('The uploaded file exceeds the maximum allowed size');
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return new ValidationError('Unexpected file upload', [
          { path: error.field ?? 'file', message: 'This file field is not accepted here' },
        ]);
      default:
        return new UnsupportedMediaTypeError('The upload could not be processed');
    }
  }

  // Express' JSON body parser surfaces malformed payloads as a SyntaxError with `body` set.
  if (
    error instanceof SyntaxError &&
    'body' in error &&
    (error as { status?: number }).status === 400
  ) {
    return new ValidationError('The request body is not valid JSON');
  }

  if ((error as { type?: string }).type === 'entity.too.large') {
    return new PayloadTooLargeError('The request body is too large');
  }

  return new AppError(500, ERROR_CODES.INTERNAL_ERROR, 'An unexpected error occurred', {
    expected: false,
    cause: error,
  });
}

/**
 * Wraps an async handler so a rejected promise reaches `errorHandler`. Express 4 does not
 * forward async rejections on its own.
 */
export function asyncHandler<T extends (req: Request, res: Response) => Promise<void>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}
