import fs from 'node:fs';
import path from 'node:path';
import {
  MasterStatus,
  RecipeIngredientScaling,
  type RecipeDifficulty,
} from '@menuboard/shared';
import { ingredientCategoryRepository, ingredientRepository } from '../../repositories/IngredientRepository';
import { menuCategoryRepository, menuItemRepository } from '../../repositories/MasterRepository';
import { recipeRepository } from '../../repositories/RecipeRepository';
import { newId } from '../../utils/ids';
import { logger } from '../../utils/logger';
import type { Db } from '../types';
import { selectOne, type RowDataPacket } from '../types';

/**
 * Real menu/ingredient/recipe data ported from the sibling "ashram_kitchen" (VSKorder)
 * system — see E:\VSKorder\HANDOVER_INGREDIENT_RECIPE.md for the source analysis. Loaded
 * from a JSON data file at runtime rather than hardcoded as TS literals (matching the
 * decision recorded in that handover doc), so the seed script itself stays readable.
 *
 * Additive: VSKorder's categories/items are inserted alongside MenuBoard's own curated seed
 * (`MENU` in seed.ts) rather than replacing it — some names repeat across the two catalogues
 * (e.g. "Roti" under both an existing "Breads" category and an imported "Carbs & Mains" one),
 * which is cosmetic, not a schema conflict, since menu_items has no cross-category uniqueness.
 */

interface ImportedItemCategory {
  id: number;
  name: string;
  nameHi: string | null;
  sortOrder: number;
}
interface ImportedItem {
  id: number;
  categoryId: number;
  name: string;
  nameHi: string | null;
  unit: string;
}
interface ImportedIngredientCategory {
  id: number;
  name: string;
  nameHi: string | null;
  sortOrder: number;
}
interface ImportedIngredient {
  id: number;
  categoryId: number | null;
  name: string;
  nameHi: string | null;
  unit: string;
}
interface ImportedRecipe {
  id: number;
  itemId: number;
  basePax: number;
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
}
interface ImportedRecipeIngredient {
  recipeId: number;
  ingredientId: number;
  qtyForBasePax: number;
  unit: string;
  scaling: RecipeIngredientScaling;
  notes: string | null;
  sortOrder: number;
}
interface ImportedRecipeStep {
  recipeId: number;
  stepNo: number;
  textEn: string;
  textHi: string | null;
  durationMin: number | null;
}

interface ImportedData {
  itemCategories: ImportedItemCategory[];
  items: ImportedItem[];
  ingredientCategories: ImportedIngredientCategory[];
  ingredients: ImportedIngredient[];
  recipes: ImportedRecipe[];
  recipeIngredients: ImportedRecipeIngredient[];
  recipeSteps: ImportedRecipeStep[];
}

interface ExistsRow extends RowDataPacket {
  id: string;
}

