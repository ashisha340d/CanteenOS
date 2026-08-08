import {
  MasterStatus,
  RecipeIngredientScaling,
  scaleRecipe,
  type RecipeDto,
  type RecipeWriteRequest,
  type ScaledRecipeDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapRecipe } from '../models/mappers';
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from '../models/rows';
import { ingredientRepository } from '../repositories/IngredientRepository';
import { menuItemRepository } from '../repositories/MasterRepository';
import { recipeRepository } from '../repositories/RecipeRepository';
import { NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * Recipes: the ingredient-and-steps breakdown behind a menu item.
 *
 * A menu item may have several authored variants (e.g. three kinds of Roti); exactly one is
 * `isDefault`, and that is the variant the shopping-list roll-up scales against. Quantities
 * are authored once for `basePax` servings and never rewritten — everything a user sees, the
 * long-press sheet on an order line included, comes from {@link scaleRecipe}, so a pax
 * change on an order is a read-time multiplication rather than a write that could drift out
 * of step with the recipe it came from.
 */
export class RecipeService {
  async list(query: { menuItemId?: string; status?: MasterStatus; search?: string } = {}): Promise<RecipeDto[]> {
    const pool = getPool();
    const rows = await recipeRepository.list(pool, query);
    return this.withChildren(pool, rows);
  }

  async getById(id: string): Promise<RecipeDto> {
    const pool = getPool();
    const row = await recipeRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Recipe', id);
    const [recipe] = await this.withChildren(pool, [row]);
    if (recipe === undefined) throw new NotFoundError('Recipe', id);
    return recipe;
  }

  async listByMenuItemId(menuItemId: string): Promise<RecipeDto[]> {
    const pool = getPool();
    const rows = await recipeRepository.listByMenuItemId(pool, menuItemId);
    return this.withChildren(pool, rows);
  }

  /** The long-press view's source recipe: a menu item's default variant. */
  async getDefaultByMenuItemId(menuItemId: string): Promise<RecipeDto> {
    const pool = getPool();
    const row = await recipeRepository.findDefaultByMenuItemId(pool, menuItemId);
    if (row === null) throw new NotFoundError('Recipe for menu item', menuItemId);
    const [recipe] = await this.withChildren(pool, [row]);
    if (recipe === undefined) throw new NotFoundError('Recipe for menu item', menuItemId);
    return recipe;
  }

  /**
   * The long-press view: a menu item's default recipe with every quantity multiplied out
   * for the serving count actually ordered.
   */
  async getScaled(menuItemId: string, pax: number): Promise<ScaledRecipeDto> {
    if (!Number.isFinite(pax) || pax <= 0) {
      throw new ValidationError('A serving count is required', [
        { path: 'pax', message: 'Enter a pax count greater than zero' },
      ]);
    }
    const recipe = await this.getDefaultByMenuItemId(menuItemId);
    return scaleRecipe(recipe, pax);
  }

  async upsert(input: RecipeWriteRequest, actor: AuditActor): Promise<RecipeDto> {
    if (input.basePax <= 0) {
      throw new ValidationError('The base serving count must be positive', [
        { path: 'basePax', message: 'A recipe has to be stated for at least one serving' },
      ]);
    }
    if (input.ingredients.length === 0) {
      throw new ValidationError('A recipe needs at least one ingredient', [
        { path: 'ingredients', message: 'Add at least one ingredient' },
      ]);
    }

    const recipeId = await withTransaction(async (connection) => {
      const menuItem = await menuItemRepository.findById(connection, input.menuItemId);
      if (menuItem === null) throw new NotFoundError('Menu item', input.menuItemId);

      const ingredientIds = [...new Set(input.ingredients.map((i) => i.ingredientId))];
      const knownIngredients = await ingredientRepository.findByIds(connection, ingredientIds);
      if (knownIngredients.length !== ingredientIds.length) {
        const known = new Set(knownIngredients.map((i) => i.id));
        const missing = ingredientIds.filter((id) => !known.has(id));
        throw new ValidationError('One or more ingredients could not be found', [
          { path: 'ingredients', message: `Unknown ingredient id(s): ${missing.join(', ')}` },
        ]);
      }

      const id = input.id ?? newId();
      const isNewRecipe = input.id === undefined || (await recipeRepository.findById(connection, input.id)) === null;
      // The first recipe authored for an item is its default by construction — there is
      // nothing else for the shopping list to scale against yet.
      const existingVariants = await recipeRepository.listByMenuItemId(connection, input.menuItemId);
      const isDefault = input.isDefault ?? (isNewRecipe && existingVariants.length === 0);

      if (isDefault) {
        await recipeRepository.clearDefault(connection, input.menuItemId, id);
      }

      const row = await recipeRepository.upsert(connection, {
        id,
        menuItemId: input.menuItemId,
        basePax: input.basePax,
        isDefault,
        prepTimeMin: input.prepTimeMin ?? null,
        cookTimeMin: input.cookTimeMin ?? null,
        teamSize: input.teamSize ?? null,
        difficulty: input.difficulty ?? null,
        descriptionEn: input.descriptionEn ?? null,
        descriptionHi: input.descriptionHi ?? null,
        methodEn: input.methodEn ?? null,
        methodHi: input.methodHi ?? null,
        yieldNote: input.yieldNote ?? null,
        chefNotes: input.chefNotes ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId ?? null,
      });

      await recipeRepository.replaceIngredients(
        connection,
        row.id,
        input.ingredients.map((ingredient, index) => ({
          id: ingredient.id ?? newId(),
          ingredientId: ingredient.ingredientId,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
          scaling: ingredient.scaling ?? RecipeIngredientScaling.LINEAR,
          notes: ingredient.notes ?? null,
          sortOrder: ingredient.sortOrder ?? index,
        })),
      );

      if (input.steps !== undefined) {
        await recipeRepository.replaceSteps(
          connection,
          row.id,
          input.steps.map((step, index) => ({
            id: step.id ?? newId(),
            stepNo: index + 1,
            textEn: step.textEn,
            textHi: step.textHi ?? null,
            durationMin: step.durationMin ?? null,
            imagePath: step.imagePath ?? null,
          })),
        );
      }

      await auditService.record(connection, actor, {
        action: isNewRecipe ? AuditAction.MASTER_CREATED : AuditAction.MASTER_UPDATED,
        entityType: 'recipe',
        entityId: row.id,
        after: {
          menuItemId: input.menuItemId,
          basePax: input.basePax,
          isDefault,
          ingredientCount: input.ingredients.length,
        },
      });

      return row.id;
    });

    const pool = getPool();
    const row = await recipeRepository.findById(pool, recipeId);
    if (row === null) throw new NotFoundError('Recipe', recipeId);
    const [recipe] = await this.withChildren(pool, [row]);
    if (recipe === undefined) throw new NotFoundError('Recipe', recipeId);
    return recipe;
  }

  /** Promotes a variant to be the default for its menu item, demoting whichever one was. */
  async setDefault(id: string, actor: AuditActor): Promise<RecipeDto> {
    await withTransaction(async (connection) => {
      const row = await recipeRepository.findById(connection, id);
      if (row === null) throw new NotFoundError('Recipe', id);
      if (row.is_default === 1) return;

      await recipeRepository.clearDefault(connection, row.menu_item_id, id);
      await recipeRepository.upsert(connection, {
        id: row.id,
        menuItemId: row.menu_item_id,
        basePax: Number(row.base_pax),
        isDefault: true,
        prepTimeMin: row.prep_time_min,
        cookTimeMin: row.cook_time_min,
        teamSize: row.team_size,
        difficulty: row.difficulty,
        descriptionEn: row.description_en,
        descriptionHi: row.description_hi,
        methodEn: row.method_en,
        methodHi: row.method_hi,
        yieldNote: row.yield_note,
        chefNotes: row.chef_notes,
        status: row.status,
        createdBy: row.created_by,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'recipe',
        entityId: id,
        after: { isDefault: true },
      });
    });
    return this.getById(id);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await recipeRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Recipe', id);
      const removed = await recipeRepository.softDelete(connection, id);
      if (!removed) throw new NotFoundError('Recipe', id);

      // Promote the oldest remaining variant so the menu item never silently loses a
      // default that ShoppingListService depends on.
      if (before.is_default === 1) {
        const remaining = await recipeRepository.listByMenuItemId(connection, before.menu_item_id);
        const next = remaining[0];
        if (next !== undefined) {
          await recipeRepository.clearDefault(connection, before.menu_item_id, next.id);
          await recipeRepository.upsert(connection, {
            id: next.id,
            menuItemId: next.menu_item_id,
            basePax: Number(next.base_pax),
            isDefault: true,
            prepTimeMin: next.prep_time_min,
            cookTimeMin: next.cook_time_min,
            teamSize: next.team_size,
            difficulty: next.difficulty,
            descriptionEn: next.description_en,
            descriptionHi: next.description_hi,
            methodEn: next.method_en,
            methodHi: next.method_hi,
            yieldNote: next.yield_note,
            chefNotes: next.chef_notes,
            status: next.status,
            createdBy: next.created_by,
          });
        }
      }

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'recipe',
        entityId: id,
      });
    });
  }

  /** One extra pair of queries for the whole set rather than one per recipe. */
  private async withChildren(db: Db, rows: RecipeRow[]): Promise<RecipeDto[]> {
    if (rows.length === 0) return [];
    const [ingredients, steps] = await Promise.all([
      recipeRepository.listIngredientsForRecipes(db, rows.map((row) => row.id)),
      recipeRepository.listStepsForRecipes(db, rows.map((row) => row.id)),
    ]);
    const ingredientsByRecipe = new Map<string, RecipeIngredientRow[]>();
    for (const ingredient of ingredients) {
      const list = ingredientsByRecipe.get(ingredient.recipe_id) ?? [];
      list.push(ingredient);
      ingredientsByRecipe.set(ingredient.recipe_id, list);
    }
    const stepsByRecipe = new Map<string, RecipeStepRow[]>();
    for (const step of steps) {
      const list = stepsByRecipe.get(step.recipe_id) ?? [];
      list.push(step);
      stepsByRecipe.set(step.recipe_id, list);
    }
    return rows.map((row) =>
      mapRecipe(row, ingredientsByRecipe.get(row.id) ?? [], stepsByRecipe.get(row.id) ?? []),
    );
  }
}

export const recipeService = new RecipeService();
