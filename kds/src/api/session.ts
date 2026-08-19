import type { AuthenticatedUser } from '@menuboard/shared';

const DEVICE_ID_KEY = 'menuboard.kds.deviceId';
const REFRESH_KEY = 'menuboard.kds.refresh';
const USER_KEY = 'menuboard.kds.user';
const LOCKED_KEY = 'menuboard.kds.locked';

let accessToken: string | null = null;

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (id === null) {
    id = `kds-${crypto.randomUUID()}`;
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
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(LOCKED_KEY);
}

export function hasSession(): boolean {
  return getRefreshToken() !== null;
}

/* The last signed-in user, remembered so the lock screen can ask for just their MPIN. */

export function saveSessionUser(user: AuthenticatedUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify({ name: user.name, username: user.username }));
}

export function readSessionUser(): { name: string; username: string } | null {
  const raw = localStorage.getItem(USER_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<{ name: string; username: string }>;
    if (typeof parsed.name === 'string' && typeof parsed.username === 'string') {
      return { name: parsed.name, username: parsed.username };
    }
  } catch {
    // A corrupt entry is the same as no entry.
  }
  localStorage.removeItem(USER_KEY);
  return null;
}

/* Screen lock: the session stays alive underneath; only the screen asks for the MPIN again. */

export function setLocked(locked: boolean): void {
  if (locked) {
    localStorage.setItem(LOCKED_KEY, '1');
  } else {
    localStorage.removeItem(LOCKED_KEY);
  }
}

export function isLocked(): boolean {
  return localStorage.getItem(LOCKED_KEY) === '1';
}
