import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { MasterController } from '../controllers/MasterController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  catalogueScopedListQuerySchema,
  createActivityTypeSchema,
  createMenuCategorySchema,
  createMenuItemSchema,
  createStationSchema,
  idParam,
  masterListQuerySchema,
  menuItemListQuerySchema,
  stationListQuerySchema,
  updateActivityTypeSchema,
  updateMenuCategorySchema,
  updateMenuItemSchema,
  updateStationSchema,
} from '../validation/schemas';

/**
 * Master data.
 *
 * Reads require only MASTER_READ, which every role holds — Android needs stations, activities
 * and the menu to render an order. Writes require MASTER_WRITE, which no Android session holds,
 * so master maintenance is structurally confined to the Admin Portal.
 */
export function masterRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.MASTER_READ);
  const write = requireCapability(Capability.MASTER_WRITE);

  /* stations */
  router.get(
    '/stations',
    read,
    validate({ query: stationListQuerySchema }),
    asyncHandler(MasterController.listStations),
  );
  router.get(
    '/stations/:id',
    read,
    validate({ params: idParam }),
    asyncHandler(MasterController.getStationById),
  );
  router.post(
    '/stations',
    write,
    validate({ body: createStationSchema }),
    asyncHandler(MasterController.createStation),
  );
  router.patch(
    '/stations/:id',
    write,
    validate({ params: idParam, body: updateStationSchema }),
    asyncHandler(MasterController.updateStation),
  );
  router.delete(
    '/stations/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MasterController.deleteStation),
  );

  /* activity types */
  router.get(
    '/activity-types',
    read,
    validate({ query: masterListQuerySchema }),
    asyncHandler(MasterController.listActivityTypes),
  );
  router.post(
    '/activity-types',
    write,
    validate({ body: createActivityTypeSchema }),
    asyncHandler(MasterController.createActivityType),
  );
  router.patch(
    '/activity-types/:id',
    write,
    validate({ params: idParam, body: updateActivityTypeSchema }),
    asyncHandler(MasterController.updateActivityType),
  );
  router.delete(
    '/activity-types/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MasterController.deleteActivityType),
  );

  /* menu categories */
  router.get(
    '/menu-categories',
    read,
    validate({ query: catalogueScopedListQuerySchema }),
    asyncHandler(MasterController.listMenuCategories),
  );
  router.post(
    '/menu-categories',
    write,
    validate({ body: createMenuCategorySchema }),
    asyncHandler(MasterController.createMenuCategory),
  );
  router.patch(
    '/menu-categories/:id',
    write,
    validate({ params: idParam, body: updateMenuCategorySchema }),
    asyncHandler(MasterController.updateMenuCategory),
  );
  router.delete(
    '/menu-categories/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MasterController.deleteMenuCategory),
  );

  /* menu items */
  router.get(
    '/menu-items',
    read,
    validate({ query: menuItemListQuerySchema }),
    asyncHandler(MasterController.listMenuItems),
  );
  router.get(
    '/menu-items/:id',
    read,
    validate({ params: idParam }),
    asyncHandler(MasterController.getMenuItemById),
  );
  router.post(
    '/menu-items',
    write,
    validate({ body: createMenuItemSchema }),
    asyncHandler(MasterController.createMenuItem),
  );
  router.patch(
    '/menu-items/:id',
    write,
    validate({ params: idParam, body: updateMenuItemSchema }),
    asyncHandler(MasterController.updateMenuItem),
  );
  router.delete(
    '/menu-items/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MasterController.deleteMenuItem),
  );

  return router;
}
