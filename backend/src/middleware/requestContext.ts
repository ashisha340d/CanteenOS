import type { NextFunction, Request, Response } from 'express';
import { HEADERS } from '@menuboard/shared';
import { newId, isUuid } from '../utils/ids';

/**
 * Assigns a request id (honouring an inbound `X-Request-Id` when it is a valid UUID) and
 * echoes it back. No per-request log line — errors surface through the error handler.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(HEADERS.REQUEST_ID);
  const requestId = isUuid(inbound) ? (inbound as string) : newId();

  req.context = {
    requestId,
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    startedAt: Date.now(),
  };

  res.setHeader(HEADERS.REQUEST_ID, requestId);

  next();
}
