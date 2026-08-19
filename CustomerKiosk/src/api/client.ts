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

/**
 * `VITE_API_BASE_URL` is baked in at build time, so a hard-coded `localhost` would break the
 * moment the tablet — a different machine from the server — loads the page. Defaulting to the
 * host the kiosk was opened from means one build serves every tablet in the hall.
 */
const DEFAULT_API_PORT = 4000;
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}/api/v1`;

export const http = axios.create({
  baseURL: API_BASE_URL,
  headers: { [HEADERS.CLIENT_TYPE]: ClientType.KIOSK },
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

/**
 * The backend rotates the refresh token on every use and treats a replay as theft by revoking
 * the whole device chain — so two parallel refreshes would log the kiosk out mid-order. Every
 * request that meets an expired token waits on the one refresh already in flight.
 */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Why a refresh failed, not just that it did.
 *
 * A kiosk boots when somebody unlocks the hall, which is often before the counter's server
 * and the access point have settled. Treating that first failed refresh as a rejected session
 * is how an unattended tablet ends the night signed in and starts the morning showing a staff
 * password prompt to a queue of guests — the one failure mode nobody is present to fix.
 */
export type SessionOutcome = 'ready' | 'signed-out' | 'unreachable';

export async function restoreSession(): Promise<SessionOutcome> {
  const refreshToken = getRefreshToken();
  if (refreshToken === null) return 'signed-out';

  try {
    const response = await axios.post<ApiResponse<AuthTokens>>(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken, deviceId: getDeviceId() },
      { headers: { [HEADERS.CLIENT_TYPE]: ClientType.KIOSK } },
    );
    if (!response.data.success) {
      clearSession();
      return 'signed-out';
    }
    setAccessToken(response.data.data.accessToken);
    saveRefreshToken(response.data.data.refreshToken);
    return 'ready';
  } catch (error) {
    // Only the server saying no ends the session. Anything the network did is temporary, and
    // the stored token is still the best thing the tablet has to try again with.
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

    // Only a decision by the server ends a session. A dropped connection carries no error
    // code at all and must leave the stored token where it is.
    if (code === 'REFRESH_REUSED' || code === 'UNAUTHENTICATED' || code === 'TOKEN_INVALID') {
      clearSession();
      onSessionLost();
    }

    return Promise.reject(error);
  },
);

/** Unwraps the `{ success, data }` envelope every endpoint returns. */
export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  const response = await promise;
  if (!response.data) return undefined as T;
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}

/** The server's wording is the useful one — a guest-facing fallback only when there is none. */
export function readErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    if (body && !body.success && body.error.message) return body.error.message;
    if (error.code === 'ERR_NETWORK') return fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
