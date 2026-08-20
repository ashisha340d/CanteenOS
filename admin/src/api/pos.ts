import type {
  CreatePosOrderRequest,
  PosAnalyticsQuery,
  PosBusyHourDto,
  PosCheckoutRequest,
  PosDashboardDto,
  PosOrderDetailDto,
  PosOrderDto,
  PosOrderListQuery,
  PosSalesSummaryDto,
  PosTopItemDto,
  PosVoidRequest,
  UpdatePosOrderRequest,
  UpdatePosOrderStatusRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export interface PosDashboardQuery {
  businessDate?: string;
  stationId?: string;
  counterId?: string;
}

export interface PosTopItemsQuery extends PosAnalyticsQuery {
  limit?: number;
}

/**
 * The till.
 *
 * Every write returns the whole recalculated ticket, so the screen never has to guess what
 * the server did to the totals — it renders what came back.
 */
export const posApi = {
  dashboard: (query: PosDashboardQuery = {}) =>
    unwrap<PosDashboardDto>(http.get('/pos/dashboard', { params: query })),
  list: (query: PosOrderListQuery) =>
    unwrapPaged<PosOrderDto>(http.get('/pos/orders', { params: query })),
  get: (id: string) => unwrap<PosOrderDetailDto>(http.get(`/pos/orders/${id}`)),
  create: (body: CreatePosOrderRequest) =>
    unwrap<PosOrderDetailDto>(http.post('/pos/orders', body)),
  update: (id: string, body: UpdatePosOrderRequest) =>
    unwrap<PosOrderDetailDto>(http.patch(`/pos/orders/${id}`, body)),
  setStatus: (id: string, body: UpdatePosOrderStatusRequest) =>
    unwrap<PosOrderDetailDto>(http.post(`/pos/orders/${id}/status`, body)),
  checkout: (id: string, body: PosCheckoutRequest) =>
    unwrap<PosOrderDetailDto>(http.post(`/pos/orders/${id}/checkout`, body)),
  void: (id: string, body: PosVoidRequest) =>
    unwrap<PosOrderDetailDto>(http.post(`/pos/orders/${id}/void`, body)),
};

/**
 * What the till sold, rather than what it is doing. Three reads because the three desktop
 * widgets they feed are added independently — a desktop showing only the clock must not pay
 * for a top-items query nobody asked to see.
 */
export const posAnalyticsApi = {
  sales: (query: PosAnalyticsQuery) =>
    unwrap<PosSalesSummaryDto>(http.get('/pos/analytics/sales', { params: query })),
  topItems: (query: PosTopItemsQuery) =>
    unwrap<PosTopItemDto[]>(http.get('/pos/analytics/top-items', { params: query })),
  busyHours: (query: PosAnalyticsQuery) =>
    unwrap<PosBusyHourDto[]>(http.get('/pos/analytics/busy-hours', { params: query })),
};
