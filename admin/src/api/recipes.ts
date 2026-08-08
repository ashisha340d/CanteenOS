import type { MasterStatus, RecipeDto, RecipeWriteRequest } from '@menuboard/shared';
import { http, unwrap } from './client';

export interface RecipeListQuery {
  menuItemId?: string;
  status?: MasterStatus;
  q?: string;
}

/** Mirrors backend/src/services/RecipeParserService.ts's local (non-shared) types. */
export interface ParsedIngredient {
  ingredientId?: string;
  name: string;
  qtyForBasePax: string;
  unit?: string;
  scaling?: RecipeWriteRequest['ingredients'][number]['scaling'];
  notes?: string;
}

export interface ParsedStep {
  textEn: string;
  durationMin?: number;
}

export interface UnresolvedItem {
  type: string;
  text: string;
  reason: string;
}

export interface ParsedRecipe {
  itemName: string;
  basePax: number;
  prepTimeMin?: number;
  cookTimeMin?: number;
  difficulty?: RecipeDto['difficulty'];
  descriptionEn?: string;
  methodEn?: string;
  yieldNote?: string;
  ingredients: ParsedIngredient[];
  steps: ParsedStep[];
  unresolved: UnresolvedItem[];
}

export const recipesApi = {
  list: (query: RecipeListQuery) => unwrap<RecipeDto[]>(http.get('/recipes', { params: query })),
  getById: (id: string) => unwrap<RecipeDto>(http.get(`/recipes/${id}`)),
  listByMenuItem: (menuItemId: string) =>
    unwrap<RecipeDto[]>(http.get(`/recipes/menu-item/${menuItemId}/variants`)),
  getDefaultByMenuItem: (menuItemId: string) =>
    unwrap<RecipeDto>(http.get(`/recipes/menu-item/${menuItemId}`)),
  upsert: (body: RecipeWriteRequest) => unwrap<RecipeDto>(http.put('/recipes', body)),
  setDefault: (id: string) => unwrap<RecipeDto>(http.patch(`/recipes/${id}/default`)),
  remove: (id: string) => unwrap<null>(http.delete(`/recipes/${id}`)),
  importParse: (rawText: string) =>
    unwrap<ParsedRecipe>(http.post('/recipes/import/parse', { rawText })),
  importAi: (rawText: string, draft: ParsedRecipe, unresolved: UnresolvedItem[]) =>
    unwrap<ParsedRecipe>(http.post('/recipes/import/ai', { rawText, draft, unresolved })),
  transcribe: (file: Blob) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<{ transcript: string }>(
      http.post('/recipes/transcribe', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },
  translate: (text: string, target?: string) =>
    unwrap<{ translated: string }>(http.post('/recipes/translate', { text, target })),
  translateBatch: (texts: string[], target?: string) =>
    unwrap<{ translated: string[] }>(http.post('/recipes/translate/batch', { texts, target })),
};
