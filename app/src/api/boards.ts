import type { BoardWithMembersDto, Paginated } from '@menuboard/shared';
import { apiClient, unwrap } from './client';

export const boardsApi = {
  async list(params?: { page?: number; pageSize?: number }): Promise<Paginated<BoardWithMembersDto>> {
    const response = await apiClient.get('/boards', { params: { withCounts: true, ...params } });
    return unwrap(response);
  },

  async getById(boardId: string): Promise<BoardWithMembersDto> {
    const response = await apiClient.get(`/boards/${boardId}`);
    return unwrap(response);
  },
};
