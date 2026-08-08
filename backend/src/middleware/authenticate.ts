import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES, UserStatus } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { userRepository } from '../repositories/UserRepository';
import { tokenService } from '../services/TokenService';
import { AccountInactiveError, UnauthenticatedError } from '../utils/errors';

/**
 * Verifies the bearer token and attaches `req.auth`.
 *
 * The user's current status is read on every request rather than trusted from the token.
 * A 15-minute access token would otherwise let a suspended account keep working until it
 * expired; the cost is one primary-key lookup on a pooled connection.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header('authorization');
    if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthenticatedError('A bearer token is required');
    }

    const token = header.slice(7).trim();
    if (token === '') {
      throw new UnauthenticatedError('A bearer token is required');
    }

    const claims = tokenService.verifyAccessToken(token);

    const user = await userRepository.findById(getPool(), claims.sub);
    if (user === null) {
      throw new UnauthenticatedError('The signed-in user no longer exists', ERROR_CODES.TOKEN_INVALID);
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountInactiveError();
    }
    // A role change must take effect immediately, so the live row wins over the token claim.
    if (user.role !== claims.role) {
      throw new UnauthenticatedError(
        'Your permissions have changed, please sign in again',
        ERROR_CODES.TOKEN_INVALID,
      );
    }

    req.auth = {
      userId: user.id,
      role: user.role,
      clientType: claims.ct,
      deviceId: claims.did,
      tokenId: claims.jti,
      capabilities: tokenService.capabilitiesFor(user.role, claims.ct),
    };

    next();
  } catch (error) {
    next(error);
  }
}
