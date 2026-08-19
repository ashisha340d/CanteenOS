import type { KdsMetricsDto, KdsRecentActionDto } from '@menuboard/shared';
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
};
