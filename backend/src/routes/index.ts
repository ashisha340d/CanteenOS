import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { apiRateLimit } from '../middleware/rateLimit';
import { authRoutes } from './auth.routes';
import { userRoutes } from './user.routes';
import { boardRoutes } from './board.routes';
import { masterRoutes } from './master.routes';
import { orderRoutes } from './order.routes';
import { attachmentRoutes, publicAttachmentRoutes } from './attachment.routes';
import { notificationRoutes } from './notification.routes';
import { syncRoutes } from './sync.routes';
import { adminRoutes } from './admin.routes';
import { alertRoutes, recipeRoutes } from './recipe.routes';
import { ingredientCategoryRoutes, ingredientRoutes } from './ingredient.routes';
import { shoppingListRoutes } from './shopping.routes';
import { publicVoiceModelRoutes, voiceModelRoutes } from './voiceModel.routes';
import { youtubeImportRoutes } from './youtubeImport.routes';

/**
 * API v1 routing table.
 *
 * `/auth` mounts before `authenticate` because login and refresh must work without a token.
 * Everything after it is authenticated; the per-route guards then narrow by capability.
 */
export function buildApiRouter(): Router {
  const router = Router();

  router.use(apiRateLimit);
  router.use('/auth', authRoutes());

  // Media bytes are authorised by a signed, expiring URL rather than a bearer header, because an
  // <Image> or audio element cannot send one. Mounted before `authenticate` for that reason.
  router.use('/attachments', publicAttachmentRoutes());

  // Same reasoning as the media bytes: a long background download of the speech model cannot
  // carry a bearer token that may expire mid-transfer, so it authorises by signed URL.
  router.use('/voice-model', publicVoiceModelRoutes());

  // Every route below requires a valid access token.
  router.use(authenticate);

  router.use('/users', userRoutes());
  router.use('/boards', boardRoutes());
  router.use('/orders', orderRoutes());
  router.use('/attachments', attachmentRoutes());
  router.use('/notifications', notificationRoutes());
  router.use('/recipes', recipeRoutes());
  router.use('/youtube-imports', youtubeImportRoutes());
  router.use('/ingredients', ingredientRoutes());
  router.use('/ingredient-categories', ingredientCategoryRoutes());
  router.use('/shopping-lists', shoppingListRoutes());
  router.use('/alerts', alertRoutes());
  router.use('/voice-model', voiceModelRoutes());
  router.use('/sync', syncRoutes());

  // Master data: reads shared by both clients, writes Admin-only (enforced inside).
  router.use('/', masterRoutes());

  // Dashboard, permissions, reports, billing, audit, settings — Admin Portal only.
  router.use('/admin', adminRoutes());

  return router;
}
