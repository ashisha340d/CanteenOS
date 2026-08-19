import type {
  CdsBillDto,
  CounterDto,
  KdsConfigDto,
  KdsExchangeRequest,
  KdsMetricsDto,
  KdsQueueDto,
  KdsRecentActionDto,
  KdsStationKind,
  KdsStationMenuDto,
  KdsStationMenuUpsertRequest,
  MenuTreeDto,
  PrintingGroupDto,
  Uuid,
} from '@menuboard/shared';
import { http, unwrap } from './client';

export async function fetchKdsConfig(): Promise<KdsConfigDto> {
  return unwrap(http.get<{ success: true; data: KdsConfigDto }>('/kds/config'));
}

export async function listCounters(): Promise<CounterDto[]> {
  return unwrap(http.get<{ success: true; data: CounterDto[] }>('/kds/counters'));
}

export async function listKitchenGroups(): Promise<PrintingGroupDto[]> {
  return unwrap(http.get<{ success: true; data: PrintingGroupDto[] }>('/kds/kitchen-groups'));
}

export async function fetchCounterQueue(counterId: Uuid): Promise<KdsQueueDto> {
  return unwrap(
    http.get<{ success: true; data: KdsQueueDto }>(`/kds/counter/${counterId}/queue`),
  );
}

export async function fetchCounterMetrics(counterId: Uuid): Promise<KdsMetricsDto> {
  return unwrap(
    http.get<{ success: true; data: KdsMetricsDto }>(`/kds/counter/${counterId}/metrics`),
  );
}

export async function fetchRecentActions(counterId: Uuid): Promise<KdsRecentActionDto[]> {
  return unwrap(
    http.get<{ success: true; data: KdsRecentActionDto[] }>(
      `/kds/counter/${counterId}/recent-actions`,
    ),
  );
}

export async function fetchKitchenQueue(printingGroupId: Uuid): Promise<KdsQueueDto> {
  return unwrap(
    http.get<{ success: true; data: KdsQueueDto }>(`/kds/kitchen/${printingGroupId}/queue`),
  );
}

export async function acknowledgeLine(lineId: Uuid): Promise<void> {
  return unwrap(http.post<{ success: true; data: void }>(`/kds/lines/${lineId}/acknowledge`));
}

export async function serveLine(lineId: Uuid): Promise<void> {
  return unwrap(http.post<{ success: true; data: void }>(`/kds/lines/${lineId}/serve`));
}

export async function revertLine(lineId: Uuid): Promise<void> {
  return unwrap(http.post<{ success: true; data: void }>(`/kds/lines/${lineId}/revert`));
}

export async function serveAll(orderId: Uuid, counterId: Uuid): Promise<void> {
  return unwrap(
    http.post<{ success: true; data: void }>(`/kds/orders/${orderId}/serve-all`, { counterId }),
  );
}

export async function exchangeOrder(orderId: Uuid, body: KdsExchangeRequest): Promise<void> {
  return unwrap(
    http.post<{ success: true; data: void }>(`/kds/orders/${orderId}/exchange`, body),
  );
}

export async function fetchCdsBill(counterId: Uuid): Promise<CdsBillDto | null> {
  return unwrap(
    http.get<{ success: true; data: CdsBillDto | null }>(`/kds/cds/counter/${counterId}/bill`),
  );
}

/** What this counter is allowed to sell in an exchange — resolved sellables with prices. */
export async function fetchSellables(counterId: Uuid): Promise<MenuTreeDto> {
  return unwrap(http.get<{ success: true; data: MenuTreeDto }>(`/kds/counter/${counterId}/sellables`));
}

/** The station's own menu file — renames and finished flags on top of the published menu. */
export async function fetchStationMenu(
  kind: KdsStationKind,
  stationId: Uuid,
): Promise<KdsStationMenuDto> {
  return unwrap(
    http.get<{ success: true; data: KdsStationMenuDto }>(`/kds/station/${kind}/${stationId}/menu`),
  );
}

export async function saveStationMenuItem(
  kind: KdsStationKind,
  stationId: Uuid,
  menuItemId: Uuid,
  body: KdsStationMenuUpsertRequest,
): Promise<void> {
  return unwrap(
    http.put<{ success: true; data: void }>(
      `/kds/station/${kind}/${stationId}/menu/${menuItemId}`,
      body,
    ),
  );
}
