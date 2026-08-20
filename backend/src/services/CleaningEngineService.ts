import {
  CALENDAR_FREQUENCY_KINDS,
  CleaningAssignmentReason,
  CleaningEventSource,
  CleaningFrequencyKind,
  CleaningTaskPriority,
  CleaningTaskStatus,
  CleaningTriggerEvent,
  LIMITS,
  NotificationType,
  UserRole,
  type CleaningTaskPriority as Priority,
} from '@menuboard/shared';
import type { Db, PoolConnection } from '../db/types';
import type {
  CleanableAssetRow,
  CleaningEventRow,
  CleaningRuleRow,
  CleaningRuleSkillRow,
  CleaningTaskRow,
} from '../models/rows';
import { CleanableAssetRepository } from '../repositories/CleanableAssetRepository';
import { CleaningMasterRepository } from '../repositories/CleaningMasterRepository';
import { CleaningProcedureRepository } from '../repositories/CleaningProcedureRepository';
import { CleaningRuleRepository } from '../repositories/CleaningRuleRepository';
import { CleaningTaskRepository } from '../repositories/CleaningTaskRepository';
import { userRepository } from '../repositories/UserRepository';
import { newId } from '../utils/ids';
import { toDbDateTime } from '../utils/time';
import { toJsonColumn } from '../utils/json';
import { logger } from '../utils/logger';
import { cleaningAssignmentService } from './CleaningAssignmentService';
import { notificationService } from './NotificationService';
import type { AuditActor } from './AuditService';
import type { NotificationDto } from '@menuboard/shared';

/**
 * The engine: an event arrives, rules match, tasks appear, somebody is told.
 *
 * Everything about the module's behaviour lives here, and three decisions shape it:
 *
 *  - **The occurrence key is the idempotency guarantee.** A rule + an asset + a key is unique
 *    in the database, so the daily sweep running twice, or a phone retrying a report, cannot
 *    produce two identical tasks. Calendar frequencies derive their key from the period;
 *    event-driven ones from the event's own id, because a second spill really is more work.
 *  - **A task pins the published procedure version, not the procedure.** Editing an SOP next
 *    month cannot rewrite what somebody signed off today. A rule whose procedure has never
 *    been published simply cannot raise work, and says so on the rules page.
 *  - **Generation and assignment commit together.** A task that exists without an owner and
 *    without a notification is a task nobody will do.
 */

/** How far ahead the sweep looks. One day: the sweep runs hourly, so this is ample. */
const SWEEP_HORIZON_HOURS = 24;

