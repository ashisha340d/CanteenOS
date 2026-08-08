import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  ANDROID_FORBIDDEN_CAPABILITIES,
  ClientType,
  ERROR_CODES,
  type AccessTokenClaims,
  type Capability,
  type UserRole,
} from '@menuboard/shared';
import { config } from '../config';
import { permissionsCacheService } from './PermissionsCacheService';
import { UnauthenticatedError } from '../utils/errors';
import { newId, randomToken } from '../utils/ids';
import { addDays, addMinutes } from '../utils/time';

/**
 * Access token minting and verification, plus refresh token secret generation.
 *
 * Refresh tokens are opaque random strings, never JWTs: they must be revocable, and a
 * self-contained token cannot be. Only their SHA-256 hash is stored, so a database leak
 * does not yield usable tokens.
 */
export class TokenService {
  issueAccessToken(input: {
    userId: string;
    role: UserRole;
    clientType: ClientType;
    deviceId: string;
  }): { token: string; expiresAt: Date; tokenId: string } {
    const tokenId = newId();
    const expiresAt = addMinutes(new Date(), config.auth.accessTokenTtlMinutes);

    const token = jwt.sign(
      {
        sub: input.userId,
        role: input.role,
        ct: input.clientType,
        did: input.deviceId,
        jti: tokenId,
      },
      config.auth.jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: `${config.auth.accessTokenTtlMinutes}m`,
        issuer: config.auth.issuer,
        audience: config.auth.audience,
      },
    );

    return { token, expiresAt, tokenId };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      // `algorithms` is pinned so a forged `alg: none` or RS256 header cannot be accepted.
      const decoded = jwt.verify(token, config.auth.jwtSecret, {
        algorithms: ['HS256'],
        issuer: config.auth.issuer,
        audience: config.auth.audience,
      });

      if (typeof decoded === 'string') {
        throw new UnauthenticatedError('Malformed token', ERROR_CODES.TOKEN_INVALID);
      }
      return decoded as unknown as AccessTokenClaims;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthenticatedError('Access token has expired', ERROR_CODES.TOKEN_EXPIRED);
      }
      if (error instanceof UnauthenticatedError) throw error;
      throw new UnauthenticatedError('Access token is invalid', ERROR_CODES.TOKEN_INVALID);
    }
  }

  /** Returns the secret to hand the client and the hash to persist. */
  createRefreshToken(): { secret: string; hash: string; expiresAt: Date } {
    const secret = randomToken(32);
    return {
      secret,
      hash: hashRefreshToken(secret),
      expiresAt: addDays(new Date(), config.auth.refreshTokenTtlDays),
    };
  }

  /**
   * Effective global capabilities for a session. Android sessions have the administrative
   * capabilities stripped even when the user is an Admin, so the mobile app can never
   * reach billing, masters, reports or user management.
   */
  capabilitiesFor(role: UserRole, clientType: ClientType): Capability[] {
    const base = permissionsCacheService.getRoleCapabilities(role);
    if (clientType !== ClientType.ANDROID) return base;
    return base.filter((capability) => !ANDROID_FORBIDDEN_CAPABILITIES.includes(capability));
  }
}

export function hashRefreshToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export const tokenService = new TokenService();
