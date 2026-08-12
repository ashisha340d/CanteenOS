import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientType, UserRole, UserStatus } from '@menuboard/shared';
import {
  passkeyLoginSchema,
  passkeyRegisterSchema,
  passkeyRemoveSchema,
  pinLoginSchema,
  pinManageSchema,
} from '../src/validation/schemas';
import type { UserRow } from '../src/models/rows';
import { AccountInactiveError, AdminRoleRequiredError, InvalidCredentialsError } from '../src/utils/errors';

const mocks = vi.hoisted(() => {
  const pool = { execute: vi.fn() };
  const pinRepo = {
    findByUserId: vi.fn(),
    upsert: vi.fn(),
    remove: vi.fn(),
    incrementFailedAttempt: vi.fn(),
    setLockedUntil: vi.fn(),
    resetAttempts: vi.fn(),
  };
  const userRepo = {
    findById: vi.fn(),
    findByIdentifier: vi.fn(),
    touchLastLogin: vi.fn(),
  };
  const authSvc = {
    assertUserCanLogin: vi.fn(),
    startSession: vi.fn(),
    recordFailedLogin: vi.fn(),
  };
  const auditSvc = { record: vi.fn() };
  return { pool, pinRepo, userRepo, authSvc, auditSvc };
});

vi.mock('../src/db/pool', () => ({ getPool: () => mocks.pool }));
vi.mock('../src/db/transaction', () => ({ withTransaction: async (fn: (db: unknown) => Promise<unknown>) => fn(mocks.pool) }));
vi.mock('../src/repositories/UserRepository', () => ({ userRepository: mocks.userRepo }));
vi.mock('../src/repositories/UserPinRepository', () => ({ userPinRepository: mocks.pinRepo }));
vi.mock('../src/services/AuthService', () => ({ authService: mocks.authSvc }));
vi.mock('../src/services/AuditService', () => ({
  AuditAction: {
    FAST_AUTH_PIN_SUCCESS: 'auth.fast.pin.success',
    FAST_AUTH_PIN_FAILED: 'auth.fast.pin.failed',
    ACCOUNT_LOCKED: 'auth.account.locked',
    PIN_CREATED: 'auth.pin.created',
    PIN_CHANGED: 'auth.pin.changed',
    PIN_REMOVED: 'auth.pin.removed',
    PASSKEY_REGISTERED: 'auth.passkey.registered',
    PASSKEY_REMOVED: 'auth.passkey.removed',
    FAST_AUTH_PASSKEY_SUCCESS: 'auth.fast.passkey.success',
    FAST_AUTH_PASSKEY_FAILED: 'auth.fast.passkey.failed',
  },
  auditService: mocks.auditSvc,
}));

// Import the service after its dependencies have been mocked.
const { pinService } = await import('../src/services/PinService');

const passkeyMocks = vi.hoisted(() => ({
  registrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  authenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  credentialRepo: {
    findByCredentialId: vi.fn(),
    listActiveByUserId: vi.fn(),
    insert: vi.fn(),
    revoke: vi.fn(),
    updateCounterAndLastUsed: vi.fn(),
  },
  challengeRepo: {
    insert: vi.fn(),
    findValidByUserAndType: vi.fn(),
    deleteById: vi.fn(),
  },
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: passkeyMocks.registrationOptions,
  verifyRegistrationResponse: passkeyMocks.verifyRegistrationResponse,
  generateAuthenticationOptions: passkeyMocks.authenticationOptions,
  verifyAuthenticationResponse: passkeyMocks.verifyAuthenticationResponse,
}));

vi.mock('../src/repositories/WebAuthnCredentialRepository', () => ({
  webAuthnCredentialRepository: passkeyMocks.credentialRepo,
}));

vi.mock('../src/repositories/WebAuthnChallengeRepository', () => ({
  webAuthnChallengeRepository: passkeyMocks.challengeRepo,
}));

const { passkeyService } = await import('../src/services/PasskeyService');

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  const password = overrides.password_hash ? '' : 'password123';
  return {
    id: '00000000-0000-0000-0000-000000000001',
    employee_code: null,
    name: 'Test User',
    username: 'testuser',
    phone: null,
    email: null,
    password_hash: overrides.password_hash ?? bcrypt.hashSync(password, 10),
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    avatar_path: null,
    must_change_password: 0,
    last_login_at: null,
    created_by: null,
    created_at: '2026-01-01 00:00:00.000',
    updated_at: '2026-01-01 00:00:00.000',
    deleted_at: null,
    revision: 1,
    sync_seq: '1',
    ...overrides,
  };
}

