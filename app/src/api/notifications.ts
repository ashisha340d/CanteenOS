import type { NotificationDto, Paginated } from '@menuboard/shared';
import { apiClient, unwrap } from './client';

export const notificationsApi = {
  async list(params?: { unreadOnly?: boolean; page?: number; pageSize?: number }): Promise<Paginated<NotificationDto>> {
    const response = await apiClient.get('/notifications', { params });
    return unwrap(response);
  },

  async remove(id: string): Promise<{ removed: boolean; cursor: number }> {
    const response = await apiClient.delete(`/notifications/${id}`);
    return unwrap(response);
  },
};
