import type {
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  PinLoginRequest,
  RegisterPushTokenRequest,
  RemovePinRequest,
  SetPinRequest,
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

  async loginWithPin(request: PinLoginRequest): Promise<LoginResponse> {
    const response = await apiClient.post<{ success: true; data: LoginResponse }>(
      '/auth/login/pin',
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

  async pinStatus(): Promise<{ hasPin: boolean }> {
    const response = await apiClient.get('/auth/pin/status');
    return unwrap(response);
  },

  async setPin(request: SetPinRequest): Promise<void> {
    await apiClient.post('/auth/pin', request);
  },

  async removePin(request: RemovePinRequest): Promise<void> {
    await apiClient.post('/auth/pin/remove', request);
  },

  async registerPushToken(request: RegisterPushTokenRequest): Promise<void> {
    await apiClient.post('/auth/push-token', request);
  },
};
