/**
 * Browser development stand-in for expo-secure-store, backed by `localStorage`.
 *
 * SECURITY: `localStorage` is *not* secure storage — it is readable by any script on the
 * origin and survives in plain text on disk. This file exists so the sign-in flow can be
 * exercised in Chrome/Edge during development; the shipping Android build always goes through
 * `secureStorage.ts` and the platform keychain. Do not point a production web target at this.
 */
const memoryFallback = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    // Access throws when cookies/site data are blocked for the origin.
    return false;
  }
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!hasLocalStorage()) return memoryFallback.get(key) ?? null;
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!hasLocalStorage()) {
      memoryFallback.set(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (!hasLocalStorage()) {
      memoryFallback.delete(key);
      return;
    }
    window.localStorage.removeItem(key);
  },
};
