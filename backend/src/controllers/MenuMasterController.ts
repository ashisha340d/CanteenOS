import type { Request, Response } from 'express';
import type {
  AvailabilityStatus,
  CounterRouteWriteRequest,
  CounterWriteRequest,
  ItemGroupAssignmentWriteRequest,
  ItemGroupWriteRequest,
  MenuCategoryAssignmentWriteRequest,
  MenuItemAssignmentWriteRequest,
  MenuItemScheduleBulkWriteRequest,
  MenuItemVariantCatalogPriceWriteRequest,
  MenuItemVariantWriteRequest,
  MenuScheduleWriteRequest,
  MenuWriteRequest,
  ModifierAssignmentWriteRequest,
  ModifierGroupWriteRequest,
  ModifierWriteRequest,
  PrintingGroupWriteRequest,
  PrintingRouteWriteRequest,
  RoutableEntityType,
} from '@menuboard/shared';
import { menuMasterService, type MenuMasterQuery } from '../services/MenuMasterService';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Menu Master: menus, category/item assignments, variants, counters, printing groups,
 * modifiers and schedules. Reads share MASTER_READ with the existing masters (stations,
 * activity types, menu categories, menu items); writes share MASTER_WRITE, which no Android
 * session holds — see master.routes.ts for the identical reasoning applied here.
 */
