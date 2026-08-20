import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateStockAdjustmentRequest,
  CreateStockCountRequest,
  RecordStockCountLinesRequest,
  StockAdjustmentListQuery,
  StockBalanceListQuery,
  StockBatchListQuery,
  StockCountListQuery,
  StockLedgerListQuery,
  UpdateStockAdjustmentRequest,
} from '@menuboard/shared';
import { stockAdjustmentsApi, stockApi, stockCountsApi } from '../api/stock';

/* ---------------------------------------------------------------- balances & summary */

export function useStockBalances(query: StockBalanceListQuery, enabled = true) {
  return useQuery({
    queryKey: ['stock-balances', query],
    queryFn: () => stockApi.balances(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useStockSummary(locationId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['stock-summary', locationId],
    queryFn: () => stockApi.summary(locationId === null ? {} : { locationId }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useStockLedger(query: StockLedgerListQuery, enabled = true) {
  return useQuery({
    queryKey: ['stock-ledger', query],
    queryFn: () => stockApi.ledger(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useStockBatches(query: StockBatchListQuery, enabled = true) {
  return useQuery({
    queryKey: ['stock-batches', query],
    queryFn: () => stockApi.batches(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/**
 * Anything that reaches the ledger moves the balances, the batches and the headline figures
 * with it, so they all refresh together rather than each screen having to remember to.
 */
function useInvalidateStockReads() {
  const qc = useQueryClient();
  return (): void => {
    void qc.invalidateQueries({ queryKey: ['stock-balances'] });
    void qc.invalidateQueries({ queryKey: ['stock-summary'] });
    void qc.invalidateQueries({ queryKey: ['stock-ledger'] });
    void qc.invalidateQueries({ queryKey: ['stock-batches'] });
  };
}

/* ------------------------------------------------------------------------ adjustments */

export function useStockAdjustments(query: StockAdjustmentListQuery) {
  return useQuery({
    queryKey: ['stock-adjustments', query],
    queryFn: () => stockAdjustmentsApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useStockAdjustment(id: string | null) {
  return useQuery({
    queryKey: ['stock-adjustment', id],
    queryFn: () => stockAdjustmentsApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

function useInvalidateStockAdjustments() {
  const qc = useQueryClient();
  return (id?: string): void => {
    void qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: ['stock-adjustment', id] });
  };
}

export function useCreateStockAdjustment() {
  const invalidate = useInvalidateStockAdjustments();
  return useMutation({
    mutationFn: (body: CreateStockAdjustmentRequest) => stockAdjustmentsApi.create(body),
    onSuccess: (adjustment) => invalidate(adjustment.id),
  });
}

export function useUpdateStockAdjustment() {
  const invalidate = useInvalidateStockAdjustments();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStockAdjustmentRequest }) =>
      stockAdjustmentsApi.update(id, body),
    onSuccess: (adjustment) => invalidate(adjustment.id),
  });
}

export function useSubmitStockAdjustment() {
  const invalidate = useInvalidateStockAdjustments();
  return useMutation({
    mutationFn: (id: string) => stockAdjustmentsApi.submit(id),
    onSuccess: (adjustment) => invalidate(adjustment.id),
  });
}

/** The only adjustment transition that writes stock, so the only one that clears the reads. */
export function usePostStockAdjustment() {
  const invalidate = useInvalidateStockAdjustments();
  const invalidateReads = useInvalidateStockReads();
  return useMutation({
    mutationFn: (id: string) => stockAdjustmentsApi.post(id),
    onSuccess: (adjustment) => {
      invalidate(adjustment.id);
      invalidateReads();
    },
  });
}

export function useCancelStockAdjustment() {
  const invalidate = useInvalidateStockAdjustments();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      stockAdjustmentsApi.cancel(id, reason),
    onSuccess: (adjustment) => invalidate(adjustment.id),
  });
}

/* ----------------------------------------------------------------------------- counts */

export function useStockCounts(query: StockCountListQuery) {
  return useQuery({
    queryKey: ['stock-counts', query],
    queryFn: () => stockCountsApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useStockCount(id: string | null) {
  return useQuery({
    queryKey: ['stock-count', id],
    queryFn: () => stockCountsApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

function useInvalidateStockCounts() {
  const qc = useQueryClient();
  return (id?: string): void => {
    void qc.invalidateQueries({ queryKey: ['stock-counts'] });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: ['stock-count', id] });
  };
}

export function useCreateStockCount() {
  const invalidate = useInvalidateStockCounts();
  return useMutation({
    mutationFn: (body: CreateStockCountRequest) => stockCountsApi.create(body),
    onSuccess: (count) => invalidate(count.id),
  });
}

export function useRecordStockCountLines() {
  const invalidate = useInvalidateStockCounts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RecordStockCountLinesRequest }) =>
      stockCountsApi.recordLines(id, body),
    onSuccess: (count) => invalidate(count.id),
  });
}

export function useSubmitStockCount() {
  const invalidate = useInvalidateStockCounts();
  return useMutation({
    mutationFn: (id: string) => stockCountsApi.submit(id),
    onSuccess: (count) => invalidate(count.id),
  });
}

/** Approval may turn the variance into a posted adjustment, so both worlds refresh. */
export function useApproveStockCount() {
  const invalidate = useInvalidateStockCounts();
  const invalidateAdjustments = useInvalidateStockAdjustments();
  const invalidateReads = useInvalidateStockReads();
  return useMutation({
    mutationFn: (id: string) => stockCountsApi.approve(id),
    onSuccess: (result) => {
      invalidate(result.count.id);
      invalidateAdjustments(result.adjustment?.id);
      invalidateReads();
    },
  });
}

export function useCancelStockCount() {
  const invalidate = useInvalidateStockCounts();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      stockCountsApi.cancel(id, reason),
    onSuccess: (count) => invalidate(count.id),
  });
}
