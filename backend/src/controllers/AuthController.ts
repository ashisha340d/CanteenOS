import type { Request, Response } from 'express';
import type {
  ChangePasswordRequest,
  LoginRequest,
  LogoutRequest,
  PasskeyLoginRequest,
  PinLoginRequest,
  PinStatusResponse,
  RefreshRequest,
  RegisterPasskeyOptionsRequest,
  RegisterPasskeyRequest,
  RegisterPushTokenRequest,
  RemovePasskeyRequest,
  RemovePinRequest,
  SetPinRequest,
} from '@menuboard/shared';
import { authService } from '../services/AuthService';
import { pinService } from '../services/PinService';
import { passkeyService } from '../services/PasskeyService';
import { tokenService } from '../services/TokenService';
import { requireAuth } from '../middleware/types';
import { noContent, ok } from '../utils/http';
import { authRequestMeta } from './context';

/** HTTP concerns only: read the request, call the service, shape the response. */
export const AuthController = {
  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body as LoginRequest, authRequestMeta(req));
    ok(res, result);
  },

  async refresh(req: Request, res: Response): Promise<void> {
    const input = req.body as RefreshRequest;
    const tokens = await authService.refresh(
      input.refreshToken,
      input.deviceId,
      authRequestMeta(req),
    );
    ok(res, tokens);
  },

  async logout(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    await authService.logout(auth.userId, req.body as LogoutRequest, authRequestMeta(req));
    noContent(res);
  },

  async me(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const user = await authService.currentUser(auth.userId);
    ok(res, {
      user,
      capabilities: tokenService.capabilitiesFor(auth.role, auth.clientType),
    });
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    await authService.changePassword(
      auth.userId,
      req.body as ChangePasswordRequest,
      authRequestMeta(req),
    );
    noContent(res);
  },

  async registerPushToken(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const input = req.body as RegisterPushTokenRequest;
    await authService.registerPushToken(auth.userId, input.deviceId, input.pushToken);
    noContent(res);
  },

  async loginWithPin(req: Request, res: Response): Promise<void> {
    const result = await pinService.login(req.body as PinLoginRequest, authRequestMeta(req));
    ok(res, result);
  },

  async setPin(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    await pinService.setPin(auth.userId, req.body as SetPinRequest, authRequestMeta(req));
    noContent(res);
  },

  async pinStatus(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const status = await pinService.getStatus(auth.userId);
    ok(res, status as PinStatusResponse);
  },

  async removePin(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    await pinService.removePin(auth.userId, req.body as RemovePinRequest, authRequestMeta(req));
    noContent(res);
  },

  async passkeyLoginOptions(req: Request, res: Response): Promise<void> {
    const { identifier } = req.body as { identifier: string };
    const result = await passkeyService.loginOptions(
      identifier,
      req.get('origin'),
      authRequestMeta(req),
    );
    ok(res, result);
  },

  async loginWithPasskey(req: Request, res: Response): Promise<void> {
    const result = await passkeyService.login(req.body as PasskeyLoginRequest, req.get('origin'), authRequestMeta(req));
    ok(res, result);
  },

  async passkeyRegisterOptions(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const input = req.body as RegisterPasskeyOptionsRequest;
    const result = await passkeyService.registrationOptions(
      auth.userId,
      input.deviceName ?? null,
      req.get('origin'),
    );
    ok(res, result);
  },

  async registerPasskey(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const input = req.body as RegisterPasskeyRequest;
    const result = await passkeyService.register(auth.userId, input, req.get('origin'), authRequestMeta(req));
    ok(res, result);
  },

  async listPasskeys(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const passkeys = await passkeyService.listPasskeys(auth.userId);
    ok(res, { passkeys });
  },

  async removePasskey(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    await passkeyService.removePasskey(auth.userId, req.body as RemovePasskeyRequest, authRequestMeta(req));
    noContent(res);
  },
};
