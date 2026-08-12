import { Router } from 'express';
import { z } from 'zod';
import { AuthController } from '../controllers/AuthController';
import { authenticate } from '../middleware/authenticate';
import { asyncHandler } from '../middleware/errorHandler';
import { authRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  passkeyLoginOptionsSchema,
  passkeyLoginSchema,
  passkeyRegisterOptionsSchema,
  passkeyRegisterSchema,
  passkeyRemoveSchema,
  pinLoginSchema,
  pinManageSchema,
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

  // ----------------------------------------------------------------- fast auth

  router.post(
    '/login/pin',
    authRateLimit,
    validate({ body: pinLoginSchema }),
    asyncHandler(AuthController.loginWithPin),
  );

  router.post(
    '/login/passkey/options',
    authRateLimit,
    validate({ body: passkeyLoginOptionsSchema }),
    asyncHandler(AuthController.passkeyLoginOptions),
  );

  router.post(
    '/login/passkey',
    authRateLimit,
    validate({ body: passkeyLoginSchema }),
    asyncHandler(AuthController.loginWithPasskey),
  );

  router.get('/pin/status', authenticate, asyncHandler(AuthController.pinStatus));

  router.post(
    '/pin',
    authenticate,
    validate({ body: pinManageSchema }),
    asyncHandler(AuthController.setPin),
  );

  router.post(
    '/pin/remove',
    authenticate,
    validate({ body: z.object({ currentPassword: z.string().min(1) }).strict() }),
    asyncHandler(AuthController.removePin),
  );

  router.get('/passkeys', authenticate, asyncHandler(AuthController.listPasskeys));

  router.post(
    '/passkeys/register-options',
    authenticate,
    validate({ body: passkeyRegisterOptionsSchema }),
    asyncHandler(AuthController.passkeyRegisterOptions),
  );

  router.post(
    '/passkeys/register',
    authenticate,
    validate({ body: passkeyRegisterSchema }),
    asyncHandler(AuthController.registerPasskey),
  );

  router.post(
    '/passkeys/remove',
    authenticate,
    validate({ body: passkeyRemoveSchema }),
    asyncHandler(AuthController.removePasskey),
  );

  return router;
}
