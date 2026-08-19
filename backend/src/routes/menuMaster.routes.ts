import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { MenuMasterController } from '../controllers/MenuMasterController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  assignCounterRouteSchema,
  assignMenuCategorySchema,
  assignMenuItemSchema,
  assignModifierGroupSchema,
  assignPrintingRouteSchema,
  catalogueScopedListQuerySchema,
  createCounterSchema,
  createItemGroupSchema,
  createMenuSchema,
  createModifierGroupSchema,
  createModifierSchema,
  createPrintingGroupSchema,
  createScheduleSchema,
  createVariantSchema,
  idParam,
  menuCategoryAssignmentListQuerySchema,
  menuCodeParam,
  menuItemAssignmentListQuerySchema,
  menuItemScheduleBulkSchema,
  menuListQuerySchema,
  menuShiftApplyQuerySchema,
  routableEntityRefSchema,
  updateCounterSchema,
  updateItemGroupSchema,
  updateMenuCategoryAssignmentSchema,
  updateMenuItemAssignmentSchema,
  updateMenuSchema,
  updateModifierGroupSchema,
  updateModifierSchema,
  updatePrintingGroupSchema,
  updateScheduleSchema,
  updateVariantSchema,
  variantCatalogPriceSchema,
} from '../validation/schemas';
import { z } from 'zod';
import { uuid } from '../validation/common';

const menuIdParam = z.object({ menuId: uuid }).strict();
const foodItemIdParam = z.object({ foodItemId: uuid }).strict();
const groupIdParam = z.object({ groupId: uuid }).strict();
const variantIdParam = z.object({ variantId: uuid }).strict();

/**
 * Menu Master: menus, category/item assignments, variants, counters, printing groups,
 * modifiers and schedules. Mounted alongside masterRoutes() in routes/index.ts, sharing its
 * MASTER_READ / MASTER_WRITE gate — the existing Menu Category and Menu Item CRUD stays
 * exactly where it is in master.routes.ts; nothing here replaces it.
 */
