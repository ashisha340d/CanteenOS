import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type AuthenticatorTransportFuture,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { UserRow, WebAuthnCredentialRow } from '../models/rows';
import { webAuthnChallengeRepository } from '../repositories/WebAuthnChallengeRepository';
import { webAuthnCredentialRepository } from '../repositories/WebAuthnCredentialRepository';
import { userRepository } from '../repositories/UserRepository';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { authService } from './AuthService';
import { InvalidCredentialsError, NotFoundError, ValidationError } from '../utils/errors';
import { newId, randomToken } from '../utils/ids';
import { addMinutes } from '../utils/time';
import { verifyPassword } from '../utils/password';
import { isAllowedCorsOrigin } from '../utils/originAllowlist';
import type { AuthRequestMeta } from './AuthService';
import type {
  PasskeyDto,
  PasskeyLoginOptionsResponse,
  PasskeyLoginRequest,
  LoginResponse,
  RegisterPasskeyOptionsResponse,
  RegisterPasskeyRequest,
  RemovePasskeyRequest,
} from '@menuboard/shared';

const RP_NAME = 'MenuBoard';
const CHALLENGE_TTL_MINUTES = 5;
const MAX_PASSKEYS_PER_USER = 10;

interface OriginContext {
  origin: string;
  rpID: string;
}

function requireOrigin(originHeader: string | undefined): OriginContext {
  if (originHeader === undefined || !isAllowedCorsOrigin(originHeader)) {
    throw new ValidationError('Invalid or missing origin header', [
      { path: 'origin', message: 'Invalid or missing origin header' },
    ]);
  }
  const url = new URL(originHeader);
  return { origin: originHeader, rpID: url.hostname };
}

function toPasskeyDto(row: WebAuthnCredentialRow): PasskeyDto {
  return {
    id: row.id,
    credentialId: row.credential_id,
    deviceName: row.device_name,
    transports: JSON.parse(row.transports) as string[],
    backupEligible: row.backup_eligible === 1,
    backupState: row.backup_state === 1,
    createdAt: `${row.created_at.replace(' ', 'T')}Z`,
    lastUsedAt: row.last_used_at === null ? null : `${row.last_used_at.replace(' ', 'T')}Z`,
  };
}

function toWebAuthnCredential(row: WebAuthnCredentialRow): WebAuthnCredential {
  return {
    id: row.credential_id,
    publicKey: Buffer.from(row.public_key, 'base64url'),
    counter: row.sign_counter,
    transports: JSON.parse(row.transports) as AuthenticatorTransportFuture[],
  };
}

function passkeyActor(user: UserRow, meta: AuthRequestMeta): AuditActor {
  return {
    userId: user.id,
    role: user.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };
}

export class PasskeyService {
  async registrationOptions(
    userId: string,
    deviceName: string | null,
    originHeader: string | undefined,
  ): Promise<RegisterPasskeyOptionsResponse> {
    const { origin, rpID } = requireOrigin(originHeader);
    const db = getPool();
    const user = await userRepository.findById(db, userId);
    if (user === null) throw new NotFoundError('User', userId);

    const existing = await webAuthnCredentialRepository.listActiveByUserId(db, userId);
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      throw new ValidationError('Maximum number of passkeys reached', [
        { path: 'deviceName', message: 'Maximum number of passkeys reached' },
      ]);
    }

    const challenge = randomToken(32);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: user.username,
      userID: Buffer.from(user.id),
      userDisplayName: user.name,
      challenge,
      attestationType: 'none',
      excludeCredentials: existing.map((row) => ({
        id: row.credential_id,
        transports: JSON.parse(row.transports) as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await webAuthnChallengeRepository.insert(db, {
      id: newId(),
      userId,
      type: 'registration',
      challenge: options.challenge,
      expiresAt: addMinutes(new Date(), CHALLENGE_TTL_MINUTES),
    });

    return { options: options as unknown as Record<string, unknown> };
  }

  async register(
    userId: string,
    input: RegisterPasskeyRequest,
    originHeader: string | undefined,
    meta: AuthRequestMeta,
  ): Promise<PasskeyDto> {
    const { origin, rpID } = requireOrigin(originHeader);

    return withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);

      const passwordMatches = await verifyPassword(input.currentPassword, user.password_hash);
      if (!passwordMatches) {
        throw new ValidationError('Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }

      const challengeRow = await webAuthnChallengeRepository.findValidByUserAndType(
        connection,
        userId,
        'registration',
      );
      if (challengeRow === null) {
        throw new ValidationError('Passkey registration has expired. Please try again.', [
          { path: 'response', message: 'Passkey registration has expired. Please try again.' },
        ]);
      }

      const response = input.response as unknown as RegistrationResponseJSON;
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        throw new ValidationError('Passkey registration could not be verified', [
          { path: 'response', message: 'Passkey registration could not be verified' },
        ]);
      }

      const { registrationInfo } = verification;
      const { credential, credentialBackedUp, credentialDeviceType } = registrationInfo;

      await webAuthnChallengeRepository.deleteById(connection, challengeRow.id);

      const deviceName = input.deviceName?.trim() || (response.response.transports?.includes('internal') ? 'This device' : 'Security key');
      await webAuthnCredentialRepository.insert(connection, {
        id: newId(),
        credentialId: credential.id,
        userId,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        signCounter: credential.counter,
        transports: JSON.stringify(response.response.transports ?? []),
        backupEligible: credentialDeviceType === 'multiDevice',
        backupState: credentialBackedUp,
        deviceName: deviceName.length > 0 ? deviceName : null,
      });

      await auditService.record(connection, passkeyActor(user, meta), {
        action: AuditAction.PASSKEY_REGISTERED,
        entityType: 'webauthn_credential',
        entityId: credential.id,
        after: { deviceName, rpID },
      });

      const row = await webAuthnCredentialRepository.findByCredentialId(connection, credential.id);
      if (row === null) {
        throw new Error('Inserted passkey could not be read back');
      }
      return toPasskeyDto(row);
    });
  }

