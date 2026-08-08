import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { SyncController } from '../controllers/SyncController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { syncRateLimit } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { syncPullSchema, syncPushSchema } from '../validation/schemas';

/**
 * Offline synchronisation.
 *
 * The limiter here is deliberately generous: a device returning from hours offline legitimately
 * drains its queue in a burst, and throttling that would stall recovery.
 */
export function syncRoutes(): Router {
  const router = Router();

  router.use(syncRateLimit, requireCapability(Capability.SYNC_USE));

  router.get('/status', asyncHandler(SyncController.status));

  router.post(
    '/push',
    validate({ body: syncPushSchema }),
    asyncHandler(SyncController.push),
  );

  router.post(
    '/pull',
    validate({ body: syncPullSchema }),
    asyncHandler(SyncController.pull),
  );

  return router;
}
