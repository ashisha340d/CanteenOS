import {
  CleaningEventSource,
  CleaningTriggerEvent,
  NotificationType,
  UserRole,
  type NotificationDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { CleaningEventRepository } from '../repositories/CleaningEventRepository';
import { CleaningMasterRepository } from '../repositories/CleaningMasterRepository';
import { CleaningTaskRepository } from '../repositories/CleaningTaskRepository';
import { notificationRepository } from '../repositories/NotificationRepository';
import { userRepository } from '../repositories/UserRepository';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { toDbDateTime } from '../utils/time';
import type { AuditActor } from './AuditService';
import { cleaningEngineService } from './CleaningEngineService';
import { cleaningReportService } from './CleaningReportService';
import { notificationService } from './NotificationService';

/**
 * The cleaning sweep: raises the calendar occurrences that have come due, and chases the ones
 * nobody has done.
 *
 * Idempotent by construction rather than by bookkeeping. There is no job table and no "last
 * run" column:
 *
 *  - a scheduled occurrence carries a deterministic key derived from its period, and the unique
 *    key on (rule, asset, occurrence) makes a second raise a no-op;
 *  - the `SCHEDULE_DUE` event carries the same key as its `dedupe_key`, so even the event log
 *    does not gain a duplicate row;
 *  - a reminder already sent inside its own window is not sent again.
 *
 * A missed run is therefore harmless: the next one does exactly what the last one would have.
 */

/** Hourly. Calendar rules can name a due time, so a six-hourly sweep would raise them late. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** How far back the overdue chase looks. Comfortably longer than the sweep interval. */
const OVERDUE_GRACE_MINUTES = 180;

/** Who is chased when work goes overdue or sits unowned. */
const SUPERVISOR_ROLES: readonly UserRole[] = [
  UserRole.MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

/** The sweep acts on nobody's behalf; its rows are attributed to the system. */
const SYSTEM_ACTOR: AuditActor = {
  userId: null,
  role: null,
  ip: null,
  userAgent: null,
  requestId: null,
};

export interface CleaningSweepResult {
  occurrencesRaised: number;
  tasksCreated: number;
  overdueChased: number;
  unassignedEscalated: number;
  correctiveActionsChased: number;
}

export class CleaningSchedulerService {
  private timer: NodeJS.Timeout | null = null;

  /** Started from server.ts alongside the other background work. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.runQuietly();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.runQuietly();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async runQuietly(): Promise<void> {
    try {
      const result = await this.sweep();
      if (
        result.occurrencesRaised > 0 ||
        result.tasksCreated > 0 ||
        result.overdueChased > 0 ||
        result.unassignedEscalated > 0 ||
        result.correctiveActionsChased > 0
      ) {
        logger.info('Cleaning sweep complete', { ...result });
      }
    } catch (error) {
      logger.error('Cleaning sweep failed', undefined, error);
    }
  }

  async sweep(at: Date = new Date()): Promise<CleaningSweepResult> {
    const pool = getPool();
    const supervisors = await userRepository.findActiveByRoles(pool, SUPERVISOR_ROLES);
    const supervisorIds = supervisors.map((user) => user.id);

    const raised = await this.raiseDueOccurrences(pool, at);
    const overdue = await this.chaseOverdue(pool);
    const unassigned = await this.escalateUnassigned(pool, supervisorIds);
    const corrective = await this.chaseCorrectiveActions(pool, supervisorIds);

    notificationService.publish([
      ...raised.notifications,
      ...overdue.notifications,
      ...unassigned.notifications,
      ...corrective.notifications,
    ]);

    return {
      occurrencesRaised: raised.occurrences,
      tasksCreated: raised.tasks,
      overdueChased: overdue.count,
      unassignedEscalated: unassigned.count,
      correctiveActionsChased: corrective.count,
    };
  }

  /**
   * Publishes one `SCHEDULE_DUE` event per rule occurrence that has come due.
   *
   * The event goes through the same engine as a human report, so scheduled work is as
   * explainable afterwards as reported work — the task's `trigger_event_id` always leads back
   * to a row saying why it exists.
   */
  private async raiseDueOccurrences(
    db: Db,
    at: Date,
  ): Promise<{ occurrences: number; tasks: number; notifications: NotificationDto[] }> {
    const due = await cleaningEngineService.dueOccurrences(db, at);
    if (due.length === 0) return { occurrences: 0, tasks: 0, notifications: [] };

    const notifications: NotificationDto[] = [];
    let occurrences = 0;
    let tasks = 0;

    for (const entry of due) {
      const dedupeKey = `SCHED:${entry.rule.id}:${entry.occurrenceKey}`.slice(0, 190);
      try {
        const created = await withTransaction(async (connection) => {
          const seen = await CleaningEventRepository.findByDedupeKey(connection, dedupeKey);
          if (seen !== null) return { taskIds: [] as string[], notifications: [] as NotificationDto[] };

          const eventId = newId();
          const shift =
            entry.rule.shift_id ??
            (await CleaningMasterRepository.findCurrentShift(connection, at))?.id ??
            null;
          await CleaningEventRepository.insert(connection, {
            id: eventId,
            eventType: CleaningTriggerEvent.SCHEDULE_DUE,
            source: CleaningEventSource.SCHEDULER,
            occurredAt: toDbDateTime(at),
            cleanableAssetId: entry.rule.cleanable_asset_id,
            areaId: entry.rule.area_id,
            equipmentId: null,
            shiftId: shift,
            assetTypeId: entry.rule.asset_type_id,
            reportedBy: null,
            note: `${entry.rule.code} — ${entry.occurrenceKey}`,
            payload: null,
            dedupeKey,
          });

          const row = await CleaningEventRepository.findById(connection, eventId);
          if (row === null) return { taskIds: [], notifications: [] };
          return cleaningReportService.process(connection, row, SYSTEM_ACTOR, {
            allowFallback: false,
            fallbackPriority: null,
          });
        });

        if (created.taskIds.length > 0) {
          occurrences += 1;
          tasks += created.taskIds.length;
          notifications.push(...created.notifications);
        }
      } catch (error) {
        // One bad rule must not stop the sweep for every other rule.
        logger.error(
          'Cleaning sweep failed for one rule',
          { ruleId: entry.rule.id, ruleCode: entry.rule.code },
          error,
        );
      }
    }

    return { occurrences, tasks, notifications };
  }

  /** Tells the owner, once, when their task goes past its due moment. */
  private async chaseOverdue(
    db: Db,
  ): Promise<{ count: number; notifications: NotificationDto[] }> {
    const overdue = await CleaningTaskRepository.listNewlyOverdue(db, OVERDUE_GRACE_MINUTES);
    if (overdue.length === 0) return { count: 0, notifications: [] };

    const since = toDbDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const notifications: NotificationDto[] = [];
    let count = 0;

    for (const task of overdue) {
      if (task.assigned_to === null) continue;
      const alreadyTold = await notificationRepository.existsForSubjectSince(
        db,
        NotificationType.CLEANING_TASK_OVERDUE,
        task.id,
        since,
      );
      if (alreadyTold) continue;

      const sent = await withTransaction((connection) =>
        notificationService.notify(connection, {
          userIds: [task.assigned_to as string],
          type: NotificationType.CLEANING_TASK_OVERDUE,
          title: 'A cleaning task is overdue',
          body: task.task_name,
          data: { taskId: task.id, areaId: task.area_id, priority: task.priority },
        }),
      );
      notifications.push(...sent);
      count += 1;
    }

    return { count, notifications };
  }

  /**
   * Chases the tasks nobody could be given.
   *
   * These are the ones the engine refused to guess about; without this they would sit in the
   * pool until somebody happened to open the unassigned filter.
   */
  private async escalateUnassigned(
    db: Db,
    supervisorIds: readonly string[],
  ): Promise<{ count: number; notifications: NotificationDto[] }> {
    if (supervisorIds.length === 0) return { count: 0, notifications: [] };
    const unassigned = await CleaningTaskRepository.listUnassignedOpen(db, 50);
    if (unassigned.length === 0) return { count: 0, notifications: [] };

    const since = toDbDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const notifications: NotificationDto[] = [];
    let count = 0;

    for (const task of unassigned) {
      const alreadyTold = await notificationRepository.existsForSubjectSince(
        db,
        NotificationType.CLEANING_TASK_UNASSIGNED,
        task.id,
        since,
      );
      if (alreadyTold) continue;

      const sent = await withTransaction((connection) =>
        notificationService.notify(connection, {
          userIds: supervisorIds,
          type: NotificationType.CLEANING_TASK_UNASSIGNED,
          title: 'A cleaning task still has no owner',
          body: task.task_name,
          data: { taskId: task.id, areaId: task.area_id, priority: task.priority },
        }),
      );
      notifications.push(...sent);
      count += 1;
    }

    return { count, notifications };
  }

  /**
   * Chases corrective actions whose due moment has passed.
   *
   * The dashboard counts these, so leaving them unchased would mean a number a manager can see
   * and nobody is told about. Goes to the owner, or to the supervisors when it has none —
   * an unowned overdue corrective action is precisely the thing that gets forgotten.
   */
  private async chaseCorrectiveActions(
    db: Db,
    supervisorIds: readonly string[],
  ): Promise<{ count: number; notifications: NotificationDto[] }> {
    const overdue = await CleaningTaskRepository.listCorrectiveActions(db, {
      overdueOnly: true,
      limit: 50,
      offset: 0,
    });
    if (overdue.length === 0) return { count: 0, notifications: [] };

    const since = toDbDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const notifications: NotificationDto[] = [];
    let count = 0;

    for (const action of overdue) {
      const alreadyTold = await notificationRepository.existsForSubjectSince(
        db,
        NotificationType.CLEANING_CORRECTIVE_ACTION_OVERDUE,
        action.id,
        since,
      );
      if (alreadyTold) continue;

      const audience = action.assigned_to === null ? supervisorIds : [action.assigned_to];
      if (audience.length === 0) continue;

      const sent = await withTransaction((connection) =>
        notificationService.notify(connection, {
          userIds: audience,
          type: NotificationType.CLEANING_CORRECTIVE_ACTION_OVERDUE,
          title: 'A corrective action is overdue',
          body: action.failure_summary,
          data: {
            correctiveActionId: action.id,
            taskId: action.task_id,
            areaId: action.area_id,
          },
        }),
      );
      notifications.push(...sent);
      count += 1;
    }

    return { count, notifications };
  }
}

export const cleaningSchedulerService = new CleaningSchedulerService();
