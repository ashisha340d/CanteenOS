import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthenticatedUser } from '@menuboard/shared';
import { Capability } from '@menuboard/shared';
import { authApi } from '../api/auth';
import { setSessionExpiredHandler } from '../api/client';
import {
  clearSession,
  getDeviceId,
  getRefreshToken,
  loadCapabilities,
  loadUser,
  saveRefreshToken,
  saveUser,
  setAccessToken,
} from './session';

interface AuthContextValue {
  user: AuthenticatedUser | null;
  capabilities: Capability[];
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (identifier: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthenticatedUser) => void;
  hasCapability: (capability: Capability) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUserState] = useState<AuthenticatedUser | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  const clearAll = useCallback(() => {
    clearSession();
    setUserState(null);
    setCapabilities([]);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(clearAll);
  }, [clearAll]);

  // Attempt a silent session restore on load: if a refresh token exists, trade it for a
  // fresh access token, then confirm identity via /auth/me.
  useEffect(() => {
    let cancelled = false;
    async function restore(): Promise<void> {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        setStatus('unauthenticated');
        return;
      }
      try {
        const tokens = await authApi.refresh(refreshToken, getDeviceId());
        setAccessToken(tokens.accessToken);
        saveRefreshToken(tokens.refreshToken, true);
        const me = await authApi.me();
        if (cancelled) return;
        saveUser(me.user, me.capabilities);
        setUserState(me.user);
        setCapabilities(me.capabilities as Capability[]);
        setStatus('authenticated');
      } catch {
        if (!cancelled) clearAll();
      }
    }
    const cachedUser = loadUser();
    if (cachedUser) {
      setUserState(cachedUser);
      setCapabilities(loadCapabilities() as Capability[]);
    }
    void restore();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (identifier: string, password: string, rememberMe: boolean) => {
    const response = await authApi.login({
      identifier,
      password,
      deviceId: getDeviceId(),
      clientType: 'ADMIN',
      rememberMe,
    });
    setAccessToken(response.tokens.accessToken);
    saveRefreshToken(response.tokens.refreshToken, rememberMe);
    saveUser(response.user, response.capabilities);
    setUserState(response.user);
    setCapabilities(response.capabilities as Capability[]);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken() ?? undefined;
    try {
      await authApi.logout(refreshToken);
    } catch {
      // Best-effort; clear local state regardless.
    }
    clearAll();
  }, [clearAll]);

  const setUser = useCallback((next: AuthenticatedUser) => {
    setUserState(next);
    saveUser(next, capabilities);
  }, [capabilities]);

  const hasCapability = useCallback(
    (capability: Capability) => capabilities.includes(capability),
    [capabilities],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, capabilities, status, login, logout, setUser, hasCapability }),
    [user, capabilities, status, login, logout, setUser, hasCapability],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
