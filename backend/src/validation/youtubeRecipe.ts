import { z } from 'zod';
import { RecipeDifficulty, type YoutubeExtractedRecipe } from '@menuboard/shared';

/**
 * Schema for the recipe JSON Gemini produces for a YouTube import. LLM output is untrusted
 * input: everything is validated (and lightly coerced) here before it is stored on the
 * import record, and the stored JSON is re-validated before it may populate the Recipe
 * Master review form. Missing information stays null — it is never invented.
 */

const nullableTrimmed = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      const t = typeof v === 'string' ? v.trim() : '';
      return t ? t.slice(0, max) : null;
    });

const nullableNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });

const stringList = z
  .union([z.array(z.union([z.string(), z.null()])), z.null(), z.undefined()])
  .transform((v) =>
    (v ?? [])
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 500))
      .slice(0, 50),
  );

const extractedIngredientSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    quantity: nullableNumber,
    quantityText: nullableTrimmed(100),
    unit: nullableTrimmed(30),
    preparation: nullableTrimmed(200),
    notes: nullableTrimmed(500),
    ingredientId: z
      .union([z.string().uuid(), z.null(), z.undefined()])
      .transform((v) => v ?? null),
  })
  .passthrough()
  .transform(({ name, quantity, quantityText, unit, preparation, notes, ingredientId }) => ({
    name,
    quantity,
    quantityText,
    unit,
    preparation,
    notes,
    ingredientId,
  }));

const extractedStepSchema = z
  .object({
    stepNo: nullableNumber,
    instruction: z.string().trim().min(1).max(4000),
    durationMin: nullableNumber,
    temperature: nullableTrimmed(100),
    cookingMethod: nullableTrimmed(100),
  })
  .passthrough()
  .transform(({ stepNo, instruction, durationMin, temperature, cookingMethod }) => ({
    stepNo: stepNo ?? 0,
    instruction,
    durationMin: durationMin === null ? null : Math.round(durationMin),
    temperature,
    cookingMethod,
  }));

export const youtubeExtractedRecipeSchema = z
  .object({
    recipeName: z.string().trim().min(1).max(300),
    description: nullableTrimmed(1000),
    category: nullableTrimmed(120),
    cuisine: nullableTrimmed(120),
    yieldNote: nullableTrimmed(200),
    servings: nullableNumber,
    prepTimeMin: nullableNumber,
    cookTimeMin: nullableNumber,
    totalTimeMin: nullableNumber,
    difficulty: z
      .union([z.nativeEnum(RecipeDifficulty), z.null(), z.undefined()])
      .catch(null)
      .transform((v) => v ?? null),
    ingredients: z.array(extractedIngredientSchema).min(1).max(100),
    steps: z.array(extractedStepSchema).max(100).default([]),
    equipment: stringList,
    tips: stringList,
    notes: nullableTrimmed(2000),
    variations: stringList,
    garnish: nullableTrimmed(500),
    storageInstructions: nullableTrimmed(1000),
    shelfLife: nullableTrimmed(200),
    dietaryInfo: stringList,
    allergens: stringList,
  })
  .passthrough()
  .transform((value): YoutubeExtractedRecipe => ({
    recipeName: value.recipeName,
    description: value.description,
    category: value.category,
    cuisine: value.cuisine,
    yieldNote: value.yieldNote,
    servings: value.servings === null ? null : Math.round(value.servings),
    prepTimeMin: value.prepTimeMin === null ? null : Math.round(value.prepTimeMin),
    cookTimeMin: value.cookTimeMin === null ? null : Math.round(value.cookTimeMin),
    totalTimeMin: value.totalTimeMin === null ? null : Math.round(value.totalTimeMin),
    difficulty: value.difficulty,
    ingredients: value.ingredients,
    steps: value.steps.map((step, index) => ({ ...step, stepNo: step.stepNo || index + 1 })),
    equipment: value.equipment,
    tips: value.tips,
    notes: value.notes,
    variations: value.variations,
    garnish: value.garnish,
    storageInstructions: value.storageInstructions,
    shelfLife: value.shelfLife,
    dietaryInfo: value.dietaryInfo,
    allergens: value.allergens,
  }));