/** Who is told when a task cannot be given to anybody. */
const SUPERVISOR_ROLES: readonly UserRole[] = [
  UserRole.MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

/** The seeded carrier for work a report raised that no rule covers. */
export const ADHOC_PROCEDURE_CODE = 'CLN-REPORTED';
export const ADHOC_RULE_CODE = 'CLN-REPORTED';

export interface GeneratedTask {
  taskId: string;
  assignedTo: string | null;
}

export interface GenerationResult {
  tasks: GeneratedTask[];
  notifications: NotificationDto[];
}

/**
 * Wall-clock times in this module are **local to the server**, not UTC.
 *
 * That is not a preference, it is forced by consistency: `shifts.starts_at` is a TIME the
 * roster manager typed meaning 06:00 in the morning, and `findCurrentShift` / `isWithinShift`
 * already compare it against the local clock. A rule's `dueTime` is the same kind of value,
 * typed in the same kind of field, so interpreting it in UTC would put "clean by 22:00" at
 * 03:30 the next morning for an IST canteen — and would disagree with the shift the very same
 * rule is tied to.
 *
 * Stored instants (`due_at`, `scheduled_at`) remain UTC, like every other datetime in the
 * product. Only the *interpretation* of a wall-clock input, and the calendar day an occurrence
 * is bucketed into, are local.
 */

/** ISO week number, so a WEEKLY rule's key is stable across a year boundary. */
function isoWeekKey(date: Date): string {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNumber = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7,
    );
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The local calendar day, so "today's clean" means the operator's today. */
function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Whole days since the epoch in local terms — the bucket a PERIODIC occurrence falls in. */
function localDayIndex(date: Date): number {
  return Math.floor(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000,
  );
}

/** Applies a rule's `dueTime` to a day, in local wall-clock. Absent means end of that day. */
function dueMomentFor(day: Date, dueTime: string | null): Date {
  const result = new Date(day.getTime());
  if (dueTime === null) {
    result.setHours(23, 59, 0, 0);
    return result;
  }
  const [hours, minutes] = dueTime.split(':');
  result.setHours(Number(hours), Number(minutes ?? 0), 0, 0);
  return result;
}

export class CleaningEngineService {
  /* ------------------------------------------------------------ frequency maths */

  /**
   * The occurrence this rule is currently in, as a stable key, or null when the rule is not
   * due in this period at all (a WEEKLY rule on the wrong weekday).
   */
  occurrenceKeyFor(rule: CleaningRuleRow, at: Date): string | null {
    switch (rule.frequency_kind) {
      case CleaningFrequencyKind.DAILY:
        return `D-${localDay(at)}`;

      case CleaningFrequencyKind.WEEKLY: {
        if (rule.day_of_week !== null && at.getDay() !== Number(rule.day_of_week)) return null;
        return `W-${isoWeekKey(at)}`;
      }

      case CleaningFrequencyKind.MONTHLY: {
        if (rule.day_of_month !== null && at.getDate() !== Number(rule.day_of_month)) return null;
        return `M-${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
      }

      case CleaningFrequencyKind.PERIODIC: {
        // Buckets of `intervalDays` counted from the epoch, so two servers agree on the bucket
        // without keeping a "last run" column that a restore could rewind.
        const days = Math.max(1, Number(rule.interval_days ?? 1));
        const bucket = Math.floor(localDayIndex(at) / days);
        return `P${days}-${bucket}`;
      }

      case CleaningFrequencyKind.PER_SHIFT:
        return `S-${localDay(at)}-${rule.shift_id ?? 'ANY'}`;

      default:
        return null;
    }
  }

  /** When this occurrence is due. Event-driven rules use `dueWithinMinutes` from the event. */
  dueAtFor(rule: CleaningRuleRow, at: Date): Date | null {
    if (rule.due_within_minutes !== null) {
      return new Date(at.getTime() + Number(rule.due_within_minutes) * 60_000);
    }
    if (CALENDAR_FREQUENCY_KINDS.includes(rule.frequency_kind)) {
      return dueMomentFor(at, rule.due_time === null ? null : rule.due_time.slice(0, 5));
    }
    // No window configured on an event-driven rule: due at the end of the day it was raised.
    return dueMomentFor(at, null);
  }

  /* ------------------------------------------------------------ task generation */

  /**
   * Raises the tasks an event calls for.
   *
   * Runs inside the caller's transaction, so the event row, its tasks, their assignments and
   * the notifications commit or roll back together.
   */
  async generateForEvent(
    connection: PoolConnection,
    event: CleaningEventRow,
    actor: AuditActor,
  ): Promise<GenerationResult> {
    const rules = await CleaningRuleRepository.listForTrigger(connection, event.event_type, {
      cleanableAssetId: event.cleanable_asset_id,
      areaId: event.area_id,
      assetTypeId: event.asset_type_id,
    });

    const occurredAt = new Date(`${event.occurred_at.replace(' ', 'T')}Z`);
    const tasks: GeneratedTask[] = [];
    const notifications: NotificationDto[] = [];

    for (const rule of rules) {
      const targets = await this.resolveTargets(connection, rule, event);
      if (targets.length === 0) continue;

      const version = await CleaningProcedureRepository.findPublishedVersion(
        connection,
        rule.procedure_id,
      );
      if (version === null) {
        logger.warn('cleaning rule skipped: procedure has no published version', {
          ruleId: rule.id,
          ruleCode: rule.code,
        });
        continue;
      }

      const skills = await CleaningRuleRepository.listSkills(connection, rule.id);
      // An event-driven occurrence is keyed by the event, so two spills make two tasks.
      const occurrenceKey =
        this.occurrenceKeyFor(rule, occurredAt) ?? `E-${event.id.slice(0, 24)}`;

      for (const asset of targets) {
        const result = await this.createTask(connection, {
          rule,
          asset,
          versionId: version.id,
          occurrenceKey,
          occurredAt,
          triggerEventId: event.id,
          triggerEventType: event.event_type,
          priority: this.priorityFor(rule, asset, event),
          skills,
          actor,
          source: event.source,
        });
        if (result === null) continue;
        tasks.push({ taskId: result.taskId, assignedTo: result.assignedTo });
        notifications.push(...result.notifications);
      }
    }

    return { tasks, notifications };
  }

  /**
   * The assets a rule reaches for this event.
   *
   * A rule scoped to a type is narrowed by whatever the event named: a spill reported on one
   * chopping board must not raise a task on every chopping board in the building.
   */
  private async resolveTargets(
    db: Db,
    rule: CleaningRuleRow,
    event: CleaningEventRow,
  ): Promise<CleanableAssetRow[]> {
    if (event.cleanable_asset_id !== null) {
      const asset = await CleanableAssetRepository.findById(db, event.cleanable_asset_id);
      if (asset === null || asset.is_available !== 1 || asset.status !== 'ACTIVE') return [];
      // The rule must actually cover the asset the event named.
      if (rule.scope === 'ASSET') return rule.cleanable_asset_id === asset.id ? [asset] : [];
      if (rule.asset_type_id !== asset.asset_type_id) return [];
      if (rule.scope === 'ASSET_TYPE_IN_AREA' && rule.area_id !== asset.area_id) return [];
      return [asset];
    }

    const scope: { cleanableAssetId?: string | null; assetTypeId?: string | null; areaId?: string | null } = {
      cleanableAssetId: rule.cleanable_asset_id,
      assetTypeId: rule.asset_type_id,
      areaId: rule.area_id,
    };
    // An area-wide event narrows a global rule to that area.
    if (rule.scope === 'ASSET_TYPE_GLOBAL' && event.area_id !== null) {
      scope.areaId = event.area_id;
    }
    return CleanableAssetRepository.listForRuleScope(db, scope);
  }

  /** The reported problem may raise the rule's default priority, never lower it. */
  private priorityFor(
    rule: CleaningRuleRow,
    asset: CleanableAssetRow,
    event: CleaningEventRow,
  ): Priority {
    const order: Priority[] = [
      CleaningTaskPriority.LOW,
      CleaningTaskPriority.NORMAL,
      CleaningTaskPriority.HIGH,
      CleaningTaskPriority.CRITICAL,
    ];
    let priority = rule.priority;
    if (
      event.event_type === CleaningTriggerEvent.CONTAMINATION_REPORTED ||
      asset.risk_level === 'CRITICAL'
    ) {
      priority = CleaningTaskPriority.CRITICAL;
    } else if (
      event.event_type === CleaningTriggerEvent.SPILL_REPORTED ||
      asset.food_contact === 'DIRECT'
    ) {
      if (order.indexOf(priority) < order.indexOf(CleaningTaskPriority.HIGH)) {
        priority = CleaningTaskPriority.HIGH;
      }
    }
    return priority;
  }

  /**
   * Writes one task, its step sheet, its assignment and the notification that goes with it.
   * Returns null when this occurrence already exists — the idempotent no-op.
   */
  async createTask(
    connection: PoolConnection,
    input: {
      rule: CleaningRuleRow;
      asset: CleanableAssetRow;
      versionId: string;
      occurrenceKey: string;
      occurredAt: Date;
      triggerEventId: string | null;
      triggerEventType: CleaningTriggerEvent;
      priority: Priority;
      skills: readonly CleaningRuleSkillRow[];
      actor: AuditActor;
      source: CleaningEventSource;
      /** Overrides the rule's own name — used by the ad-hoc path to carry the report's words. */
      taskName?: string;
    },
  ): Promise<{ taskId: string; assignedTo: string | null; notifications: NotificationDto[] } | null> {
    const existing = await CleaningTaskRepository.findByOccurrence(
      connection,
      input.rule.id,
      input.asset.id,
      input.occurrenceKey,
    );
    if (existing !== null) return null;

    const taskId = newId();
    const dueAt = this.dueAtFor(input.rule, input.occurredAt);
    const shift =
      input.rule.shift_id !== null
        ? { id: input.rule.shift_id }
        : await CleaningMasterRepository.findCurrentShift(connection, input.occurredAt);

    await CleaningTaskRepository.insert(connection, {
      id: taskId,
      ruleId: input.rule.id,
      cleanableAssetId: input.asset.id,
      areaId: input.asset.area_id,
      procedureVersionId: input.versionId,
      occurrenceKey: input.occurrenceKey,
      triggerEventId: input.triggerEventId,
      triggerEventType: input.triggerEventType,
      taskName: (input.taskName ?? `${input.rule.task_name} — ${input.asset.name}`).slice(
        0,
        LIMITS.CLEANING_RULE_TASK_NAME_MAX,
      ),
      priority: input.priority,
      estimatedMinutes: input.rule.estimated_minutes,
      shiftId: shift?.id ?? null,
      scheduledAt: toDbDateTime(input.occurredAt),
      dueAt: dueAt === null ? null : toDbDateTime(dueAt),
      status: CleaningTaskStatus.PLANNED,
      requiresVerification: input.rule.requires_verification === 1,
      verificationMethod: input.rule.verification_method,
      verifierRole: input.rule.verifier_role,
    });

    await CleaningTaskRepository.insertStateChange(connection, {
      id: newId(),
      taskId,
      fromStatus: null,
      toStatus: CleaningTaskStatus.PLANNED,
      actorId: input.actor.userId,
      actorRole: input.actor.role,
      source: input.source,
      note: `Raised by ${input.rule.code}`,
    });

    // The step sheet is a snapshot: the task keeps its own row per step, so a later edit to
    // the procedure cannot change what this operator was asked to do.
    const steps = await CleaningProcedureRepository.listSteps(connection, input.versionId);
    await CleaningTaskRepository.seedStepResults(
      connection,
      taskId,
      steps.map((step) => ({ id: newId(), stepId: step.id, stepNumber: Number(step.step_number) })),
    );

    const decision = await cleaningAssignmentService.decide(connection, {
      areaId: input.asset.area_id,
      requiredSkills: input.skills,
      responsibleRole: input.rule.responsible_role,
      at: input.occurredAt,
    });

    const now = toDbDateTime();
    const nextStatus =
      decision.userId === null ? CleaningTaskStatus.UNASSIGNED : CleaningTaskStatus.ASSIGNED;

    await CleaningTaskRepository.update(
      connection,
      taskId,
      ['status = ?', 'assigned_to = ?', 'assigned_at = ?'],
      [nextStatus, decision.userId, decision.userId === null ? null : now],
    );
    await CleaningTaskRepository.insertStateChange(connection, {
      id: newId(),
      taskId,
      fromStatus: CleaningTaskStatus.PLANNED,
      toStatus: nextStatus,
      actorId: input.actor.userId,
      actorRole: input.actor.role,
      source: CleaningEventSource.SYSTEM,
      note:
        decision.userId === null
          ? 'Nobody eligible was available'
          : `Assigned automatically (${decision.strategy}${decision.relaxed ? ', relaxed' : ''})`,
    });
    await CleaningTaskRepository.insertAssignment(connection, {
      id: newId(),
      taskId,
      assignedTo: decision.userId,
      assignedBy: null,
      reason: decision.reason,
      strategy: decision.strategy,
      decision: toJsonColumn({
        strategy: decision.strategy,
        relaxed: decision.relaxed,
        candidates: decision.candidates.slice(0, 10),
      }),
      note: null,
    });

    const notifications = await this.notifyAssignment(connection, {
      taskId,
      taskName: input.taskName ?? input.rule.task_name,
      assetName: input.asset.name,
      areaId: input.asset.area_id,
      assignedTo: decision.userId,
      priority: input.priority,
      dueAt,
      actor: input.actor,
    });

    return { taskId, assignedTo: decision.userId, notifications };
  }

  /**
   * The fallback that makes reporting worth doing.
   *
   * A report that matched no rule still has to produce assignable work, or the person who
   * raised it learns that reporting achieves nothing and stops. It is carried by a seeded rule
   * and procedure (`CLN-REPORTED`) so the task is an ordinary row with an ordinary step sheet,
   * not a special case the rest of the module has to know about.
   */
  async createAdhocTask(
    connection: PoolConnection,
    input: {
      event: CleaningEventRow;
      asset: CleanableAssetRow;
      priority: Priority;
      actor: AuditActor;
    },
  ): Promise<{ taskId: string; assignedTo: string | null; notifications: NotificationDto[] } | null> {
    const rule = await CleaningRuleRepository.findByCode(connection, ADHOC_RULE_CODE);
    if (rule === null) {
      logger.error('cleaning: the reported clean-up rule is missing; run the seed', {
        code: ADHOC_RULE_CODE,
      });
      return null;
    }
    const version = await CleaningProcedureRepository.findPublishedVersion(
      connection,
      rule.procedure_id,
    );
    if (version === null) {
      logger.error('cleaning: the reported clean-up procedure has no published version', {
        code: ADHOC_PROCEDURE_CODE,
      });
      return null;
    }

    const note = input.event.note?.trim();
    const name =
      note !== undefined && note !== ''
        ? `${input.asset.name} — ${note}`
        : `${input.asset.name} — reported for cleaning`;

    return this.createTask(connection, {
      rule,
      asset: input.asset,
      versionId: version.id,
      // Keyed by the event, so every report produces its own task even on the same asset.
      occurrenceKey: `E-${input.event.id.slice(0, 24)}`,
      occurredAt: new Date(`${input.event.occurred_at.replace(' ', 'T')}Z`),
      triggerEventId: input.event.id,
      triggerEventType: input.event.event_type,
      priority: input.priority,
      skills: [],
      actor: input.actor,
      source: input.event.source,
      taskName: name,
    });
  }

  /* -------------------------------------------------------------- notifications */

  async notifyAssignment(
    connection: PoolConnection,
    input: {
      taskId: string;
      taskName: string;
      assetName: string;
      areaId: string;
      assignedTo: string | null;
      priority: Priority;
      dueAt: Date | null;
      actor: AuditActor;
    },
  ): Promise<NotificationDto[]> {
    if (input.assignedTo !== null) {
      return notificationService.notify(connection, {
        userIds: [input.assignedTo],
        type: NotificationType.CLEANING_TASK_ASSIGNED,
        title: `Cleaning: ${input.assetName}`,
        body: input.taskName,
        actorId: input.actor.userId,
        data: {
          taskId: input.taskId,
          areaId: input.areaId,
          priority: input.priority,
          dueAt: input.dueAt?.toISOString() ?? null,
        },
      });
    }

    // Nobody could take it. Somebody has to know, or it sits in the pool forever.
    const supervisors = await userRepository.findActiveByRoles(connection, SUPERVISOR_ROLES);
    return notificationService.notify(connection, {
      userIds: supervisors.map((user) => user.id),
      type: NotificationType.CLEANING_TASK_UNASSIGNED,
      title: `Cleaning task needs an owner`,
      body: `${input.taskName} — nobody eligible was on shift`,
      actorId: input.actor.userId,
      data: { taskId: input.taskId, areaId: input.areaId, priority: input.priority },
    });
  }

  /* ---------------------------------------------------------------------- sweep */

  /**
   * Raises the calendar occurrences that fall due inside the horizon.
   *
   * Publishes a `SCHEDULE_DUE` event per rule/period rather than inserting tasks directly, so
   * the whole module has exactly one path into `cleaning_tasks` and the event log answers "why
   * does this task exist?" for scheduled work too.
   */
  async dueOccurrences(
    db: Db,
    at: Date = new Date(),
  ): Promise<Array<{ rule: CleaningRuleRow; occurrenceKey: string; dueAt: Date | null }>> {
    const rules = await CleaningRuleRepository.listCalendarRules(db, CALENDAR_FREQUENCY_KINDS);
    const out: Array<{ rule: CleaningRuleRow; occurrenceKey: string; dueAt: Date | null }> = [];
    for (const rule of rules) {
      const key = this.occurrenceKeyFor(rule, at);
      if (key === null) continue;
      const dueAt = this.dueAtFor(rule, at);
      // Only raise it once the occurrence is within the horizon of its due moment; a daily
      // task due at 22:00 should not appear on the list at 06:00 as if it were already late.
      if (
        dueAt !== null &&
        dueAt.getTime() - at.getTime() > SWEEP_HORIZON_HOURS * 3_600_000
      ) {
        continue;
      }
      out.push({ rule, occurrenceKey: key, dueAt });
    }
    return out;
  }

  /** Tasks whose due moment has just passed, for the overdue reminder. */
  async listNewlyOverdue(db: Db, graceMinutes: number): Promise<CleaningTaskRow[]> {
    return CleaningTaskRepository.listNewlyOverdue(db, graceMinutes);
  }
}

export const cleaningEngineService = new CleaningEngineService();
