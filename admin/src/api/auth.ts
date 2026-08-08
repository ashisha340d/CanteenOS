import type {
  AuthTokens,
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
} from '@menuboard/shared';
import { http, unwrap } from './client';

export const authApi = {
  login: (body: LoginRequest) => unwrap<LoginResponse>(http.post('/auth/login', body)),

  refresh: (refreshToken: string, deviceId: string) =>
    unwrap<AuthTokens>(http.post('/auth/refresh', { refreshToken, deviceId })),

  logout: (refreshToken?: string, allDevices?: boolean) =>
    unwrap<null>(http.post('/auth/logout', { refreshToken, allDevices })),

  me: () => unwrap<{ user: AuthenticatedUser; capabilities: string[] }>(http.get('/auth/me')),

  changePassword: (body: ChangePasswordRequest) =>
    unwrap<null>(http.post('/auth/password', body)),
};
