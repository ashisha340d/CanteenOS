import { LIMITS } from '@menuboard/shared';
import { describe, expect, it } from 'vitest';
import { changePasswordSchema, createUserSchema, loginSchema } from '../src/validation/schemas';

describe('password policy (LIMITS.PASSWORD_MIN / PASSWORD_MAX)', () => {
  it('rejects a new password shorter than the minimum', () => {
    const short = 'a'.repeat(LIMITS.PASSWORD_MIN - 1);
    const result = changePasswordSchema.safeParse({ currentPassword: 'whatever', newPassword: short });
    expect(result.success).toBe(false);
  });

  it('accepts a new password exactly at the minimum length', () => {
    const atMin = 'a'.repeat(LIMITS.PASSWORD_MIN);
    const result = changePasswordSchema.safeParse({ currentPassword: 'whatever', newPassword: atMin });
    expect(result.success).toBe(true);
  });

  it('rejects a new password longer than the maximum', () => {
    const tooLong = 'a'.repeat(LIMITS.PASSWORD_MAX + 1);
    const result = changePasswordSchema.safeParse({ currentPassword: 'whatever', newPassword: tooLong });
    expect(result.success).toBe(false);
  });

  it('rejects an empty current password on change', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'a'.repeat(LIMITS.PASSWORD_MIN),
    });
    expect(result.success).toBe(false);
  });

  it('createUserSchema enforces the same minimum for a brand-new account', () => {
    const tooShort = createUserSchema.safeParse({
      username: 'newuser',
      name: 'New User',
      password: 'a'.repeat(LIMITS.PASSWORD_MIN - 1),
      role: 'USER',
    });
    expect(tooShort.success).toBe(false);

    const longEnough = createUserSchema.safeParse({
      username: 'newuser',
      name: 'New User',
      password: 'a'.repeat(LIMITS.PASSWORD_MIN),
      role: 'USER',
    });
    expect(longEnough.success).toBe(true);
  });

  it('login does not enforce the minimum length (an existing short legacy password must still be able to log in)', () => {
    const result = loginSchema.safeParse({
      identifier: 'user1',
      password: 'x',
      deviceId: 'device-1',
      clientType: 'ANDROID',
    });
    expect(result.success).toBe(true);
  });

  it('login rejects a completely empty password', () => {
    const result = loginSchema.safeParse({
      identifier: 'user1',
      password: '',
      deviceId: 'device-1',
      clientType: 'ANDROID',
    });
    expect(result.success).toBe(false);
  });
});
