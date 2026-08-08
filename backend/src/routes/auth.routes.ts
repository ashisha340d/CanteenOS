import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { authRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  pushTokenSchema,
  refreshSchema,
} from '../validation/schemas';

export function authRoutes(): Router {
  const router = Router();

  // Credential endpoints carry a tight, IP-plus-identifier limiter so guessing is expensive.
  router.post(
    '/login',
    authRateLimit,
    validate({ body: loginSchema }),
    asyncHandler(AuthController.login),
  );

  router.post(
    '/refresh',
    authRateLimit,
    validate({ body: refreshSchema }),
    asyncHandler(AuthController.refresh),
  );

  // The rest need a valid access token.
  router.post(
    '/logout',
    authenticate,
    validate({ body: logoutSchema }),
    asyncHandler(AuthController.logout),
  );

  router.get('/me', authenticate, asyncHandler(AuthController.me));

  router.post(
    '/password',
    authenticate,
    validate({ body: changePasswordSchema }),
    asyncHandler(AuthController.changePassword),
  );

  router.post(
    '/push-token',
    authenticate,
    validate({ body: pushTokenSchema }),
    asyncHandler(AuthController.registerPushToken),
  );

  return router;
}
