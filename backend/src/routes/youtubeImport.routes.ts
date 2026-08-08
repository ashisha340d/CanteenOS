import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { YoutubeImportController } from '../controllers/YoutubeImportController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createYoutubeImportSchema,
  youtubeImportListQuerySchema,
  youtubeImportMarkSavedSchema,
} from '../validation/schemas';
import { idParam } from '../validation/common';

/**
 * YouTube Recipe Downloader — a staging area, not the Recipe Master. Everything here is
 * recipe authoring, so the whole surface sits behind RECIPE_WRITE (the same gate as the
 * existing text/photo/voice recipe import).
 */
export function youtubeImportRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: youtubeImportListQuerySchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(YoutubeImportController.list),
  );

  router.get(
    '/:id',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(YoutubeImportController.getById),
  );

  router.post(
    '/',
    validate({ body: createYoutubeImportSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(YoutubeImportController.create),
  );

  router.post(
    '/:id/retry',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(YoutubeImportController.retry),
  );

  router.post(
    '/:id/saved',
    validate({ params: idParam, body: youtubeImportMarkSavedSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(YoutubeImportController.markSaved),
  );

  router.delete(
    '/:id',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(YoutubeImportController.remove),
  );

  return router;
}
