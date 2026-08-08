import type { Request, Response } from 'express';
import type {
  ChangePasswordRequest,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterPushTokenRequest,
} from '@menuboard/shared';
import { authService } from '../services/AuthService';
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
};
