import type { KdsMetricsDto, KdsQueueDto, KdsRecentActionDto } from '@menuboard/shared';
import { http, unwrap } from './client';

/**
 * Read-only views over the KDS flow for the front desk: what a counter has just served, and
 * its board metrics. Mutations stay on the wall display.
 */
export const kdsApi = {
  recentActions: (counterId: string) =>
    unwrap<KdsRecentActionDto[]>(http.get(`/kds/counter/${counterId}/recent-actions`)),
  metrics: (counterId: string) =>
    unwrap<KdsMetricsDto>(http.get(`/kds/counter/${counterId}/metrics`)),
  /**
   * What is still open on a counter's board. Used by the chat composer to offer the orders a
   * message can be tagged to — deliberately this endpoint rather than a new "recent orders"
   * one, because "not yet served" is exactly what the board already means by its queue.
   */
  counterQueue: (counterId: string) =>
    unwrap<KdsQueueDto>(http.get(`/kds/counter/${counterId}/queue`)),
};
