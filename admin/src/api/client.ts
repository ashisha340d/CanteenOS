import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiErrorBody, ApiResponse, AuthTokens } from '@menuboard/shared';
import { ClientType, HEADERS } from '@menuboard/shared';
import {
  clearSession,
  getAccessToken,
  getDeviceId,
  getRefreshToken,
  getStoredRemember,
  saveRefreshToken,
  setAccessToken,
} from '../services/session';

/**
 * `VITE_API_BASE_URL` is baked in at build time, so a value like `http://localhost:4000/api/v1`
 * only ever works when the admin UI itself is opened from `localhost` — opened from a LAN or
 * Tailscale address, "localhost" means the visiting device, not this server. Falling back to the
 * page's own hostname means one build works from any address the admin UI is reachable at. An
 * explicit `VITE_API_BASE_URL` still wins, for deployments where the API genuinely lives on a
 * different host than the admin UI.
 */
const DEFAULT_API_PORT = 4000;
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}/api/v1`;

export const http = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    [HEADERS.CLIENT_TYPE]: ClientType.ADMIN,
  },
});

/** Fired when the session becomes unusable so the app can redirect to /login. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => {
  window.location.assign('/login');
};
export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  config.headers.set(HEADERS.DEVICE_ID, getDeviceId());
  return config;
});

/**
 * Concurrent-401 protection (docs/TASK.md §6.2): the backend rotates the refresh token on
 * every use and revokes the whole device chain on reuse, so two parallel refresh calls would
 * log the user out. Every request that hits TOKEN_EXPIRED while a refresh is already in
 * flight awaits that same promise instead of starting its own.
 */
let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const response = await axios.post<ApiResponse<AuthTokens>>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken, deviceId: getDeviceId() },
      { headers: { [HEADERS.CLIENT_TYPE]: ClientType.ADMIN } },
    );
    if (!response.data.success) return null;
    const tokens = response.data.data;
    setAccessToken(tokens.accessToken);
    saveRefreshToken(tokens.refreshToken, getStoredRemember());
    return tokens.accessToken;
  } catch {
    return null;
  }
}

interface RetriableConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as RetriableConfig | undefined;
    const code = error.response?.data && !error.response.data.success ? error.response.data.error.code : undefined;

    if (code === 'TOKEN_EXPIRED' && original && !original._retried) {
      original._retried = true;
      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      const newToken = await refreshPromise;
      if (newToken) {
        original.headers = { ...original.headers, Authorization: `Bearer ${newToken}` };
        return http.request(original);
      }
      clearSession();
      onSessionExpired();
      return Promise.reject(error);
    }

    if (code === 'REFRESH_REUSED' || code === 'UNAUTHENTICATED' || code === 'TOKEN_INVALID') {
      clearSession();
      onSessionExpired();
    }

    return Promise.reject(error);
  },
);

/** Unwraps the `{ success, data }` envelope; throws the raw axios error on failure. */
export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await promise;
  // 204 No Content (delete endpoints) has no body to unwrap — there is nothing to fail on.
  if (!response.data) {
    return undefined as T;
  }
  if (!response.data.success) {
    throw new Error(response.data.error.message);
  }
  return response.data.data;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PagedResult<T> {
  items: T[];
  meta: PageMeta;
}

/** Unwraps a paginated envelope: `data` is the array, `meta` carries paging. */
export async function unwrapPaged<T>(
  promise: Promise<{ data: ApiResponse<T[]> & { meta?: PageMeta } }>,
): Promise<PagedResult<T>> {
  const response = await promise;
  if (!response.data.success) {
    throw new Error(response.data.error.message);
  }
  const meta = (response.data as { meta?: PageMeta }).meta ?? {
    page: 1,
    pageSize: response.data.data.length,
    total: response.data.data.length,
    totalPages: 1,
  };
  return { items: response.data.data, meta };
}
