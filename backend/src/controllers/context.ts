import type { Request } from 'express';
import type { UserRole } from '@menuboard/shared';
import type { AuditActor } from '../services/AuditService';
import { requireAuth } from '../middleware/types';

/**
 * Builds the actor record every mutating service call needs. Controllers pass this rather than
 * the raw request, so services never depend on Express.
 */
export function actorFrom(req: Request): AuditActor & { userId: string; role: UserRole } {
  const auth = requireAuth(req);
  return {
    userId: auth.userId,
    role: auth.role,
    ip: req.context.ip,
    userAgent: req.context.userAgent,
    requestId: req.context.requestId,
  };
}

export function authRequestMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
} {
  return {
    ip: req.context.ip,
    userAgent: req.context.userAgent,
    requestId: req.context.requestId,
  };
}
