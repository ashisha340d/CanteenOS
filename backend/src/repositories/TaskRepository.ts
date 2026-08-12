import type {
  TaskKind,
  TaskPriority,
  TaskSource,
  TaskStatus,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CountRow, TaskRow, TeamActivityRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for volunteer tasks (022_tasks.sql).
 *
 * No sync bookkeeping: tasks are REST-served to both clients rather than delta-synced, so
 * unlike OrderRepository there is no `revision`/`sync_seq` to maintain here.
 */

const TASK_SELECT = `SELECT t.*, u.name AS assigned_to_name, a.name AS assigned_by_name,
         o.order_number AS order_number, b.name AS board_name
    FROM tasks t
    JOIN users u ON u.id = t.assigned_to
    LEFT JOIN users a ON a.id = t.assigned_by
    LEFT JOIN orders o ON o.id = t.order_id
    LEFT JOIN boards b ON b.id = t.board_id`;

export interface TaskListFilter {
  assignedTo?: string;
  status?: TaskStatus;
  source?: TaskSource;
  kind?: TaskKind;
  search?: string;
  limit: number;
  offset: number;
}

export interface TaskInsert {
  id: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  source: TaskSource;
  priority: TaskPriority;
  assignedTo: string;
  assignedBy: string | null;
  orderId: string | null;
  boardId: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
}

function listWhere(filter: TaskListFilter): { where: string; params: unknown[] } {
  const conditions = ['t.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.assignedTo !== undefined) {
    conditions.push('t.assigned_to = ?');
    params.push(filter.assignedTo);
  }
  if (filter.status !== undefined) {
    conditions.push('t.status = ?');
    params.push(filter.status);
  }
  if (filter.source !== undefined) {
    conditions.push('t.source = ?');
    params.push(filter.source);
  }
  if (filter.kind !== undefined) {
    conditions.push('t.kind = ?');
    params.push(filter.kind);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(t.title LIKE ? OR u.name LIKE ? OR o.order_number LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const TaskRepository = {
  async list(db: Db, filter: TaskListFilter): Promise<TaskRow[]> {
    const { where, params } = listWhere(filter);
    return selectRows<TaskRow>(
      db,
      `${TASK_SELECT} ${where}
        ORDER BY FIELD(t.status,'IN_PROGRESS','PENDING','COMPLETED','CANCELLED'),
                 t.due_at IS NULL, t.due_at, t.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: TaskListFilter): Promise<number> {
    const { where, params } = listWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS count FROM tasks t
         JOIN users u ON u.id = t.assigned_to
         LEFT JOIN orders o ON o.id = t.order_id ${where}`,
      params,
    );
    return Number(row?.count ?? 0);
  },

  async findById(db: Db, id: string): Promise<TaskRow | null> {
    return selectOne<TaskRow>(db, `${TASK_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`, [id]);
  },

  /** The one task a volunteer is on right now. Null is the normal, expected state. */
  async findActiveFor(db: Db, userId: string): Promise<TaskRow | null> {
    return selectOne<TaskRow>(
      db,
      `${TASK_SELECT}
        WHERE t.assigned_to = ? AND t.status = 'IN_PROGRESS' AND t.deleted_at IS NULL
        ORDER BY t.started_at DESC LIMIT 1`,
      [userId],
    );
  },

  /** Assigned, not yet started. Deadline-bearing work first, then oldest first. */
  async listAvailableFor(db: Db, userId: string): Promise<TaskRow[]> {
    return selectRows<TaskRow>(
      db,
      `${TASK_SELECT}
        WHERE t.assigned_to = ? AND t.status = 'PENDING' AND t.deleted_at IS NULL
        ORDER BY t.due_at IS NULL, t.due_at, t.created_at`,
      [userId],
    );
  },

  async listCompletedSince(db: Db, userId: string, since: string): Promise<TaskRow[]> {
    return selectRows<TaskRow>(
      db,
      `${TASK_SELECT}
        WHERE t.assigned_to = ? AND t.status = 'COMPLETED' AND t.deleted_at IS NULL
          AND t.completed_at >= ?
        ORDER BY t.completed_at DESC`,
      [userId, since],
    );
  },

  async insert(db: Db, input: TaskInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO tasks
         (id, title, description, kind, source, status, priority, assigned_to, assigned_by,
          order_id, board_id, due_at, estimated_minutes, created_at, updated_at)
       VALUES (?,?,?,?,?,'PENDING',?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.title,
        input.description,
        input.kind,
        input.source,
        input.priority,
        input.assignedTo,
        input.assignedBy,
        input.orderId,
        input.boardId,
        input.dueAt,
        input.estimatedMinutes,
        now,
        now,
      ],
    );
  },

  async update(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE tasks SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /** Used by the order-assignment hook to stay idempotent across re-assignment. */
  async findByOrderAndAssignee(
    db: Db,
    orderId: string,
    assignedTo: string,
  ): Promise<TaskRow | null> {
    return selectOne<TaskRow>(
      db,
      `${TASK_SELECT} WHERE t.order_id = ? AND t.assigned_to = ?`,
      [orderId, assignedTo],
    );
  },

  /** Cancels open order-derived tasks for everyone except the current assignee. */
  async cancelOrderTasksExcept(
    db: Db,
    orderId: string,
    keepAssignee: string | null,
  ): Promise<number> {
    const now = toDbDateTime();
    const params: unknown[] = [now, now, orderId];
    let sql = `UPDATE tasks
                  SET status = 'CANCELLED', completed_at = ?, updated_at = ?
                WHERE order_id = ? AND status IN ('PENDING','IN_PROGRESS') AND deleted_at IS NULL`;
    if (keepAssignee !== null) {
      sql += ' AND assigned_to <> ?';
      params.push(keepAssignee);
    }
    const result = await mutate(db, sql, params);
    return result.affectedRows;
  },

  /**
   * Who is working on what, for every active user.
   *
   * The active task is picked with a correlated subquery rather than a join so a user with no
   * task still produces a row — "free" is a state the screen must show, not an absence.
   */
  async teamActivity(db: Db, limit: number): Promise<TeamActivityRow[]> {
    return selectRows<TeamActivityRow>(
      db,
      `SELECT u.id AS user_id,
              u.name AS name,
              t.id AS task_id,
              t.title AS task_title,
              t.kind AS task_kind,
              t.priority AS task_priority,
              t.started_at AS started_at,
              t.estimated_minutes AS estimated_minutes,
              t.due_at AS due_at,
              last.title AS last_task_title,
              last.completed_at AS last_active_at
         FROM users u
         LEFT JOIN tasks t
           ON t.id = (
                SELECT x.id FROM tasks x
                 WHERE x.assigned_to = u.id AND x.status = 'IN_PROGRESS' AND x.deleted_at IS NULL
                 ORDER BY x.started_at DESC LIMIT 1)
         LEFT JOIN tasks last
           ON last.id = (
                SELECT y.id FROM tasks y
                 WHERE y.assigned_to = u.id AND y.status = 'COMPLETED' AND y.deleted_at IS NULL
                 ORDER BY y.completed_at DESC LIMIT 1)
        WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
        ORDER BY t.id IS NULL, t.started_at DESC, u.name
        LIMIT ?`,
      [limit],
    );
  },
};
