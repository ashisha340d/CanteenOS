import type {
  IngredientCategoryDto,
  IngredientCategoryWriteRequest,
  IngredientDto,
  IngredientWriteRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';
import type { MasterListQuery } from './masters';

export const ingredientCategoriesApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<IngredientCategoryDto>(http.get('/ingredient-categories', { params: query })),
  create: (body: IngredientCategoryWriteRequest) =>
    unwrap<IngredientCategoryDto>(http.post('/ingredient-categories', body)),
  update: (id: string, body: Partial<IngredientCategoryWriteRequest>) =>
    unwrap<IngredientCategoryDto>(http.patch(`/ingredient-categories/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/ingredient-categories/${id}`)),
};

export const ingredientsApi = {
  list: (query: MasterListQuery & { categoryId?: string }) =>
    unwrapPaged<IngredientDto>(http.get('/ingredients', { params: query })),
  create: (body: IngredientWriteRequest) => unwrap<IngredientDto>(http.post('/ingredients', body)),
  update: (id: string, body: Partial<IngredientWriteRequest>) =>
    unwrap<IngredientDto>(http.patch(`/ingredients/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/ingredients/${id}`)),
  listUnits: () => unwrap<string[]>(http.get('/ingredients/units')),
  translate: (text: string, target?: string) =>
    unwrap<{ translated: string }>(http.post('/ingredients/translate', { text, target })),
};
