import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  ANDROID_FORBIDDEN_CAPABILITIES,
  Capability,
  ClientType,
  KIOSK_ALLOWED_CAPABILITIES,
  type UserRole,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { boardRepository } from '../repositories/BoardRepository';
import { permissionsCacheService } from '../services/PermissionsCacheService';
import { ClientNotPermittedError, ForbiddenError, NotFoundError } from '../utils/errors';
import { requireAuth } from './types';

/**
 * Requires a global capability — one granted by the user's role irrespective of any board.
 * Use for administration endpoints (users, masters, reports, billing, audit, settings).
 */
export function requireCapability(capability: Capability): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = requireAuth(req);

      // Checked before the capability itself so the error explains the real reason: an Admin
      // on the mobile app is not lacking permission, the app is not permitted to offer it.
      if (
        auth.clientType === ClientType.ANDROID &&
        ANDROID_FORBIDDEN_CAPABILITIES.includes(capability)
      ) {
        throw new ClientNotPermittedError();
      }

      // The kiosk is allowlisted rather than denylisted, so a capability added to the product
      // later is unreachable from the tablet until it is deliberately named as kiosk-safe.
      if (
        auth.clientType === ClientType.KIOSK &&
        !KIOSK_ALLOWED_CAPABILITIES.includes(capability)
      ) {
        throw new ClientNotPermittedError();
      }

      if (!auth.capabilities.includes(capability)) {
        throw new ForbiddenError();
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Requires **any one** of several global capabilities.
 *
 * Used where one endpoint legitimately serves two audiences with different powers — reading a
 * single machine, which a monitor does through `equipment.view` and a reporter through
 * `equipment.report_problem`. Expressing that as two routes would mean two paths for one
 * resource; expressing it as the weaker capability alone would hand a reporter the whole estate.
 */
export function requireAnyCapability(...capabilities: readonly Capability[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = requireAuth(req);

      if (
        auth.clientType === ClientType.ANDROID &&
        capabilities.every((capability) => ANDROID_FORBIDDEN_CAPABILITIES.includes(capability))
      ) {
        throw new ClientNotPermittedError();
      }

      const granted = capabilities.filter(
        (capability) =>
          auth.capabilities.includes(capability) &&
          !(
            auth.clientType === ClientType.ANDROID &&
            ANDROID_FORBIDDEN_CAPABILITIES.includes(capability)
          ),
      );
      if (granted.length === 0) throw new ForbiddenError();
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...roles: readonly UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = requireAuth(req);
      if (!roles.includes(auth.role)) throw new ForbiddenError();
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Decides whether a globally-held capability reaches *this* board.
 *
 * A global grant alone is not enough. Several role capabilities are global by nature but
 * board-scoped in effect — a Manager holds ORDER_QUANTITY_EDIT as a Manager, yet may only
 * spend it on boards they were assigned to. Only BOARD_READ_ALL (Admin and Super Admin)
 * crosses board boundaries; everyone else needs a membership as well.
 */
function globalGrantReachesBoard(
  capabilities: readonly Capability[],
  capability: Capability,
  boardRole: unknown,
): boolean {
  if (!capabilities.includes(capability)) return false;
  return boardRole !== null || capabilities.includes(Capability.BOARD_READ_ALL);
}

/**
 * Resolves board membership and enforces a board-scoped capability.
 *
 * Two grants are accepted: a global capability that reaches this board (see
 * {@link globalGrantReachesBoard}) or the capability attached to the caller's board role.
 * Board membership is cached on `req.boardRole` so the handler does not re-query it.
 *
 * @param capability the board-scoped capability required
 * @param boardIdFrom where to read the board id from — defaults to `params.boardId`
 */
export function requireBoardAccess(
  capability: Capability,
  boardIdFrom: (req: Request) => string | undefined = (req) => req.params.boardId,
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const boardId = boardIdFrom(req);

      if (boardId === undefined || boardId === '') {
        throw new NotFoundError('Board');
      }

      const pool = getPool();
      const board = await boardRepository.findById(pool, boardId);
      if (board === null) throw new NotFoundError('Board', boardId);

      const boardRole = await boardRepository.findActiveRole(pool, boardId, auth.userId);
      req.boardRole = boardRole;

      const grantedGlobally = globalGrantReachesBoard(auth.capabilities, capability, boardRole);
      const grantedByBoard =
        boardRole !== null && permissionsCacheService.boardRoleHasCapability(boardRole, capability);

      if (!grantedGlobally && !grantedByBoard) {
        // Non-membership is reported as 403, not 404: the board id came from a resource the
        // caller already holds, so hiding its existence buys nothing and confuses debugging.
        throw new ForbiddenError(
          boardRole === null
            ? 'You are not a member of this board'
            : 'Your role on this board does not allow this action',
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Board-scoped guard for routes keyed by something other than a board id — an order id or a
 * thread message id. `resolveBoardId` looks the board up, then the same two-grant check as
 * `requireBoardAccess` applies.
 */
export function requireResolvedBoardAccess(
  capability: Capability,
  resolveBoardId: (req: Request) => Promise<string | null>,
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const boardId = await resolveBoardId(req);
      if (boardId === null) throw new NotFoundError('Resource');

      const boardRole = await boardRepository.findActiveRole(getPool(), boardId, auth.userId);
      req.boardRole = boardRole;

      const grantedGlobally = globalGrantReachesBoard(auth.capabilities, capability, boardRole);
      const grantedByBoard =
        boardRole !== null && permissionsCacheService.boardRoleHasCapability(boardRole, capability);

      if (!grantedGlobally && !grantedByBoard) {
        throw new ForbiddenError(
          boardRole === null
            ? 'You are not a member of the board this belongs to'
            : 'Your role on this board does not allow this action',
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Blocks a whole route group from a client type, e.g. all billing routes from Android. */
export function denyClient(...clientTypes: readonly ClientType[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const auth = requireAuth(req);
      if (clientTypes.includes(auth.clientType)) throw new ClientNotPermittedError();
      next();
    } catch (error) {
      next(error);
    }
  };
}
