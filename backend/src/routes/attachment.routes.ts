import { Router } from 'express';
import { AttachmentController } from '../controllers/AttachmentController';
import { asyncHandler } from '../middleware/errorHandler';
import { uploadRateLimit } from '../middleware/rateLimit';
import { uploadSingleMedia } from '../middleware/upload';
import { validate } from '../middleware/validate';
import {
  attachmentFileQuerySchema,
  bindAttachmentsSchema,
  idParam,
  uploadQuerySchema,
} from '../validation/schemas';

/**
 * Media upload, binding and download.
 *
 * Owner-level authorisation happens in the service, because an attachment may be uploaded before
 * its owner exists — an unbound attachment is private to whoever uploaded it.
 */
export function attachmentRoutes(): Router {
  const router = Router();

  // No `requireCapability(ATTACHMENT_UPLOAD)` here: that capability is granted by board role, not
  // by global role, so a middleware check against global capabilities would refuse every ordinary
  // member. AttachmentService performs the board-aware check instead.
  router.post(
    '/upload',
    uploadRateLimit,
    // Multer runs before validation because the query is only meaningful alongside the file.
    uploadSingleMedia,
    validate({ query: uploadQuerySchema }),
    asyncHandler(AttachmentController.upload),
  );

  router.post(
    '/bind',
    validate({ body: bindAttachmentsSchema }),
    asyncHandler(AttachmentController.bind),
  );

  router.get(
    '/:id/url',
    validate({ params: idParam }),
    asyncHandler(AttachmentController.getUrl),
  );

  router.delete(
    '/:id',
    validate({ params: idParam }),
    asyncHandler(AttachmentController.remove),
  );

  return router;
}

/**
 * The download route is mounted outside the authenticated router: an `<Image>` or audio element
 * cannot attach a bearer header. Authorisation comes from the signed, expiring query string,
 * and board membership is re-checked before the bytes are served.
 */
export function publicAttachmentRoutes(): Router {
  const router = Router();

  router.get(
    '/:id/file',
    validate({ params: idParam, query: attachmentFileQuerySchema }),
    asyncHandler(AttachmentController.download),
  );

  return router;
}
