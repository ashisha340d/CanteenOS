import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecipeWriteRequest } from '@menuboard/shared';
import {
  recipesApi,
  type ParsedRecipe,
  type RecipeListQuery,
  type UnresolvedItem,
} from '../api/recipes';

export function useRecipes(query: RecipeListQuery) {
  return useQuery({ queryKey: ['recipes', query], queryFn: () => recipesApi.list(query), placeholderData: (p) => p });
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe', id],
    queryFn: () => recipesApi.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useRecipeVariants(menuItemId: string | undefined) {
  return useQuery({
    queryKey: ['recipe-variants', menuItemId],
    queryFn: () => recipesApi.listByMenuItem(menuItemId as string),
    enabled: Boolean(menuItemId),
  });
}

export function useDefaultRecipe(menuItemId: string | undefined) {
  return useQuery({
    queryKey: ['recipe-default', menuItemId],
    queryFn: () => recipesApi.getDefaultByMenuItem(menuItemId as string),
    enabled: Boolean(menuItemId),
  });
}

export function useUpsertRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecipeWriteRequest) => recipesApi.upsert(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe-variants'] });
      qc.invalidateQueries({ queryKey: ['recipe-default'] });
      qc.invalidateQueries({ queryKey: ['recipe'] });
    },
  });
}

export function useSetDefaultRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recipesApi.setDefault(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe-variants'] });
      qc.invalidateQueries({ queryKey: ['recipe-default'] });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recipesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      qc.invalidateQueries({ queryKey: ['recipe-variants'] });
      qc.invalidateQueries({ queryKey: ['recipe-default'] });
    },
  });
}

export function useImportParseRecipe() {
  return useMutation({ mutationFn: (rawText: string) => recipesApi.importParse(rawText) });
}

export function useImportAiRecipe() {
  return useMutation({
    mutationFn: ({
      rawText,
      draft,
      unresolved,
    }: {
      rawText: string;
      draft: ParsedRecipe;
      unresolved: UnresolvedItem[];
    }) => recipesApi.importAi(rawText, draft, unresolved),
  });
}