  async listPasskeys(userId: string): Promise<PasskeyDto[]> {
    const rows = await webAuthnCredentialRepository.listActiveByUserId(getPool(), userId);
    return rows.map(toPasskeyDto);
  }

  async removePasskey(
    userId: string,
    input: RemovePasskeyRequest,
    meta: AuthRequestMeta,
  ): Promise<void> {
    await withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);

      const passwordMatches = await verifyPassword(input.currentPassword, user.password_hash);
      if (!passwordMatches) {
        throw new ValidationError('Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }

      const credential = await webAuthnCredentialRepository.findByCredentialId(connection, input.credentialId);
      if (credential === null || credential.user_id !== userId || credential.revoked_at !== null) {
        throw new NotFoundError('Passkey', input.credentialId);
      }

      await webAuthnCredentialRepository.revoke(connection, credential.id);

      await auditService.record(connection, passkeyActor(user, meta), {
        action: AuditAction.PASSKEY_REMOVED,
        entityType: 'webauthn_credential',
        entityId: credential.id,
        after: { credentialId: input.credentialId },
      });
    });
  }

  async loginOptions(
    identifier: string,
    originHeader: string | undefined,
    meta: AuthRequestMeta,
  ): Promise<PasskeyLoginOptionsResponse> {
    const { origin, rpID } = requireOrigin(originHeader);
    const db = getPool();
    const user = await userRepository.findByIdentifier(db, identifier.trim());

    if (user === null) {
      // Same generic error as the password login to avoid user enumeration.
      await authService.recordFailedLogin(db, identifier, meta);
      throw new InvalidCredentialsError();
    }

    const credentials = await webAuthnCredentialRepository.listActiveByUserId(db, user.id);

    const challenge = randomToken(32);
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((row) => ({
        id: row.credential_id,
        transports: JSON.parse(row.transports) as AuthenticatorTransportFuture[],
      })),
      challenge,
      userVerification: 'preferred',
    });

    await webAuthnChallengeRepository.insert(db, {
      id: newId(),
      userId: user.id,
      type: 'authentication',
      challenge: options.challenge,
      expiresAt: addMinutes(new Date(), CHALLENGE_TTL_MINUTES),
    });

    return { options: options as unknown as Record<string, unknown> };
  }

  async login(
    input: PasskeyLoginRequest,
    originHeader: string | undefined,
    meta: AuthRequestMeta,
  ): Promise<LoginResponse> {
    const { origin, rpID } = requireOrigin(originHeader);
    const response = input.response as unknown as AuthenticationResponseJSON;

    return withTransaction(async (connection) => {
      const credential = await webAuthnCredentialRepository.findByCredentialId(connection, response.id);

      if (credential === null) {
        await authService.recordFailedLogin(connection, response.id, meta);
        throw new InvalidCredentialsError();
      }

      if (credential.revoked_at !== null) {
        const revokedUser = await userRepository.findById(connection, credential.user_id);
        await auditService.record(connection, {
          userId: revokedUser?.id ?? credential.user_id,
          role: revokedUser?.role ?? null,
          ip: meta.ip,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
        }, {
          action: AuditAction.FAST_AUTH_PASSKEY_FAILED,
          entityType: 'webauthn_credential',
          entityId: credential.id,
          after: { reason: 'revoked_credential', credentialId: response.id },
        });
        throw new InvalidCredentialsError();
      }

      const user = await userRepository.findById(connection, credential.user_id);
      if (user === null) {
        await authService.recordFailedLogin(connection, response.id, meta);
        throw new InvalidCredentialsError();
      }

      authService.assertUserCanLogin(user, input.clientType);

      const challengeRow = await webAuthnChallengeRepository.findValidByUserAndType(
        connection,
        user.id,
        'authentication',
      );
      if (challengeRow === null) {
        await auditService.record(connection, passkeyActor(user, meta), {
          action: AuditAction.FAST_AUTH_PASSKEY_FAILED,
          entityType: 'user',
          entityId: user.id,
          after: { reason: 'challenge_expired_or_missing', credentialId: response.id },
        });
        throw new InvalidCredentialsError();
      }

      try {
        const verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challengeRow.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: toWebAuthnCredential(credential),
          requireUserVerification: true,
        });

        if (!verification.verified) {
          throw new InvalidCredentialsError();
        }

        await webAuthnCredentialRepository.updateCounterAndLastUsed(
          connection,
          credential.id,
          verification.authenticationInfo.newCounter,
        );
        await webAuthnChallengeRepository.deleteById(connection, challengeRow.id);

        return authService.startSession(
          user,
          { deviceId: input.deviceId, deviceName: input.deviceName, clientType: input.clientType },
          meta,
          AuditAction.FAST_AUTH_PASSKEY_SUCCESS,
          { method: 'passkey', credentialId: response.id, clientType: input.clientType, deviceId: input.deviceId },
          connection,
        );
      } catch (error) {
        await auditService.record(connection, passkeyActor(user, meta), {
          action: AuditAction.FAST_AUTH_PASSKEY_FAILED,
          entityType: 'user',
          entityId: user.id,
          after: { reason: 'verification_failed', credentialId: response.id },
        });
        if (error instanceof InvalidCredentialsError) throw error;
        throw new InvalidCredentialsError();
      }
    });
  }
}

export const passkeyService = new PasskeyService();
