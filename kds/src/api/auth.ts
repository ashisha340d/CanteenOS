import { ClientType, type AuthenticatedUser, type LoginResponse } from '@menuboard/shared';
import { http, unwrap } from './client';
import { getDeviceId, saveRefreshToken, saveSessionUser, setAccessToken } from './session';

const DEVICE_NAME = 'KDS display';

export interface MeResponse {
  user: AuthenticatedUser;
  capabilities: string[];
}

function storeTokens(session: LoginResponse): LoginResponse {
  setAccessToken(session.tokens.accessToken);
  saveRefreshToken(session.tokens.refreshToken);
  saveSessionUser(session.user);
  return session;
}

export async function loginWithPin(identifier: string, pin: string): Promise<LoginResponse> {
  const session = await unwrap(
    http.post<{ success: true; data: LoginResponse }>('/auth/login/pin', {
      identifier,
      pin,
      deviceId: getDeviceId(),
      deviceName: DEVICE_NAME,
      clientType: ClientType.KDS,
      rememberMe: true,
    }),
  );
  return storeTokens(session);
}

export async function loginWithPassword(
  identifier: string,
  password: string,
): Promise<LoginResponse> {
  const session = await unwrap(
    http.post<{ success: true; data: LoginResponse }>('/auth/login', {
      identifier,
      password,
      deviceId: getDeviceId(),
      deviceName: DEVICE_NAME,
      clientType: ClientType.KDS,
      rememberMe: true,
    }),
  );
  return storeTokens(session);
}

// POST /auth/refresh lives in client.ts as `restoreSession`, so the interceptor's single-flight
// refresh and the boot-time restore share one path.
export { restoreSession } from './client';

export async function fetchMe(): Promise<MeResponse> {
  return unwrap(http.get<{ success: true; data: MeResponse }>('/auth/me'));
}
