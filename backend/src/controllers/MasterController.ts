import type { Request, Response } from 'express';
import type {
  ActivityTypeWriteRequest,
  CreateStationRequest,
  MenuCategoryWriteRequest,
  MenuItemWriteRequest,
  UpdateStationRequest,
} from '@menuboard/shared';
import { masterService, type MasterQuery } from '../services/MasterService';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Master data. Reads are open to any authenticated client (Android needs them to render an
 * order); writes require MASTER_WRITE, which Android sessions never hold.
 */
export const MasterController = {
  /* -------------------------------------------------------------- stations */

  async listStations(req: Request, res: Response): Promise<void> {
    paginated(res, await masterService.listStations(req.query as unknown as MasterQuery));
  },

  async getStationById(req: Request, res: Response): Promise<void> {
    ok(res, await masterService.getStationById(req.params.id as string));
  },

  async createStation(req: Request, res: Response): Promise<void> {
    created(
      res,
      await masterService.createStation(req.body as CreateStationRequest, actorFrom(req)),
    );
  },

  async updateStation(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await masterService.updateStation(
        req.params.id as string,
        req.body as UpdateStationRequest,
        actorFrom(req),
      ),
    );
  },

  async deleteStation(req: Request, res: Response): Promise<void> {
    await masterService.deleteStation(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* -------------------------------------------------------- activity types */

  async listActivityTypes(req: Request, res: Response): Promise<void> {
    paginated(res, await masterService.listActivityTypes(req.query as unknown as MasterQuery));
  },

  async createActivityType(req: Request, res: Response): Promise<void> {
    created(
      res,
      await masterService.createActivityType(req.body as ActivityTypeWriteRequest, actorFrom(req)),
    );
  },

  async updateActivityType(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await masterService.updateActivityType(
        req.params.id as string,
        req.body as Partial<ActivityTypeWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteActivityType(req: Request, res: Response): Promise<void> {
    await masterService.deleteActivityType(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------------- menu categories */

  async listMenuCategories(req: Request, res: Response): Promise<void> {
    paginated(res, await masterService.listMenuCategories(req.query as unknown as MasterQuery));
  },

  async createMenuCategory(req: Request, res: Response): Promise<void> {
    created(
      res,
      await masterService.createMenuCategory(req.body as MenuCategoryWriteRequest, actorFrom(req)),
    );
  },

  async updateMenuCategory(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await masterService.updateMenuCategory(
        req.params.id as string,
        req.body as Partial<MenuCategoryWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteMenuCategory(req: Request, res: Response): Promise<void> {
    await masterService.deleteMenuCategory(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------------------ menu items */

  async listMenuItems(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await masterService.listMenuItems(
        req.query as unknown as MasterQuery & { categoryId?: string },
      ),
    );
  },

  async createMenuItem(req: Request, res: Response): Promise<void> {
    created(
      res,
      await masterService.createMenuItem(req.body as MenuItemWriteRequest, actorFrom(req)),
    );
  },

  async updateMenuItem(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await masterService.updateMenuItem(
        req.params.id as string,
        req.body as Partial<MenuItemWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteMenuItem(req: Request, res: Response): Promise<void> {
    await masterService.deleteMenuItem(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
