import { secureStorage } from './secureStorage';

/**
 * Access token: kept in memory only (never persisted) — matches the Admin Portal
 * convention in docs/TASK.md §6.2, adapted for a single-process mobile app.
 * Refresh token: persisted in SecureStore only when "remember login" is enabled.
 */
const REFRESH_TOKEN_KEY = 'menuboard_refresh_token';

let inMemoryAccessToken: string | null = null;

export const secureTokenStore = {
  getAccessToken(): string | null {
    return inMemoryAccessToken;
  },
  setAccessToken(token: string | null): void {
    inMemoryAccessToken = token;
  },
  async getRefreshToken(): Promise<string | null> {
    return secureStorage.getItem(REFRESH_TOKEN_KEY);
  },
  async setRefreshToken(token: string | null): Promise<void> {
    if (token) {
      await secureStorage.setItem(REFRESH_TOKEN_KEY, token);
    } else {
      await secureStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  },
  async clear(): Promise<void> {
    inMemoryAccessToken = null;
    await secureStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};
