import {
  TaskKind,
  TaskPriority,
  TaskSource,
  TaskStatus,
  UserRole,
  type MyTasksDto,
  type TaskCreateRequest,
  type TaskDto,
  type TaskListQuery,
  type TaskUpdateRequest,
  type TeamMemberActivityDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapTask, mapTeamActivity } from '../models/mappers';
import { TaskRepository, type TaskListFilter } from '../repositories/TaskRepository';
import { userRepository } from '../repositories/UserRepository';
import { ConflictError, ForbiddenError, NotFoundError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { toDbDateTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * Volunteer task assignment — the "My Tasks" screen's whole backend.
 *
 * Two rules carry the product:
 *  - Exactly one task may be IN_PROGRESS per volunteer. Starting a second is refused rather
 *    than silently stopping the first, because the screen's entire purpose is to answer
 *    "what am I doing now" with one unambiguous answer.
 *  - A deadline is never invented. `due_at` is copied from a linked order and is otherwise
 *    null, so an ordinary task cannot appear late.
 */

/** How far back "completed today" reaches. */
const COMPLETED_WINDOW_HOURS = 24;
const TEAM_ACTIVITY_LIMIT = 200;

/** The assigner's role, as the volunteer should see it. */
function sourceForRole(role: UserRole): TaskSource {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return TaskSource.SUPER_ADMIN;
    case UserRole.ADMIN:
      return TaskSource.ADMIN;
    default:
      return TaskSource.MANAGER;
  }
}

export class TaskService {
  async myTasks(userId: string): Promise<MyTasksDto> {
    const pool = getPool();
    const since = toDbDateTime(new Date(Date.now() - COMPLETED_WINDOW_HOURS * 3_600_000));
    const [active, available, completed] = await Promise.all([
      TaskRepository.findActiveFor(pool, userId),
      TaskRepository.listAvailableFor(pool, userId),
      TaskRepository.listCompletedSince(pool, userId, since),
    ]);

    return {
      active: active === null ? null : mapTask(active),
      available: available.map(mapTask),
      completedToday: completed.map(mapTask),
    };
  }

  async teamActivity(): Promise<TeamMemberActivityDto[]> {
    const rows = await TaskRepository.teamActivity(getPool(), TEAM_ACTIVITY_LIMIT);
    return rows.map(mapTeamActivity);
  }

  async list(query: TaskListQuery) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: TaskListFilter = {
      ...(query.assignedTo !== undefined ? { assignedTo: query.assignedTo } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.source !== undefined ? { source: query.source } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      TaskRepository.list(pool, filter),
      TaskRepository.count(pool, filter),
    ]);
    return buildPage(rows.map(mapTask), total, page, pageSize);
  }

  async getById(id: string): Promise<TaskDto> {
    const row = await TaskRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Task', id);
    return mapTask(row);
  }

  /**
   * Creates a task. Assigning to somebody else requires TASK_ASSIGN, checked at the route;
   * this method decides only what the task should look like once that is settled.
   */
  async create(
    input: TaskCreateRequest,
    actor: AuditActor & { userId: string; role: UserRole },
  ): Promise<TaskDto> {
    const assignedTo = input.assignedTo ?? actor.userId;
    const isSelf = assignedTo === actor.userId;
    const id = newId();

    return withTransaction(async (connection) => {
      if (!isSelf) {
        const assignee = await userRepository.findById(connection, assignedTo);
        if (assignee === null) throw new NotFoundError('User', assignedTo);
      }

      await TaskRepository.insert(connection, {
        id,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind ?? TaskKind.WORK,
        // Self-assigned work is labelled SELF whatever the author's role — an admin writing
        // their own to-do is not issuing themselves an instruction.
        source: isSelf ? TaskSource.SELF : sourceForRole(actor.role),
        priority: input.priority ?? TaskPriority.NORMAL,
        assignedTo,
        assignedBy: isSelf ? null : actor.userId,
        orderId: null,
        boardId: input.boardId ?? null,
        // Never set for a hand-authored task: only an order carries a real deadline.
        dueAt: null,
        estimatedMinutes: input.estimatedMinutes ?? null,
      });

      const created = await TaskRepository.findById(connection, id);
      if (created === null) throw new NotFoundError('Task', id);

      await auditService.record(connection, actor, {
        action: isSelf ? AuditAction.TASK_SELF_CREATED : AuditAction.TASK_ASSIGNED,
        entityType: 'tasks',
        entityId: id,
        after: { title: input.title, assignedTo, source: created.source },
      });
      return mapTask(created);
    });
  }

  async update(
    id: string,
    input: TaskUpdateRequest,
    actor: AuditActor & { userId: string },
    canAssign: boolean,
  ): Promise<TaskDto> {
    return withTransaction(async (connection) => {
      const current = await TaskRepository.findById(connection, id);
      if (current === null) throw new NotFoundError('Task', id);
      this.assertMayTouch(current.assigned_to, actor.userId, canAssign);

      if (input.assignedTo !== undefined && input.assignedTo !== current.assigned_to) {
        if (!canAssign) throw new ForbiddenError('You cannot reassign this task');
        const assignee = await userRepository.findById(connection, input.assignedTo);
        if (assignee === null) throw new NotFoundError('User', input.assignedTo);
      }

      const assignments: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      if (input.title !== undefined) set('title', input.title);
      if (input.description !== undefined) set('description', input.description);
      if (input.priority !== undefined) set('priority', input.priority);
      if (input.assignedTo !== undefined) set('assigned_to', input.assignedTo);
      if (input.estimatedMinutes !== undefined) set('estimated_minutes', input.estimatedMinutes);
      if (input.status !== undefined) {
        set('status', input.status);
        if (input.status === TaskStatus.COMPLETED || input.status === TaskStatus.CANCELLED) {
          set('completed_at', toDbDateTime());
        }
      }

      await TaskRepository.update(connection, id, assignments, params);
      const updated = await TaskRepository.findById(connection, id);
      if (updated === null) throw new NotFoundError('Task', id);

      await auditService.record(connection, actor, {
        action: AuditAction.TASK_UPDATED,
        entityType: 'tasks',
        entityId: id,
        before: { status: current.status, assignedTo: current.assigned_to, title: current.title },
        after: { status: updated.status, assignedTo: updated.assigned_to, title: updated.title },
      });
      return mapTask(updated);
    });
  }

  /** Moves a task into "Working On". Refused while another task is already active. */
  async start(id: string, actor: AuditActor & { userId: string }): Promise<TaskDto> {
    return withTransaction(async (connection) => {
      const task = await TaskRepository.findById(connection, id);
      if (task === null) throw new NotFoundError('Task', id);
      if (task.assigned_to !== actor.userId) {
        throw new ForbiddenError('You can only start a task assigned to you');
      }
      if (task.status === TaskStatus.IN_PROGRESS) return mapTask(task);
      if (task.status !== TaskStatus.PENDING) {
        throw new ConflictError(`A ${task.status.toLowerCase()} task cannot be started`);
      }

      const active = await TaskRepository.findActiveFor(connection, actor.userId);
      if (active !== null) {
        throw new ConflictError(
          `You are already working on "${active.title}". Finish or stop it before starting another.`,
        );
      }

      await TaskRepository.update(
        connection,
        id,
        ['status = ?', 'started_at = ?'],
        [TaskStatus.IN_PROGRESS, toDbDateTime()],
      );
      const started = await TaskRepository.findById(connection, id);
      if (started === null) throw new NotFoundError('Task', id);

      await auditService.record(connection, actor, {
        action: AuditAction.TASK_STARTED,
        entityType: 'tasks',
        entityId: id,
        after: { title: started.title },
      });
      return mapTask(started);
    });
  }

  async complete(id: string, actor: AuditActor & { userId: string }): Promise<TaskDto> {
    return this.finish(id, TaskStatus.COMPLETED, AuditAction.TASK_COMPLETED, actor);
  }

  /** Puts an active task back on the available list without marking it done. */
  async stop(id: string, actor: AuditActor & { userId: string }): Promise<TaskDto> {
    return withTransaction(async (connection) => {
      const task = await TaskRepository.findById(connection, id);
      if (task === null) throw new NotFoundError('Task', id);
      if (task.assigned_to !== actor.userId) {
        throw new ForbiddenError('You can only stop a task assigned to you');
      }
      if (task.status !== TaskStatus.IN_PROGRESS) {
        throw new ConflictError('That task is not currently in progress');
      }

      await TaskRepository.update(
        connection,
        id,
        ['status = ?', 'started_at = NULL'],
        [TaskStatus.PENDING],
      );
      const stopped = await TaskRepository.findById(connection, id);
      if (stopped === null) throw new NotFoundError('Task', id);

      await auditService.record(connection, actor, {
        action: AuditAction.TASK_STOPPED,
        entityType: 'tasks',
        entityId: id,
        after: { title: stopped.title },
      });
      return mapTask(stopped);
    });
  }

  async cancel(
    id: string,
    actor: AuditActor & { userId: string },
    canAssign: boolean,
  ): Promise<TaskDto> {
    const task = await TaskRepository.findById(getPool(), id);
    if (task === null) throw new NotFoundError('Task', id);
    this.assertMayTouch(task.assigned_to, actor.userId, canAssign);
    return this.finish(id, TaskStatus.CANCELLED, AuditAction.TASK_CANCELLED, actor, canAssign);
  }

  async remove(id: string, actor: AuditActor & { userId: string }): Promise<void> {
    await withTransaction(async (connection) => {
      const task = await TaskRepository.findById(connection, id);
      if (task === null) throw new NotFoundError('Task', id);
      await TaskRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.TASK_DELETED,
        entityType: 'tasks',
        entityId: id,
        before: { title: task.title, assignedTo: task.assigned_to },
      });
    });
  }

  private assertMayTouch(assignedTo: string, userId: string, canAssign: boolean): void {
    if (assignedTo !== userId && !canAssign) {
      throw new ForbiddenError('That task belongs to somebody else');
    }
  }

  private async finish(
    id: string,
    status: TaskStatus,
    action: AuditAction,
    actor: AuditActor & { userId: string },
    canAssign = false,
  ): Promise<TaskDto> {
    return withTransaction(async (connection) => {
      const task = await TaskRepository.findById(connection, id);
      if (task === null) throw new NotFoundError('Task', id);
      this.assertMayTouch(task.assigned_to, actor.userId, canAssign);
      if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
        throw new ConflictError('That task is already finished');
      }

      await TaskRepository.update(
        connection,
        id,
        ['status = ?', 'completed_at = ?'],
        [status, toDbDateTime()],
      );
      const finished = await TaskRepository.findById(connection, id);
      if (finished === null) throw new NotFoundError('Task', id);

      await auditService.record(connection, actor, {
        action,
        entityType: 'tasks',
        entityId: id,
        after: { title: finished.title, status },
      });
      return mapTask(finished);
    });
  }

  /**
   * Mirrors an order assignment into the assignee's task list.
   *
   * Called from OrderService inside its own transaction. Idempotent: re-assigning to the same
   * person reuses the existing row, and handing the order to somebody else cancels the
   * previous holder's task rather than leaving stale work on their screen.
   */
  async syncOrderAssignment(
    db: Db,
    input: {
      orderId: string;
      orderNumber: string;
      boardId: string;
      venue: string;
      requiredDate: string;
      requiredTime: string;
      priority: string;
      assignedTo: string | null;
      assignerRole: UserRole;
    },
  ): Promise<void> {
    await TaskRepository.cancelOrderTasksExcept(db, input.orderId, input.assignedTo);
    if (input.assignedTo === null) return;

    const existing = await TaskRepository.findByOrderAndAssignee(db, input.orderId, input.assignedTo);
    if (existing !== null) {
      // Already theirs: revive it if a previous unassignment cancelled it, otherwise leave the
      // volunteer's own progress alone.
      if (existing.status === TaskStatus.CANCELLED) {
        await TaskRepository.update(
          db,
          existing.id,
          ['status = ?', 'completed_at = NULL'],
          [TaskStatus.PENDING],
        );
      }
      return;
    }

    await TaskRepository.insert(db, {
      id: newId(),
      title: `Food Prep for Order #${input.orderNumber}`,
      description: input.venue,
      kind: TaskKind.WORK,
      source: sourceForRole(input.assignerRole),
      priority:
        input.priority === 'HIGH' || input.priority === 'URGENT'
          ? TaskPriority.HIGH
          : TaskPriority.NORMAL,
      assignedTo: input.assignedTo,
      assignedBy: null,
      orderId: input.orderId,
      boardId: input.boardId,
      // The order's own required date/time — the only deadline in the system that is real.
      dueAt: `${input.requiredDate} ${input.requiredTime}`,
      estimatedMinutes: null,
    });
  }
}

export const taskService = new TaskService();
