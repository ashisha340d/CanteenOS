import type { UserRole } from '@menuboard/shared';
import type { Db } from '../db/types';
import { auditRepository, type AuditListFilter } from '../repositories/AuditRepository';
import { mapAuditLog } from '../models/mappers';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { buildPage, resolvePaging } from '../utils/http';

/** Canonical action names. Kept as a closed set so audit queries can rely on them. */
export const AuditAction = {
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.refresh',
  TOKEN_REUSE_DETECTED: 'auth.refresh.reuse',
  PASSWORD_CHANGED: 'auth.password.changed',

  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  USER_ROLE_CHANGED: 'user.role.changed',

  BOARD_CREATED: 'board.created',
  BOARD_UPDATED: 'board.updated',
  BOARD_ARCHIVED: 'board.archived',
  BOARD_MEMBER_ADDED: 'board.member.added',
  BOARD_MEMBER_UPDATED: 'board.member.updated',
  BOARD_MEMBER_REMOVED: 'board.member.removed',

  MASTER_CREATED: 'master.created',
  MASTER_UPDATED: 'master.updated',
  MASTER_DELETED: 'master.deleted',

  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_ACKNOWLEDGED: 'order.acknowledged',

  THREAD_MESSAGE_POSTED: 'thread.message.posted',
  THREAD_MESSAGE_DELETED: 'thread.message.deleted',

  ATTACHMENT_UPLOADED: 'attachment.uploaded',
  ATTACHMENT_DELETED: 'attachment.deleted',

  BILLING_GENERATED: 'billing.generated',
  BILLING_STATUS_CHANGED: 'billing.status.changed',

  SETTING_UPDATED: 'setting.updated',
  PERMISSION_UPDATED: 'permission.updated',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditActor {
  userId: string | null;
  role: UserRole | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  boardId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Every mutation records an audit row, written on the caller's connection so it commits or
 * rolls back with the change it describes. An audit trail that can disagree with the data is
 * worse than none.
 */
export class AuditService {
  async record(db: Db, actor: AuditActor, entry: AuditEntry): Promise<void> {
    try {
      await auditRepository.insert(db, {
        id: newId(),
        actorId: actor.userId,
        actorRole: actor.role,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        boardId: entry.boardId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip: actor.ip,
        userAgent: actor.userAgent,
        requestId: actor.requestId,
      });
    } catch (error) {
      // Audit is important but must not mask the real failure. Log loudly and rethrow so the
      // surrounding transaction still rolls back — a silent audit gap is a compliance hole.
      logger.error('Failed to write audit row', { action: entry.action }, error);
      throw error;
    }
  }

  async list(db: Db, query: AuditListFilter & { page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = resolvePaging(query);
    const { rows, total } = await auditRepository.list(db, {
      ...query,
      limit: pageSize,
      offset,
    });
    return buildPage(rows.map(mapAuditLog), total, page, pageSize);
  }

  async listForEntity(db: Db, entityType: string, entityId: string, limit = 100) {
    const rows = await auditRepository.listForEntity(db, entityType, entityId, limit);
    return rows.map(mapAuditLog);
  }
}

export const auditService = new AuditService();