function loadImportedData(): ImportedData {
  const filePath = path.resolve(__dirname, 'data/imported-recipes.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ImportedData;
}

async function findMenuCategoryByName(db: Db, name: string): Promise<string | null> {
  const row = await selectOne<ExistsRow>(
    db,
    'SELECT id FROM menu_categories WHERE name = ? AND deleted_at IS NULL LIMIT 1',
    [name],
  );
  return row === null ? null : row.id;
}

async function findMenuItemByCategoryAndName(
  db: Db,
  categoryId: string,
  name: string,
): Promise<string | null> {
  const row = await selectOne<ExistsRow>(
    db,
    'SELECT id FROM menu_items WHERE category_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1',
    [categoryId, name],
  );
  return row === null ? null : row.id;
}

export async function seedImportedRecipes(connection: Db, createdBy: string): Promise<void> {
  const data = loadImportedData();

  /* -------------------------------------------------- menu categories & items */

  const itemCategoryIdMap = new Map<number, string>();
  for (const [index, category] of data.itemCategories.entries()) {
    let id = await findMenuCategoryByName(connection, category.name);
    if (id === null) {
      const row = await menuCategoryRepository.insert(connection, {
        id: newId(),
        name: category.name,
        nameHi: category.nameHi,
        description: null,
        imagePath: null,
        status: MasterStatus.ACTIVE,
        sortOrder: 100 + index, // after MENU's own curated categories
        createdBy,
      });
      id = row.id;
    }
    itemCategoryIdMap.set(category.id, id);
  }

  const itemIdMap = new Map<number, string>();
  for (const [index, item] of data.items.entries()) {
    const categoryId = itemCategoryIdMap.get(item.categoryId);
    if (categoryId === undefined) continue;

    let id = await findMenuItemByCategoryAndName(connection, categoryId, item.name);
    if (id === null) {
      const row = await menuItemRepository.insert(connection, {
        id: newId(),
        categoryId,
        name: item.name,
        nameHi: item.nameHi,
        unit: item.unit,
        unitHi: null,
        imagePath: null,
        status: MasterStatus.ACTIVE,
        sortOrder: index,
        createdBy,
      });
      id = row.id;
    }
    itemIdMap.set(item.id, id);
  }

  /* ---------------------------------------------- ingredient categories & ingredients */

  const ingredientCategoryIdMap = new Map<number, string>();
  for (const [index, category] of data.ingredientCategories.entries()) {
    const existing = await ingredientCategoryRepository.findByName(connection, category.name);
    const id =
      existing?.id ??
      (
        await ingredientCategoryRepository.insert(connection, {
          id: newId(),
          name: category.name,
          nameHi: category.nameHi,
          status: MasterStatus.ACTIVE,
          sortOrder: index,
          createdBy,
        })
      ).id;
    ingredientCategoryIdMap.set(category.id, id);
  }

  const ingredientIdMap = new Map<number, string>();
  for (const [index, ingredient] of data.ingredients.entries()) {
    let existing = await ingredientRepository.findByName(connection, ingredient.name);
    if (existing === null) {
      const categoryId =
        ingredient.categoryId === null ? null : (ingredientCategoryIdMap.get(ingredient.categoryId) ?? null);
      existing = await ingredientRepository.insert(connection, {
        id: newId(),
        categoryId,
        name: ingredient.name,
        nameHi: ingredient.nameHi,
        unit: ingredient.unit,
        status: MasterStatus.ACTIVE,
        sortOrder: index,
        createdBy,
      });
    }
    ingredientIdMap.set(ingredient.id, existing.id);
  }

  /* ------------------------------------------------------------------- recipes */

  const recipeIdMap = new Map<number, string>();
  const recipeCountByItem = new Map<string, number>();

  for (const recipe of data.recipes) {
    const menuItemId = itemIdMap.get(recipe.itemId);
    if (menuItemId === undefined) continue;

    // Idempotent by (menu_item_id, description_en): re-running the seed must not duplicate
    // variants that already exist from a previous run.
    const existing = await selectOne<ExistsRow>(
      connection,
      `SELECT id FROM recipes
        WHERE menu_item_id = ? AND description_en <=> ? AND deleted_at IS NULL LIMIT 1`,
      [menuItemId, recipe.descriptionEn],
    );
    if (existing !== null) {
      recipeIdMap.set(recipe.id, existing.id);
      recipeCountByItem.set(menuItemId, (recipeCountByItem.get(menuItemId) ?? 0) + 1);
      continue;
    }

    const isDefault = (recipeCountByItem.get(menuItemId) ?? 0) === 0;
    const id = newId();
    await recipeRepository.upsert(connection, {
      id,
      menuItemId,
      basePax: recipe.basePax,
      isDefault,
      prepTimeMin: recipe.prepTimeMin,
      cookTimeMin: recipe.cookTimeMin,
      teamSize: recipe.teamSize,
      difficulty: recipe.difficulty,
      descriptionEn: recipe.descriptionEn,
      descriptionHi: recipe.descriptionHi,
      methodEn: recipe.methodEn,
      methodHi: recipe.methodHi,
      yieldNote: recipe.yieldNote,
      chefNotes: recipe.chefNotes,
      status: MasterStatus.ACTIVE,
      createdBy,
    });
    recipeIdMap.set(recipe.id, id);
    recipeCountByItem.set(menuItemId, (recipeCountByItem.get(menuItemId) ?? 0) + 1);
  }

  /* --------------------------------------------------------- recipe ingredients/steps */

  const ingredientsByRecipe = new Map<number, ImportedRecipeIngredient[]>();
  for (const ri of data.recipeIngredients) {
    const list = ingredientsByRecipe.get(ri.recipeId) ?? [];
    list.push(ri);
    ingredientsByRecipe.set(ri.recipeId, list);
  }
  const stepsByRecipe = new Map<number, ImportedRecipeStep[]>();
  for (const step of data.recipeSteps) {
    const list = stepsByRecipe.get(step.recipeId) ?? [];
    list.push(step);
    stepsByRecipe.set(step.recipeId, list);
  }

  let newRecipes = 0;
  for (const recipe of data.recipes) {
    const recipeId = recipeIdMap.get(recipe.id);
    if (recipeId === undefined) continue;

    const existingIngredients = await recipeRepository.listIngredients(connection, recipeId);
    if (existingIngredients.length > 0) continue; // already seeded this variant's children

    const ingredients = (ingredientsByRecipe.get(recipe.id) ?? [])
      .map((ri) => {
        const ingredientId = ingredientIdMap.get(ri.ingredientId);
        if (ingredientId === undefined) return null;
        return {
          id: newId(),
          ingredientId,
          quantity: ri.qtyForBasePax,
          unit: ri.unit,
          scaling: ri.scaling,
          notes: ri.notes,
          sortOrder: ri.sortOrder,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (ingredients.length > 0) {
      await recipeRepository.replaceIngredients(connection, recipeId, ingredients);
    }

    const steps = (stepsByRecipe.get(recipe.id) ?? []).map((s) => ({
      id: newId(),
      stepNo: s.stepNo,
      textEn: s.textEn,
      textHi: s.textHi,
      durationMin: s.durationMin,
      imagePath: null,
    }));
    if (steps.length > 0) {
      await recipeRepository.replaceSteps(connection, recipeId, steps);
    }
    newRecipes += 1;
  }

  logger.info('Seeded imported recipes', {
    itemCategories: data.itemCategories.length,
    items: data.items.length,
    ingredientCategories: data.ingredientCategories.length,
    ingredients: data.ingredients.length,
    recipes: data.recipes.length,
    recipesWithNewChildren: newRecipes,
  });
}
