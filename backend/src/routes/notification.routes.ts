import { Router } from 'express';
import { NotificationController } from '../controllers/AdminController';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { idParam, markReadSchema, notificationListQuerySchema } from '../validation/schemas';

/**
 * Notifications are always the signed-in user's own — there is no capability to check and no
 * way to address someone else's inbox, because the user id comes from the token.
 */
export function notificationRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: notificationListQuerySchema }),
    asyncHandler(NotificationController.list),
  );

  router.get('/unread-count', asyncHandler(NotificationController.unreadCount));

  router.post(
    '/read',
    validate({ body: markReadSchema }),
    asyncHandler(NotificationController.markRead),
  );

  router.post('/read-all', asyncHandler(NotificationController.markAllRead));

  router.delete(
    '/:id',
    validate({ params: idParam }),
    asyncHandler(NotificationController.remove),
  );

  return router;
}
