import {
  ClientType,
  ERROR_CODES,
  UserRole,
  UserStatus,
  type AuthTokens,
  type AuthenticatedUser,
  type ChangePasswordRequest,
  type LoginRequest,
  type LoginResponse,
} from '@menuboard/shared';
import { getPool, type PoolConnection } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import type { UserRow } from '../models/rows';
import { refreshTokenRepository } from '../repositories/RefreshTokenRepository';
import { userRepository } from '../repositories/UserRepository';
import {
  AccountInactiveError,
  AdminRoleRequiredError,
  InvalidCredentialsError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../utils/errors';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { hashPassword, verifyPassword } from '../utils/password';
import { hashRefreshToken, tokenService } from './TokenService';
import { AuditAction, auditService, type AuditActor } from './AuditService';

export interface AuthRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

/**
 * Authentication, refresh-token rotation and session teardown.
 *
 * Refresh tokens rotate on every use. Presenting a token that has already been consumed is
 * treated as theft: the entire device chain is revoked, which forces a fresh login and
 * invalidates whatever the attacker holds.
 */
export class AuthService {
  async login(input: LoginRequest, meta: AuthRequestMeta): Promise<LoginResponse> {
    const pool = getPool();
    const user = await userRepository.findByIdentifier(pool, input.identifier.trim());

    if (user === null) {
      // Record the attempt, but reveal nothing about which part was wrong.
      await this.recordFailedLogin(pool, input.identifier, meta);
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await verifyPassword(input.password, user.password_hash);
    if (!passwordMatches) {
      await this.recordFailedLogin(pool, input.identifier, meta, user);
      throw new InvalidCredentialsError();
    }

    this.assertUserCanLogin(user, input.clientType);
    return this.startSession(user, input, meta, AuditAction.LOGIN, {
      clientType: input.clientType,
      deviceId: input.deviceId,
    });
  }

  /**
   * Validates that a user is allowed to start a session for the requested client type.
   * Throws the same errors the password login would, so fast-auth methods behave identically.
   */
  assertUserCanLogin(user: UserRow, clientType: ClientType): void {
    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountInactiveError(
        user.status === UserStatus.SUSPENDED
          ? 'This account has been suspended'
          : 'This account is inactive',
      );
    }

    // The Admin Portal is restricted to the ADMIN role only — not Super Admin, Manager,
    // User or Employee. Checked before a session is ever issued for this client type.
    if (clientType === ClientType.ADMIN && user.role !== UserRole.ADMIN) {
      throw new AdminRoleRequiredError();
    }
  }

  /**
   * Issues a full authenticated session after the caller has already verified the user's
   * credentials (password, PIN, or passkey). This is the single place sessions are created
   * so fast-auth methods reuse the same refresh-token rotation, audit and capability logic.
   */
  async startSession(
    user: UserRow,
    input: { deviceId: string; deviceName?: string | null; clientType: ClientType },
    meta: AuthRequestMeta,
    action: AuditAction,
    after: Record<string, unknown> = {},
    connection?: PoolConnection,
  ): Promise<LoginResponse> {
    return withTransaction(
      async (conn) => {
        // A fresh login supersedes any previous session on the same device.
        const existing = await refreshTokenRepository.findActiveByUserDevice(conn, user.id, input.deviceId);
        for (const token of existing) {
          await refreshTokenRepository.revoke(conn, token.id);
        }

        const tokens = await this.issueSession(conn, user, input, meta);
        await userRepository.touchLastLogin(conn, user.id);

        await auditService.record(conn, this.actorFor(user, meta), {
          action,
          entityType: 'user',
          entityId: user.id,
          after,
        });

        return {
          user: toAuthenticatedUser(user),
          tokens,
          capabilities: tokenService.capabilitiesFor(user.role, input.clientType),
        };
      },
      connection,
    );
  }

  /**
   * Exchanges a refresh token for a new pair. The old token is consumed atomically, so two
   * concurrent refreshes cannot both succeed.
   */
  async refresh(
    refreshToken: string,
    deviceId: string,
    meta: AuthRequestMeta,
  ): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(refreshToken);

    return withTransaction(async (connection) => {
      const row = await refreshTokenRepository.findByHash(connection, tokenHash);

      if (row === null) {
        throw new UnauthenticatedError('Refresh token is not recognised', ERROR_CODES.TOKEN_INVALID);
      }

      if (row.revoked_at !== null) {
        // Reuse of a consumed token: assume the chain is compromised and cut the device off.
        const revoked = await refreshTokenRepository.revokeDeviceChain(
          connection,
          row.user_id,
          row.device_id,
        );
        logger.warn('Refresh token reuse detected; device chain revoked', {
          userId: row.user_id,
          deviceId: row.device_id,
          revoked,
          requestId: meta.requestId,
        });
        await auditService.record(
          connection,
          { userId: row.user_id, role: null, ...meta },
          {
            action: AuditAction.TOKEN_REUSE_DETECTED,
            entityType: 'refresh_token',
            entityId: row.id,
            after: { deviceId: row.device_id, revokedCount: revoked },
          },
        );
        throw new UnauthenticatedError(
          'This session has been revoked, please sign in again',
          ERROR_CODES.REFRESH_REUSED,
        );
      }

      if (new Date(`${row.expires_at.replace(' ', 'T')}Z`) <= new Date()) {
        throw new UnauthenticatedError('Refresh token has expired', ERROR_CODES.TOKEN_EXPIRED);
      }

      // Binding the token to the device it was issued for stops a stolen token being
      // replayed from elsewhere.
      if (row.device_id !== deviceId) {
        throw new UnauthenticatedError(
          'Refresh token does not belong to this device',
          ERROR_CODES.TOKEN_INVALID,
        );
      }

      const user = await userRepository.findById(connection, row.user_id);
      if (user === null) throw new NotFoundError('User', row.user_id);
      if (user.status !== UserStatus.ACTIVE) {
        await refreshTokenRepository.revokeDeviceChain(connection, user.id, row.device_id);
        throw new AccountInactiveError();
      }
      // Re-checked on every refresh, not just at login: a role change away from ADMIN (or a
      // rollout of this restriction onto an already-issued session) must cut Admin Portal
      // access off at the next refresh rather than waiting for the refresh token to expire.
      if (row.client_type === ClientType.ADMIN && user.role !== UserRole.ADMIN) {
        await refreshTokenRepository.revokeDeviceChain(connection, user.id, row.device_id);
        throw new AdminRoleRequiredError();
      }

      const nextTokenId = newId();
      const refresh = tokenService.createRefreshToken();

      await refreshTokenRepository.insert(connection, {
        id: nextTokenId,
        userId: user.id,
        tokenHash: refresh.hash,
        deviceId: row.device_id,
        deviceName: row.device_name,
        clientType: row.client_type,
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: refresh.expiresAt,
      });
      await refreshTokenRepository.rotate(connection, row.id, nextTokenId);

      const access = tokenService.issueAccessToken({
        userId: user.id,
        role: user.role,
        clientType: row.client_type,
        deviceId: row.device_id,
      });

      await auditService.record(connection, this.actorFor(user, meta), {
        action: AuditAction.TOKEN_REFRESH,
        entityType: 'user',
        entityId: user.id,
        after: { deviceId: row.device_id },
      });

      return {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        refreshToken: refresh.secret,
        refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      };
    });
  }

  async logout(
    userId: string,
    input: { refreshToken?: string; allDevices?: boolean },
    meta: AuthRequestMeta,
  ): Promise<void> {
    await withTransaction(async (connection) => {
      if (input.allDevices === true) {
        await refreshTokenRepository.revokeAllForUser(connection, userId);
      } else if (input.refreshToken !== undefined) {
        await refreshTokenRepository.revokeByHash(connection, hashRefreshToken(input.refreshToken));
      }

      await auditService.record(
        connection,
        { userId, role: null, ...meta },
        {
          action: AuditAction.LOGOUT,
          entityType: 'user',
          entityId: userId,
          after: { allDevices: input.allDevices === true },
        },
      );
    });
  }

  /**
   * Self-service password change. Every session for the user is revoked afterwards, since a
   * password change is exactly when outstanding sessions should stop being trusted.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordRequest,
    meta: AuthRequestMeta,
  ): Promise<void> {
    await withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);

      const matches = await verifyPassword(input.currentPassword, user.password_hash);
      if (!matches) {
        throw new ValidationError('Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }
      if (input.currentPassword === input.newPassword) {
        throw new ValidationError('New password must differ from the current password', [
          { path: 'newPassword', message: 'Choose a password you have not used before' },
        ]);
      }

      const passwordHash = await hashPassword(input.newPassword);
      await userRepository.update(connection, userId, {
        passwordHash,
        mustChangePassword: false,
      });
      await refreshTokenRepository.revokeAllForUser(connection, userId);

      await auditService.record(connection, this.actorFor(user, meta), {
        action: AuditAction.PASSWORD_CHANGED,
        entityType: 'user',
        entityId: userId,
      });
    });
  }

  async registerPushToken(userId: string, deviceId: string, pushToken: string): Promise<void> {
    await refreshTokenRepository.setPushToken(getPool(), userId, deviceId, pushToken);
  }

  async currentUser(userId: string): Promise<AuthenticatedUser> {
    const user = await userRepository.findById(getPool(), userId);
    if (user === null) throw new NotFoundError('User', userId);
    return toAuthenticatedUser(user);
  }

  private async issueSession(
    db: Db,
    user: UserRow,
    input: { deviceId: string; deviceName?: string | null; clientType: ClientType },
    meta: AuthRequestMeta,
  ): Promise<AuthTokens> {
    const refresh = tokenService.createRefreshToken();
    const tokenRowId = newId();

    await refreshTokenRepository.insert(db, {
      id: tokenRowId,
      userId: user.id,
      tokenHash: refresh.hash,
      deviceId: input.deviceId,
      deviceName: input.deviceName ?? null,
      clientType: input.clientType,
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: refresh.expiresAt,
    });

    const access = tokenService.issueAccessToken({
      userId: user.id,
      role: user.role,
      clientType: input.clientType,
      deviceId: input.deviceId,
    });

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.secret,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
    };
  }

  async recordFailedLogin(
    db: Db,
    identifier: string,
    meta: AuthRequestMeta,
    user?: UserRow,
  ): Promise<void> {
    try {
      await auditService.record(
        db,
        {
          userId: user?.id ?? null,
          role: user?.role ?? null,
          ip: meta.ip,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
        },
        {
          action: AuditAction.LOGIN_FAILED,
          entityType: 'user',
          entityId: user?.id ?? null,
          // The identifier is recorded for intrusion analysis; the password never is.
          after: { identifier },
        },
      );
    } catch (error) {
      // A failed audit write must not turn a 401 into a 500.
      logger.error('Failed to audit login failure', { requestId: meta.requestId }, error);
    }
  }

  private actorFor(user: UserRow, meta: AuthRequestMeta): AuditActor {
    return {
      userId: user.id,
      role: user.role,
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    };
  }
}

export function toAuthenticatedUser(user: UserRow): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    phone: user.phone,
    email: user.email,
    role: user.role as UserRole,
    status: user.status,
    avatarPath: user.avatar_path,
    mustChangePassword: user.must_change_password === 1,
  };
}

export { ClientType };
export const authService = new AuthService();
