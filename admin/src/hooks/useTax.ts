import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageQuery, TaxProfileWriteRequest } from '@menuboard/shared';
import {
  gstSyncApi,
  hsnSacApi,
  taxProfilesApi,
  type HsnSacSearchParams,
  type TaxProfileListQuery,
} from '../api/tax';

/* ------------------------------------------------- HSN/SAC classification master */

export function useHsnSacSearch(params: HsnSacSearchParams, enabled = true) {
  return useQuery({
    queryKey: ['hsn-sac', params],
    queryFn: () => hsnSacApi.search(params),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useHsnSacCode(id: string | null) {
  return useQuery({
    queryKey: ['hsn-sac-code', id],
    queryFn: () => hsnSacApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

export function useHsnSacSummary() {
  return useQuery({ queryKey: ['hsn-sac-summary'], queryFn: () => hsnSacApi.summary() });
}

/* ------------------------------------------------------------- synchronization */

export function useGstSyncRuns(query: PageQuery) {
  return useQuery({
    queryKey: ['gst-sync-runs', query],
    queryFn: () => gstSyncApi.runs(query),
    placeholderData: (previous) => previous,
  });
}

/**
 * Invalidates every classification-derived cache on success: the counts, the run history and
 * any open code search. Tax Profiles are deliberately NOT invalidated — a sync never changes
 * them, and refetching would imply otherwise.
 */
export function useSyncGstMaster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => gstSyncApi.sync(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hsn-sac-summary'] });
      void qc.invalidateQueries({ queryKey: ['gst-sync-runs'] });
      void qc.invalidateQueries({ queryKey: ['hsn-sac'] });
    },
  });
}

/* ------------------------------------------------------------------ tax profiles */

export function useTaxProfiles(query: TaxProfileListQuery) {
  return useQuery({
    queryKey: ['tax-profiles', query],
    queryFn: () => taxProfilesApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useTaxProfile(id: string | null) {
  return useQuery({
    queryKey: ['tax-profile', id],
    queryFn: () => taxProfilesApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

export function useCreateTaxProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaxProfileWriteRequest) => taxProfilesApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tax-profiles'] }),
  });
}

export function useUpdateTaxProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<TaxProfileWriteRequest> }) =>
      taxProfilesApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tax-profiles'] }),
  });
}

export function useDeleteTaxProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => taxProfilesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tax-profiles'] }),
  });
}
