import type {
  CounterChatThreadDto,
  CounterMessageDto,
  CounterOrderTagDto,
  Uuid,
} from '@menuboard/shared';
import { http, unwrap } from './client';

export async function fetchThread(counterId: Uuid): Promise<CounterChatThreadDto> {
  return unwrap(
    http.get<{ success: true; data: CounterChatThreadDto }>(`/counter-chat/${counterId}`),
  );
}

export async function sendMessage(
  counterId: Uuid,
  body: string,
  orderId: Uuid | null = null,
): Promise<CounterMessageDto> {
  return unwrap(
    http.post<{ success: true; data: CounterMessageDto }>(
      `/counter-chat/${counterId}/messages`,
      { body, orderId },
    ),
  );
}

export async function markChatRead(counterId: Uuid): Promise<{ unreadCount: number }> {
  return unwrap(
    http.post<{ success: true; data: { unreadCount: number } }>(
      `/counter-chat/${counterId}/read`,
      {},
    ),
  );
}

/** Hindi for one message, on demand — what the auto-translate switch calls. */
export async function translateMessage(
  counterId: Uuid,
  messageId: Uuid,
): Promise<CounterMessageDto> {
  return unwrap(
    http.post<{ success: true; data: CounterMessageDto }>(
      `/counter-chat/${counterId}/messages/${messageId}/translate`,
      {},
    ),
  );
}

/** Which order cards on this board carry a message, for the chat badge on a card. */
export async function fetchOrderTags(counterId: Uuid): Promise<CounterOrderTagDto[]> {
  return unwrap(
    http.get<{ success: true; data: CounterOrderTagDto[] }>(
      `/counter-chat/${counterId}/order-tags`,
    ),
  );
}
