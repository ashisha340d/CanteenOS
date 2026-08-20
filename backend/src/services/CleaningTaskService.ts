import {
  CLEANING_TASK_OPEN_STATUSES,
  Capability,
  CleaningAssignmentReason,
  CleaningEventSource,
  CleaningEvidenceKind,
  CleaningStepStatus,
  CleaningTaskStatus,
  CleaningTriggerEvent,
  CleaningVerificationMethod,
  CleaningVerificationOutcome,
  CorrectiveActionStatus,
  LIMITS,
  NotificationType,
  UserRole,
  canTransitionCleaningTask,
  type CleaningCorrectiveActionDto,
  type CleaningTaskAssignRequest,
  type CleaningTaskCancelRequest,
  type CleaningTaskCompleteRequest,
  type CleaningTaskDto,
  type CleaningTaskEvidenceRequest,
  type CleaningTaskListQuery,
  type CleaningTaskStartRequest,
  type CleaningTaskStepUpdateRequest,
  type CleaningVerifyRequest,
  type CorrectiveActionListQuery,
  type CorrectiveActionUpdateRequest,
  type MyCleaningDto,
  type NotificationDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import {
  mapCleaningCorrectiveAction,
  mapCleaningEvent,
  mapCleaningProcedureVersion,
  mapCleaningTask,
  mapCleaningTaskAssignment,
  mapCleaningTaskEvidence,
  mapCleaningTaskStateChange,
  mapCleaningTaskStepResult,
  mapCleaningVerification,
  type CleaningTaskViewerContext,
} from '../models/mappers';
import type { CleaningTaskRow } from '../models/rows';
import { CleaningEventRepository } from '../repositories/CleaningEventRepository';
import { CleaningMasterRepository } from '../repositories/CleaningMasterRepository';
import { CleaningProcedureRepository } from '../repositories/CleaningProcedureRepository';
import { CleaningRuleRepository } from '../repositories/CleaningRuleRepository';
import { CleaningTaskRepository, type TaskFilter } from '../repositories/CleaningTaskRepository';
import { permissionsCacheService } from './PermissionsCacheService';
import { userRepository } from '../repositories/UserRepository';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { toDbDateTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { cleaningAssignmentService } from './CleaningAssignmentService';
import { notificationService } from './NotificationService';

/**
 * The cleaning task lifecycle: assigned → started → done → checked → closed, with a reclean
 * loop hanging off a failed check.
 *
 * Four rules run through it:
 *
 *  - **`canTransitionCleaningTask` in shared is the only authority on movement.** Both clients
 *    and this service ask the same function, so a button enabled on the phone cannot be
 *    refused by the server.
 *  - **Nobody verifies their own work.** Checked here, not on the route, because it is a fact
 *    about the task and the person rather than about the endpoint.
 *  - **A mandatory step cannot be silently skipped.** Completion is refused while one is still
 *    pending, and a skipped step must carry a reason. That is the difference between a
 *    hygiene record and a checkbox.
 *  - **Every move writes the state history and, where it matters, a notification, inside the
 *    same transaction.** A task that changes hands without telling anybody has not changed
 *    hands.
 */

const MY_LIST_LIMIT = 50;

const SUPERVISOR_ROLES: readonly UserRole[] = [
  UserRole.MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

export class CleaningTaskService {
  /* ------------------------------------------------------------------- viewers */

  /**
   * What this user may do to a cleaning task, resolved once per request and handed to the
   * mapper. The capability set is the same one the route guard consults.
   */
  async viewerFor(userId: string): Promise<CleaningTaskViewerContext> {
    const user = await userRepository.findById(getPool(), userId);
    if (user === null) {
      return { userId, canWork: false, canVerify: false, canAssign: false };
    }
    const role = user.role;
    return {
      userId,
      canWork: permissionsCacheService.roleHasCapability(role, Capability.CLEANING_WORK),
      canVerify: permissionsCacheService.roleHasCapability(role, Capability.CLEANING_VERIFY),
      canAssign: permissionsCacheService.roleHasCapability(role, Capability.CLEANING_ASSIGN),
    };
  }

  /* --------------------------------------------------------------------- reads */

  async list(query: CleaningTaskListQuery, userId: string) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: TaskFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.priority !== undefined ? { priority: query.priority } : {}),
      ...(query.areaId !== undefined ? { areaId: query.areaId } : {}),
      ...(query.floorId !== undefined ? { floorId: query.floorId } : {}),
      ...(query.cleanableAssetId !== undefined
        ? { cleanableAssetId: query.cleanableAssetId }
        : {}),
      ...(query.assetTypeId !== undefined ? { assetTypeId: query.assetTypeId } : {}),
      ...(query.ruleId !== undefined ? { ruleId: query.ruleId } : {}),
      ...(query.shiftId !== undefined ? { shiftId: query.shiftId } : {}),
      // Resolved here rather than by the client, so a phone cannot ask for somebody else's list.
      ...(query.mine === true
        ? { assignedTo: userId }
        : query.assignedTo !== undefined
          ? { assignedTo: query.assignedTo }
          : {}),
      ...(query.openOnly !== undefined ? { openOnly: query.openOnly } : {}),
      ...(query.overdueOnly !== undefined ? { overdueOnly: query.overdueOnly } : {}),
      ...(query.unassignedOnly !== undefined ? { unassignedOnly: query.unassignedOnly } : {}),
      ...(query.awaitingVerification !== undefined
        ? { awaitingVerification: query.awaitingVerification }
        : {}),
      ...(query.dueFrom !== undefined ? { dueFrom: toDbDateTime(new Date(query.dueFrom)) } : {}),
      ...(query.dueTo !== undefined ? { dueTo: toDbDateTime(new Date(query.dueTo)) } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total, viewer] = await Promise.all([
      CleaningTaskRepository.list(pool, filter),
      CleaningTaskRepository.count(pool, filter),
      this.viewerFor(userId),
    ]);
    return buildPage(
      rows.map((row) => mapCleaningTask(row, viewer)),
      total,
      page,
      pageSize,
    );
  }

  async getById(id: string, userId: string): Promise<CleaningTaskDto> {
    const pool = getPool();
    const row = await CleaningTaskRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Cleaning task', id);
    return this.detailFor(pool, row, userId);
  }

  private async detailFor(db: Db, row: CleaningTaskRow, userId: string): Promise<CleaningTaskDto> {
    const viewer = await this.viewerFor(userId);
    const [steps, evidence, verifications, assignments, history, corrective, version] =
      await Promise.all([
        CleaningTaskRepository.listStepResults(db, row.id),
        CleaningTaskRepository.listEvidence(db, row.id),
        CleaningTaskRepository.listVerifications(db, row.id),
        CleaningTaskRepository.listAssignments(db, row.id),
        CleaningTaskRepository.listStateHistory(db, row.id),
        CleaningTaskRepository.listCorrectiveActions(db, {
          taskId: row.id,
          limit: 20,
          offset: 0,
        }),
        CleaningProcedureRepository.findVersion(db, row.procedure_version_id),
      ]);

    const results = await CleaningTaskRepository.listVerificationResults(
      db,
      verifications.map((verification) => verification.id),
    );

    const procedure =
      version === null
        ? undefined
        : mapCleaningProcedureVersion(version, {
            chemicals: await CleaningProcedureRepository.listVersionChemicals(db, version.id),
            tools: await CleaningProcedureRepository.listVersionTools(db, version.id),
          });

    return {
      ...mapCleaningTask(row, viewer),
      steps: steps.map(mapCleaningTaskStepResult),
      evidence: evidence.map((item) => mapCleaningTaskEvidence(item, userId)),
      verifications: verifications.map((verification) =>
        mapCleaningVerification(
          verification,
          results.filter((result) => result.verification_id === verification.id),
        ),
      ),
      assignments: assignments.map(mapCleaningTaskAssignment),
      history: history.map(mapCleaningTaskStateChange),
      correctiveActions: corrective.map(mapCleaningCorrectiveAction),
      ...(procedure !== undefined ? { procedure } : {}),
    };
  }

  /** The phone's landing payload. Four questions, four lists. */
  async myCleaning(userId: string): Promise<MyCleaningDto> {
    const pool = getPool();
    const viewer = await this.viewerFor(userId);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);

    const [assigned, dueToday, toVerify, reported, corrective, overdue] = await Promise.all([
      CleaningTaskRepository.list(pool, {
        assignedTo: userId,
        openOnly: true,
        limit: MY_LIST_LIMIT,
        offset: 0,
      }),
      CleaningTaskRepository.list(pool, {
        assignedTo: userId,
        openOnly: true,
        dueTo: toDbDateTime(todayEnd),
        limit: MY_LIST_LIMIT,
        offset: 0,
      }),
      viewer.canVerify
        ? CleaningTaskRepository.list(pool, {
            awaitingVerification: true,
            limit: MY_LIST_LIMIT,
            offset: 0,
          })
        : Promise.resolve([]),
      CleaningEventRepository.list(pool, {
        reportedBy: userId,
        limit: MY_LIST_LIMIT,
        offset: 0,
      }),
      CleaningTaskRepository.listCorrectiveActions(pool, {
        assignedTo: userId,
        openOnly: true,
        limit: MY_LIST_LIMIT,
        offset: 0,
      }),
      CleaningTaskRepository.count(pool, {
        assignedTo: userId,
        overdueOnly: true,
        limit: 1,
        offset: 0,
      }),
    ]);

    // Nobody signs off their own clean, so the verify queue never shows the reader's own work.
    const verifiable = toVerify.filter((row) => row.completed_by !== userId);

    return {
      assigned: assigned.map((row) => mapCleaningTask(row, viewer)),
      dueToday: dueToday.map((row) => mapCleaningTask(row, viewer)),
      toVerify: verifiable.map((row) => mapCleaningTask(row, viewer)),
      reported: reported.map(mapCleaningEvent),
      correctiveActions: corrective.map(mapCleaningCorrectiveAction),
      counts: {
        assigned: assigned.length,
        dueToday: dueToday.length,
        overdue,
        toVerify: verifiable.length,
        correctiveActions: corrective.length,
      },
    };
  }

  /* --------------------------------------------------------------- assignment */

  async assign(
    id: string,
    input: CleaningTaskAssignRequest,
    actor: AuditActor,
  ): Promise<CleaningTaskDto> {
    const notifications = await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findByIdForUpdate(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);
      this.assertOpen(task);

      const next =
        input.assignedTo === null ? CleaningTaskStatus.UNASSIGNED : CleaningTaskStatus.ASSIGNED;
      if (!canTransitionCleaningTask(task.status, next)) {
        throw new ConflictError(
          `A task that is ${task.status.toLowerCase().replace(/_/g, ' ')} cannot be reassigned`,
        );
      }
      if (input.assignedTo !== null && input.assignedTo === task.assigned_to) {
        throw new ConflictError('That task already belongs to them');
      }
      if (input.assignedTo !== null) {
        const user = await userRepository.findById(connection, input.assignedTo);
        if (user === null) throw new NotFoundError('User', input.assignedTo);
      }

      const now = toDbDateTime();
      await CleaningTaskRepository.update(
        connection,
        id,
        ['status = ?', 'assigned_to = ?', 'assigned_at = ?'],
        [next, input.assignedTo, input.assignedTo === null ? null : now],
      );
      await CleaningTaskRepository.insertStateChange(connection, {
        id: newId(),
        taskId: id,
        fromStatus: task.status,
        toStatus: next,
        actorId: actor.userId,
        actorRole: actor.role,
        source: CleaningEventSource.ADMIN,
        note: input.note ?? null,
      });
      await CleaningTaskRepository.insertAssignment(connection, {
        id: newId(),
        taskId: id,
        assignedTo: input.assignedTo,
        assignedBy: actor.userId,
        reason:
          task.assigned_to === null
            ? CleaningAssignmentReason.MANUAL
            : CleaningAssignmentReason.REASSIGNED,
        strategy: null,
        decision: null,
        note: input.note ?? null,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_TASK_ASSIGNED,
        entityType: 'cleaning_task',
        entityId: id,
        before: { assignedTo: task.assigned_to, status: task.status },
        after: { assignedTo: input.assignedTo, status: next },
      });

      if (input.assignedTo === null) return [];
      return notificationService.notify(connection, {
        userIds: [input.assignedTo],
        type: NotificationType.CLEANING_TASK_ASSIGNED,
        title: 'Cleaning task assigned to you',
        body: task.task_name,
        actorId: actor.userId,
        data: { taskId: id, areaId: task.area_id, priority: task.priority },
      });
    });

    notificationService.publish(notifications);
    return this.getById(id, actor.userId ?? '');
  }

  /** Who the engine would pick, shown before a supervisor commits to it. */
  async candidates(id: string) {
    const pool = getPool();
    const task = await CleaningTaskRepository.findById(pool, id);
    if (task === null) throw new NotFoundError('Cleaning task', id);
    const rule = await CleaningRuleRepository.findById(pool, task.rule_id);
    const skills = await CleaningRuleRepository.listSkills(pool, task.rule_id);
    return cleaningAssignmentService.candidatesFor(pool, {
      areaId: task.area_id,
      requiredSkills: skills,
      responsibleRole: rule?.responsible_role ?? null,
    });
  }

  /* ------------------------------------------------------------------ doing it */

  async start(
    id: string,
    input: CleaningTaskStartRequest,
    actor: AuditActor,
  ): Promise<CleaningTaskDto> {
    await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findByIdForUpdate(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);
      await this.assertMayWork(connection, task, actor);

      if (!canTransitionCleaningTask(task.status, CleaningTaskStatus.STARTED)) {
        // A reclean starts from RECLEAN_REQUIRED, which the machine models as its own move.
        if (task.status !== CleaningTaskStatus.RECLEAN_REQUIRED) {
          throw new ConflictError('That task cannot be started from its current state');
        }
      }

      const now = toDbDateTime();
      const next =
        task.status === CleaningTaskStatus.RECLEAN_REQUIRED
          ? CleaningTaskStatus.RECLEAN_REQUIRED
          : CleaningTaskStatus.STARTED;

      await CleaningTaskRepository.update(
        connection,
        id,
        ['status = ?', 'started_at = ?'],
        [next, task.started_at ?? now],
      );
      await CleaningTaskRepository.insertStateChange(connection, {
        id: newId(),
        taskId: id,
        fromStatus: task.status,
        toStatus: next,
        actorId: actor.userId,
        actorRole: actor.role,
        source: CleaningEventSource.MOBILE,
        note: input.note ?? 'Started',
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_TASK_STARTED,
        entityType: 'cleaning_task',
        entityId: id,
        after: { status: next },
      });
    });
    return this.getById(id, actor.userId ?? '');
  }

  async recordStep(
    id: string,
    stepId: string,
    input: CleaningTaskStepUpdateRequest,
    actor: AuditActor,
  ): Promise<CleaningTaskDto> {
    if (input.status === CleaningStepStatus.SKIPPED && (input.skipReason ?? '').trim() === '') {
      throw new ValidationError('Say why the step was skipped');
    }
    await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findByIdForUpdate(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);
      await this.assertMayWork(connection, task, actor);
      if (
        task.status !== CleaningTaskStatus.STARTED &&
        task.status !== CleaningTaskStatus.RECLEAN_REQUIRED &&
        task.status !== CleaningTaskStatus.ASSIGNED
      ) {
        throw new ConflictError('That task is not in progress');
      }

      const updated = await CleaningTaskRepository.updateStepResult(connection, id, stepId, {
        status: input.status,
        skipReason: input.skipReason ?? null,
        note: input.note ?? null,
        performedBy: actor.userId,
      });
      if (!updated) throw new NotFoundError('Cleaning step', stepId);

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_TASK_STEP_RECORDED,
        entityType: 'cleaning_task',
        entityId: id,
        after: { stepId, status: input.status },
      });
    });
    return this.getById(id, actor.userId ?? '');
  }

  async addEvidence(
    id: string,
    input: CleaningTaskEvidenceRequest,
    actor: AuditActor,
  ): Promise<CleaningTaskDto> {
    await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findByIdForUpdate(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);
      const count = await CleaningTaskRepository.countEvidence(connection, id);
      if (count >= LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX) {
        throw new ConflictError(
          `A task may carry at most ${LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX} photos`,
        );
      }
      await CleaningTaskRepository.insertEvidence(connection, {
        id: newId(),
        taskId: id,
        mediaId: input.mediaId,
        kind: input.kind ?? CleaningEvidenceKind.OTHER,
        stepId: input.stepId ?? null,
        caption: input.caption ?? null,
        uploadedBy: actor.userId ?? '',
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_EVIDENCE_ADDED,
        entityType: 'cleaning_task',
        entityId: id,
        after: { mediaId: input.mediaId, kind: input.kind ?? CleaningEvidenceKind.OTHER },
      });
    });
    return this.getById(id, actor.userId ?? '');
  }

  async removeEvidence(id: string, evidenceId: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const removed = await CleaningTaskRepository.softDeleteEvidence(connection, evidenceId);
      if (!removed) throw new NotFoundError('Cleaning evidence', evidenceId);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_EVIDENCE_DELETED,
        entityType: 'cleaning_task',
        entityId: id,
        before: { evidenceId },
      });
    });
  }

  /**
   * Finishing the job.
   *
   * Steps not reported one at a time may be settled here in one call, which is what the phone
   * actually does. What cannot be settled is a mandatory step left pending, or a step that
   * demanded a photo and never got one — those are refused with the list of what is missing.
   */
  async complete(
    id: string,
    input: CleaningTaskCompleteRequest,
    actor: AuditActor,
  ): Promise<CleaningTaskDto> {
    const notifications = await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findByIdForUpdate(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);
      await this.assertMayWork(connection, task, actor);

      const reclean = task.status === CleaningTaskStatus.RECLEAN_REQUIRED;
      if (task.status !== CleaningTaskStatus.STARTED && !reclean) {
        throw new ConflictError('Start the task before completing it');
      }

      for (const step of input.steps ?? []) {
        if (step.status === CleaningStepStatus.SKIPPED && (step.skipReason ?? '').trim() === '') {
          throw new ValidationError('Say why each skipped step was skipped');
        }
        await CleaningTaskRepository.updateStepResult(connection, id, step.stepId, {
          status: step.status,
          skipReason: step.skipReason ?? null,
          note: null,
          performedBy: actor.userId,
        });
      }

      for (const item of (input.evidence ?? []).slice(0, LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX)) {
        await CleaningTaskRepository.insertEvidence(connection, {
          id: newId(),
          taskId: id,
          mediaId: item.mediaId,
          kind: item.kind ?? CleaningEvidenceKind.AFTER,
          stepId: item.stepId ?? null,
          caption: item.caption ?? null,
          uploadedBy: actor.userId ?? '',
        });
      }

      const outstanding = await CleaningTaskRepository.listOutstandingMandatorySteps(
        connection,
        id,
      );
      if (outstanding.length > 0) {
        throw new ValidationError(
          `Finish or skip every required step first: ${outstanding
            .map((step) => step.title ?? `step ${step.step_number}`)
            .join(', ')}`,
        );
      }
      const missingPhotos = await CleaningTaskRepository.listStepsMissingPhotos(connection, id);
      if (missingPhotos.length > 0) {
        throw new ValidationError(
          `These steps need a photo: ${missingPhotos
            .map((step) => step.title ?? `step ${step.step_number}`)
            .join(', ')}`,
        );
      }

      const now = toDbDateTime();
      // Where the task goes next is decided by the rule, not the client: a clean that needs
      // checking must not be able to close itself.
      const next = reclean
        ? CleaningTaskStatus.RECLEANED
        : task.requires_verification === 1
          ? CleaningTaskStatus.COMPLETED
          : CleaningTaskStatus.COMPLETED;

      await CleaningTaskRepository.update(
        connection,
        id,
        [
          'status = ?',
          'completed_at = ?',
          'completed_by = ?',
          'completion_note = ?',
          ...(reclean ? ['reclean_count = reclean_count + 1'] : []),
        ],
        [next, now, actor.userId, input.note ?? null],
      );
      await CleaningTaskRepository.insertStateChange(connection, {
        id: newId(),
        taskId: id,
        fromStatus: task.status,
        toStatus: next,
        actorId: actor.userId,
        actorRole: actor.role,
        source: CleaningEventSource.MOBILE,
        note: input.note ?? 'Completed',
      });

      const settled = await this.settleAfterCompletion(connection, id, next, task, actor);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_TASK_COMPLETED,
        entityType: 'cleaning_task',
        entityId: id,
        before: { status: task.status },
        after: { status: settled.status, reclean },
      });
      return settled.notifications;
    });

    notificationService.publish(notifications);
    return this.getById(id, actor.userId ?? '');
  }

  /**
   * Where a completed task lands: waiting for a check, or closed.
   *
   * Decided in the same transaction as completion, from the rule's own `requiresVerification`,
   * so a client cannot close work that was supposed to be inspected.
   */
  private async settleAfterCompletion(
    connection: PoolConnection,
    id: string,
    completedStatus: CleaningTaskStatus,
    task: CleaningTaskRow,
    actor: AuditActor,
  ): Promise<{ status: CleaningTaskStatus; notifications: NotificationDto[] }> {
    const now = toDbDateTime();

    if (task.requires_verification !== 1) {
      await CleaningTaskRepository.update(
        connection,
        id,
        ['status = ?', 'closed_at = ?'],
        [CleaningTaskStatus.CLOSED, now],
      );
      await CleaningTaskRepository.insertStateChange(connection, {
        id: newId(),
        taskId: id,
        fromStatus: completedStatus,
        toStatus: CleaningTaskStatus.CLOSED,
        actorId: actor.userId,
        actorRole: actor.role,
        source: CleaningEventSource.SYSTEM,
        note: 'No verification required',
      });
      return { status: CleaningTaskStatus.CLOSED, notifications: [] };
    }

    const next =
      completedStatus === CleaningTaskStatus.RECLEANED
        ? CleaningTaskStatus.REVERIFICATION_REQUIRED
        : CleaningTaskStatus.VERIFICATION_REQUIRED;

    await CleaningTaskRepository.update(connection, id, ['status = ?'], [next]);
    await CleaningTaskRepository.insertStateChange(connection, {
      id: newId(),
      taskId: id,
      fromStatus: completedStatus,
      toStatus: next,
      actorId: actor.userId,
      actorRole: actor.role,
      source: CleaningEventSource.SYSTEM,
      note: 'Awaiting a check',
    });

    const verifiers = await this.verifierAudience(connection, task);
    const notifications = await notificationService.notify(connection, {
      userIds: verifiers,
      type: NotificationType.CLEANING_VERIFICATION_REQUIRED,
      title: 'A clean needs checking',
      body: task.task_name,
      actorId: actor.userId,
      data: { taskId: id, areaId: task.area_id, method: task.verification_method },
    });
    return { status: next, notifications };
  }

  /* ------------------------------------------------------------- verification */

  /**
   * Passing or failing a completed clean.
   *
   * A FAIL is not a dead end: it moves the task to RECLEAN_REQUIRED, hands it back to whoever
   * did it, and raises a corrective action so the *reason* it failed gets an owner too. The
   * same task object carries the whole story, so "what happened to this occurrence" stays one
   * query.
   */
  async verify(
    id: string,
    input: CleaningVerifyRequest,
    actor: AuditActor,
  ): Promise<CleaningTaskDto> {
    const notifications = await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findByIdForUpdate(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);

      if (
        task.status !== CleaningTaskStatus.VERIFICATION_REQUIRED &&
        task.status !== CleaningTaskStatus.REVERIFICATION_REQUIRED
      ) {
        throw new ConflictError('That task is not waiting to be checked');
      }
      if (task.completed_by !== null && task.completed_by === actor.userId) {
        throw new ForbiddenError('You cannot sign off a clean you carried out yourself');
      }
      if (input.outcome === CleaningVerificationOutcome.FAIL) {
        if ((input.failureReason ?? '').trim() === '') {
          throw new ValidationError('Say what was wrong with it');
        }
      }

      const method =
        input.method ?? task.verification_method ?? CleaningVerificationMethod.VISUAL_INSPECTION;
      // The standard is the acceptance criteria the measurement is judged against, and it can
      // be declared in two places. The rule's wins as an override; failing that the procedure
      // version's applies — that is the "clean means" the operator was actually shown, so
      // judging against anything else would measure them by a rule they never saw.
      const rule = await CleaningRuleRepository.findById(connection, task.rule_id);
      const version = await CleaningProcedureRepository.findVersion(
        connection,
        task.procedure_version_id,
      );
      const standardId = rule?.standard_id ?? version?.standard_id ?? null;
      const standard =
        standardId === null
          ? null
          : await CleaningMasterRepository.findStandard(connection, standardId);

      const verificationId = newId();
      const attempt = await CleaningTaskRepository.nextVerificationAttempt(connection, id);
      await CleaningTaskRepository.insertVerification(connection, {
        id: verificationId,
        taskId: id,
        attempt,
        method,
        outcome: input.outcome,
        standardId: standard?.id ?? null,
        verifiedBy: actor.userId ?? '',
        failureReason: input.failureReason ?? null,
        note: input.note ?? null,
      });

      await CleaningTaskRepository.insertVerificationResults(
        connection,
        verificationId,
        (input.results ?? []).slice(0, LIMITS.CLEANING_VERIFICATION_RESULTS_MAX).map((result) => ({
          id: newId(),
          label: result.label,
          // A measurement is judged against the standard's window here rather than trusted from
          // the client: the window is the record of what "clean enough" meant that day.
          passed:
            result.passed !== undefined && result.passed !== null
              ? result.passed
              : withinStandard(result.measuredValue ?? null, standard),
          measuredValue: result.measuredValue ?? null,
          measureUnit: result.measureUnit ?? standard?.measure_unit ?? null,
          expectedMin: standard === null ? null : numberOrNull(standard.min_value),
          expectedMax: standard === null ? null : numberOrNull(standard.max_value),
          note: result.note ?? null,
        })),
      );

      for (const item of input.evidence ?? []) {
        await CleaningTaskRepository.insertEvidence(connection, {
          id: newId(),
          taskId: id,
          mediaId: item.mediaId,
          kind: CleaningEvidenceKind.VERIFICATION,
          stepId: null,
          caption: item.caption ?? null,
          uploadedBy: actor.userId ?? '',
        });
      }

      const now = toDbDateTime();

      if (input.outcome === CleaningVerificationOutcome.PASS) {
        await CleaningTaskRepository.update(
          connection,
          id,
          ['status = ?', 'verified_at = ?', 'verified_by = ?'],
          [CleaningTaskStatus.VERIFIED, now, actor.userId],
        );
        await CleaningTaskRepository.insertStateChange(connection, {
          id: newId(),
          taskId: id,
          fromStatus: task.status,
          toStatus: CleaningTaskStatus.VERIFIED,
          actorId: actor.userId,
          actorRole: actor.role,
          source: CleaningEventSource.ADMIN,
          note: input.note ?? 'Passed',
        });
        await CleaningTaskRepository.update(
          connection,
          id,
          ['status = ?', 'closed_at = ?'],
          [CleaningTaskStatus.CLOSED, now],
        );
        await CleaningTaskRepository.insertStateChange(connection, {
          id: newId(),
          taskId: id,
          fromStatus: CleaningTaskStatus.VERIFIED,
          toStatus: CleaningTaskStatus.CLOSED,
          actorId: actor.userId,
          actorRole: actor.role,
          source: CleaningEventSource.SYSTEM,
          note: 'Closed after passing',
        });
        await auditService.record(connection, actor, {
          action: AuditAction.CLEANING_TASK_VERIFIED,
          entityType: 'cleaning_task',
          entityId: id,
          after: { outcome: 'PASS', attempt, method },
        });
        return [];
      }

      // FAIL: the task goes back for a reclean, and the failure gets an owner of its own.
      await CleaningTaskRepository.update(connection, id, ['status = ?'], [CleaningTaskStatus.FAILED]);
      await CleaningTaskRepository.insertStateChange(connection, {
        id: newId(),
        taskId: id,
        fromStatus: task.status,
        toStatus: CleaningTaskStatus.FAILED,
        actorId: actor.userId,
        actorRole: actor.role,
        source: CleaningEventSource.ADMIN,
        note: input.failureReason ?? 'Failed the check',
      });
      await CleaningTaskRepository.update(
        connection,
        id,
        ['status = ?'],
        [CleaningTaskStatus.RECLEAN_REQUIRED],
      );
      await CleaningTaskRepository.insertStateChange(connection, {
        id: newId(),
        taskId: id,
        fromStatus: CleaningTaskStatus.FAILED,
        toStatus: CleaningTaskStatus.RECLEAN_REQUIRED,
        actorId: actor.userId,
        actorRole: actor.role,
        source: CleaningEventSource.SYSTEM,
        note: 'Sent back for recleaning',
      });

      const correctiveId = newId();
      await CleaningTaskRepository.insertCorrectiveAction(connection, {
        id: correctiveId,
        taskId: id,
        verificationId,
        cleanableAssetId: task.cleanable_asset_id,
        areaId: task.area_id,
        failureSummary: (input.failureReason ?? 'Failed its hygiene check').slice(
          0,
          LIMITS.CLEANING_CORRECTIVE_FAILURE_SUMMARY_MAX,
        ),
        immediateAction: input.correctiveAction?.immediateAction ?? null,
        assignedTo: input.correctiveAction?.assignedTo ?? task.assigned_to,
        dueAt:
          input.correctiveAction?.dueAt === undefined || input.correctiveAction.dueAt === null
            ? null
            : toDbDateTime(new Date(input.correctiveAction.dueAt)),
        raisedBy: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_TASK_FAILED,
        entityType: 'cleaning_task',
        entityId: id,
        after: { outcome: 'FAIL', attempt, method, correctiveActionId: correctiveId },
      });

      const audience = new Set<string>();
      if (task.assigned_to !== null) audience.add(task.assigned_to);
      if (task.completed_by !== null) audience.add(task.completed_by);
      const correctiveOwner = input.correctiveAction?.assignedTo ?? task.assigned_to;
      if (correctiveOwner !== null && correctiveOwner !== undefined) audience.add(correctiveOwner);

      return notificationService.notify(connection, {
        userIds: [...audience],
        type: NotificationType.CLEANING_RECLEAN_REQUIRED,
        title: 'A clean failed its check',
        body: `${task.task_name} — ${input.failureReason ?? 'needs recleaning'}`,
        actorId: actor.userId,
        data: { taskId: id, areaId: task.area_id, correctiveActionId: correctiveId },
      });
    });

    notificationService.publish(notifications);
    return this.getById(id, actor.userId ?? '');
  }

  async cancel(
    id: string,
    input: CleaningTaskCancelRequest,
    actor: AuditActor,
  ): Promise<CleaningTaskDto> {
    await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findByIdForUpdate(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);
      this.assertOpen(task);
      if (!canTransitionCleaningTask(task.status, CleaningTaskStatus.CANCELLED)) {
        throw new ConflictError('That task can no longer be cancelled');
      }
      const now = toDbDateTime();
      await CleaningTaskRepository.update(
        connection,
        id,
        ['status = ?', 'cancelled_reason = ?', 'closed_at = ?'],
        [CleaningTaskStatus.CANCELLED, input.reason, now],
      );
      await CleaningTaskRepository.insertStateChange(connection, {
        id: newId(),
        taskId: id,
        fromStatus: task.status,
        toStatus: CleaningTaskStatus.CANCELLED,
        actorId: actor.userId,
        actorRole: actor.role,
        source: CleaningEventSource.ADMIN,
        note: input.reason,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_TASK_CANCELLED,
        entityType: 'cleaning_task',
        entityId: id,
        before: { status: task.status },
        after: { reason: input.reason },
      });
    });
    return this.getById(id, actor.userId ?? '');
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const task = await CleaningTaskRepository.findById(connection, id);
      if (task === null) throw new NotFoundError('Cleaning task', id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_TASK_DELETED,
        entityType: 'cleaning_task',
        entityId: id,
        before: {
          taskName: task.task_name,
          status: task.status,
          cleanableAssetId: task.cleanable_asset_id,
        },
      });
      await CleaningTaskRepository.remove(connection, id);
    });
  }

  /* -------------------------------------------------------- corrective actions */

  async listCorrectiveActions(query: CorrectiveActionListQuery, userId: string) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter = {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.areaId !== undefined ? { areaId: query.areaId } : {}),
      ...(query.mine === true
        ? { assignedTo: userId }
        : query.assignedTo !== undefined
          ? { assignedTo: query.assignedTo }
          : {}),
      ...(query.openOnly !== undefined ? { openOnly: query.openOnly } : {}),
      ...(query.overdueOnly !== undefined ? { overdueOnly: query.overdueOnly } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      CleaningTaskRepository.listCorrectiveActions(pool, filter),
      CleaningTaskRepository.countCorrectiveActions(pool, filter),
    ]);
    return buildPage(rows.map(mapCleaningCorrectiveAction), total, page, pageSize);
  }

  async getCorrectiveAction(id: string): Promise<CleaningCorrectiveActionDto> {
    const row = await CleaningTaskRepository.findCorrectiveAction(getPool(), id);
    if (row === null) throw new NotFoundError('Corrective action', id);
    return mapCleaningCorrectiveAction(row);
  }

  async updateCorrectiveAction(
    id: string,
    input: CorrectiveActionUpdateRequest,
    actor: AuditActor,
  ): Promise<CleaningCorrectiveActionDto> {
    const notifications = await withTransaction(async (connection) => {
      const before = await CleaningTaskRepository.findCorrectiveAction(connection, id);
      if (before === null) throw new NotFoundError('Corrective action', id);

      const closing =
        input.status === CorrectiveActionStatus.CLOSED &&
        before.status !== CorrectiveActionStatus.CLOSED;
      if (closing) {
        // A corrective action closed without a root cause records that something went wrong and
        // nothing was learned, which is the opposite of what it is for.
        const rootCause = input.rootCause ?? before.root_cause;
        const action = input.correctiveAction ?? before.corrective_action;
        if ((rootCause ?? '').trim() === '' || (action ?? '').trim() === '') {
          throw new ValidationError(
            'Record the root cause and what was done about it before closing this',
          );
        }
      }

      const assignments: string[] = [];
      const params: unknown[] = [];
      const push = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(value);
      };
      if (input.rootCause !== undefined) push('root_cause', input.rootCause);
      if (input.correctiveAction !== undefined) push('corrective_action', input.correctiveAction);
      if (input.preventiveAction !== undefined) push('preventive_action', input.preventiveAction);
      if (input.immediateAction !== undefined) push('immediate_action', input.immediateAction);
      if (input.assignedTo !== undefined) push('assigned_to', input.assignedTo);
      if (input.dueAt !== undefined) {
        push('due_at', input.dueAt === null ? null : toDbDateTime(new Date(input.dueAt)));
      }
      if (input.status !== undefined) push('status', input.status);
      if (input.closureNote !== undefined) push('closure_note', input.closureNote);
      if (closing) {
        push('closed_by', actor.userId);
        push('closed_at', toDbDateTime());
      }
      await CleaningTaskRepository.updateCorrectiveAction(connection, id, assignments, params);

      await auditService.record(connection, actor, {
        action: closing
          ? AuditAction.CLEANING_CORRECTIVE_ACTION_CLOSED
          : AuditAction.CLEANING_CORRECTIVE_ACTION_UPDATED,
        entityType: 'cleaning_corrective_action',
        entityId: id,
        before: { status: before.status, assignedTo: before.assigned_to },
        after: { ...input },
      });

      if (
        input.assignedTo !== undefined &&
        input.assignedTo !== null &&
        input.assignedTo !== before.assigned_to
      ) {
        return notificationService.notify(connection, {
          userIds: [input.assignedTo],
          type: NotificationType.CLEANING_CORRECTIVE_ACTION_ASSIGNED,
          title: 'Corrective action assigned to you',
          body: before.failure_summary,
          actorId: actor.userId,
          data: { correctiveActionId: id, taskId: before.task_id, areaId: before.area_id },
        });
      }
      return [];
    });

    notificationService.publish(notifications);
    return this.getCorrectiveAction(id);
  }

  /* ------------------------------------------------------------------- guards */

  private assertOpen(task: CleaningTaskRow): void {
    if (!CLEANING_TASK_OPEN_STATUSES.includes(task.status)) {
      throw new ConflictError('That task is already closed');
    }
  }

  /**
   * Working a task is the assignee's job. A supervisor who can reassign may also finish it —
   * somebody has to, when the person who owned it went home.
   */
  private async assertMayWork(
    db: Db,
    task: CleaningTaskRow,
    actor: AuditActor,
  ): Promise<void> {
    if (actor.userId === null) throw new ForbiddenError('Sign in to work on a cleaning task');
    if (task.assigned_to === actor.userId) return;
    if (
      actor.role !== null &&
      permissionsCacheService.roleHasCapability(actor.role, Capability.CLEANING_ASSIGN)
    ) {
      return;
    }
    throw new ForbiddenError('That cleaning task belongs to somebody else');
  }

  /** Who is asked to check a finished clean: the rule's verifier role, or every supervisor. */
  private async verifierAudience(db: Db, task: CleaningTaskRow): Promise<string[]> {
    const roles =
      task.verifier_role === null ? SUPERVISOR_ROLES : ([task.verifier_role] as readonly UserRole[]);
    const users = await userRepository.findActiveByRoles(db, roles);
    // The person who did the work is never asked to check it.
    return users.map((user) => user.id).filter((id) => id !== task.completed_by);
  }
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A measurement judged against the standard's window. Null when there is nothing to judge. */
function withinStandard(
  value: number | null,
  standard: { min_value: string | number | null; max_value: string | number | null } | null,
): boolean | null {
  if (value === null || standard === null) return null;
  const min = numberOrNull(standard.min_value);
  const max = numberOrNull(standard.max_value);
  if (min === null && max === null) return null;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

export const cleaningTaskService = new CleaningTaskService();

