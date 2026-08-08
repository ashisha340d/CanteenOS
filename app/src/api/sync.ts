import type { SyncPullRequest, SyncPullResponse, SyncPushRequest, SyncPushResponse } from '@menuboard/shared';
import { apiClient, unwrap } from './client';

export const syncApi = {
  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const response = await apiClient.post('/sync/push', request);
    return unwrap(response);
  },

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const response = await apiClient.post('/sync/pull', request);
    return unwrap(response);
  },

  async status(): Promise<{ cursor: number; serverTime: string }> {
    const response = await apiClient.get('/sync/status');
    return unwrap(response);
  },
};
