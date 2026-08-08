import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { ApiErrorBody, ApiResponse, AuthTokens } from '@menuboard/shared';
import { ClientType, ERROR_CODES, HEADERS } from '@menuboard/shared';
import { secureTokenStore } from '../utils/secureTokenStore';
import { getOrCreateDeviceId } from '../utils/deviceId';

/**
 * The single axios-backed API funnel for the whole app (per app/AGENTS.md). Every domain
 * module in `src/api/*` goes through this instance — nothing else in the app constructs
 * its own axios client or calls `fetch` against the backend directly.
 */
/**
 * `apiBaseUrl` is `10.0.2.2`, the Android emulator's alias for the host machine — a browser
 * cannot resolve it, so the web development target reads `apiBaseUrlWeb` instead. Exported so
 * `socketClient.ts` derives the same host rather than re-deciding the platform split.
 */
export const API_BASE_URL: string =
  (Platform.OS === 'web'
    ? (Constants.expoConfig?.extra?.apiBaseUrlWeb as string | undefined)
    : undefined) ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'http://10.0.2.2:4000/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

export class ApiError extends Error {
  code: string;
  details?: ApiErrorBody['error']['details'];
  constructor(body: ApiErrorBody['error']) {
    super(body.message);
    this.code = body.code;
    this.details = body.details;
  }
}

/** Extracts `.data` from the envelope, or throws a typed `ApiError` keyed on `error.code`. */
export function unwrap<T>(response: { data: ApiResponse<T> }): T {
  const body = response.data;
  if (body.success) return body.data;
  throw new ApiError(body.error);
}

let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = secureTokenStore.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  config.headers.set(HEADERS.CLIENT_TYPE, ClientType.ANDROID);
  config.headers.set(HEADERS.DEVICE_ID, await getOrCreateDeviceId());
  return config;
});

/**
 * Rotating-refresh discipline (docs/TASK.md §6.2, applied to Android): the server rotates
 * the refresh token on every use and revokes the whole device chain on reuse, so concurrent
 * 401s must share exactly one in-flight refresh call. Every request that arrives while a
 * refresh is in flight is queued and replayed once it resolves.
 */
let refreshPromise: Promise<AuthTokens> | null = null;
type QueuedRequest = InternalAxiosRequestConfig & { _retried?: boolean };

export async function performRefresh(): Promise<AuthTokens> {
  const refreshToken = await secureTokenStore.getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }
  const deviceId = await getOrCreateDeviceId();
  const response = await axios.post<ApiResponse<AuthTokens>>(`${API_BASE_URL}/auth/refresh`, {
    refreshToken,
    deviceId,
  });
  const tokens = unwrap(response);
  secureTokenStore.setAccessToken(tokens.accessToken);
  const remembered = await secureTokenStore.getRefreshToken();
  if (remembered) {
    await secureTokenStore.setRefreshToken(tokens.refreshToken);
  }
  return tokens;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as QueuedRequest | undefined;
    const code = error.response?.data?.error?.code;

    if (!original || original._retried || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    if (code === ERROR_CODES.REFRESH_REUSED) {
      await secureTokenStore.clear();
      onSessionExpired?.();
      return Promise.reject(error);
    }

    if (code !== ERROR_CODES.TOKEN_EXPIRED) {
      return Promise.reject(error);
    }

    original._retried = true;
    try {
      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      const tokens = await refreshPromise;
      original.headers = original.headers ?? {};
      original.headers.set?.('Authorization', `Bearer ${tokens.accessToken}`);
      return apiClient.request(original);
    } catch (refreshError) {
      await secureTokenStore.clear();
      onSessionExpired?.();
      return Promise.reject(refreshError);
    }
  },
);
