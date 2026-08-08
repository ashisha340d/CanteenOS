import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IngredientCategoryWriteRequest, IngredientWriteRequest } from '@menuboard/shared';
import { ingredientCategoriesApi, ingredientsApi } from '../api/ingredients';
import type { MasterListQuery } from '../api/masters';

/* ------------------------------------------------------------ ingredient categories */

export function useIngredientCategories(query: MasterListQuery) {
  return useQuery({
    queryKey: ['ingredient-categories', query],
    queryFn: () => ingredientCategoriesApi.list(query),
    placeholderData: (p) => p,
  });
}
export function useCreateIngredientCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IngredientCategoryWriteRequest) => ingredientCategoriesApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredient-categories'] }),
  });
}
export function useUpdateIngredientCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<IngredientCategoryWriteRequest> }) =>
      ingredientCategoriesApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredient-categories'] }),
  });
}
export function useDeleteIngredientCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ingredientCategoriesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredient-categories'] }),
  });
}

/* --------------------------------------------------------------------- ingredients */

export function useIngredients(query: MasterListQuery & { categoryId?: string }) {
  return useQuery({
    queryKey: ['ingredients', query],
    queryFn: () => ingredientsApi.list(query),
    placeholderData: (p) => p,
  });
}
export function useCreateIngredient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IngredientWriteRequest) => ingredientsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
  });
}
export function useUpdateIngredient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<IngredientWriteRequest> }) =>
      ingredientsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
  });
}
export function useDeleteIngredient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ingredientsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ingredients'] }),
  });
}
export function useIngredientUnits() {
  return useQuery({ queryKey: ['ingredient-units'], queryFn: () => ingredientsApi.listUnits() });
}
