import type {
  GstSyncRunDto,
  HsnSacCodeDto,
  HsnSacCodeType,
  HsnSacMasterSummaryDto,
  MasterStatus,
  PageQuery,
  TaxProfileDto,
  TaxProfileWriteRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export interface HsnSacSearchParams {
  q?: string;
  codeType?: HsnSacCodeType;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface TaxProfileListQuery extends PageQuery {
  status?: MasterStatus;
}

/**
 * The HSN/SAC master is read-only over the API by design — its only author is the official
 * GST/GSTN dataset, applied by `gstSyncApi.sync`.
 */
export const hsnSacApi = {
  search: (params: HsnSacSearchParams) =>
    unwrapPaged<HsnSacCodeDto>(http.get('/hsn-sac', { params })),
  get: (id: string) => unwrap<HsnSacCodeDto>(http.get(`/hsn-sac/${id}`)),
  summary: () => unwrap<HsnSacMasterSummaryDto>(http.get('/hsn-sac/summary')),
};

export const gstSyncApi = {
  /** Long-running: downloads and diffs ~22,000 records against the official source. */
  sync: () => unwrap<GstSyncRunDto>(http.post('/gst-sync', undefined, { timeout: 300_000 })),
  runs: (query: PageQuery) => unwrapPaged<GstSyncRunDto>(http.get('/gst-sync/runs', { params: query })),
  run: (id: string) => unwrap<GstSyncRunDto>(http.get(`/gst-sync/runs/${id}`)),
};

export const taxProfilesApi = {
  list: (query: TaxProfileListQuery) =>
    unwrapPaged<TaxProfileDto>(http.get('/tax-profiles', { params: query })),
  get: (id: string) => unwrap<TaxProfileDto>(http.get(`/tax-profiles/${id}`)),
  create: (body: TaxProfileWriteRequest) =>
    unwrap<TaxProfileDto>(http.post('/tax-profiles', body)),
  update: (id: string, body: Partial<TaxProfileWriteRequest>) =>
    unwrap<TaxProfileDto>(http.patch(`/tax-profiles/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/tax-profiles/${id}`)),
};
