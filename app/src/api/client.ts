import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { ApiErrorBody, ApiResponse, AuthTokens } from '@menuboard/shared';
import { ClientType, ERROR_CODES, HEADERS } from '@menuboard/shared';
import { secureTokenStore } from '../utils/secureTokenStore';
import { getOrCreateDeviceId } from '../utils/deviceId';

const HOST_URL = process.env.API_BASE_URL_HOST ?? 'http://10.0.2.2:4000/api/v1';
const LOCALHOST_URL = process.env.API_BASE_URL_LOCALHOST ?? 'http://localhost:4000/api/v1';
const NETWORK_URL = process.env.API_BASE_URL_NETWORK ?? 'http://192.168.1.37:4000/api/v1';
const TAILSCALE_URL = process.env.API_BASE_URL_TAILSCALE ?? 'http://100.77.100.67:4000/api/v1';

function resolveApiBaseUrl(): string {
  const webUrl = Platform.OS === 'web' ? (Constants.expoConfig?.extra?.apiBaseUrlWeb as string | undefined) : undefined;
  const mobileUrl = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
  const envActiveUrl = process.env.API_BASE_URL;

  return envActiveUrl ?? webUrl ?? mobileUrl ?? TAILSCALE_URL;
}

/**
 * The single axios-backed API funnel for the whole app (per app/AGENTS.md). Every domain
 * module in `src/api/*` goes through this instance — nothing else in the app constructs
 * its own axios client or calls `fetch` against the backend directly.
 *
 * The initial value is a best guess; `discoverApiBaseUrl()` may replace it at startup.
 */
export const API_BASE_URL: string = resolveApiBaseUrl();

/**
 * The endpoint actually in use. Starts as the configured guess and is narrowed by
 * `discoverApiBaseUrl`, so anything reading it *after* startup gets the working host.
 */
let activeBaseUrl: string = API_BASE_URL;

export function getApiBaseUrl(): string {
  return activeBaseUrl;
}

console.log('[API] Connection options:');
console.log(`  HOST      : ${HOST_URL}`);
console.log(`  LOCALHOST : ${LOCALHOST_URL}`);
console.log(`  NETWORK   : ${NETWORK_URL}`);
console.log(`  TAILSCALE : ${TAILSCALE_URL}`);
console.log(`[API] Configured endpoint: ${API_BASE_URL} (platform: ${Platform.OS})`);

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

/**
 * Finds a backend this device can actually reach, and points the client at it.
 *
 * A single hard-coded host cannot be right for every way this app is run: the Tailscale
 * address only resolves when Tailscale is up on the phone, `10.0.2.2` only means anything
 * inside the Android emulator, and the LAN address changes with the network. Configuring one
 * of them made the app unreachable in every other situation — which is the "Expo cannot reach
 * the server" case.
 *
 * Candidates are raced rather than tried in sequence, so the fastest reachable host wins and
 * a dead address costs one timeout instead of blocking the ones behind it. If none answer the
 * configured value is kept, leaving the normal offline behaviour intact.
 */
export async function discoverApiBaseUrl(): Promise<string> {
  const candidates = [
    ...new Set(
      [
        process.env.API_BASE_URL,
        Platform.OS === 'web'
          ? (Constants.expoConfig?.extra?.apiBaseUrlWeb as string | undefined)
          : (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined),
        // The Metro host the bundle was served from is the strongest signal on a physical
        // device: whatever address Expo reached the phone on, the backend is almost always
        // on that same machine.
        metroHostCandidate(),
        NETWORK_URL,
        TAILSCALE_URL,
        Platform.OS === 'android' ? HOST_URL : undefined,
        LOCALHOST_URL,
      ].filter((url): url is string => typeof url === 'string' && url.length > 0),
    ),
  ];

  const winner = await Promise.any(
    candidates.map(async (url) => {
      const result = await pingApi(url);
      if (!result.ok) throw new Error(`unreachable: ${url}`);
      return url;
    }),
  ).catch(() => null);

  if (winner === null) {
    console.warn(`[API] No candidate reachable; staying on ${activeBaseUrl}`);
    return activeBaseUrl;
  }

  activeBaseUrl = winner;
  apiClient.defaults.baseURL = winner;
  console.log(`[API] Active endpoint: ${winner}`);
  return winner;
}

/** `http://192.168.1.37:8081` -> `http://192.168.1.37:4000/api/v1`. */
function metroHostCandidate(): string | undefined {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : undefined;
  if (host === undefined || host === '') return undefined;
  return `http://${host}:4000/api/v1`;
}

export async function pingApi(url = API_BASE_URL): Promise<{ ok: boolean; status?: number; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const response = await axios.get(`${url.replace(/\/api\/v1$/, '')}/health`, { timeout: 5000 });
    const latencyMs = Date.now() - start;
    console.log(`[API] Ping ${url} -> OK (${response.status}) in ${latencyMs}ms`);
    return { ok: true, status: response.status, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const message = error instanceof AxiosError ? `${error.code}: ${error.message}` : String(error);
    console.warn(`[API] Ping ${url} -> FAILED in ${latencyMs}ms: ${message}`);
    return { ok: false, latencyMs, error: message };
  }
}

if (__DEV__) {
  apiClient.interceptors.request.use((config) => {
    console.log(`[API] >> ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  });
  apiClient.interceptors.response.use(
    (response) => {
      console.log(`[API] << ${response.status} ${response.config.url}`);
      return response;
    },
    (error: AxiosError) => {
      console.warn(`[API] << ERROR ${error.response?.status ?? error.code} ${error.config?.url}`);
      return Promise.reject(error);
    },
  );
}

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
