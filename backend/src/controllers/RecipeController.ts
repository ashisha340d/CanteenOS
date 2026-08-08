import type { Request, Response } from 'express';
import type { MasterStatus, RecipeWriteRequest } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { ingredientRepository } from '../repositories/IngredientRepository';
import { transcribeAudio } from '../services/GeminiService';
import {
  parseRecipeText,
  resolveRecipeWithAI,
  type ParsedRecipe,
  type UnresolvedItem,
} from '../services/RecipeParserService';
import { recipeService } from '../services/RecipeService';
import { translateBatch, translateText } from '../services/TranslateService';
import { ValidationError } from '../utils/errors';
import { created, noContent, ok } from '../utils/http';
import { actorFrom } from './context';

async function knownIngredientsForParser() {
  const { rows } = await ingredientRepository.list(getPool(), { limit: 1000, offset: 0 });
  return rows.map((row) => ({ id: row.id, name: row.name, nameHi: row.name_hi }));
}

export const RecipeController = {
  async list(req: Request, res: Response): Promise<void> {
    const { menuItemId, status, q } = req.query as { menuItemId?: string; status?: string; q?: string };
    ok(
      res,
      await recipeService.list({
        ...(menuItemId !== undefined ? { menuItemId } : {}),
        ...(status !== undefined ? { status: status as MasterStatus } : {}),
        ...(q !== undefined ? { search: q } : {}),
      }),
    );
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await recipeService.getById(req.params.id as string));
  },

  /** Every authored variant for a menu item — the Admin Portal's recipe builder. */
  async listByMenuItem(req: Request, res: Response): Promise<void> {
    ok(res, await recipeService.listByMenuItemId(req.params.menuItemId as string));
  },

  /** The default variant — what the long-press "view recipe" resolves to. */
  async getDefaultByMenuItem(req: Request, res: Response): Promise<void> {
    ok(res, await recipeService.getDefaultByMenuItemId(req.params.menuItemId as string));
  },

  /** The long-press view — ingredients already multiplied out for the serving count asked for. */
  async getScaled(req: Request, res: Response): Promise<void> {
    const { pax } = req.query as unknown as { pax: number };
    ok(res, await recipeService.getScaled(req.params.menuItemId as string, pax));
  },

  async upsert(req: Request, res: Response): Promise<void> {
    created(res, await recipeService.upsert(req.body as RecipeWriteRequest, actorFrom(req)));
  },

  async setDefault(req: Request, res: Response): Promise<void> {
    ok(res, await recipeService.setDefault(req.params.id as string, actorFrom(req)));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await recipeService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------------------ AI-assisted import */

  /** Rule-based first pass — no AI dependency, works even without GEMINI_API_KEY. */
  async importParse(req: Request, res: Response): Promise<void> {
    const { rawText } = req.body as { rawText?: string };
    if (!rawText?.trim()) throw new ValidationError('rawText is required');
    const known = await knownIngredientsForParser();
    ok(res, parseRecipeText(rawText, known));
  },

  /** Asks Gemini to resolve whichever ingredients the regex pass could not match. */
  async importAi(req: Request, res: Response): Promise<void> {
    const { rawText, draft, unresolved } = req.body as {
      rawText?: string;
      draft?: unknown;
      unresolved?: unknown[];
    };
    if (!rawText?.trim()) throw new ValidationError('rawText is required');
    if (!draft || typeof draft !== 'object') throw new ValidationError('draft is required');

    const known = await knownIngredientsForParser();
    const resolved = await resolveRecipeWithAI(
      rawText,
      draft as ParsedRecipe,
      (unresolved ?? []) as UnresolvedItem[],
      known,
    );
    ok(res, resolved);
  },

  async transcribe(req: Request, res: Response): Promise<void> {
    if (!req.file) throw new ValidationError('Audio file is required');
    const transcript = await transcribeAudio(req.file.buffer, req.file.mimetype);
    ok(res, { transcript });
  },

  async translate(req: Request, res: Response): Promise<void> {
    const { text, target } = req.body as { text?: string; target?: string };
    if (!text?.trim()) throw new ValidationError('text is required');
    try {
      const translated = await translateText(text, target || 'hi');
      ok(res, { translated });
    } catch (err) {
      throw new ValidationError(
        `Auto-translate is unavailable right now (${(err as Error).message}). Enter the Hindi text manually.`,
      );
    }
  },

  async translateBatch(req: Request, res: Response): Promise<void> {
    const { texts, target } = req.body as { texts: string[]; target?: string };
    try {
      const translated = await translateBatch(texts, target || 'hi');
      ok(res, { translated });
    } catch (err) {
      throw new ValidationError(
        `Auto-translate is unavailable right now (${(err as Error).message}). Enter the Hindi text manually.`,
      );
    }
  },
};
