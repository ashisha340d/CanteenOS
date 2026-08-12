import type { AuthenticatedUser } from '@menuboard/shared';

/**
 * Session storage rules (docs/TASK.md §6.2):
 *  - the access token lives in memory only (module-level variable), never persisted;
 *  - the refresh token is written to localStorage only when "remember me" was checked at
 *    login, otherwise it lives in sessionStorage so it survives a reload but not a new tab
 *    session close;
 *  - the device id is stable per browser and persisted forever.
 */

const DEVICE_ID_KEY = 'menuboard.admin.deviceId';
const REFRESH_TOKEN_KEY = 'menuboard.admin.refreshToken';
const REMEMBER_KEY = 'menuboard.admin.remember';
const USER_KEY = 'menuboard.admin.user';
const CAPS_KEY = 'menuboard.admin.capabilities';

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * `crypto.randomUUID()` only exists in secure contexts (HTTPS or localhost); the admin UI is
 * routinely opened over plain HTTP on a LAN or Tailscale address, where it's undefined.
 * `crypto.getRandomValues()` has no such restriction, so build a v4 UUID from that instead.
 */
function generateDeviceId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function refreshStore(remember: boolean): Storage {
  return remember ? localStorage : sessionStorage;
}

export function getStoredRemember(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === '1';
}

export function saveRefreshToken(token: string, remember: boolean): void {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
  refreshStore(remember).setItem(REFRESH_TOKEN_KEY, token);
  // Clear the other store so a stale copy never wins.
  refreshStore(!remember).removeItem(REFRESH_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  const remember = getStoredRemember();
  return refreshStore(remember).getItem(REFRESH_TOKEN_KEY) ?? refreshStore(!remember).getItem(REFRESH_TOKEN_KEY);
}

export function clearRefreshToken(): void {
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(REMEMBER_KEY);
}

export function saveUser(user: AuthenticatedUser, capabilities: string[]): void {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  sessionStorage.setItem(CAPS_KEY, JSON.stringify(capabilities));
}

/**
 * These run while AuthProvider is initialising, before anything is rendered. A half-written or
 * hand-edited storage entry must therefore degrade to "signed out" rather than throw, or the
 * admin is stuck on a blank page with no way to reach the login screen.
 */
function readJson<T>(key: string, fallback: T): T {
  const raw = sessionStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    sessionStorage.removeItem(key);
    return fallback;
  }
}

export function loadUser(): AuthenticatedUser | null {
  return readJson<AuthenticatedUser | null>(USER_KEY, null);
}

export function loadCapabilities(): string[] {
  const caps = readJson<unknown>(CAPS_KEY, []);
  return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === 'string') : [];
}

export function clearSession(): void {
  accessToken = null;
  clearRefreshToken();
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(CAPS_KEY);
}
