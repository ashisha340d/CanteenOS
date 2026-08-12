import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { MediaController } from '../controllers/MediaController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { uploadRateLimit } from '../middleware/rateLimit';
import { uploadSingleMedia } from '../middleware/upload';
import { validate } from '../middleware/validate';
import {
  assignMediaSchema,
  idParam,
  mediaEntityQuerySchema,
  mediaFileQuerySchema,
  mediaListQuerySchema,
  reorderMediaSchema,
  updateMediaAssetSchema,
} from '../validation/schemas';

/**
 * The Menu Master media library. Reads share MASTER_READ (any admin session needs to browse
 * media while editing a menu); writes share MASTER_WRITE, exactly like every other Menu
 * Master route in menuMaster.routes.ts.
 */
export function mediaRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.MASTER_READ);
  const write = requireCapability(Capability.MASTER_WRITE);

  router.get('/', read, validate({ query: mediaListQuerySchema }), asyncHandler(MediaController.list));
  router.get('/:id', read, validate({ params: idParam }), asyncHandler(MediaController.getById));
  router.post(
    '/upload',
    write,
    uploadRateLimit,
    uploadSingleMedia,
    asyncHandler(MediaController.upload),
  );
  router.put(
    '/:id',
    write,
    validate({ params: idParam, body: updateMediaAssetSchema }),
    asyncHandler(MediaController.update),
  );
  router.delete('/:id', write, validate({ params: idParam }), asyncHandler(MediaController.remove));

  router.get(
    '/assignments/for-entity',
    read,
    validate({ query: mediaEntityQuerySchema }),
    asyncHandler(MediaController.listForEntity),
  );
  router.post(
    '/assignments',
    write,
    validate({ body: assignMediaSchema }),
    asyncHandler(MediaController.assign),
  );
  router.delete(
    '/assignments/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MediaController.unassign),
  );
  router.post(
    '/assignments/:id/set-primary',
    write,
    validate({ params: idParam }),
    asyncHandler(MediaController.setPrimary),
  );
  router.post(
    '/assignments/:id/reorder',
    write,
    validate({ params: idParam, body: reorderMediaSchema }),
    asyncHandler(MediaController.reorder),
  );

  return router;
}

/**
 * The download route is mounted outside the authenticated router — same reasoning as
 * `publicAttachmentRoutes()`: an `<img>` cannot attach a bearer header, so this is authorised
 * by the signed, expiring query string alone.
 */
export function publicMediaRoutes(): Router {
  const router = Router();

  router.get(
    '/:id/file',
    validate({ params: idParam, query: mediaFileQuerySchema }),
    asyncHandler(MediaController.download),
  );

  return router;
}
