import bcrypt from 'bcryptjs';
import { config } from '../config';
import { LIMITS } from '@menuboard/shared';
import { ValidationError } from './errors';

export async function hashPassword(plain: string): Promise<string> {
  assertPasswordPolicy(plain);
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // bcrypt.compare is constant-time for the hash comparison itself.
  return bcrypt.compare(plain, hash);
}

/**
 * Password policy, enforced at the one place passwords enter the system so it cannot be
 * bypassed by a route that forgot to validate.
 */
export function assertPasswordPolicy(plain: string): void {
  const problems: string[] = [];

  if (plain.length < LIMITS.PASSWORD_MIN) {
    problems.push(`be at least ${LIMITS.PASSWORD_MIN} characters`);
  }
  if (plain.length > LIMITS.PASSWORD_MAX) {
    problems.push(`be at most ${LIMITS.PASSWORD_MAX} characters`);
  }
  if (!/[A-Za-z]/.test(plain)) problems.push('contain a letter');
  if (!/\d/.test(plain)) problems.push('contain a digit');

  if (problems.length > 0) {
    throw new ValidationError('Password is not strong enough', [
      { path: 'password', message: `Password must ${problems.join(', ')}` },
    ]);
  }
}
