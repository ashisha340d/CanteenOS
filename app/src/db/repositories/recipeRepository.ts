import type * as SQLite from 'expo-sqlite';
import type {
  MasterStatus,
  RecipeDifficulty,
  RecipeDto,
  RecipeIngredientDto,
  RecipeIngredientScaling,
  RecipeStepDto,
} from '@menuboard/shared';
import { getDb } from '../client';
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from '../models';
import { ingredientRepository } from './ingredientRepository';

/**
 * Recipes, cached locally so the long-press "view recipe" works in a kitchen with no signal.
 *
 * Read-only on the device: the app never originates a recipe write, so there is no outbox
 * involvement and no `sync_state` column on these tables. A menu item may have several
 * authored variants; `findByMenuItem` always resolves the one flagged `is_default`, matching
 * every other place (shopping list generation, the server's non-variant recipe endpoint) that
 * needs "the" recipe for a menu item.
 */

function toStep(row: RecipeStepRow): RecipeStepDto {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    stepNo: row.step_no,
    textEn: row.text_en ?? '',
    textHi: row.text_hi,
    durationMin: row.duration_min,
    imagePath: row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    syncSeq: row.server_sync_seq,
  };
}

function toIngredient(
  row: RecipeIngredientRow,
  ingredientName?: string | null,
  ingredientNameHi?: string | null,
): RecipeIngredientDto {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    ingredientId: row.ingredient_id,
    quantity: row.quantity,
    unit: row.unit,
    scaling: row.scaling as RecipeIngredientScaling,
    notes: row.notes,
    sortOrder: row.sort_order,
    ingredientName: ingredientName ?? undefined,
    ingredientNameHi: ingredientNameHi ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    syncSeq: row.server_sync_seq,
  };
}

