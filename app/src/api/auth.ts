import type {
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RegisterPushTokenRequest,
} from '@menuboard/shared';
import { apiClient, unwrap } from './client';

export const authApi = {
  async login(request: LoginRequest): Promise<LoginResponse> {
    const response = await apiClient.post<{ success: true; data: LoginResponse }>(
      '/auth/login',
      request,
    );
    return unwrap(response);
  },

  async me(): Promise<{ user: AuthenticatedUser; capabilities: string[] }> {
    const response = await apiClient.get('/auth/me');
    return unwrap(response);
  },

  async logout(refreshToken?: string): Promise<void> {
    await apiClient.post('/auth/logout', { refreshToken });
  },

  async changePassword(request: ChangePasswordRequest): Promise<void> {
    await apiClient.post('/auth/password', request);
  },

  async registerPushToken(request: RegisterPushTokenRequest): Promise<void> {
    await apiClient.post('/auth/push-token', request);
  },
};
