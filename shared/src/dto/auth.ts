import type { ClientType } from '../constants';
import type { UserRole, UserStatus } from '../enums';
import type { IsoDateTime, Uuid } from './common';

export interface LoginRequest {
  /** Username, phone or email — resolved server-side. */
  identifier: string;
  password: string;
  deviceId: string;
  deviceName?: string;
  clientType: ClientType;
  /** Persists the refresh token on the device. Does not extend access token lifetime. */
  rememberMe?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: IsoDateTime;
  refreshToken: string;
  refreshTokenExpiresAt: IsoDateTime;
}

export interface AuthenticatedUser {
  id: Uuid;
  name: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  avatarPath: string | null;
  mustChangePassword: boolean;
}

export interface LoginResponse {
  user: AuthenticatedUser;
  tokens: AuthTokens;
  /** Effective capability list for this session, already filtered by client type. */
  capabilities: string[];
}

export interface RefreshRequest {
  refreshToken: string;
  deviceId: string;
}

export type RefreshResponse = AuthTokens;

export interface LogoutRequest {
  refreshToken?: string;
  /** Revoke every device for this user rather than only the current one. */
  allDevices?: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface RegisterPushTokenRequest {
  deviceId: string;
  pushToken: string;
}

/** Decoded access token payload. */
export interface AccessTokenClaims {
  sub: Uuid;
  role: UserRole;
  ct: ClientType;
  did: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}
