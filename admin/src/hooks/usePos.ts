import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePosOrderRequest,
  PosAnalyticsQuery,
  PosCheckoutRequest,
  PosOrderListQuery,
  PosVoidRequest,
  UpdatePosOrderRequest,
  UpdatePosOrderStatusRequest,
} from '@menuboard/shared';
import {
  posAnalyticsApi,
  posApi,
  type PosDashboardQuery,
  type PosTopItemsQuery,
} from '../api/pos';

/**
 * The dashboard is a live work queue, so it polls.
 *
 * The portal has no socket client (docs/ARCHITECTURE.md §6.4 makes realtime an Android
 * concern), and a counter screen that only refreshes on navigation would quietly hide a
 * ticket another terminal just took. Fifteen seconds is short enough to feel current and long
 * enough not to matter.
 */
const DASHBOARD_REFRESH_MS = 15_000;

export function usePosDashboard(query: PosDashboardQuery = {}) {
  return useQuery({
    queryKey: ['pos-dashboard', query],
    queryFn: () => posApi.dashboard(query),
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function usePosOrders(query: PosOrderListQuery) {
  return useQuery({
    queryKey: ['pos-orders', query],
    queryFn: () => posApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function usePosOrder(id: string | null) {
  return useQuery({
    queryKey: ['pos-order', id],
    queryFn: () => posApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

/**
 * The sales widgets sit on the desktop for a whole shift, so they refresh on the same
 * fifteen-second beat as the dashboard rather than only when the operator navigates. Any POS
 * write made from this workstation also invalidates them immediately, so the figures move the
 * moment the operator settles a ticket instead of up to fifteen seconds later.
 */
export function usePosSalesSummary(query: PosAnalyticsQuery, enabled = true) {
  return useQuery({
    queryKey: ['pos-analytics', 'sales', query],
    queryFn: () => posAnalyticsApi.sales(query),
    enabled,
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function usePosTopItems(query: PosTopItemsQuery, enabled = true) {
  return useQuery({
    queryKey: ['pos-analytics', 'top-items', query],
    queryFn: () => posAnalyticsApi.topItems(query),
    enabled,
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function usePosBusyHours(query: PosAnalyticsQuery, enabled = true) {
  return useQuery({
    queryKey: ['pos-analytics', 'busy-hours', query],
    queryFn: () => posAnalyticsApi.busyHours(query),
    enabled,
    refetchInterval: DASHBOARD_REFRESH_MS,
    placeholderData: (previous) => previous,
  });
}

/** Every POS write moves the dashboard, so all of them invalidate it. */
function useInvalidatePos() {
  const qc = useQueryClient();
  return (id?: string): void => {
    void qc.invalidateQueries({ queryKey: ['pos-dashboard'] });
    void qc.invalidateQueries({ queryKey: ['pos-orders'] });
    void qc.invalidateQueries({ queryKey: ['pos-analytics'] });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: ['pos-order', id] });
  };
}

export function useCreatePosOrder() {
  const invalidate = useInvalidatePos();
  return useMutation({
    mutationFn: (body: CreatePosOrderRequest) => posApi.create(body),
    onSuccess: (order) => invalidate(order.id),
  });
}

export function useUpdatePosOrder() {
  const invalidate = useInvalidatePos();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePosOrderRequest }) =>
      posApi.update(id, body),
    onSuccess: (order) => invalidate(order.id),
  });
}

export function useSetPosOrderStatus() {
  const invalidate = useInvalidatePos();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePosOrderStatusRequest }) =>
      posApi.setStatus(id, body),
    onSuccess: (order) => invalidate(order.id),
  });
}

export function useCheckoutPosOrder() {
  const invalidate = useInvalidatePos();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PosCheckoutRequest }) =>
      posApi.checkout(id, body),
    onSuccess: (order) => invalidate(order.id),
  });
}

export function useVoidPosOrder() {
  const invalidate = useInvalidatePos();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PosVoidRequest }) => posApi.void(id, body),
    onSuccess: (order) => invalidate(order.id),
  });
}
