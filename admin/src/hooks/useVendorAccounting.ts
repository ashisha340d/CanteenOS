import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountsPayableListQuery,
  CreateVendorPaymentRequest,
  GoodsReceiptListQuery,
  PurchaseInvoiceListQuery,
  VendorLedgerListQuery,
  VendorPaymentListQuery,
} from '@menuboard/shared';
import {
  goodsReceiptsApi,
  payablesApi,
  purchaseInvoicesApi,
  vendorLedgerApi,
  vendorPaymentsApi,
  type VendorAgeingQuery,
  type VendorStatementQuery,
} from '../api/vendorAccounting';

/**
 * Paying a supplier moves the payable, the ledger, the statement, the ageing and the invoice
 * that produced it all at once, so they refresh together rather than each screen remembering
 * to. Queueing touches only the payable set, but the queue screen reads the same key.
 */
function useInvalidateVendorAccounting() {
  const qc = useQueryClient();
  return (): void => {
    void qc.invalidateQueries({ queryKey: ['payables'] });
    void qc.invalidateQueries({ queryKey: ['vendor-payments'] });
    void qc.invalidateQueries({ queryKey: ['vendor-ledger'] });
    void qc.invalidateQueries({ queryKey: ['vendor-statement'] });
    void qc.invalidateQueries({ queryKey: ['vendor-ageing'] });
    void qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
  };
}

/* ------------------------------------------------------------------ vendor ledger */

export function useVendorLedger(query: VendorLedgerListQuery, enabled = true) {
  return useQuery({
    queryKey: ['vendor-ledger', query],
    queryFn: () => vendorLedgerApi.list(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useVendorStatement(
  supplierId: string | null,
  query: VendorStatementQuery,
  enabled = true,
) {
  return useQuery({
    queryKey: ['vendor-statement', supplierId, query],
    queryFn: () => vendorLedgerApi.statement(supplierId as string, query),
    enabled: enabled && supplierId !== null && supplierId !== '',
    placeholderData: (previous) => previous,
  });
}

export function useVendorAgeing(query: VendorAgeingQuery, enabled = true) {
  return useQuery({
    queryKey: ['vendor-ageing', query],
    queryFn: () => vendorLedgerApi.ageing(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/* ---------------------------------------------------------------------- payables */

export function usePayables(query: AccountsPayableListQuery, enabled = true) {
  return useQuery({
    queryKey: ['payables', query],
    queryFn: () => payablesApi.list(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useQueuePayable() {
  const invalidate = useInvalidateVendorAccounting();
  return useMutation({
    mutationFn: (payableId: string) => payablesApi.queue(payableId),
    onSuccess: () => invalidate(),
  });
}

/* ---------------------------------------------------------------------- payments */

export function useVendorPayments(query: VendorPaymentListQuery, enabled = true) {
  return useQuery({
    queryKey: ['vendor-payments', query],
    queryFn: () => vendorPaymentsApi.list(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/**
 * One payment, with its allocations. Fetched only when a row is expanded — the list endpoint
 * omits allocations deliberately, so this is what answers "which bills did this settle".
 */
export function useVendorPayment(paymentId: string | null) {
  return useQuery({
    queryKey: ['vendor-payment', paymentId],
    queryFn: () => vendorPaymentsApi.get(paymentId as string),
    enabled: paymentId !== null,
  });
}

export function useCreateVendorPayment() {
  const invalidate = useInvalidateVendorAccounting();
  return useMutation({
    mutationFn: (body: CreateVendorPaymentRequest) => vendorPaymentsApi.create(body),
    onSuccess: () => invalidate(),
  });
}

/* ------------------------------------------------------------ generated documents */

export function usePurchaseInvoices(query: PurchaseInvoiceListQuery, enabled = true) {
  return useQuery({
    queryKey: ['purchase-invoices', query],
    queryFn: () => purchaseInvoicesApi.list(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function usePurchaseInvoice(invoiceId: string | null) {
  return useQuery({
    queryKey: ['purchase-invoice', invoiceId],
    queryFn: () => purchaseInvoicesApi.get(invoiceId as string),
    enabled: invoiceId !== null && invoiceId !== '',
    retry: false,
  });
}

export function useGoodsReceipts(query: GoodsReceiptListQuery, enabled = true) {
  return useQuery({
    queryKey: ['goods-receipts', query],
    queryFn: () => goodsReceiptsApi.list(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useGoodsReceipt(receiptId: string | null) {
  return useQuery({
    queryKey: ['goods-receipt', receiptId],
    queryFn: () => goodsReceiptsApi.get(receiptId as string),
    enabled: receiptId !== null && receiptId !== '',
    retry: false,
  });
}
