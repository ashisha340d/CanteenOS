import type {
  AccountsPayableDto,
  AccountsPayableListQuery,
  CreateVendorPaymentRequest,
  GoodsReceiptDto,
  GoodsReceiptListQuery,
  IsoDate,
  PurchaseInvoiceDto,
  PurchaseInvoiceListQuery,
  VendorAgeingRowDto,
  VendorLedgerEntryDto,
  VendorLedgerListQuery,
  VendorPaymentDto,
  VendorPaymentListQuery,
  VendorStatementDto,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

const BASE = '/purchase';

export interface VendorStatementQuery {
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

export interface VendorAgeingQuery {
  supplierId?: string;
}

export const vendorLedgerApi = {
  list: (query: VendorLedgerListQuery) =>
    unwrapPaged<VendorLedgerEntryDto>(http.get(`${BASE}/vendor-ledger`, { params: query })),
  statement: (supplierId: string, query: VendorStatementQuery) =>
    unwrap<VendorStatementDto>(
      http.get(`${BASE}/vendor-ledger/${supplierId}/statement`, { params: query }),
    ),
  ageing: (query: VendorAgeingQuery) =>
    unwrap<VendorAgeingRowDto[]>(http.get(`${BASE}/vendor-ledger/ageing`, { params: query })),
};

export const payablesApi = {
  list: (query: AccountsPayableListQuery) =>
    unwrapPaged<AccountsPayableDto>(http.get(`${BASE}/payables`, { params: query })),
  queue: (payableId: string) =>
    unwrap<AccountsPayableDto>(http.post(`${BASE}/payables/${payableId}/queue`, {})),
};

export const vendorPaymentsApi = {
  list: (query: VendorPaymentListQuery) =>
    unwrapPaged<VendorPaymentDto>(http.get(`${BASE}/payments`, { params: query })),
  /**
   * Reading one payment carries its allocations; the list deliberately does not, because
   * loading them for every row would be an N+1 across the page.
   */
  get: (paymentId: string) =>
    unwrap<VendorPaymentDto>(http.get(`${BASE}/payments/${paymentId}`)),
  create: (body: CreateVendorPaymentRequest) =>
    unwrap<VendorPaymentDto>(http.post(`${BASE}/payments`, body)),
};

export const purchaseInvoicesApi = {
  list: (query: PurchaseInvoiceListQuery) =>
    unwrapPaged<PurchaseInvoiceDto>(http.get(`${BASE}/invoices`, { params: query })),
  get: (invoiceId: string) =>
    unwrap<PurchaseInvoiceDto>(http.get(`${BASE}/invoices/${invoiceId}`)),
};

export const goodsReceiptsApi = {
  list: (query: GoodsReceiptListQuery) =>
    unwrapPaged<GoodsReceiptDto>(http.get(`${BASE}/receipts`, { params: query })),
  get: (receiptId: string) => unwrap<GoodsReceiptDto>(http.get(`${BASE}/receipts/${receiptId}`)),
};
