import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { ApiFieldError } from '@menuboard/shared';
import { ValidationError } from '../utils/errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and *replaces* the request parts with their parsed output, so handlers receive
 * coerced, trimmed, defaulted values and never touch raw input. Unknown keys are stripped by
 * the schemas themselves, which is what keeps mass-assignment out of the service layer.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const details: ApiFieldError[] = [];

      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);
        if (result.success) req.params = result.data as typeof req.params;
        else details.push(...toFieldErrors(result.error, 'params'));
      }

      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);
        // Express 4 defines `query` as a getter on some setups; assigning through
        // Object.defineProperty keeps it writable across versions.
        if (result.success) {
          Object.defineProperty(req, 'query', {
            value: result.data,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        } else {
          details.push(...toFieldErrors(result.error, 'query'));
        }
      }

      if (schemas.body) {
        const result = schemas.body.safeParse(req.body);
        if (result.success) req.body = result.data;
        else details.push(...toFieldErrors(result.error, 'body'));
      }

      if (details.length > 0) {
        throw new ValidationError('The request could not be validated', details);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function toFieldErrors(error: ZodError, prefix: string): ApiFieldError[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

/** Typed accessors so controllers get inference without casting at every call site. */
export function body<T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> {
  return req.body as z.infer<T>;
}

export function query<T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> {
  return req.query as unknown as z.infer<T>;
}

export function params<T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> {
  return req.params as unknown as z.infer<T>;
}
