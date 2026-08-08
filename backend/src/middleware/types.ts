import type { Request } from 'express';
import type { BoardRole, Capability, ClientType, UserRole } from '@menuboard/shared';

/** Identity attached by `authenticate`. */
export interface AuthContext {
  userId: string;
  role: UserRole;
  clientType: ClientType;
  deviceId: string;
  tokenId: string;
  /** Global capabilities, already filtered for the calling client type. */
  capabilities: readonly Capability[];
}

export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  startedAt: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      context: RequestContext;
      auth?: AuthContext;
      /**
       * Board membership resolved by `requireBoardAccess`, cached on the request so a
       * handler does not re-query it.
       */
      boardRole?: BoardRole | null;
      /** Output of `validate`; typed per route via the generic helpers. */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

/** Narrowing helper for handlers that run behind `authenticate`. */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) {
    // Reaching here means a route was wired without `authenticate` — a programming error,
    // not a client error.
    throw new Error('Route handler requires authentication middleware');
  }
  return req.auth;
}
