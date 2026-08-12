import bcrypt from 'bcryptjs';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { UserRow } from '../models/rows';
import { userPinRepository } from '../repositories/UserPinRepository';
import { userRepository } from '../repositories/UserRepository';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { authService } from './AuthService';
import { config } from '../config';
import {
  InvalidCredentialsError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../utils/errors';
import { addMinutes } from '../utils/time';
import { verifyPassword } from '../utils/password';
import type { AuthRequestMeta } from './AuthService';
import type { PinLoginRequest, SetPinRequest, RemovePinRequest, LoginResponse } from '@menuboard/shared';

const PIN_LENGTH = 4;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function isLocked(row: { locked_until: string | null }): boolean {
  if (row.locked_until === null) return false;
  return new Date(`${row.locked_until.replace(' ', 'T')}Z`) > new Date();
}

function pinActor(user: UserRow, meta: AuthRequestMeta): AuditActor {
  return {
    userId: user.id,
    role: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };
}

export class PinService {
  async login(input: PinLoginRequest, meta: AuthRequestMeta): Promise<LoginResponse> {
    const pool = getPool();
    const user = await userRepository.findByIdentifier(pool, input.identifier.trim());

    if (user === null) {
      await authService.recordFailedLogin(pool, input.identifier, meta);
      throw new InvalidCredentialsError();
    }

    authService.assertUserCanLogin(user, input.clientType);

    return withTransaction(async (connection) => {
      const pinRow = await userPinRepository.findByUserId(connection, user.id);

      if (pinRow === null) {
        // No PIN configured, but we still record the attempt against the identifier.
        await authService.recordFailedLogin(connection, input.identifier, meta, user);
        throw new InvalidCredentialsError();
      }

      if (isLocked(pinRow)) {
        await auditService.record(connection, pinActor(user, meta), {
          action: AuditAction.FAST_AUTH_PIN_FAILED,
          entityType: 'user',
          entityId: user.id,
          after: { reason: 'account_locked', identifier: input.identifier },
        });
        // Surface a generic rate-limited response; the real lockout is visible in audit.
        throw new RateLimitedError('Too many failed PIN attempts. Please try again later.');
      }

      const matches = await bcrypt.compare(input.pin, pinRow.pin_hash);
      if (!matches) {
        await userPinRepository.incrementFailedAttempt(connection, user.id);
        const updated = await userPinRepository.findByUserId(connection, user.id);
        const shouldLock = updated !== null && updated.failed_attempts >= MAX_FAILED_ATTEMPTS;
        if (shouldLock) {
          await userPinRepository.setLockedUntil(connection, user.id, addMinutes(new Date(), LOCKOUT_MINUTES));
        }

        await auditService.record(connection, pinActor(user, meta), {
          action: AuditAction.FAST_AUTH_PIN_FAILED,
          entityType: 'user',
          entityId: user.id,
          after: { identifier: input.identifier, failedAttempts: updated?.failed_attempts ?? 0, locked: shouldLock },
        });

        if (shouldLock) {
          await auditService.record(connection, pinActor(user, meta), {
            action: AuditAction.ACCOUNT_LOCKED,
            entityType: 'user',
            entityId: user.id,
            after: { reason: 'pin_failed_attempts', lockoutMinutes: LOCKOUT_MINUTES },
          });
        }

        throw new InvalidCredentialsError();
      }

      await userPinRepository.resetAttempts(connection, user.id);
      return authService.startSession(
        user,
        { deviceId: input.deviceId, deviceName: input.deviceName, clientType: input.clientType },
        meta,
        AuditAction.FAST_AUTH_PIN_SUCCESS,
        { method: 'pin', identifier: input.identifier, clientType: input.clientType, deviceId: input.deviceId },
        connection,
      );
    });
  }

  async setPin(userId: string, input: SetPinRequest, meta: AuthRequestMeta): Promise<void> {
    const pin = input.pin.trim();
    if (!/^\d{4}$/.test(pin)) {
      throw new ValidationError('PIN must be exactly 4 digits', [
        { path: 'pin', message: 'PIN must be exactly 4 digits' },
      ]);
    }

    await withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);

      const passwordMatches = await verifyPassword(input.currentPassword, user.password_hash);
      if (!passwordMatches) {
        throw new ValidationError('Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }

      const existing = await userPinRepository.findByUserId(connection, userId);
      const pinHash = await bcrypt.hash(pin, config.auth.bcryptRounds);

      await userPinRepository.upsert(connection, userId, pinHash);

      await auditService.record(connection, pinActor(user, meta), {
        action: existing === null ? AuditAction.PIN_CREATED : AuditAction.PIN_CHANGED,
        entityType: 'user',
        entityId: userId,
      });
    });
  }

  async getStatus(userId: string): Promise<{ hasPin: boolean }> {
    const row = await userPinRepository.findByUserId(getPool(), userId);
    return { hasPin: row !== null };
  }

  async removePin(userId: string, input: RemovePinRequest, meta: AuthRequestMeta): Promise<void> {
    await withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);

      const passwordMatches = await verifyPassword(input.currentPassword, user.password_hash);
      if (!passwordMatches) {
        throw new ValidationError('Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }

      const existing = await userPinRepository.findByUserId(connection, userId);
      if (existing === null) {
        throw new ValidationError('No PIN is configured for this account', [
          { path: 'currentPassword', message: 'No PIN is configured for this account' },
        ]);
      }

      await userPinRepository.remove(connection, userId);

      await auditService.record(connection, pinActor(user, meta), {
        action: AuditAction.PIN_REMOVED,
        entityType: 'user',
        entityId: userId,
      });
    });
  }
}

export const pinService = new PinService();
