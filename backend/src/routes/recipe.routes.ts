import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { AlertController } from '../controllers/AlertController';
import { RecipeController } from '../controllers/RecipeController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { uploadRateLimit } from '../middleware/rateLimit';
import { uploadSingleAlertSound, uploadSingleAudioInMemory } from '../middleware/upload';
import { validate } from '../middleware/validate';
import {
  alertSoundSlotParam,
  alertTypeParam,
  menuItemIdParam,
  pendingAlertsQuerySchema,
  recipeImportAiSchema,
  recipeImportParseSchema,
  recipeListQuerySchema,
  recipeWriteSchema,
  scaledRecipeQuerySchema,
  translateBatchSchema,
  translateTextSchema,
  updateAlertSettingSchema,
} from '../validation/schemas';
import { idParam } from '../validation/common';

/**
 * Recipes.
 *
 * Reads are gated on RECIPE_READ, which every role above Employee holds — the long-press
 * "view recipe" on an order line is available to anyone who can see the order. Writes are
 * Admin-only master data.
 */
export function recipeRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: recipeListQuerySchema }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(RecipeController.list),
  );

  router.get(
    '/:id',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(RecipeController.getById),
  );

  // Every authored variant for a menu item — the Admin Portal's recipe builder.
  router.get(
    '/menu-item/:menuItemId/variants',
    validate({ params: menuItemIdParam }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(RecipeController.listByMenuItem),
  );

  router.get(
    '/menu-item/:menuItemId',
    validate({ params: menuItemIdParam }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(RecipeController.getDefaultByMenuItem),
  );

  // The scaled read is its own route rather than a query flag on the one above, because the
  // response shape differs — quantities are multiplied out and the sync metadata is gone.
  router.get(
    '/menu-item/:menuItemId/scaled',
    validate({ params: menuItemIdParam, query: scaledRecipeQuerySchema }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(RecipeController.getScaled),
  );

  router.put(
    '/',
    validate({ body: recipeWriteSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(RecipeController.upsert),
  );

  router.patch(
    '/:id/default',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(RecipeController.setDefault),
  );

  router.delete(
    '/:id',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(RecipeController.remove),
  );

  // AI-assisted authoring: free text / a photo of a handwritten card / a voice note -> a
  // structured recipe draft the Admin then reviews before saving. The regex-based /parse
  // step needs no external service; /ai and /transcribe call Gemini and fail with a clear
  // message if GEMINI_API_KEY is unset (see backend/src/config, GeminiService).
  router.post(
    '/import/parse',
    validate({ body: recipeImportParseSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(RecipeController.importParse),
  );

  router.post(
    '/import/ai',
    validate({ body: recipeImportAiSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(RecipeController.importAi),
  );

  router.post(
    '/transcribe',
    requireCapability(Capability.RECIPE_WRITE),
    uploadSingleAudioInMemory,
    asyncHandler(RecipeController.transcribe),
  );

  router.post(
    '/translate',
    validate({ body: translateTextSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(RecipeController.translate),
  );

  router.post(
    '/translate/batch',
    validate({ body: translateBatchSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(RecipeController.translateBatch),
  );

  return router;
}

/**
 * Alarm configuration and the per-device schedule.
 *
 * `GET /alerts/pending` is deliberately open to any authenticated user: it returns only the
 * alarms for that caller's own boards and role. Everything else needs ALERT_CONFIG.
 */
export function alertRoutes(): Router {
  const router = Router();

  router.get('/pending', validate({ query: pendingAlertsQuerySchema }), asyncHandler(AlertController.listPending));

  // Readable by everyone: a device needs the sound and repeat policy to fire an alarm
  // correctly, and none of it is sensitive.
  router.get('/settings', asyncHandler(AlertController.listSettings));
  router.get('/sounds', asyncHandler(AlertController.listSounds));
  router.get(
    '/sounds/:slot/file',
    validate({ params: alertSoundSlotParam }),
    asyncHandler(AlertController.downloadSound),
  );

  router.patch(
    '/settings/:alertType',
    validate({ params: alertTypeParam, body: updateAlertSettingSchema }),
    requireCapability(Capability.ALERT_CONFIG),
    asyncHandler(AlertController.updateSetting),
  );

  router.post(
    '/sounds/:slot',
    uploadRateLimit,
    requireCapability(Capability.ALERT_CONFIG),
    validate({ params: alertSoundSlotParam }),
    // Multer runs after the capability check but before the body is otherwise available.
    uploadSingleAlertSound,
    asyncHandler(AlertController.uploadSound),
  );

  return router;
}
