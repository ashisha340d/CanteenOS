import type {
  CounterChatSummaryDto,
  CounterChatThreadDto,
  CounterMessageDto,
  Uuid,
} from '@menuboard/shared';
import { http, unwrap } from './client';

export const counterChatApi = {
  /** Every counter, its last word, and what is waiting on the office. */
  async summaries(): Promise<CounterChatSummaryDto[]> {
    return unwrap(
      http.get<{ success: true; data: CounterChatSummaryDto[] }>('/counter-chat'),
    );
  },

  async thread(counterId: Uuid): Promise<CounterChatThreadDto> {
    return unwrap(
      http.get<{ success: true; data: CounterChatThreadDto }>(`/counter-chat/${counterId}`),
    );
  },

  async send(counterId: Uuid, body: string, orderId: Uuid | null): Promise<CounterMessageDto> {
    return unwrap(
      http.post<{ success: true; data: CounterMessageDto }>(
        `/counter-chat/${counterId}/messages`,
        { body, orderId },
      ),
    );
  },

  async ringBell(counterId: Uuid): Promise<CounterMessageDto> {
    return unwrap(
      http.post<{ success: true; data: CounterMessageDto }>(`/counter-chat/${counterId}/bell`, {}),
    );
  },

  /** Ends a ring in progress — the office hanging up. */
  async hangUp(counterId: Uuid): Promise<{ ended: true }> {
    return unwrap(
      http.post<{ success: true; data: { ended: true } }>(
        `/counter-chat/${counterId}/bell/hangup`,
        {},
      ),
    );
  },

  /** Empties a counter's thread on both sides. */
  async clear(counterId: Uuid): Promise<{ cleared: number }> {
    return unwrap(
      http.delete<{ success: true; data: { cleared: number } }>(
        `/counter-chat/${counterId}/messages`,
      ),
    );
  },

  async markRead(counterId: Uuid): Promise<{ unreadCount: number }> {
    return unwrap(
      http.post<{ success: true; data: { unreadCount: number } }>(
        `/counter-chat/${counterId}/read`,
        {},
      ),
    );
  },
};
