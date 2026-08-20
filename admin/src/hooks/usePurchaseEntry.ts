import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePurchaseEntryRequest,
  PostPurchaseEntryRequest,
  PurchaseEntryListQuery,
  PurchaseRegisterQuery,
  UpdatePurchaseEntryRequest,
} from '@menuboard/shared';
import { purchaseEntriesApi, purchaseRegisterApi } from '../api/purchaseEntry';

/**
 * A post rewrites stock, the vendor ledger and the payable set all at once, so everything
 * downstream of a purchase is invalidated together rather than piecemeal.
 */
function useInvalidatePurchase() {
  const qc = useQueryClient();
  return (entryId?: string): void => {
    void qc.invalidateQueries({ queryKey: ['purchase-entries'] });
    void qc.invalidateQueries({ queryKey: ['purchase-register'] });
    void qc.invalidateQueries({ queryKey: ['purchase-register-totals'] });
    void qc.invalidateQueries({ queryKey: ['stock'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
    if (entryId !== undefined) {
      void qc.invalidateQueries({ queryKey: ['purchase-entry', entryId] });
      void qc.invalidateQueries({ queryKey: ['purchase-entry-preview', entryId] });
      void qc.invalidateQueries({ queryKey: ['purchase-entry-flow', entryId] });
    }
  };
}

export function usePurchaseEntries(query: PurchaseEntryListQuery) {
  return useQuery({
    queryKey: ['purchase-entries', query],
    queryFn: () => purchaseEntriesApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function usePurchaseEntry(entryId: string | null) {
  return useQuery({
    queryKey: ['purchase-entry', entryId],
    queryFn: () => purchaseEntriesApi.get(entryId as string),
    enabled: entryId !== null && entryId !== '',
    retry: false,
  });
}

/**
 * What a post would do, asked for while the operator is still typing so an exception lands
 * before the supplier's driver has left rather than after.
 */
export function usePurchasePostPreview(entryId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['purchase-entry-preview', entryId],
    queryFn: () => purchaseEntriesApi.preview(entryId as string),
    enabled: enabled && entryId !== null && entryId !== '',
    retry: false,
  });
}

export function usePurchaseDocumentFlow(entryId: string | null) {
  return useQuery({
    queryKey: ['purchase-entry-flow', entryId],
    queryFn: () => purchaseEntriesApi.flow(entryId as string),
    enabled: entryId !== null && entryId !== '',
    retry: false,
  });
}

export function useCreatePurchaseEntry() {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: (body: CreatePurchaseEntryRequest) => purchaseEntriesApi.create(body),
    onSuccess: (entry) => invalidate(entry.id),
  });
}

export function useUpdatePurchaseEntry() {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: ({ entryId, body }: { entryId: string; body: UpdatePurchaseEntryRequest }) =>
      purchaseEntriesApi.update(entryId, body),
    onSuccess: (entry) => invalidate(entry.id),
  });
}

export function useReadyPurchaseEntry() {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: (entryId: string) => purchaseEntriesApi.ready(entryId),
    onSuccess: (entry) => invalidate(entry.id),
  });
}

export function usePostPurchaseEntry() {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: ({ entryId, body }: { entryId: string; body: PostPurchaseEntryRequest }) =>
      purchaseEntriesApi.post(entryId, body),
    onSuccess: (result) => invalidate(result.entry.id),
  });
}

export function useCancelPurchaseEntry() {
  const invalidate = useInvalidatePurchase();
  return useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason?: string }) =>
      purchaseEntriesApi.cancel(entryId, reason),
    onSuccess: (entry) => invalidate(entry.id),
  });
}

export function usePurchaseRegister(query: PurchaseRegisterQuery) {
  return useQuery({
    queryKey: ['purchase-register', query],
    queryFn: () => purchaseRegisterApi.list(query),
    placeholderData: (previous) => previous,
    retry: false,
  });
}

/**
 * The column totals over the whole filtered set. Separate from the page query because the
 * accountant reads the footer, not the page, and the page is only ever a window on the data.
 */
export function usePurchaseRegisterTotals(query: PurchaseRegisterQuery) {
  return useQuery({
    queryKey: ['purchase-register-totals', query],
    queryFn: () => purchaseRegisterApi.totals(query),
    placeholderData: (previous) => previous,
    retry: false,
  });
}