export const MenuMasterController = {
  /* ---------------------------------------------------------------------------- menus */

  async listMenus(req: Request, res: Response): Promise<void> {
    paginated(res, await menuMasterService.listMenus(req.query as unknown as MenuMasterQuery));
  },

  async getMenuById(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.getMenuById(req.params.id as string));
  },

  async createMenu(req: Request, res: Response): Promise<void> {
    created(res, await menuMasterService.createMenu(req.body as MenuWriteRequest, actorFrom(req)));
  },

  async updateMenu(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateMenu(
        req.params.id as string,
        req.body as Partial<MenuWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteMenu(req: Request, res: Response): Promise<void> {
    await menuMasterService.deleteMenu(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async restoreMenu(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.restoreMenu(req.params.id as string, actorFrom(req)));
  },

  async publishMenu(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.publishMenu(req.params.id as string, actorFrom(req)));
  },

  async unpublishMenu(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.unpublishMenu(req.params.id as string, actorFrom(req)));
  },

  /** POS / MenuBoard: the fully resolved category -> item -> variant tree for one menu. */
  async getMenuTree(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.getMenuTree(req.params.code as string, actorFrom(req).userId));
  },

  /* ------------------------------------------------------- menu category assignments */

  async listMenuCategoryAssignments(req: Request, res: Response): Promise<void> {
    const includeInactive = (req.query as { includeInactive?: boolean }).includeInactive === true;
    ok(
      res,
      await menuMasterService.listMenuCategoryAssignments(req.params.menuId as string, includeInactive),
    );
  },

  async assignMenuCategory(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.assignCategoryToMenu(
        req.params.menuId as string,
        req.body as MenuCategoryAssignmentWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateMenuCategoryAssignment(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateMenuCategoryAssignment(
        req.params.id as string,
        req.body as Partial<MenuCategoryAssignmentWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeMenuCategoryAssignment(req: Request, res: Response): Promise<void> {
    await menuMasterService.removeMenuCategoryAssignment(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------------------ menu item assignments */

  async listMenuItemAssignments(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await menuMasterService.listMenuItemAssignments(
        req.query as unknown as MenuMasterQuery & {
          menuId?: string;
          categoryAssignmentId?: string;
          availability?: AvailabilityStatus;
        },
      ),
    );
  },

  async getMenuItemAssignmentById(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.getMenuItemAssignmentById(req.params.id as string));
  },

  async assignMenuItem(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.assignFoodItemToMenu(
        req.params.menuId as string,
        req.body as MenuItemAssignmentWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateMenuItemAssignment(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateMenuItemAssignment(
        req.params.id as string,
        req.body as Partial<MenuItemAssignmentWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeMenuItemAssignment(req: Request, res: Response): Promise<void> {
    await menuMasterService.removeMenuItemAssignment(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------- menu item variants (Food Item Master) */

  async listVariants(req: Request, res: Response): Promise<void> {
    const includeInactive = (req.query as { includeInactive?: boolean }).includeInactive === true;
    ok(res, await menuMasterService.listVariants(req.params.foodItemId as string, includeInactive));
  },

  async createVariant(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.createVariant(
        req.params.foodItemId as string,
        req.body as MenuItemVariantWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateVariant(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateVariant(
        req.params.id as string,
        req.body as Partial<MenuItemVariantWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeVariant(req: Request, res: Response): Promise<void> {
    await menuMasterService.removeVariant(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* -------------------------------------------------------------------------- counters */

  async listCounters(req: Request, res: Response): Promise<void> {
    paginated(res, await menuMasterService.listCounters(req.query as unknown as MenuMasterQuery));
  },

  async createCounter(req: Request, res: Response): Promise<void> {
    created(res, await menuMasterService.createCounter(req.body as CounterWriteRequest, actorFrom(req)));
  },

  async updateCounter(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateCounter(
        req.params.id as string,
        req.body as Partial<CounterWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteCounter(req: Request, res: Response): Promise<void> {
    await menuMasterService.deleteCounter(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listCounterRoutes(req: Request, res: Response): Promise<void> {
    const { entityType, entityId } = req.query as unknown as {
      entityType: RoutableEntityType;
      entityId: string;
    };
    ok(res, await menuMasterService.listCounterRoutes(entityType, entityId));
  },

  async assignCounterRoute(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.assignCounterRoute(req.body as CounterRouteWriteRequest, actorFrom(req)),
    );
  },

  async removeCounterRoute(req: Request, res: Response): Promise<void> {
    await menuMasterService.removeCounterRoute(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------------------------- item groups */

  async listItemGroups(req: Request, res: Response): Promise<void> {
    paginated(res, await menuMasterService.listItemGroups(req.query as unknown as MenuMasterQuery));
  },

  async createItemGroup(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.createItemGroup(req.body as ItemGroupWriteRequest, actorFrom(req)),
    );
  },

  async updateItemGroup(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateItemGroup(
        req.params.id as string,
        req.body as Partial<ItemGroupWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteItemGroup(req: Request, res: Response): Promise<void> {
    await menuMasterService.deleteItemGroup(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listItemGroupsForFoodItem(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.listItemGroupsForFoodItem(req.params.foodItemId as string));
  },

  async assignItemGroup(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.assignItemGroup(
        req.body as ItemGroupAssignmentWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async removeItemGroupAssignment(req: Request, res: Response): Promise<void> {
    await menuMasterService.removeItemGroupAssignment(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* -------------------------------------------------------------- food item schedules */

  async getMenuItemSchedule(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.getMenuItemSchedule(req.params.foodItemId as string));
  },

  async setMenuItemSchedule(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.setMenuItemSchedule(
        req.params.foodItemId as string,
        req.body as MenuItemScheduleBulkWriteRequest,
        actorFrom(req),
      ),
    );
  },

  /* ------------------------------------------------------ variant catalogue pricing */

  async listVariantCatalogPrices(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.listVariantCatalogPrices(req.params.variantId as string));
  },

  async setVariantCatalogPrice(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.setVariantCatalogPrice(
        req.params.variantId as string,
        req.body as MenuItemVariantCatalogPriceWriteRequest,
        actorFrom(req),
      ),
    );
  },

  /* -------------------------------------------------------------------- printing groups */

  async listPrintingGroups(req: Request, res: Response): Promise<void> {
    paginated(res, await menuMasterService.listPrintingGroups(req.query as unknown as MenuMasterQuery));
  },

  async createPrintingGroup(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.createPrintingGroup(req.body as PrintingGroupWriteRequest, actorFrom(req)),
    );
  },

  async updatePrintingGroup(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updatePrintingGroup(
        req.params.id as string,
        req.body as Partial<PrintingGroupWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deletePrintingGroup(req: Request, res: Response): Promise<void> {
    await menuMasterService.deletePrintingGroup(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listPrintingRoutes(req: Request, res: Response): Promise<void> {
    const { entityType, entityId } = req.query as unknown as {
      entityType: RoutableEntityType;
      entityId: string;
    };
    ok(res, await menuMasterService.listPrintingRoutes(entityType, entityId));
  },

  async assignPrintingRoute(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.assignPrintingRoute(req.body as PrintingRouteWriteRequest, actorFrom(req)),
    );
  },

  async removePrintingRoute(req: Request, res: Response): Promise<void> {
    await menuMasterService.removePrintingRoute(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------------------------------- modifiers */

  async listModifierGroups(req: Request, res: Response): Promise<void> {
    paginated(res, await menuMasterService.listModifierGroups(req.query as unknown as MenuMasterQuery));
  },

  async createModifierGroup(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.createModifierGroup(req.body as ModifierGroupWriteRequest, actorFrom(req)),
    );
  },

  async updateModifierGroup(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateModifierGroup(
        req.params.id as string,
        req.body as Partial<ModifierGroupWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteModifierGroup(req: Request, res: Response): Promise<void> {
    await menuMasterService.deleteModifierGroup(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async createModifier(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.createModifier(
        req.params.groupId as string,
        req.body as ModifierWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateModifier(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateModifier(
        req.params.id as string,
        req.body as Partial<ModifierWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteModifier(req: Request, res: Response): Promise<void> {
    await menuMasterService.deleteModifier(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listModifierAssignments(req: Request, res: Response): Promise<void> {
    const { entityType, entityId } = req.query as unknown as {
      entityType: RoutableEntityType;
      entityId: string;
    };
    ok(res, await menuMasterService.listModifierAssignments(entityType, entityId));
  },

  async assignModifierGroup(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.assignModifierGroup(
        req.body as ModifierAssignmentWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async removeModifierAssignment(req: Request, res: Response): Promise<void> {
    await menuMasterService.removeModifierAssignment(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* --------------------------------------------------------------------- menu schedules */

  async listSchedules(req: Request, res: Response): Promise<void> {
    ok(res, await menuMasterService.listSchedules(req.params.menuId as string));
  },

  async createSchedule(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuMasterService.createSchedule(
        req.params.menuId as string,
        req.body as MenuScheduleWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateSchedule(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuMasterService.updateSchedule(
        req.params.id as string,
        req.body as Partial<MenuScheduleWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeSchedule(req: Request, res: Response): Promise<void> {
    await menuMasterService.removeSchedule(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
