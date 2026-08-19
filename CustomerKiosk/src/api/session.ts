/**
 * The kiosk's own session.
 *
 * A tablet is unattended and gets power-cycled by whoever locks the hall, so the refresh token
 * has to survive a reload — unlike the Admin Portal, there is nobody present to sign in again
 * in the morning. That is exactly why the session is capability-starved on the server
 * (`KIOSK_ALLOWED_CAPABILITIES`): this token is only as safe as the room the tablet is in.
 */

const DEVICE_ID_KEY = 'menuboard.kiosk.deviceId';
const REFRESH_KEY = 'menuboard.kiosk.refresh';

let accessToken: string | null = null;

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (id === null) {
    id = `kiosk-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function saveRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_KEY, token);
}

export function clearSession(): void {
  accessToken = null;
  localStorage.removeItem(REFRESH_KEY);
}

export function hasSession(): boolean {
  return getRefreshToken() !== null;
}