export function menuMasterRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.MASTER_READ);
  const write = requireCapability(Capability.MASTER_WRITE);

  /* menus */
  router.get('/menus', read, validate({ query: menuListQuerySchema }), asyncHandler(MenuMasterController.listMenus));
  router.get('/menus/:id', read, validate({ params: idParam }), asyncHandler(MenuMasterController.getMenuById));
  router.post('/menus', write, validate({ body: createMenuSchema }), asyncHandler(MenuMasterController.createMenu));
  router.patch(
    '/menus/:id',
    write,
    validate({ params: idParam, body: updateMenuSchema }),
    asyncHandler(MenuMasterController.updateMenu),
  );
  router.delete('/menus/:id', write, validate({ params: idParam }), asyncHandler(MenuMasterController.deleteMenu));
  router.post(
    '/menus/:id/restore',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.restoreMenu),
  );
  router.post(
    '/menus/:id/publish',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.publishMenu),
  );
  router.post(
    '/menus/:id/unpublish',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.unpublishMenu),
  );

  /** POS / MenuBoard: the resolved tree for one published menu, by its stable code. */
  router.get(
    '/menus/by-code/:code/tree',
    read,
    validate({ params: menuCodeParam }),
    asyncHandler(MenuMasterController.getMenuTree),
  );

  /* menu category assignments */
  router.get(
    '/menus/:menuId/categories',
    read,
    validate({ params: menuIdParam, query: menuCategoryAssignmentListQuerySchema }),
    asyncHandler(MenuMasterController.listMenuCategoryAssignments),
  );
  router.post(
    '/menus/:menuId/categories',
    write,
    validate({ params: menuIdParam, body: assignMenuCategorySchema }),
    asyncHandler(MenuMasterController.assignMenuCategory),
  );
  router.patch(
    '/menu-category-assignments/:id',
    write,
    validate({ params: idParam, body: updateMenuCategoryAssignmentSchema }),
    asyncHandler(MenuMasterController.updateMenuCategoryAssignment),
  );
  router.delete(
    '/menu-category-assignments/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.removeMenuCategoryAssignment),
  );

  /* menu item assignments — assigning an EXISTING food item (menu_items row) to a menu */
  router.get(
    '/menu-item-assignments',
    read,
    validate({ query: menuItemAssignmentListQuerySchema }),
    asyncHandler(MenuMasterController.listMenuItemAssignments),
  );
  router.get(
    '/menu-item-assignments/:id',
    read,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.getMenuItemAssignmentById),
  );
  router.post(
    '/menus/:menuId/items',
    write,
    validate({ params: menuIdParam, body: assignMenuItemSchema }),
    asyncHandler(MenuMasterController.assignMenuItem),
  );
  router.patch(
    '/menu-item-assignments/:id',
    write,
    validate({ params: idParam, body: updateMenuItemAssignmentSchema }),
    asyncHandler(MenuMasterController.updateMenuItemAssignment),
  );
  router.delete(
    '/menu-item-assignments/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.removeMenuItemAssignment),
  );

  /* menu item variants — belong to the Food Item Master (menu_items), not any one menu */
  router.get(
    '/menu-items/:foodItemId/variants',
    read,
    validate({ params: foodItemIdParam }),
    asyncHandler(MenuMasterController.listVariants),
  );
  router.post(
    '/menu-items/:foodItemId/variants',
    write,
    validate({ params: foodItemIdParam, body: createVariantSchema }),
    asyncHandler(MenuMasterController.createVariant),
  );
  router.patch(
    '/menu-item-variants/:id',
    write,
    validate({ params: idParam, body: updateVariantSchema }),
    asyncHandler(MenuMasterController.updateVariant),
  );
  router.delete(
    '/menu-item-variants/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.removeVariant),
  );

  /* counters */
  router.get('/counters', read, validate({ query: menuListQuerySchema }), asyncHandler(MenuMasterController.listCounters));
  router.post(
    '/counters',
    write,
    validate({ body: createCounterSchema }),
    asyncHandler(MenuMasterController.createCounter),
  );
  router.patch(
    '/counters/:id',
    write,
    validate({ params: idParam, body: updateCounterSchema }),
    asyncHandler(MenuMasterController.updateCounter),
  );
  router.delete(
    '/counters/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.deleteCounter),
  );
  router.get(
    '/counter-routes',
    read,
    validate({ query: routableEntityRefSchema }),
    asyncHandler(MenuMasterController.listCounterRoutes),
  );
  router.post(
    '/counter-routes',
    write,
    validate({ body: assignCounterRouteSchema }),
    asyncHandler(MenuMasterController.assignCounterRoute),
  );
  router.delete(
    '/counter-routes/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.removeCounterRoute),
  );

  /* item groups */
  router.get('/item-groups', read, validate({ query: catalogueScopedListQuerySchema }), asyncHandler(MenuMasterController.listItemGroups));
  router.post(
    '/item-groups',
    write,
    validate({ body: createItemGroupSchema }),
    asyncHandler(MenuMasterController.createItemGroup),
  );
  router.patch(
    '/item-groups/:id',
    write,
    validate({ params: idParam, body: updateItemGroupSchema }),
    asyncHandler(MenuMasterController.updateItemGroup),
  );
  router.delete(
    '/item-groups/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.deleteItemGroup),
  );
  /* food item schedules */
  router.get(
    '/menu-items/:foodItemId/schedule',
    read,
    validate({ params: foodItemIdParam }),
    asyncHandler(MenuMasterController.getMenuItemSchedule),
  );
  router.put(
    '/menu-items/:foodItemId/schedule',
    write,
    validate({ params: foodItemIdParam, body: menuItemScheduleBulkSchema }),
    asyncHandler(MenuMasterController.setMenuItemSchedule),
  );

  /* variant catalogue pricing */
  router.get(
    '/menu-item-variants/:variantId/catalog-prices',
    read,
    validate({ params: variantIdParam }),
    asyncHandler(MenuMasterController.listVariantCatalogPrices),
  );
  router.put(
    '/menu-item-variants/:variantId/catalog-prices',
    write,
    validate({ params: variantIdParam, body: variantCatalogPriceSchema }),
    asyncHandler(MenuMasterController.setVariantCatalogPrice),
  );

  /* printing groups */
  router.get(
    '/printing-groups',
    read,
    validate({ query: menuListQuerySchema }),
    asyncHandler(MenuMasterController.listPrintingGroups),
  );
  router.post(
    '/printing-groups',
    write,
    validate({ body: createPrintingGroupSchema }),
    asyncHandler(MenuMasterController.createPrintingGroup),
  );
  router.patch(
    '/printing-groups/:id',
    write,
    validate({ params: idParam, body: updatePrintingGroupSchema }),
    asyncHandler(MenuMasterController.updatePrintingGroup),
  );
  router.delete(
    '/printing-groups/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.deletePrintingGroup),
  );
  router.get(
    '/printing-routes',
    read,
    validate({ query: routableEntityRefSchema }),
    asyncHandler(MenuMasterController.listPrintingRoutes),
  );
  router.post(
    '/printing-routes',
    write,
    validate({ body: assignPrintingRouteSchema }),
    asyncHandler(MenuMasterController.assignPrintingRoute),
  );
  router.delete(
    '/printing-routes/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.removePrintingRoute),
  );

  /* modifiers */
  router.get(
    '/modifier-groups',
    read,
    validate({ query: menuListQuerySchema }),
    asyncHandler(MenuMasterController.listModifierGroups),
  );
  router.post(
    '/modifier-groups',
    write,
    validate({ body: createModifierGroupSchema }),
    asyncHandler(MenuMasterController.createModifierGroup),
  );
  router.patch(
    '/modifier-groups/:id',
    write,
    validate({ params: idParam, body: updateModifierGroupSchema }),
    asyncHandler(MenuMasterController.updateModifierGroup),
  );
  router.delete(
    '/modifier-groups/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.deleteModifierGroup),
  );
  router.post(
    '/modifier-groups/:groupId/modifiers',
    write,
    validate({ params: groupIdParam, body: createModifierSchema }),
    asyncHandler(MenuMasterController.createModifier),
  );
  router.patch(
    '/modifiers/:id',
    write,
    validate({ params: idParam, body: updateModifierSchema }),
    asyncHandler(MenuMasterController.updateModifier),
  );
  router.delete(
    '/modifiers/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.deleteModifier),
  );
  router.get(
    '/modifier-assignments',
    read,
    validate({ query: routableEntityRefSchema }),
    asyncHandler(MenuMasterController.listModifierAssignments),
  );
  router.post(
    '/modifier-assignments',
    write,
    validate({ body: assignModifierGroupSchema }),
    asyncHandler(MenuMasterController.assignModifierGroup),
  );
  router.delete(
    '/modifier-assignments/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.removeModifierAssignment),
  );

  /* menu schedules */
  router.get(
    '/menus/:menuId/schedules',
    read,
    validate({ params: menuIdParam }),
    asyncHandler(MenuMasterController.listSchedules),
  );
  router.post(
    '/menus/:menuId/schedules',
    write,
    validate({ params: menuIdParam, body: createScheduleSchema }),
    asyncHandler(MenuMasterController.createSchedule),
  );
  router.patch(
    '/menu-schedules/:id',
    write,
    validate({ params: idParam, body: updateScheduleSchema }),
    asyncHandler(MenuMasterController.updateSchedule),
  );
  router.delete(
    '/menu-schedules/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuMasterController.removeSchedule),
  );

  /**
   * Forces the morning/evening shift auto-reset now, rather than waiting for the automatic
   * sweep. See MenuShiftSchedulerService — this never marks anything unavailable, only reverses
   * an UNAVAILABLE/SOLD_OUT flag that the new shift's schedule (or, for EVENING, the whole
   * catalogue) says should be back.
   */
  router.post(
    '/menu-shift/apply',
    write,
    validate({ query: menuShiftApplyQuerySchema }),
    asyncHandler(MenuMasterController.applyMenuShiftReset),
  );

  return router;
}
