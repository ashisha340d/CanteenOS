import type {
  AuthTokens,
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  PasskeyDto,
  PasskeyLoginOptionsResponse,
  PasskeyLoginRequest,
  PinLoginRequest,
  PinStatusResponse,
  RegisterPasskeyOptionsRequest,
  RegisterPasskeyOptionsResponse,
  RegisterPasskeyRequest,
  RemovePasskeyRequest,
  RemovePinRequest,
  SetPinRequest,
} from '@menuboard/shared';
import { http, unwrap } from './client';

export const authApi = {
  login: (body: LoginRequest) => unwrap<LoginResponse>(http.post('/auth/login', body)),

  loginWithPin: (body: PinLoginRequest) => unwrap<LoginResponse>(http.post('/auth/login/pin', body)),

  getPasskeyLoginOptions: (identifier: string) =>
    unwrap<PasskeyLoginOptionsResponse>(http.post('/auth/login/passkey/options', { identifier })),

  loginWithPasskey: (body: PasskeyLoginRequest) =>
    unwrap<LoginResponse>(http.post('/auth/login/passkey', body)),

  refresh: (refreshToken: string, deviceId: string) =>
    unwrap<AuthTokens>(http.post('/auth/refresh', { refreshToken, deviceId })),

  logout: (refreshToken?: string, allDevices?: boolean) =>
    unwrap<null>(http.post('/auth/logout', { refreshToken, allDevices })),

  me: () => unwrap<{ user: AuthenticatedUser; capabilities: string[] }>(http.get('/auth/me')),

  changePassword: (body: ChangePasswordRequest) =>
    unwrap<null>(http.post('/auth/password', body)),

  setPin: (body: SetPinRequest) => unwrap<null>(http.post('/auth/pin', body)),

  removePin: (body: RemovePinRequest) => unwrap<null>(http.post('/auth/pin/remove', body)),

  getPinStatus: () => unwrap<PinStatusResponse>(http.get('/auth/pin/status')),

  listPasskeys: () => unwrap<{ passkeys: PasskeyDto[] }>(http.get('/auth/passkeys')),

  getPasskeyRegisterOptions: (body: RegisterPasskeyOptionsRequest) =>
    unwrap<RegisterPasskeyOptionsResponse>(http.post('/auth/passkeys/register-options', body)),

  registerPasskey: (body: RegisterPasskeyRequest) =>
    unwrap<PasskeyDto>(http.post('/auth/passkeys/register', body)),

  removePasskey: (body: RemovePasskeyRequest) => unwrap<null>(http.post('/auth/passkeys/remove', body)),
};
