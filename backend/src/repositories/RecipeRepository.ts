import type { MasterStatus, RecipeDifficulty, RecipeIngredientScaling } from '@menuboard/shared';
import { allocateSyncSeq, allocateSyncSeqBlock } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export interface UpsertRecipeInput {
  id: string;
  menuItemId: string;
  basePax: number;
  isDefault: boolean;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  teamSize: number | null;
  difficulty: RecipeDifficulty | null;
  descriptionEn: string | null;
  descriptionHi: string | null;
  methodEn: string | null;
  methodHi: string | null;
  yieldNote: string | null;
  chefNotes: string | null;
  status: MasterStatus;
  createdBy: string | null;
}

export interface RecipeIngredientInput {
  id: string;
  ingredientId: string;
  quantity: number;
  unit: string;
  scaling: RecipeIngredientScaling;
  notes: string | null;
  sortOrder: number;
}

export interface RecipeStepInput {
  id: string;
  stepNo: number;
  textEn: string;
  textHi: string | null;
  durationMin: number | null;
  imagePath: string | null;
}

const RECIPE_COLUMNS = `
  id, menu_item_id, base_pax, is_default, prep_time_min, cook_time_min, team_size,
  difficulty, description_en, description_hi, method_en, method_hi, yield_note, chef_notes,
  status, created_by, created_at, updated_at, deleted_at, revision, sync_seq`;

const INGREDIENT_COLUMNS = `
  id, recipe_id, ingredient_id, quantity, unit, scaling, notes, sort_order,
  created_at, updated_at, deleted_at, revision, sync_seq`;

const STEP_COLUMNS = `
  id, recipe_id, step_no, text_en, text_hi, duration_min, image_path,
  created_at, updated_at, deleted_at, revision, sync_seq`;

/**
 * Recipes, their ingredients and their steps.
 *
 * A menu item may have several authored recipe variants (e.g. three kinds of Roti); exactly
 * one is `is_default` (enforced by a generated-column unique index — see migration 005),
 * and that is the variant `ShoppingListService` scales against. Quantities are stored at
 * `base_pax` and never rewritten; scaling happens on read in RecipeService.
 */