const meta = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-1' };

function isoDateTime(dt: Date): string {
  return dt.toISOString().slice(0, 23).replace('T', ' ');
}

describe('fast auth validation schemas', () => {
  it('accepts a 4-digit PIN login', () => {
    const result = pinLoginSchema.safeParse({
      identifier: 'testuser',
      pin: '1234',
      deviceId: 'device-1',
      clientType: 'ADMIN',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a PIN with fewer than 4 digits', () => {
    const result = pinLoginSchema.safeParse({
      identifier: 'testuser',
      pin: '123',
      deviceId: 'device-1',
      clientType: 'ADMIN',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a PIN containing letters', () => {
    const result = pinLoginSchema.safeParse({
      identifier: 'testuser',
      pin: '12ab',
      deviceId: 'device-1',
      clientType: 'ADMIN',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid PIN management request', () => {
    const result = pinManageSchema.safeParse({ currentPassword: 'password123', pin: '9876' });
    expect(result.success).toBe(true);
  });

  it('accepts a passkey login request with a response object', () => {
    const result = passkeyLoginSchema.safeParse({
      response: { id: 'cred', rawId: 'cred', response: {}, type: 'public-key' },
      deviceId: 'device-1',
      clientType: 'ADMIN',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a passkey registration without a current password', () => {
    const result = passkeyRegisterSchema.safeParse({ response: {} });
    expect(result.success).toBe(false);
  });

  it('rejects a passkey removal without a credential id', () => {
    const result = passkeyRemoveSchema.safeParse({ currentPassword: 'password123' });
    expect(result.success).toBe(false);
  });
});

describe('PinService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authSvc.assertUserCanLogin.mockImplementation((user: UserRow, clientType: ClientType) => {
      if (user.status !== UserStatus.ACTIVE) {
        throw new AccountInactiveError();
      }
      if (clientType === ClientType.ADMIN && user.role !== UserRole.ADMIN) {
        throw new AdminRoleRequiredError();
      }
    });
    mocks.authSvc.startSession.mockResolvedValue({
      user: { id: '00000000-0000-0000-0000-000000000001' },
      tokens: { accessToken: 'at', refreshToken: 'rt' },
      capabilities: [],
    });
  });

  it('returns a session when the PIN is correct', async () => {
    const pin = '1234';
    const user = makeUser();
    const pinRow = {
      user_id: user.id,
      pin_hash: bcrypt.hashSync(pin, 10),
      failed_attempts: 0,
      locked_until: null,
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
    };
    mocks.userRepo.findByIdentifier.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue(pinRow);

    const result = await pinService.login(
      {
        identifier: user.username,
        pin,
        deviceId: 'device-1',
        clientType: ClientType.ADMIN,
      },
      meta,
    );

    expect(result.tokens).toBeDefined();
    expect(mocks.pinRepo.resetAttempts).toHaveBeenCalledWith(mocks.pool, user.id);
    expect(mocks.authSvc.startSession).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ deviceId: 'device-1', clientType: 'ADMIN' }),
      meta,
      'auth.fast.pin.success',
      expect.objectContaining({ method: 'pin', identifier: user.username }),
      expect.anything(),
    );
  });

  it('throws InvalidCredentialsError for a non-existent user', async () => {
    mocks.userRepo.findByIdentifier.mockResolvedValue(null);

    await expect(
      pinService.login(
        {
          identifier: 'nobody',
          pin: '1234',
          deviceId: 'device-1',
          clientType: ClientType.ADMIN,
        },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(mocks.authSvc.recordFailedLogin).toHaveBeenCalled();
  });

  it('throws InvalidCredentialsError for a user with no PIN configured', async () => {
    const user = makeUser();
    mocks.userRepo.findByIdentifier.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue(null);

    await expect(
      pinService.login(
        { identifier: user.username, pin: '1234', deviceId: 'device-1', clientType: ClientType.ADMIN },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('increments failed attempts and eventually locks the account', async () => {
    const pin = '1234';
    const user = makeUser();
    const pinRow = {
      user_id: user.id,
      pin_hash: bcrypt.hashSync('9999', 10),
      failed_attempts: 4,
      locked_until: null,
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
    };
    mocks.userRepo.findByIdentifier.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue(pinRow);
    // After incrementing, reflect the new attempt count.
    mocks.pinRepo.incrementFailedAttempt.mockResolvedValue(undefined);
    mocks.pinRepo.findByUserId.mockResolvedValueOnce(pinRow).mockResolvedValueOnce({
      ...pinRow,
      failed_attempts: 5,
    });

    await expect(
      pinService.login(
        { identifier: user.username, pin, deviceId: 'device-1', clientType: ClientType.ADMIN },
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(mocks.pinRepo.incrementFailedAttempt).toHaveBeenCalledWith(mocks.pool, user.id);
    expect(mocks.pinRepo.setLockedUntil).toHaveBeenCalled();
    expect(mocks.auditSvc.record).toHaveBeenLastCalledWith(
      mocks.pool,
      expect.anything(),
      expect.objectContaining({ action: 'auth.account.locked' }),
    );
  });

  it('rejects a locked account even with the correct PIN', async () => {
    const pin = '1234';
    const user = makeUser();
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    const pinRow = {
      user_id: user.id,
      pin_hash: bcrypt.hashSync(pin, 10),
      failed_attempts: 5,
      locked_until: isoDateTime(lockedUntil),
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
    };
    mocks.userRepo.findByIdentifier.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue(pinRow);

    await expect(
      pinService.login(
        { identifier: user.username, pin, deviceId: 'device-1', clientType: ClientType.ADMIN },
        meta,
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(mocks.authSvc.startSession).not.toHaveBeenCalled();
  });

  it('enforces ADMIN role for the Admin Portal', async () => {
    const user = makeUser({ role: UserRole.USER });
    const pinRow = {
      user_id: user.id,
      pin_hash: bcrypt.hashSync('1234', 10),
      failed_attempts: 0,
      locked_until: null,
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
    };
    mocks.userRepo.findByIdentifier.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue(pinRow);

    await expect(
      pinService.login(
        { identifier: user.username, pin: '1234', deviceId: 'device-1', clientType: ClientType.ADMIN },
        meta,
      ),
    ).rejects.toBeInstanceOf(AdminRoleRequiredError);
  });

  it('rejects an inactive account', async () => {
    const user = makeUser({ status: UserStatus.SUSPENDED });
    const pinRow = {
      user_id: user.id,
      pin_hash: bcrypt.hashSync('1234', 10),
      failed_attempts: 0,
      locked_until: null,
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
    };
    mocks.userRepo.findByIdentifier.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue(pinRow);

    await expect(
      pinService.login(
        { identifier: user.username, pin: '1234', deviceId: 'device-1', clientType: ClientType.ADMIN },
        meta,
      ),
    ).rejects.toBeInstanceOf(AccountInactiveError);
  });

  it('sets a PIN when the current password is correct', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue(null);

    await pinService.setPin(user.id, { currentPassword: 'password123', pin: '5678' }, meta);

    expect(mocks.pinRepo.upsert).toHaveBeenCalled();
    expect(mocks.auditSvc.record).toHaveBeenLastCalledWith(
      mocks.pool,
      expect.anything(),
      expect.objectContaining({ action: 'auth.pin.created' }),
    );
  });

  it('changes an existing PIN and audits it as a change', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue({
      user_id: user.id,
      pin_hash: 'oldhash',
      failed_attempts: 0,
      locked_until: null,
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
    });

    await pinService.setPin(user.id, { currentPassword: 'password123', pin: '9999' }, meta);

    expect(mocks.auditSvc.record).toHaveBeenLastCalledWith(
      mocks.pool,
      expect.anything(),
      expect.objectContaining({ action: 'auth.pin.changed' }),
    );
  });

  it('rejects PIN setup with the wrong current password', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);

    await expect(
      pinService.setPin(user.id, { currentPassword: 'wrongpassword', pin: '5678' }, meta),
    ).rejects.toBeInstanceOf(Error);
  });

  it('removes a PIN when the current password is correct', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);
    mocks.pinRepo.findByUserId.mockResolvedValue({
      user_id: user.id,
      pin_hash: bcrypt.hashSync('1234', 10),
      failed_attempts: 0,
      locked_until: null,
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
    });

    await pinService.removePin(user.id, { currentPassword: 'password123' }, meta);

    expect(mocks.pinRepo.remove).toHaveBeenCalledWith(mocks.pool, user.id);
    expect(mocks.auditSvc.record).toHaveBeenLastCalledWith(
      mocks.pool,
      expect.anything(),
      expect.objectContaining({ action: 'auth.pin.removed' }),
    );
  });
});

describe('PasskeyService', () => {
  const origin = 'http://localhost:5173';

  function makeCredentialRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      id: '00000000-0000-0000-0000-000000000002',
      credential_id: 'credential-id-1',
      user_id: '00000000-0000-0000-0000-000000000001',
      public_key: Buffer.from('public-key').toString('base64url'),
      sign_counter: 0,
      transports: JSON.stringify(['internal']),
      backup_eligible: 0,
      backup_state: 0,
      device_name: 'This device',
      last_used_at: null,
      revoked_at: null,
      created_at: '2026-01-01 00:00:00.000',
      updated_at: '2026-01-01 00:00:00.000',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    passkeyMocks.registrationOptions.mockResolvedValue({
      rp: { name: 'MenuBoard', id: 'localhost' },
      user: { id: 'user-handle', name: 'testuser', displayName: 'Test User' },
      challenge: 'registration-challenge',
      pubKeyCredParams: [],
      timeout: 60000,
    });
    passkeyMocks.authenticationOptions.mockResolvedValue({
      challenge: 'authentication-challenge',
      allowCredentials: [{ id: 'credential-id-1', type: 'public-key' }],
      timeout: 60000,
    });
    passkeyMocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'new-credential-id',
          publicKey: Buffer.from('new-public-key'),
          counter: 0,
        },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    });
    passkeyMocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: {
        credentialID: 'credential-id-1',
        newCounter: 1,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin,
        rpID: 'localhost',
      },
    });
    mocks.authSvc.assertUserCanLogin.mockImplementation((user: UserRow, clientType: ClientType) => {
      if (user.status !== UserStatus.ACTIVE) throw new AccountInactiveError();
      if (clientType === ClientType.ADMIN && user.role !== UserRole.ADMIN) throw new AdminRoleRequiredError();
    });
    mocks.authSvc.startSession.mockResolvedValue({
      user: { id: '00000000-0000-0000-0000-000000000001' },
      tokens: { accessToken: 'at', refreshToken: 'rt' },
      capabilities: [],
    });
  });

  it('generates passkey registration options and stores a challenge', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);
    passkeyMocks.credentialRepo.listActiveByUserId.mockResolvedValue([]);

    const result = await passkeyService.registrationOptions(user.id, 'My phone', origin);

    expect(result.options).toBeDefined();
    expect(passkeyMocks.registrationOptions).toHaveBeenCalled();
    expect(passkeyMocks.challengeRepo.insert).toHaveBeenCalled();
  });

  it('registers a passkey after verifying the current password', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);
    passkeyMocks.challengeRepo.findValidByUserAndType.mockResolvedValue({
      id: 'challenge-id',
      user_id: user.id,
      type: 'registration',
      challenge: 'registration-challenge',
      expires_at: '2026-12-31 23:59:59.000',
      created_at: '2026-01-01 00:00:00.000',
    });
    passkeyMocks.credentialRepo.findByCredentialId.mockResolvedValue(
      makeCredentialRow({ id: 'new-row-id', credential_id: 'new-credential-id' }),
    );

    const response = {
      id: 'new-credential-id',
      rawId: 'new-credential-id',
      response: { clientDataJSON: 'x', attestationObject: 'y', transports: ['internal'] },
      clientExtensionResults: {},
      type: 'public-key',
    };

    const result = await passkeyService.register(
      user.id,
      { currentPassword: 'password123', response: response as unknown as Record<string, unknown>, deviceName: 'My phone' },
      origin,
      meta,
    );

    expect(result.credentialId).toBe('new-credential-id');
    expect(passkeyMocks.credentialRepo.insert).toHaveBeenCalled();
    expect(passkeyMocks.challengeRepo.deleteById).toHaveBeenCalled();
    expect(mocks.auditSvc.record).toHaveBeenLastCalledWith(
      mocks.pool,
      expect.anything(),
      expect.objectContaining({ action: 'auth.passkey.registered' }),
    );
  });

  it('rejects passkey registration with the wrong password', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);

    await expect(
      passkeyService.register(
        user.id,
        { currentPassword: 'wrongpassword', response: {}, deviceName: 'My phone' },
        origin,
        meta,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it('lists active passkeys for a user', async () => {
    passkeyMocks.credentialRepo.listActiveByUserId.mockResolvedValue([makeCredentialRow()]);

    const result = await passkeyService.listPasskeys('00000000-0000-0000-0000-000000000001');

    expect(result).toHaveLength(1);
    expect(result[0].credentialId).toBe('credential-id-1');
  });

  it('removes a passkey after verifying the current password', async () => {
    const user = makeUser();
    mocks.userRepo.findById.mockResolvedValue(user);
    passkeyMocks.credentialRepo.findByCredentialId.mockResolvedValue(makeCredentialRow());

    await passkeyService.removePasskey(
      user.id,
      { credentialId: 'credential-id-1', currentPassword: 'password123' },
      meta,
    );

    expect(passkeyMocks.credentialRepo.revoke).toHaveBeenCalled();
    expect(mocks.auditSvc.record).toHaveBeenLastCalledWith(
      mocks.pool,
      expect.anything(),
      expect.objectContaining({ action: 'auth.passkey.removed' }),
    );
  });

  it('generates passkey login options and stores a challenge', async () => {
    const user = makeUser();
    mocks.userRepo.findByIdentifier.mockResolvedValue(user);
    passkeyMocks.credentialRepo.listActiveByUserId.mockResolvedValue([makeCredentialRow()]);

    const result = await passkeyService.loginOptions(user.username, origin, meta);

    expect(result.options).toBeDefined();
    expect(passkeyMocks.authenticationOptions).toHaveBeenCalled();
    expect(passkeyMocks.challengeRepo.insert).toHaveBeenCalled();
  });

  it('returns a session for a valid passkey authentication', async () => {
    const user = makeUser();
    passkeyMocks.credentialRepo.findByCredentialId.mockResolvedValue(makeCredentialRow());
    mocks.userRepo.findById.mockResolvedValue(user);
    passkeyMocks.challengeRepo.findValidByUserAndType.mockResolvedValue({
      id: 'challenge-id',
      user_id: user.id,
      type: 'authentication',
      challenge: 'authentication-challenge',
      expires_at: '2026-12-31 23:59:59.000',
      created_at: '2026-01-01 00:00:00.000',
    });

    const response = {
      id: 'credential-id-1',
      rawId: 'credential-id-1',
      response: {
        clientDataJSON: 'x',
        authenticatorData: 'y',
        signature: 'z',
      },
      clientExtensionResults: {},
      type: 'public-key',
    };

    const result = await passkeyService.login(
      {
        response: response as unknown as Record<string, unknown>,
        deviceId: 'device-1',
        clientType: ClientType.ADMIN,
      },
      origin,
      meta,
    );

    expect(result.tokens).toBeDefined();
    expect(passkeyMocks.credentialRepo.updateCounterAndLastUsed).toHaveBeenCalledWith(
      mocks.pool,
      '00000000-0000-0000-0000-000000000002',
      1,
    );
    expect(mocks.authSvc.startSession).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ deviceId: 'device-1', clientType: 'ADMIN' }),
      meta,
      'auth.fast.passkey.success',
      expect.anything(),
      expect.anything(),
    );
  });

  it('rejects authentication with a revoked passkey', async () => {
    passkeyMocks.credentialRepo.findByCredentialId.mockResolvedValue(
      makeCredentialRow({ revoked_at: '2026-01-02 00:00:00.000' }),
    );
    mocks.userRepo.findById.mockResolvedValue(makeUser());

    const response = { id: 'credential-id-1', rawId: 'credential-id-1', response: {}, clientExtensionResults: {}, type: 'public-key' };

    await expect(
      passkeyService.login(
        { response: response as unknown as Record<string, unknown>, deviceId: 'device-1', clientType: ClientType.ADMIN },
        origin,
        meta,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(mocks.authSvc.startSession).not.toHaveBeenCalled();
  });
});
