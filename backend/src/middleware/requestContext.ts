import type { NextFunction, Request, Response } from 'express';
import { HEADERS } from '@menuboard/shared';
import { newId, isUuid } from '../utils/ids';
import { logger } from '../utils/logger';

/**
 * Assigns a request id (honouring an inbound `X-Request-Id` when it is a valid UUID),
 * echoes it back, and logs one completion line per request with status and duration.
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

  res.on('finish', () => {
    const durationMs = Date.now() - req.context.startedAt;
    const level = res.statusCode >= 500 ? 'warn' : 'info';
    logger[level]('request', {
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs,
      userId: req.auth?.userId,
      deviceId: req.auth?.deviceId,
      clientType: req.auth?.clientType,
    });
  });

  next();
}
