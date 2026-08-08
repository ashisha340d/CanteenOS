import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { IngredientController } from '../controllers/IngredientController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { idParam } from '../validation/common';
import {
  createIngredientCategorySchema,
  createIngredientSchema,
  ingredientCategoryListQuerySchema,
  ingredientListQuerySchema,
  translateTextSchema,
  updateIngredientCategorySchema,
  updateIngredientSchema,
} from '../validation/schemas';

/**
 * The recipe-only ingredient master. Reads sit alongside RECIPE_READ (a cached recipe on a
 * device needs ingredient names to render); writes are gated the same as the recipes that
 * reference this table, RECIPE_WRITE.
 */
export function ingredientRoutes(): Router {
  const router = Router();

  router.get(
    '/units',
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(IngredientController.listUnits),
  );

  router.get(
    '/',
    validate({ query: ingredientListQuerySchema }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(IngredientController.list),
  );

  router.post(
    '/',
    validate({ body: createIngredientSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(IngredientController.create),
  );

  router.post(
    '/translate',
    validate({ body: translateTextSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(IngredientController.translate),
  );

  router.get(
    '/:id',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(IngredientController.getById),
  );

  router.patch(
    '/:id',
    validate({ params: idParam, body: updateIngredientSchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(IngredientController.update),
  );

  router.delete(
    '/:id',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(IngredientController.remove),
  );

  return router;
}

export function ingredientCategoryRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: ingredientCategoryListQuerySchema }),
    requireCapability(Capability.RECIPE_READ),
    asyncHandler(IngredientController.listCategories),
  );

  router.post(
    '/',
    validate({ body: createIngredientCategorySchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(IngredientController.createCategory),
  );

  router.patch(
    '/:id',
    validate({ params: idParam, body: updateIngredientCategorySchema }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(IngredientController.updateCategory),
  );

  router.delete(
    '/:id',
    validate({ params: idParam }),
    requireCapability(Capability.RECIPE_WRITE),
    asyncHandler(IngredientController.deleteCategory),
  );

  return router;
}
