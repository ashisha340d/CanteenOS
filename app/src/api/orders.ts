import type {
  CreateOrderRequest,
  CreateThreadMessageRequest,
  OrderDetailDto,
  OrderDto,
  OrderListQuery,
  Paginated,
  ThreadMessageDto,
  UpdateOrderRequest,
  UpdateOrderStatusRequest,
} from '@menuboard/shared';
import { apiClient, unwrap } from './client';

export const ordersApi = {
  async list(query: OrderListQuery): Promise<Paginated<OrderDto>> {
    const response = await apiClient.get('/orders', { params: query });
    return unwrap(response);
  },
  async getDetail(orderId: string): Promise<OrderDetailDto> {
    const response = await apiClient.get(`/orders/${orderId}`);
    return unwrap(response);
  },
  async getThread(orderId: string, params?: { limit?: number; before?: string }): Promise<Paginated<ThreadMessageDto> | ThreadMessageDto[]> {
    const response = await apiClient.get(`/orders/${orderId}/thread`, { params });
    return unwrap(response);
  },
  // Present for completeness of the funnel; Phase 4 does not call these directly because
  // creates/edits/status-changes/thread posts/acks are local-first (see src/db/repositories)
  // and reach the server only through the Phase 5/6 sync queue.
  async create(request: CreateOrderRequest): Promise<OrderDetailDto> {
    const response = await apiClient.post('/orders', request);
    return unwrap(response);
  },
  async update(orderId: string, request: UpdateOrderRequest): Promise<OrderDetailDto> {
    const response = await apiClient.patch(`/orders/${orderId}`, request);
    return unwrap(response);
  },
  async updateStatus(orderId: string, request: UpdateOrderStatusRequest): Promise<OrderDto> {
    const response = await apiClient.post(`/orders/${orderId}/status`, request);
    return unwrap(response);
  },
  async postThreadMessage(orderId: string, request: CreateThreadMessageRequest): Promise<ThreadMessageDto> {
    const response = await apiClient.post(`/orders/${orderId}/thread`, request);
    return unwrap(response);
  },
};