export class RecipeRepository {
  async findById(db: Db, id: string): Promise<RecipeRow | null> {
    return selectOne<RecipeRow>(
      db,
      `SELECT ${RECIPE_COLUMNS} FROM recipes WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  }

  async findDefaultByMenuItemId(db: Db, menuItemId: string): Promise<RecipeRow | null> {
    return selectOne<RecipeRow>(
      db,
      `SELECT ${RECIPE_COLUMNS} FROM recipes
        WHERE menu_item_id = ? AND is_default = 1 AND deleted_at IS NULL`,
      [menuItemId],
    );
  }

  async listByMenuItemId(db: Db, menuItemId: string): Promise<RecipeRow[]> {
    return selectRows<RecipeRow>(
      db,
      `SELECT ${RECIPE_COLUMNS} FROM recipes
        WHERE menu_item_id = ? AND deleted_at IS NULL
        ORDER BY is_default DESC, created_at ASC`,
      [menuItemId],
    );
  }

  async list(
    db: Db,
    filter: { status?: MasterStatus; menuItemId?: string; search?: string } = {},
  ): Promise<RecipeRow[]> {
    const conditions = ['r.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filter.status !== undefined) {
      conditions.push('r.status = ?');
      params.push(filter.status);
    }
    if (filter.menuItemId !== undefined) {
      conditions.push('r.menu_item_id = ?');
      params.push(filter.menuItemId);
    }
    if (filter.search) {
      conditions.push('(mi.name LIKE ? OR r.description_en LIKE ?)');
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }
    return selectRows<RecipeRow>(
      db,
      `SELECT ${RECIPE_COLUMNS.split(',').map((c) => `r.${c.trim()}`).join(', ')}, mi.name AS menu_item_name
         FROM recipes r
        INNER JOIN menu_items mi ON mi.id = r.menu_item_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY mi.name ASC, r.is_default DESC, r.created_at ASC`,
      params,
    );
  }

  async listIngredients(db: Db, recipeId: string): Promise<RecipeIngredientRow[]> {
    return selectRows<RecipeIngredientRow>(
      db,
      `SELECT ri.id, ri.recipe_id, ri.ingredient_id, ri.quantity, ri.unit, ri.scaling, ri.notes,
              ri.sort_order, ri.created_at, ri.updated_at, ri.deleted_at, ri.revision, ri.sync_seq,
              i.name AS ingredient_name, i.name_hi AS ingredient_name_hi
         FROM recipe_ingredients ri
         INNER JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = ? AND ri.deleted_at IS NULL
        ORDER BY ri.sort_order ASC, ri.created_at ASC`,
      [recipeId],
    );
  }

  async listIngredientsForRecipes(
    db: Db,
    recipeIds: readonly string[],
  ): Promise<RecipeIngredientRow[]> {
    if (recipeIds.length === 0) return [];
    const placeholders = recipeIds.map(() => '?').join(', ');
    return selectRows<RecipeIngredientRow>(
      db,
      `SELECT ri.id, ri.recipe_id, ri.ingredient_id, ri.quantity, ri.unit, ri.scaling, ri.notes,
              ri.sort_order, ri.created_at, ri.updated_at, ri.deleted_at, ri.revision, ri.sync_seq,
              i.name AS ingredient_name, i.name_hi AS ingredient_name_hi
         FROM recipe_ingredients ri
         INNER JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id IN (${placeholders}) AND ri.deleted_at IS NULL
        ORDER BY ri.recipe_id ASC, ri.sort_order ASC`,
      recipeIds,
    );
  }

  async listSteps(db: Db, recipeId: string): Promise<RecipeStepRow[]> {
    return selectRows<RecipeStepRow>(
      db,
      `SELECT ${STEP_COLUMNS} FROM recipe_steps
        WHERE recipe_id = ? AND deleted_at IS NULL
        ORDER BY step_no ASC`,
      [recipeId],
    );
  }

  async listStepsForRecipes(db: Db, recipeIds: readonly string[]): Promise<RecipeStepRow[]> {
    if (recipeIds.length === 0) return [];
    const placeholders = recipeIds.map(() => '?').join(', ');
    return selectRows<RecipeStepRow>(
      db,
      `SELECT ${STEP_COLUMNS} FROM recipe_steps
        WHERE recipe_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY recipe_id ASC, step_no ASC`,
      recipeIds,
    );
  }

  /**
   * The default recipe variant for each menu item, for the shopping-list roll-up which needs
   * many at once. Menu items without a default recipe are simply absent — the caller reports
   * them as unresolved rather than silently dropping the requirement.
   */
  async findDefaultByMenuItemIds(db: Db, menuItemIds: readonly string[]): Promise<RecipeRow[]> {
    if (menuItemIds.length === 0) return [];
    const placeholders = menuItemIds.map(() => '?').join(', ');
    return selectRows<RecipeRow>(
      db,
      `SELECT ${RECIPE_COLUMNS} FROM recipes
        WHERE menu_item_id IN (${placeholders}) AND is_default = 1
          AND deleted_at IS NULL AND status = 'ACTIVE'`,
      menuItemIds,
    );
  }

  /** Clears every other default for a menu item — used before promoting a new one. */
  async clearDefault(db: Db, menuItemId: string, exceptRecipeId?: string): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    const params: unknown[] = [now, syncSeq, menuItemId];
    let sql = `UPDATE recipes SET is_default = 0, updated_at = ?, revision = revision + 1, sync_seq = ?
                WHERE menu_item_id = ? AND is_default = 1 AND deleted_at IS NULL`;
    if (exceptRecipeId !== undefined) {
      sql += ' AND id != ?';
      params.push(exceptRecipeId);
    }
    await mutate(db, sql, params);
  }

  async upsert(db: Db, input: UpsertRecipeInput): Promise<RecipeRow> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();

    await mutate(
      db,
      `INSERT INTO recipes
        (id, menu_item_id, base_pax, is_default, prep_time_min, cook_time_min, team_size,
         difficulty, description_en, description_hi, method_en, method_hi, yield_note,
         chef_notes, status, created_by, created_at, updated_at, revision, sync_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         base_pax = VALUES(base_pax), is_default = VALUES(is_default),
         prep_time_min = VALUES(prep_time_min), cook_time_min = VALUES(cook_time_min),
         team_size = VALUES(team_size), difficulty = VALUES(difficulty),
         description_en = VALUES(description_en), description_hi = VALUES(description_hi),
         method_en = VALUES(method_en), method_hi = VALUES(method_hi),
         yield_note = VALUES(yield_note), chef_notes = VALUES(chef_notes),
         status = VALUES(status), deleted_at = NULL, updated_at = VALUES(updated_at),
         revision = revision + 1, sync_seq = VALUES(sync_seq)`,
      [
        input.id,
        input.menuItemId,
        input.basePax,
        input.isDefault ? 1 : 0,
        input.prepTimeMin,
        input.cookTimeMin,
        input.teamSize,
        input.difficulty,
        input.descriptionEn,
        input.descriptionHi,
        input.methodEn,
        input.methodHi,
        input.yieldNote,
        input.chefNotes,
        input.status,
        input.createdBy,
        now,
        now,
        syncSeq,
      ],
    );

    const row = await this.findById(db, input.id);
    if (row === null) throw new Error(`Recipe ${input.id} could not be read back`);
    return row;
  }

  /**
   * Replaces a recipe's ingredient set. Absent rows are tombstoned rather than deleted so
   * the removal replicates to devices that already cached them.
   */
  async replaceIngredients(
    db: Db,
    recipeId: string,
    ingredients: readonly RecipeIngredientInput[],
  ): Promise<void> {
    const existing = await this.listIngredients(db, recipeId);
    const existingIds = new Set(existing.map((row) => row.id));
    const incomingIds = new Set(ingredients.map((item) => item.id));

    const removed = [...existingIds].filter((id) => !incomingIds.has(id));
    if (removed.length > 0) {
      const firstSeq = await allocateSyncSeqBlock(db, removed.length);
      const now = toDbDateTime();
      for (const [index, id] of removed.entries()) {
        await mutate(
          db,
          `UPDATE recipe_ingredients
              SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
            WHERE id = ?`,
          [now, now, firstSeq + index, id],
        );
      }
    }

    if (ingredients.length === 0) return;

    const firstSeq = await allocateSyncSeqBlock(db, ingredients.length);
    const now = toDbDateTime();
    for (const [index, item] of ingredients.entries()) {
      await mutate(
        db,
        `INSERT INTO recipe_ingredients
          (id, recipe_id, ingredient_id, quantity, unit, scaling, notes, sort_order,
           created_at, updated_at, revision, sync_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           quantity = VALUES(quantity), unit = VALUES(unit), scaling = VALUES(scaling),
           notes = VALUES(notes), sort_order = VALUES(sort_order), deleted_at = NULL,
           updated_at = VALUES(updated_at), revision = revision + 1, sync_seq = VALUES(sync_seq)`,
        [
          item.id,
          recipeId,
          item.ingredientId,
          item.quantity,
          item.unit,
          item.scaling,
          item.notes,
          item.sortOrder,
          now,
          now,
          firstSeq + index,
        ],
      );
    }
  }

  /** Steps have no independent identity — they are positional, so every replace is wholesale. */
  async replaceSteps(db: Db, recipeId: string, steps: readonly RecipeStepInput[]): Promise<void> {
    const existing = await this.listSteps(db, recipeId);
    if (existing.length > 0) {
      const firstSeq = await allocateSyncSeqBlock(db, existing.length);
      const now = toDbDateTime();
      for (const [index, row] of existing.entries()) {
        await mutate(
          db,
          `UPDATE recipe_steps
              SET deleted_at = ?, updated_at = ?, revision = revision + 1, sync_seq = ?
            WHERE id = ?`,
          [now, now, firstSeq + index, row.id],
        );
      }
    }

    if (steps.length === 0) return;

    const firstSeq = await allocateSyncSeqBlock(db, steps.length);
    const now = toDbDateTime();
    for (const [index, step] of steps.entries()) {
      await mutate(
        db,
        `INSERT INTO recipe_steps
          (id, recipe_id, step_no, text_en, text_hi, duration_min, image_path,
           created_at, updated_at, revision, sync_seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          step.id,
          recipeId,
          step.stepNo,
          step.textEn,
          step.textHi,
          step.durationMin,
          step.imagePath,
          now,
          now,
          firstSeq + index,
        ],
      );
    }
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const syncSeq = await allocateSyncSeq(db);
    const now = toDbDateTime();
    // is_default is cleared on delete: the generated unique index ignores NULL, but a
    // soft-deleted default (menu_item_id preserved, is_default still 1) would otherwise keep
    // reserving the slot per docs/DATABASE.md's soft-delete/unique-key rule.
    const result = await mutate(
      db,
      `UPDATE recipes SET deleted_at = ?, status = 'INACTIVE', is_default = 0, updated_at = ?,
              revision = revision + 1, sync_seq = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, syncSeq, id],
    );
    return result.affectedRows > 0;
  }

  /* -------------------------------------------------------------- sync pull */

  async changedSince(db: Db, cursor: number, limit: number): Promise<RecipeRow[]> {
    return selectRows<RecipeRow>(
      db,
      `SELECT ${RECIPE_COLUMNS} FROM recipes
        WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }

  async ingredientsChangedSince(
    db: Db,
    cursor: number,
    limit: number,
  ): Promise<RecipeIngredientRow[]> {
    return selectRows<RecipeIngredientRow>(
      db,
      `SELECT ${INGREDIENT_COLUMNS} FROM recipe_ingredients
        WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }

  async stepsChangedSince(db: Db, cursor: number, limit: number): Promise<RecipeStepRow[]> {
    return selectRows<RecipeStepRow>(
      db,
      `SELECT ${STEP_COLUMNS} FROM recipe_steps
        WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }
}

export const recipeRepository = new RecipeRepository();
