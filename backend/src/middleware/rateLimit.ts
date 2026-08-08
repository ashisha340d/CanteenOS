import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { ERROR_CODES } from '@menuboard/shared';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Rate limiting. The in-memory store is correct for a single instance; a horizontally scaled
 * deployment needs a shared store, which is why the limits are also enforced per user rather
 * than only per IP.
 */

function keyFor(req: Request): string {
  // Authenticated traffic is limited per user so devices behind one NAT do not starve each
  // other; anonymous traffic falls back to IP.
  return req.auth?.userId ?? req.ip ?? 'unknown';
}

function baseOptions(max: number, windowMs: number): Partial<Options> {
  return {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyFor,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        requestId: req.context?.requestId,
        path: req.originalUrl.split('?')[0],
        key: keyFor(req),
      });
      res.status(429).json({
        success: false,
        error: {
          code: ERROR_CODES.RATE_LIMITED,
          message: 'Too many requests, please slow down',
          requestId: req.context?.requestId ?? '',
        },
      });
    },
  };
}

/** Default limiter for the whole API surface. */
export const apiRateLimit = rateLimit(
  baseOptions(config.security.rateLimitMax, config.security.rateLimitWindowMs),
);

/**
 * Tight limiter for credential endpoints, keyed by IP + identifier so guessing one account
 * cannot be spread across addresses, and one address cannot spray many accounts.
 */
export const authRateLimit = rateLimit({
  ...baseOptions(config.security.authRateLimitMax, config.security.rateLimitWindowMs),
  keyGenerator: (req: Request): string => {
    const identifier =
      typeof req.body?.identifier === 'string' ? req.body.identifier.toLowerCase() : '';
    return `${req.ip ?? 'unknown'}:${identifier}`;
  },
  skipSuccessfulRequests: true,
});

/**
 * Sync endpoints get a higher ceiling: a device coming back online legitimately drains its
 * queue in a burst, and throttling that would stall recovery.
 */
export const syncRateLimit = rateLimit(
  baseOptions(Math.max(config.security.rateLimitMax, 600), config.security.rateLimitWindowMs),
);

/** Uploads are byte-heavy rather than request-heavy, so the count is lower. */
export const uploadRateLimit = rateLimit(baseOptions(120, config.security.rateLimitWindowMs));