function toRecipe(
  row: RecipeRow,
  ingredients: RecipeIngredientDto[],
  steps: RecipeStepDto[],
): RecipeDto {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    basePax: row.base_pax,
    isDefault: row.is_default === 1,
    prepTimeMin: row.prep_time_min,
    cookTimeMin: row.cook_time_min,
    teamSize: row.team_size,
    difficulty: row.difficulty as RecipeDifficulty | null,
    descriptionEn: row.description_en,
    descriptionHi: row.description_hi,
    methodEn: row.method_en,
    methodHi: row.method_hi,
    yieldNote: row.yield_note,
    chefNotes: row.chef_notes,
    status: row.status as MasterStatus,
    ingredients,
    steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    syncSeq: row.server_sync_seq,
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

/** Resolves ingredient name/nameHi for a batch of recipe-ingredient rows via a single lookup. */
async function attachIngredientNames(
  rows: RecipeIngredientRow[],
): Promise<RecipeIngredientDto[]> {
  const ingredients = await ingredientRepository.findByIds(rows.map((r) => r.ingredient_id));
  return rows.map((row) => {
    const ingredient = ingredients.get(row.ingredient_id);
    return toIngredient(row, ingredient?.name ?? null, ingredient?.nameHi ?? null);
  });
}

export const recipeRepository = {
  async upsertMany(rows: RecipeDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const recipe of rows) {
        await db.runAsync(
          `INSERT INTO recipes (id, menu_item_id, base_pax, is_default, prep_time_min,
             cook_time_min, team_size, difficulty, description_en, description_hi,
             method_en, method_hi, yield_note, chef_notes, status,
             created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             menu_item_id = excluded.menu_item_id, base_pax = excluded.base_pax,
             is_default = excluded.is_default, prep_time_min = excluded.prep_time_min,
             cook_time_min = excluded.cook_time_min, team_size = excluded.team_size,
             difficulty = excluded.difficulty, description_en = excluded.description_en,
             description_hi = excluded.description_hi, method_en = excluded.method_en,
             method_hi = excluded.method_hi, yield_note = excluded.yield_note,
             chef_notes = excluded.chef_notes, status = excluded.status,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq`,
          [
            recipe.id, recipe.menuItemId, recipe.basePax, recipe.isDefault ? 1 : 0,
            recipe.prepTimeMin, recipe.cookTimeMin, recipe.teamSize, recipe.difficulty,
            recipe.descriptionEn, recipe.descriptionHi, recipe.methodEn, recipe.methodHi,
            recipe.yieldNote, recipe.chefNotes, recipe.status,
            recipe.createdAt, recipe.updatedAt, recipe.deletedAt, recipe.revision, recipe.syncSeq,
          ],
        );
        // A recipe arriving with its ingredients/steps inline (the master-data read) replaces
        // them wholesale; the incremental sync sends them as their own entities instead.
        if (recipe.ingredients.length > 0) {
          await this.upsertIngredients(recipe.ingredients, db);
        }
        if (recipe.steps.length > 0) {
          await this.upsertSteps(recipe.steps, db);
        }
      }
    });
  },

  async upsertIngredients(
    rows: RecipeIngredientDto[],
    tx?: SQLite.SQLiteDatabase,
  ): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const ingredient of rows) {
        await db.runAsync(
          `INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity, unit, scaling,
             notes, sort_order, created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             recipe_id = excluded.recipe_id, ingredient_id = excluded.ingredient_id,
             quantity = excluded.quantity, unit = excluded.unit, scaling = excluded.scaling,
             notes = excluded.notes, sort_order = excluded.sort_order,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq`,
          [
            ingredient.id, ingredient.recipeId, ingredient.ingredientId, ingredient.quantity,
            ingredient.unit, ingredient.scaling, ingredient.notes, ingredient.sortOrder,
            ingredient.createdAt, ingredient.updatedAt, ingredient.deletedAt, ingredient.revision,
            ingredient.syncSeq,
          ],
        );
      }
    });
  },

  async upsertSteps(rows: RecipeStepDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const step of rows) {
        await db.runAsync(
          `INSERT INTO recipe_steps (id, recipe_id, step_no, text_en, text_hi, duration_min,
             image_path, created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             recipe_id = excluded.recipe_id, step_no = excluded.step_no,
             text_en = excluded.text_en, text_hi = excluded.text_hi,
             duration_min = excluded.duration_min, image_path = excluded.image_path,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq`,
          [
            step.id, step.recipeId, step.stepNo, step.textEn, step.textHi, step.durationMin,
            step.imagePath, step.createdAt, step.updatedAt, step.deletedAt, step.revision,
            step.syncSeq,
          ],
        );
      }
    });
  },

  /** The default recipe variant for a menu item — "the" recipe everywhere the app needs one. */
  async findByMenuItem(menuItemId: string): Promise<RecipeDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<RecipeRow>(
      `SELECT * FROM recipes WHERE menu_item_id = ? AND is_default = 1
       AND deleted_at IS NULL AND status = 'ACTIVE'`,
      [menuItemId],
    );
    if (!row) return null;
    const ingredientRows = await db.getAllAsync<RecipeIngredientRow>(
      `SELECT * FROM recipe_ingredients WHERE recipe_id = ? AND deleted_at IS NULL
       ORDER BY sort_order ASC`,
      [row.id],
    );
    const stepRows = await db.getAllAsync<RecipeStepRow>(
      `SELECT * FROM recipe_steps WHERE recipe_id = ? AND deleted_at IS NULL
       ORDER BY step_no ASC`,
      [row.id],
    );
    const ingredients = await attachIngredientNames(ingredientRows);
    return toRecipe(row, ingredients, stepRows.map(toStep));
  },

  /** Menu item ids that have a default recipe, so the UI only offers "view recipe" where one exists. */
  async menuItemIdsWithRecipes(): Promise<Set<string>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ menu_item_id: string }>(
      `SELECT menu_item_id FROM recipes WHERE is_default = 1 AND deleted_at IS NULL AND status = 'ACTIVE'`,
    );
    return new Set(rows.map((row) => row.menu_item_id));
  },
};
