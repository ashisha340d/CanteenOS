import type { UserRole } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { AuditLogRow, CountRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

export interface InsertAuditInput {
  id: string;
  actorId: string | null;
  actorRole: UserRole | null;
  action: string;
  entityType: string;
  entityId: string | null;
  boardId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditListFilter {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  boardId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

const COLUMNS = `
  al.id, al.actor_id, al.actor_role, al.action, al.entity_type, al.entity_id, al.board_id,
  al.before_data, al.after_data, al.ip, al.user_agent, al.request_id, al.created_at`;

/** Append-only. There is deliberately no update or delete method. */
export class AuditRepository {
  async insert(db: Db, input: InsertAuditInput): Promise<void> {
    await mutate(
      db,
      `INSERT INTO audit_logs
        (id, actor_id, actor_role, action, entity_type, entity_id, board_id,
         before_data, after_data, ip, user_agent, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.actorId,
        input.actorRole,
        input.action,
        input.entityType,
        input.entityId,
        input.boardId,
        toJsonColumn(input.before),
        toJsonColumn(input.after),
        input.ip,
        input.userAgent,
        input.requestId,
        toDbDateTime(),
      ],
    );
  }

  async list(db: Db, filter: AuditListFilter): Promise<{ rows: AuditLogRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.actorId !== undefined) {
      conditions.push('al.actor_id = ?');
      params.push(filter.actorId);
    }
    if (filter.action !== undefined) {
      conditions.push('al.action = ?');
      params.push(filter.action);
    }
    if (filter.entityType !== undefined) {
      conditions.push('al.entity_type = ?');
      params.push(filter.entityType);
    }
    if (filter.entityId !== undefined) {
      conditions.push('al.entity_id = ?');
      params.push(filter.entityId);
    }
    if (filter.boardId !== undefined) {
      conditions.push('al.board_id = ?');
      params.push(filter.boardId);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('al.created_at >= ?');
      params.push(`${filter.dateFrom} 00:00:00.000`);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('al.created_at <= ?');
      params.push(`${filter.dateTo} 23:59:59.999`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await selectRows<AuditLogRow>(
      db,
      `SELECT ${COLUMNS}, u.name AS actor_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
        ${where}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );

    const countRow = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM audit_logs al ${where}`,
      params,
    );

    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  /** Entity timeline, used by the Admin Portal to show an order's or user's full history. */
  async listForEntity(
    db: Db,
    entityType: string,
    entityId: string,
    limit: number,
  ): Promise<AuditLogRow[]> {
    return selectRows<AuditLogRow>(
      db,
      `SELECT ${COLUMNS}, u.name AS actor_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
        WHERE al.entity_type = ? AND al.entity_id = ?
        ORDER BY al.created_at DESC
        LIMIT ?`,
      [entityType, entityId, limit],
    );
  }
}

export const auditRepository = new AuditRepository();
