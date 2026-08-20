import type {
  CreateStockAdjustmentRequest,
  CreateStockCountRequest,
  RecordStockCountLinesRequest,
  StockAdjustmentDto,
  StockAdjustmentListQuery,
  StockBalanceDto,
  StockBalanceListQuery,
  StockBatchDto,
  StockBatchListQuery,
  StockCountApprovalResultDto,
  StockCountDto,
  StockCountListQuery,
  StockLedgerEntryDto,
  StockLedgerListQuery,
  StockSummaryDto,
  UpdateStockAdjustmentRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

const BASE = '/purchase/stock';

export interface StockSummaryQuery {
  locationId?: string;
}

export const stockApi = {
  balances: (query: StockBalanceListQuery) =>
    unwrapPaged<StockBalanceDto>(http.get(`${BASE}/balances`, { params: query })),
  summary: (query: StockSummaryQuery) =>
    unwrap<StockSummaryDto>(http.get(`${BASE}/summary`, { params: query })),
  ledger: (query: StockLedgerListQuery) =>
    unwrapPaged<StockLedgerEntryDto>(http.get(`${BASE}/ledger`, { params: query })),
  batches: (query: StockBatchListQuery) =>
    unwrapPaged<StockBatchDto>(http.get(`${BASE}/batches`, { params: query })),
};

export const stockAdjustmentsApi = {
  list: (query: StockAdjustmentListQuery) =>
    unwrapPaged<StockAdjustmentDto>(http.get(`${BASE}/adjustments`, { params: query })),
  get: (id: string) => unwrap<StockAdjustmentDto>(http.get(`${BASE}/adjustments/${id}`)),
  create: (body: CreateStockAdjustmentRequest) =>
    unwrap<StockAdjustmentDto>(http.post(`${BASE}/adjustments`, body)),
  update: (id: string, body: UpdateStockAdjustmentRequest) =>
    unwrap<StockAdjustmentDto>(http.patch(`${BASE}/adjustments/${id}`, body)),
  submit: (id: string) =>
    unwrap<StockAdjustmentDto>(http.post(`${BASE}/adjustments/${id}/submit`)),
  post: (id: string) => unwrap<StockAdjustmentDto>(http.post(`${BASE}/adjustments/${id}/post`)),
  cancel: (id: string, reason?: string) =>
    unwrap<StockAdjustmentDto>(http.post(`${BASE}/adjustments/${id}/cancel`, { reason })),
};

export const stockCountsApi = {
  list: (query: StockCountListQuery) =>
    unwrapPaged<StockCountDto>(http.get(`${BASE}/counts`, { params: query })),
  get: (id: string) => unwrap<StockCountDto>(http.get(`${BASE}/counts/${id}`)),
  create: (body: CreateStockCountRequest) =>
    unwrap<StockCountDto>(http.post(`${BASE}/counts`, body)),
  recordLines: (id: string, body: RecordStockCountLinesRequest) =>
    unwrap<StockCountDto>(http.patch(`${BASE}/counts/${id}/lines`, body)),
  submit: (id: string) => unwrap<StockCountDto>(http.post(`${BASE}/counts/${id}/submit`)),
  approve: (id: string) =>
    unwrap<StockCountApprovalResultDto>(http.post(`${BASE}/counts/${id}/approve`)),
  cancel: (id: string, reason?: string) =>
    unwrap<StockCountDto>(http.post(`${BASE}/counts/${id}/cancel`, { reason })),
};
