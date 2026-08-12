import { create } from 'zustand';
import type { ApiResponse, AuthenticatedUser, AuthTokens } from '@menuboard/shared';
import { authApi } from '../api/auth';
import { apiClient, setSessionExpiredHandler, unwrap } from '../api/client';
import { secureTokenStore } from '../utils/secureTokenStore';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { settingsRepository, SETTINGS_KEYS, userRepository } from '../db/repositories';
import { populateInitialData } from '../sync/populateFromServer';
import { registerPushToken } from '../utils/pushNotifications';
import { nowIso } from '../utils/date';
import { useLanguageStore } from './languageStore';

interface AuthState {
  status: 'unknown' | 'signedOut' | 'pinRequired' | 'signedIn';
  user: AuthenticatedUser | null;
  capabilities: string[];
  mustChangePassword: boolean;
  isBootstrapping: boolean;
  isSyncing: boolean;
  error: string | null;
  hasPin: boolean;
  pinIdentifier: string | null;

  bootstrap: () => Promise<void>;
  login: (identifier: string, password: string, rememberMe: boolean) => Promise<void>;
  loginWithPin: (pin: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setPin: (currentPassword: string, pin: string) => Promise<void>;
  removePin: (currentPassword: string) => Promise<void>;
  usePasswordInstead: () => void;
  logout: () => Promise<void>;
  refreshLocalData: () => Promise<void>;
}

/**
 * Session/UI state only, per app/AGENTS.md — domain data always lives in SQLite, never here.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  capabilities: [],
  mustChangePassword: false,
  isBootstrapping: true,
  isSyncing: false,
  error: null,
  hasPin: false,
  pinIdentifier: null,

  bootstrap: async () => {
    setSessionExpiredHandler(() => {
      set({ status: 'signedOut', user: null, capabilities: [] });
    });

    // Anything that throws before `isBootstrapping` is cleared leaves the app on its splash
    // screen forever, so reading the stored session is guarded too — an unreadable local
    // session means "signed out", not "never finish starting".
    let remember: boolean | null = null;
    let refreshToken: string | null = null;
    let pinIdentifier: string | null = null;
    try {
      remember = await settingsRepository.get<boolean>(SETTINGS_KEYS.REMEMBER_LOGIN);
      refreshToken = await secureTokenStore.getRefreshToken();
      pinIdentifier = await settingsRepository.get<string>(SETTINGS_KEYS.PIN_IDENTIFIER);
    } catch {
      set({ status: 'signedOut', isBootstrapping: false });
      return;
    }

    // A PIN unlocks the app on every cold start, whether or not the underlying session is
    // "remembered" — it is the lock screen, not a fallback for when remember-login is off.
    if (pinIdentifier) {
      set({ status: 'pinRequired', pinIdentifier, hasPin: true, isBootstrapping: false });
      return;
    }

    if (!remember || !refreshToken) {
      set({ status: 'signedOut', isBootstrapping: false });
      return;
    }
    try {
      const deviceId = await getOrCreateDeviceId();
      const response = await apiClient.post<ApiResponse<AuthTokens>>('/auth/refresh', { refreshToken, deviceId });
      const tokens = unwrap<AuthTokens>(response);
      secureTokenStore.setAccessToken(tokens.accessToken);
      await secureTokenStore.setRefreshToken(tokens.refreshToken);
      const me = await authApi.me();
      set({
        status: 'signedIn',
        user: me.user,
        capabilities: me.capabilities,
        mustChangePassword: me.user.mustChangePassword,
        isBootstrapping: false,
      });
      void useLanguageStore.getState().load(me.user.role);
      void registerPushToken();
      authApi
        .pinStatus()
        .then((s) => set({ hasPin: s.hasPin }))
        .catch(() => undefined);
    } catch {
      await secureTokenStore.clear().catch(() => undefined);
      set({ status: 'signedOut', isBootstrapping: false });
    }
  },

  login: async (identifier, password, rememberMe) => {
    set({ error: null });
    const deviceId = await getOrCreateDeviceId();
    const response = await authApi.login({
      identifier,
      password,
      deviceId,
      deviceName: 'MenuBoard Android',
      clientType: 'ANDROID',
      rememberMe,
    });
    secureTokenStore.setAccessToken(response.tokens.accessToken);
    if (rememberMe) {
      await secureTokenStore.setRefreshToken(response.tokens.refreshToken);
    }
    await settingsRepository.set(SETTINGS_KEYS.REMEMBER_LOGIN, rememberMe);
    await settingsRepository.set(SETTINGS_KEYS.CURRENT_USER_ID, response.user.id);
    await userRepository.upsertMany([
      {
        id: response.user.id,
        employeeCode: null,
        name: response.user.name,
        username: response.user.username,
        phone: response.user.phone,
        email: response.user.email,
        role: response.user.role,
        status: response.user.status,
        avatarPath: response.user.avatarPath,
        lastLoginAt: nowIso(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deletedAt: null,
        syncSeq: 0,
        revision: 1,
      },
    ]);

    const pinIdentifier = await settingsRepository.get<string>(SETTINGS_KEYS.PIN_IDENTIFIER);
    set({
      status: 'signedIn',
      user: response.user,
      capabilities: response.capabilities,
      mustChangePassword: response.user.mustChangePassword,
      pinIdentifier: pinIdentifier ?? response.user.username,
    });
    void useLanguageStore.getState().load(response.user.role);
    void registerPushToken();
    authApi
      .pinStatus()
      .then((s) => set({ hasPin: s.hasPin }))
      .catch(() => undefined);

    if (!response.user.mustChangePassword) {
      await get().refreshLocalData();
    }
  },

  loginWithPin: async (pin) => {
    set({ error: null });
    const identifier = get().pinIdentifier;
    if (!identifier) throw new Error('No account to unlock. Sign in with your password.');
    const deviceId = await getOrCreateDeviceId();
    const response = await authApi.loginWithPin({
      identifier,
      pin,
      deviceId,
      deviceName: 'MenuBoard Android',
      clientType: 'ANDROID',
    });
    secureTokenStore.setAccessToken(response.tokens.accessToken);
    await secureTokenStore.setRefreshToken(response.tokens.refreshToken);
    await settingsRepository.set(SETTINGS_KEYS.REMEMBER_LOGIN, true);
    await settingsRepository.set(SETTINGS_KEYS.CURRENT_USER_ID, response.user.id);

    set({
      status: 'signedIn',
      user: response.user,
      capabilities: response.capabilities,
      mustChangePassword: response.user.mustChangePassword,
      hasPin: true,
    });
    void useLanguageStore.getState().load(response.user.role);
    void registerPushToken();

    if (!response.user.mustChangePassword) {
      await get().refreshLocalData();
    }
  },

  usePasswordInstead: () => {
    set({ status: 'signedOut' });
  },

  changePassword: async (currentPassword, newPassword) => {
    await authApi.changePassword({ currentPassword, newPassword });
    const user = get().user;
    if (user) {
      set({ user: { ...user, mustChangePassword: false }, mustChangePassword: false });
    }
    await get().refreshLocalData();
  },

  setPin: async (currentPassword, pin) => {
    await authApi.setPin({ currentPassword, pin });
    const user = get().user;
    await settingsRepository.set(SETTINGS_KEYS.PIN_ENABLED, true);
    if (user) {
      await settingsRepository.set(SETTINGS_KEYS.PIN_IDENTIFIER, user.username);
      set({ hasPin: true, pinIdentifier: user.username });
    } else {
      set({ hasPin: true });
    }
  },

  removePin: async (currentPassword) => {
    await authApi.removePin({ currentPassword });
    await settingsRepository.remove(SETTINGS_KEYS.PIN_ENABLED);
    await settingsRepository.remove(SETTINGS_KEYS.PIN_IDENTIFIER);
    set({ hasPin: false });
  },

  logout: async () => {
    const refreshToken = await secureTokenStore.getRefreshToken();
    try {
      await authApi.logout(refreshToken ?? undefined);
    } catch {
      // Best-effort: still clear local session even if the network call fails.
    }
    await secureTokenStore.clear();
    await settingsRepository.remove(SETTINGS_KEYS.REMEMBER_LOGIN);
    await settingsRepository.remove(SETTINGS_KEYS.PIN_ENABLED);
    await settingsRepository.remove(SETTINGS_KEYS.PIN_IDENTIFIER);
    set({ status: 'signedOut', user: null, capabilities: [], mustChangePassword: false, hasPin: false, pinIdentifier: null });
  },

  refreshLocalData: async () => {
    const user = get().user;
    if (!user) return;
    set({ isSyncing: true, error: null });
    try {
      await populateInitialData(user.id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to refresh data' });
    } finally {
      set({ isSyncing: false });
    }
  },
}));
