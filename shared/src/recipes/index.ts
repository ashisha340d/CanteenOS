import { RecipeIngredientScaling } from '../enums';
import type { RecipeDto, ScaledRecipeDto } from '../dto/domain';

/** Rounds to three decimals — enough for grams, without float noise like 0.30000000004. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Scales one ingredient quantity from a recipe's base serving count to a target count.
 *
 *   LINEAR -> qty * (target / base)     most ingredients
 *   FIXED  -> qty                       tempering spices, bay leaves, garnish
 *   SQRT   -> qty * sqrt(target / base) salt, water: sub-linear in bulk cooking
 *
 * Lives in `shared` because two independent callers must agree to the digit: the server
 * answers `GET /recipes/menu-item/:id/scaled`, and the device scales its cached copy when it
 * has no signal. Two people standing at the same counter, one online and one not, have to see
 * the same quantity — so there is one implementation, not two that look alike.
 */
export function scaleQuantity(
  quantity: number,
  basePax: number,
  targetPax: number,
  scaling: RecipeIngredientScaling,
): number {
  // A recipe with a zero base would divide by zero; treat it as already stated per-serving.
  const ratio = basePax > 0 ? targetPax / basePax : 1;
  switch (scaling) {
    case RecipeIngredientScaling.FIXED:
      return quantity;
    case RecipeIngredientScaling.SQRT:
      return quantity * Math.sqrt(ratio);
    case RecipeIngredientScaling.LINEAR:
    default:
      return quantity * ratio;
  }
}

/**
 * Scales a recipe to a serving count. Quantities are held at `basePax` and multiplied on
 * read, so changing an order's pax never rewrites recipe data. Steps travel through
 * unmodified — they describe a method, not a per-serving amount.
 */
export function scaleRecipe(
  recipe: RecipeDto,
  pax: number,
  menuItemName?: string,
): ScaledRecipeDto {
  return {
    recipeId: recipe.id,
    menuItemId: recipe.menuItemId,
    menuItemName: menuItemName ?? recipe.menuItemName ?? '',
    basePax: recipe.basePax,
    scaledToPax: pax,
    methodEn: recipe.methodEn,
    methodHi: recipe.methodHi,
    ingredients: recipe.ingredients.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      name: ingredient.ingredientName ?? '',
      nameHi: ingredient.ingredientNameHi ?? null,
      quantity: round3(scaleQuantity(ingredient.quantity, recipe.basePax, pax, ingredient.scaling)),
      baseQuantity: ingredient.quantity,
      unit: ingredient.unit,
      scaling: ingredient.scaling,
      notes: ingredient.notes,
    })),
    steps: recipe.steps,
  };
}
