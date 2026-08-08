import * as SecureStore from 'expo-secure-store';

/**
 * Keychain-backed secret storage — the Android/native implementation, expo-secure-store
 * verbatim. Metro resolves `secureStorage.web.ts` for the browser development target, because
 * `expo-secure-store`'s web build is literally `export default {}` (SDK 51), so every call
 * would throw on the property access.
 */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};
