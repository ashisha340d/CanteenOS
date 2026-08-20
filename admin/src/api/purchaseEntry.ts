import type {
  ApiResponse,
  CreatePurchaseEntryRequest,
  DocumentFlowDto,
  PostPurchaseEntryRequest,
  PostPurchaseEntryResultDto,
  PurchaseEntryDto,
  PurchaseEntryListQuery,
  PurchasePostPreviewDto,
  PurchaseRegisterQuery,
  PurchaseRegisterRowDto,
  PurchaseRegisterTotalsDto,
  UpdatePurchaseEntryRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged, type PageMeta } from './client';

const BASE = '/purchase';

/** The register's `meta` carries the whole-filter totals alongside the paging block. */
export interface RegisterMeta extends PageMeta {
  totals?: PurchaseRegisterTotalsDto;
}

export interface PurchaseRegisterPage {
  items: PurchaseRegisterRowDto[];
  meta: RegisterMeta;
}

export const purchaseEntriesApi = {
  list: (query: PurchaseEntryListQuery) =>
    unwrapPaged<PurchaseEntryDto>(http.get(`${BASE}/entries`, { params: query })),

  get: (entryId: string) => unwrap<PurchaseEntryDto>(http.get(`${BASE}/entries/${entryId}`)),

  create: (body: CreatePurchaseEntryRequest) =>
    unwrap<PurchaseEntryDto>(http.post(`${BASE}/entries`, body)),

  update: (entryId: string, body: UpdatePurchaseEntryRequest) =>
    unwrap<PurchaseEntryDto>(http.patch(`${BASE}/entries/${entryId}`, body)),

  ready: (entryId: string) =>
    unwrap<PurchaseEntryDto>(http.post(`${BASE}/entries/${entryId}/ready`, {})),

  preview: (entryId: string) =>
    unwrap<PurchasePostPreviewDto>(http.get(`${BASE}/entries/${entryId}/preview`)),

  post: (entryId: string, body: PostPurchaseEntryRequest) =>
    unwrap<PostPurchaseEntryResultDto>(http.post(`${BASE}/entries/${entryId}/post`, body)),

  cancel: (entryId: string, reason?: string) =>
    unwrap<PurchaseEntryDto>(http.post(`${BASE}/entries/${entryId}/cancel`, { reason })),

  flow: (entryId: string) => unwrap<DocumentFlowDto>(http.get(`${BASE}/entries/${entryId}/flow`)),
};

export const purchaseRegisterApi = {
  list: async (query: PurchaseRegisterQuery): Promise<PurchaseRegisterPage> => {
    const response = await http.get<ApiResponse<PurchaseRegisterRowDto[]> & { meta?: RegisterMeta }>(
      `${BASE}/register`,
      { params: query },
    );
    if (!response.data.success) throw new Error(response.data.error.message);
    const rows = response.data.data;
    const meta = response.data.meta ?? {
      page: 1,
      pageSize: rows.length,
      total: rows.length,
      totalPages: 1,
    };
    return { items: rows, meta };
  },

  totals: (query: PurchaseRegisterQuery) =>
    unwrap<PurchaseRegisterTotalsDto>(http.get(`${BASE}/register/totals`, { params: query })),
};
