import type { Request, Response } from 'express';
import type { IngredientCategoryWriteRequest, IngredientWriteRequest } from '@menuboard/shared';
import { ingredientService, type MasterQuery } from '../services/IngredientService';
import { translateText } from '../services/TranslateService';
import { ValidationError } from '../utils/errors';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * The recipe-only ingredient master. Reads are open to any authenticated client (a device
 * needs ingredient names to render a cached recipe); writes require RECIPE_WRITE, same gate
 * as the recipes that reference this master.
 */
export const IngredientController = {
  /* ------------------------------------------------------------- categories */

  async listCategories(req: Request, res: Response): Promise<void> {
    paginated(res, await ingredientService.listCategories(req.query as unknown as MasterQuery));
  },

  async createCategory(req: Request, res: Response): Promise<void> {
    created(
      res,
      await ingredientService.createCategory(
        req.body as IngredientCategoryWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateCategory(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await ingredientService.updateCategory(
        req.params.id as string,
        req.body as Partial<IngredientCategoryWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async deleteCategory(req: Request, res: Response): Promise<void> {
    await ingredientService.deleteCategory(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------------------- ingredients */

  async list(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await ingredientService.list(req.query as unknown as MasterQuery & { categoryId?: string }),
    );
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await ingredientService.getById(req.params.id as string));
  },

  async listUnits(_req: Request, res: Response): Promise<void> {
    ok(res, await ingredientService.distinctUnits());
  },

  async create(req: Request, res: Response): Promise<void> {
    created(res, await ingredientService.create(req.body as IngredientWriteRequest, actorFrom(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await ingredientService.update(
        req.params.id as string,
        req.body as Partial<IngredientWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async remove(req: Request, res: Response): Promise<void> {
    await ingredientService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async translate(req: Request, res: Response): Promise<void> {
    const { text, target } = req.body as { text?: string; target?: string };
    if (!text?.trim()) throw new ValidationError('text is required');
    try {
      const translated = await translateText(text, target || 'hi');
      ok(res, { translated });
    } catch (err) {
      throw new ValidationError(
        `Auto-translate is unavailable right now (${(err as Error).message}). Enter the Hindi name manually.`,
      );
    }
  },
};
