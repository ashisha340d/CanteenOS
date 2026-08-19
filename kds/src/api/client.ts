import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiErrorBody, ApiResponse, AuthTokens } from '@menuboard/shared';
import { ClientType, HEADERS } from '@menuboard/shared';
import {
  clearSession,
  getAccessToken,
  getDeviceId,
  getRefreshToken,
  saveRefreshToken,
  setAccessToken,
} from './session';

const DEFAULT_API_PORT = 4000;
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}/api/v1`;

/** The API origin without the /api/v1 suffix — for publicly-served files like media. */
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

export const http = axios.create({
  baseURL: API_BASE_URL,
  headers: { [HEADERS.CLIENT_TYPE]: ClientType.KDS },
});

type SessionLostHandler = () => void;
let onSessionLost: SessionLostHandler = () => undefined;
export function setSessionLostHandler(handler: SessionLostHandler): void {
  onSessionLost = handler;
}

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  config.headers.set(HEADERS.DEVICE_ID, getDeviceId());
  return config;
});

// The backend rotates the refresh token on every use, so parallel refreshes would revoke the
// whole device chain. Every request that meets an expired token waits on the one refresh.
let refreshPromise: Promise<string | null> | null = null;

export type SessionOutcome = 'ready' | 'signed-out' | 'unreachable';

export async function restoreSession(): Promise<SessionOutcome> {
  const refreshToken = getRefreshToken();
  if (refreshToken === null) return 'signed-out';

  try {
    const response = await axios.post<ApiResponse<AuthTokens>>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken, deviceId: getDeviceId() },
      { headers: { [HEADERS.CLIENT_TYPE]: ClientType.KDS } },
    );
    if (!response.data.success) {
      clearSession();
      return 'signed-out';
    }
    setAccessToken(response.data.data.accessToken);
    saveRefreshToken(response.data.data.refreshToken);
    return 'ready';
  } catch (error) {
    // Only the server saying no ends the session; a network failure is temporary.
    if (axios.isAxiosError(error) && error.response !== undefined && error.response.status < 500) {
      clearSession();
      return 'signed-out';
    }
    return 'unreachable';
  }
}

async function refreshSession(): Promise<string | null> {
  return (await restoreSession()) === 'ready' ? getAccessToken() : null;
}

interface RetriableConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as RetriableConfig | undefined;
    const body = error.response?.data;
    const code = body && !body.success ? body.error.code : undefined;

    if (code === 'TOKEN_EXPIRED' && original && !original._retried) {
      original._retried = true;
      if (refreshPromise === null) {
        refreshPromise = refreshSession().finally(() => {
          refreshPromise = null;
        });
      }
      const token = await refreshPromise;
      if (token !== null) {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return http.request(original);
      }
      clearSession();
      onSessionLost();
      return Promise.reject(error);
    }

    if (code === 'REFRESH_REUSED' || code === 'UNAUTHENTICATED' || code === 'TOKEN_INVALID') {
      clearSession();
      onSessionLost();
    }

    return Promise.reject(error);
  },
);

export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await promise;
  if (!response.data) return undefined as T;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

export function readErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    if (body && !body.success && body.error.message) return body.error.message;
    if (error.code === 'ERR_NETWORK') return fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function readErrorCode(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    if (body && !body.success) return body.error.code;
  }
  return null;
}
