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
      // CSP is off deliberately. The one HTML page served here is the Digital Menu Board, whose
      // markup ships in this repository — there is no user-supplied content in it to protect
      // against — and it loads Google Fonts and a Lottie bundle from a CDN, which a useful
      // policy would have to enumerate and keep in step for no gain.
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

  // The Digital Menu Board page itself, so a screen needs a URL and nothing else — no launcher,
  // no local server, no install. Serving it from the API's own origin is what keeps it that
  // simple: the board's fetches are same-origin, so no screen has to appear in CORS_ORIGINS.
  //
  // `index: 'index.html'` and a single named file rather than the whole `digitalmenu/` folder:
  // that directory also holds tooling config, and static middleware pointed at a directory
  // serves everything in it, including whatever lands there later.
  app.get('/menu-board', (_req, res) => {
    // Helmet's blanket `X-Frame-Options: SAMEORIGIN` (above) is right for every other response
    // but wrong for this one: the admin portal's board layout editor frames this page so an
    // operator can drag the Today panel and the ads over the *actual* menu, and the portal is a
    // different origin from the API in every setup where they are not behind one reverse proxy
    // — in development it is always :5173 against :4000. SAMEORIGIN makes the browser refuse to
    // render the frame at all, with nothing in the page to explain why.
    //
    // It is replaced for this page only, and only with the framing rule relaxed: the modern
    // `frame-ancestors` equivalent, scoped to exactly the origins already trusted to call the
    // API. That mirrors `isAllowedCorsOrigin` deliberately — permissive outside production,
    // where the portal is opened from whatever LAN or Tailscale address it has that day and an
    // exact list cannot be written ahead of time, and the strict configured allowlist in
    // production. This page carries no session and no user-supplied markup, so what a frame
    // could be tricked into doing is limited to displaying a menu.
    res.removeHeader('X-Frame-Options');
    const ancestors = config.isProduction
      ? ["'self'", ...config.corsOrigins].join(' ')
      : '*';
    res.setHeader('Content-Security-Policy', `frame-ancestors ${ancestors}`);

    // Helmet's default `Cross-Origin-Opener-Policy: same-origin` has to go for the same
    // reason, and it is the less obvious of the two. The portal opens this page in a window
    // of its own to edit it, and the two hold a conversation through that handle: the editor
    // asks for an access token, the portal answers, and nothing about the editor turns on
    // until it does. Under `same-origin` the browser severs that relationship the moment the
    // window opens — across ports it is a cross-origin open — leaving `window.opener` null
    // and the editor permanently inert, with no error anywhere to say why.
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.sendFile(config.menuBoard.pagePath);
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.debug('Express application configured', {
    env: config.env,
    corsOrigins: config.corsOrigins,
    trustProxy: config.security.trustProxy,
  });

  return app;
}
