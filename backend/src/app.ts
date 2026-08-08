import express, { type Express } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { buildApiRouter } from './routes';
import { logger } from './utils/logger';
import { isAllowedCorsOrigin } from './utils/originAllowlist';

/**
 * Express application assembly. Ordering matters and is deliberate:
 *
 *   security headers → HTTPS enforcement → CORS → body parsing → request context
 *   → routes → 404 → error handler
 *
 * The error handler is last so it can catch anything thrown above it.
 */
export function createApp(): Express {
  const app = express();

  // Required for correct `req.ip` (and therefore rate limiting) behind a reverse proxy. Left off
  // by default, because trusting X-Forwarded-For without a proxy lets a client spoof its address.
  if (config.security.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and media, never HTML, so a CSP would have nothing to protect.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: config.security.forceHttps
        ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
        : false,
    }),
  );

  if (config.security.forceHttps) {
    app.use((req, res, next) => {
      if (req.secure || req.header('x-forwarded-proto') === 'https') {
        next();
        return;
      }
      res.redirect(308, `https://${req.header('host') ?? ''}${req.originalUrl}`);
    });
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header means a native app or server-to-server call, which CORS does not
        // govern; browser origins must be explicitly allowed.
        if (isAllowedCorsOrigin(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining'],
    }),
  );

  app.use(compression());

  // 1 MB is ample for JSON; a sync push of 200 items sits far below it, and media goes through
  // multipart upload rather than a JSON body.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(requestContext);

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', env: config.env } });
  });

  app.use('/api/v1', buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.debug('Express application configured', {
    env: config.env,
    corsOrigins: config.corsOrigins,
    trustProxy: config.security.trustProxy,
  });

  return app;
}
