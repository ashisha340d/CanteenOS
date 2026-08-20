import type {
  CleaningAssignmentReason,
  CleaningAssignmentStrategy,
  CleaningEventSource,
  CleaningEvidenceKind,
  CleaningStepStatus,
  CleaningTaskPriority,
  CleaningTaskStatus,
  CleaningTriggerEvent,
  CleaningVerificationMethod,
  CleaningVerificationOutcome,
  CorrectiveActionStatus,
  UserRole,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  AreaCleaningStatusRow,
  CleaningCorrectiveActionRow,
  CleaningCountsRow,
  CleaningTaskAssignmentRow,
  CleaningTaskEvidenceRow,
  CleaningTaskRow,
  CleaningTaskStateHistoryRow,
  CleaningTaskStepResultRow,
  CleaningVerificationResultRow,
  CleaningVerificationRow,
  CleaningWindowRow,
  CountRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Cleaning tasks and everything hanging off one: steps performed, evidence, verifications,
 * corrective actions, the assignment record and the state history.
 *
 * "Open" means `status NOT IN ('CLOSED','CANCELLED')` everywhere in this file, matching the
 * shared `CLEANING_TASK_OPEN_STATUSES` set. It is written out rather than parameterised
 * because it appears inside index-using predicates the optimiser must see literally.
 */

const OPEN_CLAUSE = "ct.status NOT IN ('CLOSED','CANCELLED')";

const TASK_SELECT = `SELECT ct.*,
         r.code AS rule_code,
         a.code AS cleanable_asset_code, a.name AS cleanable_asset_name,
         a.risk_level AS risk_level, a.food_contact AS food_contact,
         at.name AS asset_type_name,
         ar.name AS area_name,
         f.name AS floor_name,
         l.name AS location_name, l.room AS room, l.section AS section, l.position AS position,
         p.name AS procedure_name, v.version AS procedure_version, m.name AS method_name,
         sh.name AS shift_name,
         au.name AS assigned_to_name,
         cu.name AS completed_by_name,
         vu.name AS verified_by_name,
         (SELECT COUNT(*) FROM cleaning_task_step_results sr WHERE sr.task_id = ct.id) AS step_count,
         (SELECT COUNT(*) FROM cleaning_task_step_results sr
           WHERE sr.task_id = ct.id AND sr.status <> 'PENDING') AS steps_done,
         (SELECT COUNT(*) FROM cleaning_task_evidence ev
           WHERE ev.task_id = ct.id AND ev.deleted_at IS NULL) AS evidence_count
    FROM cleaning_tasks ct
    JOIN cleaning_rules r ON r.id = ct.rule_id
    JOIN cleanable_assets a ON a.id = ct.cleanable_asset_id
    LEFT JOIN cleanable_asset_types at ON at.id = a.asset_type_id
    LEFT JOIN equipment_areas ar ON ar.id = ct.area_id
    LEFT JOIN equipment_floors f ON f.id = ar.floor_id
    LEFT JOIN equipment_locations l ON l.id = a.location_id
    JOIN cleaning_procedure_versions v ON v.id = ct.procedure_version_id
    JOIN cleaning_procedures p ON p.id = v.procedure_id
    LEFT JOIN cleaning_methods m ON m.id = v.method_id
    LEFT JOIN shifts sh ON sh.id = ct.shift_id
    LEFT JOIN users au ON au.id = ct.assigned_to
    LEFT JOIN users cu ON cu.id = ct.completed_by
    LEFT JOIN users vu ON vu.id = ct.verified_by`;

export interface TaskFilter {
  search?: string;
  status?: CleaningTaskStatus;
  priority?: CleaningTaskPriority;
  areaId?: string;
  floorId?: string;
  cleanableAssetId?: string;
  assetTypeId?: string;
  ruleId?: string;
  shiftId?: string;
  assignedTo?: string;
  openOnly?: boolean;
  overdueOnly?: boolean;
  unassignedOnly?: boolean;
  awaitingVerification?: boolean;
  dueFrom?: string;
  dueTo?: string;
  limit: number;
  offset: number;
}

export interface TaskInsert {
  id: string;
  ruleId: string;
  cleanableAssetId: string;
  areaId: string;
  procedureVersionId: string;
  occurrenceKey: string;
  triggerEventId: string | null;
  triggerEventType: CleaningTriggerEvent;
  taskName: string;
  priority: CleaningTaskPriority;
  estimatedMinutes: number | null;
  shiftId: string | null;
  scheduledAt: string;
  dueAt: string | null;
  status: CleaningTaskStatus;
  requiresVerification: boolean;
  verificationMethod: CleaningVerificationMethod | null;
  verifierRole: UserRole | null;
}

function taskWhere(filter: TaskFilter): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    conditions.push('ct.status = ?');
    params.push(filter.status);
  } else if (filter.openOnly === true) {
    conditions.push(OPEN_CLAUSE);
  }
  if (filter.priority !== undefined) {
    conditions.push('ct.priority = ?');
    params.push(filter.priority);
  }
  if (filter.areaId !== undefined) {
    conditions.push('ct.area_id = ?');
    params.push(filter.areaId);
  }
  if (filter.floorId !== undefined) {
    conditions.push('ar.floor_id = ?');
    params.push(filter.floorId);
  }
  if (filter.cleanableAssetId !== undefined) {
    conditions.push('ct.cleanable_asset_id = ?');
    params.push(filter.cleanableAssetId);
  }
  if (filter.assetTypeId !== undefined) {
    conditions.push('a.asset_type_id = ?');
    params.push(filter.assetTypeId);
  }
  if (filter.ruleId !== undefined) {
    conditions.push('ct.rule_id = ?');
    params.push(filter.ruleId);
  }
  if (filter.shiftId !== undefined) {
    conditions.push('ct.shift_id = ?');
    params.push(filter.shiftId);
  }
  if (filter.assignedTo !== undefined) {
    conditions.push('ct.assigned_to = ?');
    params.push(filter.assignedTo);
  }
  if (filter.unassignedOnly === true) {
    conditions.push(`ct.assigned_to IS NULL AND ${OPEN_CLAUSE}`);
  }
  if (filter.awaitingVerification === true) {
    conditions.push("ct.status IN ('VERIFICATION_REQUIRED','REVERIFICATION_REQUIRED')");
  }
  if (filter.overdueOnly === true) {
    conditions.push(`ct.due_at IS NOT NULL AND ct.due_at < UTC_TIMESTAMP(3) AND ${OPEN_CLAUSE}`);
  }
  if (filter.dueFrom !== undefined) {
    conditions.push('ct.due_at >= ?');
    params.push(filter.dueFrom);
  }
  if (filter.dueTo !== undefined) {
    conditions.push('ct.due_at <= ?');
    params.push(filter.dueTo);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(ct.task_name LIKE ? OR a.name LIKE ? OR a.code LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  return {
    where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}

export const CleaningTaskRepository = {
  async list(db: Db, filter: TaskFilter): Promise<CleaningTaskRow[]> {
    const { where, params } = taskWhere(filter);
    return selectRows<CleaningTaskRow>(
      db,
      `${TASK_SELECT} ${where}
        ORDER BY ct.priority = 'CRITICAL' DESC, ct.priority = 'HIGH' DESC,
                 ct.due_at IS NULL, ct.due_at, ct.scheduled_at
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: TaskFilter): Promise<number> {
    const { where, params } = taskWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total
         FROM cleaning_tasks ct
         JOIN cleanable_assets a ON a.id = ct.cleanable_asset_id
         LEFT JOIN equipment_areas ar ON ar.id = ct.area_id
        ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findById(db: Db, id: string): Promise<CleaningTaskRow | null> {
    return selectOne<CleaningTaskRow>(db, `${TASK_SELECT} WHERE ct.id = ?`, [id]);
  },

  /** Locks the row for a status transition, so two taps cannot both move it. */
  async findByIdForUpdate(db: Db, id: string): Promise<CleaningTaskRow | null> {
    return selectOne<CleaningTaskRow>(
      db,
      `SELECT * FROM cleaning_tasks WHERE id = ? FOR UPDATE`,
      [id],
    );
  },

  /**
   * The duplicate check the generator relies on. The unique key on
   * (rule_id, cleanable_asset_id, occurrence_key) is the real guard; this makes the common
   * case a cheap read instead of a caught error.
   */
  async findByOccurrence(
    db: Db,
    ruleId: string,
    cleanableAssetId: string,
    occurrenceKey: string,
  ): Promise<CleaningTaskRow | null> {
    return selectOne<CleaningTaskRow>(
      db,
      `SELECT * FROM cleaning_tasks
        WHERE rule_id = ? AND cleanable_asset_id = ? AND occurrence_key = ?`,
      [ruleId, cleanableAssetId, occurrenceKey],
    );
  },

  async insert(db: Db, input: TaskInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_tasks
         (id, rule_id, cleanable_asset_id, area_id, procedure_version_id, occurrence_key,
          trigger_event_id, trigger_event_type, task_name, priority, estimated_minutes,
          shift_id, scheduled_at, due_at, status, requires_verification, verification_method,
          verifier_role, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.ruleId,
        input.cleanableAssetId,
        input.areaId,
        input.procedureVersionId,
        input.occurrenceKey,
        input.triggerEventId,
        input.triggerEventType,
        input.taskName,
        input.priority,
        input.estimatedMinutes,
        input.shiftId,
        input.scheduledAt,
        input.dueAt,
        input.status,
        input.requiresVerification ? 1 : 0,
        input.verificationMethod,
        input.verifierRole,
        now,
        now,
      ],
    );
  },

  async update(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE cleaning_tasks SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async remove(db: Db, id: string): Promise<boolean> {
    const result = await mutate(db, `DELETE FROM cleaning_tasks WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },

  /* ---------------------------------------------------------- state transitions */

  async insertStateChange(
    db: Db,
    input: {
      id: string;
      taskId: string;
      fromStatus: CleaningTaskStatus | null;
      toStatus: CleaningTaskStatus;
      actorId: string | null;
      actorRole: string | null;
      source: CleaningEventSource;
      note: string | null;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO cleaning_task_state_history
         (id, task_id, from_status, to_status, actor_id, actor_role, source, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.taskId,
        input.fromStatus,
        input.toStatus,
        input.actorId,
        input.actorRole,
        input.source,
        input.note,
        toDbDateTime(),
      ],
    );
  },

  async listStateHistory(db: Db, taskId: string): Promise<CleaningTaskStateHistoryRow[]> {
    return selectRows<CleaningTaskStateHistoryRow>(
      db,
      `SELECT h.*, u.name AS actor_name
         FROM cleaning_task_state_history h
         LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.task_id = ?
        ORDER BY h.created_at, h.id`,
      [taskId],
    );
  },

  /* ------------------------------------------------------------------ assignment */

  async insertAssignment(
    db: Db,
    input: {
      id: string;
      taskId: string;
      assignedTo: string | null;
      assignedBy: string | null;
      reason: CleaningAssignmentReason;
      strategy: CleaningAssignmentStrategy | null;
      decision: string | null;
      note: string | null;
    },
  ): Promise<void> {
    // Only the newest assignment is active — the rest are the audit trail of who had it before.
    await mutate(db, `UPDATE cleaning_task_assignments SET is_active = 0 WHERE task_id = ?`, [
      input.taskId,
    ]);
    await mutate(
      db,
      `INSERT INTO cleaning_task_assignments
         (id, task_id, assigned_to, assigned_by, reason, strategy, decision, note, is_active, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`,
      [
        input.id,
        input.taskId,
        input.assignedTo,
        input.assignedBy,
        input.reason,
        input.strategy,
        input.decision,
        input.note,
        toDbDateTime(),
      ],
    );
  },

  async listAssignments(db: Db, taskId: string): Promise<CleaningTaskAssignmentRow[]> {
    return selectRows<CleaningTaskAssignmentRow>(
      db,
      `SELECT ta.*, au.name AS assigned_to_name, bu.name AS assigned_by_name
         FROM cleaning_task_assignments ta
         LEFT JOIN users au ON au.id = ta.assigned_to
         LEFT JOIN users bu ON bu.id = ta.assigned_by
        WHERE ta.task_id = ?
        ORDER BY ta.created_at DESC`,
      [taskId],
    );
  },

  /* ----------------------------------------------------------------------- steps */

  /** Snapshots the procedure version's steps onto the task, so history survives an edit. */
  async seedStepResults(
    db: Db,
    taskId: string,
    steps: ReadonlyArray<{ id: string; stepId: string; stepNumber: number }>,
  ): Promise<void> {
    if (steps.length === 0) return;
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_task_step_results
         (id, task_id, step_id, step_number, status, created_at, updated_at)
       VALUES ${steps.map(() => "(?,?,?,?,'PENDING',?,?)").join(', ')}`,
      steps.flatMap((step) => [step.id, taskId, step.stepId, step.stepNumber, now, now]),
    );
  },

  async listStepResults(db: Db, taskId: string): Promise<CleaningTaskStepResultRow[]> {
    return selectRows<CleaningTaskStepResultRow>(
      db,
      `SELECT sr.*, s.title, s.instruction, s.duration_seconds, s.is_mandatory, s.requires_photo,
              c.name AS chemical_name, t.name AS tool_name, u.name AS performed_by_name
         FROM cleaning_task_step_results sr
         JOIN cleaning_procedure_steps s ON s.id = sr.step_id
         LEFT JOIN cleaning_chemicals c ON c.id = s.chemical_id
         LEFT JOIN cleaning_tools t ON t.id = s.tool_id
         LEFT JOIN users u ON u.id = sr.performed_by
        WHERE sr.task_id = ?
        ORDER BY sr.step_number`,
      [taskId],
    );
  },

  async updateStepResult(
    db: Db,
    taskId: string,
    stepId: string,
    input: {
      status: CleaningStepStatus;
      skipReason: string | null;
      note: string | null;
      performedBy: string | null;
    },
  ): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE cleaning_task_step_results
          SET status = ?, skip_reason = ?, note = ?, performed_by = ?, performed_at = ?, updated_at = ?
        WHERE task_id = ? AND step_id = ?`,
      [
        input.status,
        input.skipReason,
        input.note,
        input.performedBy,
        input.status === 'PENDING' ? null : now,
        now,
        taskId,
        stepId,
      ],
    );
    return result.affectedRows > 0;
  },

  /** Mandatory steps still PENDING. Completion is refused while this is non-empty. */
  async listOutstandingMandatorySteps(
    db: Db,
    taskId: string,
  ): Promise<CleaningTaskStepResultRow[]> {
    return selectRows<CleaningTaskStepResultRow>(
      db,
      `SELECT sr.*, s.title, s.is_mandatory, s.requires_photo
         FROM cleaning_task_step_results sr
         JOIN cleaning_procedure_steps s ON s.id = sr.step_id
        WHERE sr.task_id = ? AND sr.status = 'PENDING' AND s.is_mandatory = 1
        ORDER BY sr.step_number`,
      [taskId],
    );
  },

  /** Steps that demand a photo and do not have one bound to them yet. */
  async listStepsMissingPhotos(db: Db, taskId: string): Promise<CleaningTaskStepResultRow[]> {
    return selectRows<CleaningTaskStepResultRow>(
      db,
      `SELECT sr.*, s.title, s.is_mandatory, s.requires_photo
         FROM cleaning_task_step_results sr
         JOIN cleaning_procedure_steps s ON s.id = sr.step_id
        WHERE sr.task_id = ? AND s.requires_photo = 1 AND sr.status = 'DONE'
          AND NOT EXISTS (SELECT 1 FROM cleaning_task_evidence ev
                           WHERE ev.task_id = sr.task_id AND ev.step_id = sr.step_id
                             AND ev.deleted_at IS NULL)
        ORDER BY sr.step_number`,
      [taskId],
    );
  },

  /* -------------------------------------------------------------------- evidence */

  async insertEvidence(
    db: Db,
    input: {
      id: string;
      taskId: string;
      mediaId: string;
      kind: CleaningEvidenceKind;
      stepId: string | null;
      caption: string | null;
      uploadedBy: string;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO cleaning_task_evidence
         (id, task_id, media_id, kind, step_id, caption, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.taskId,
        input.mediaId,
        input.kind,
        input.stepId,
        input.caption,
        input.uploadedBy,
        toDbDateTime(),
      ],
    );
  },

  async listEvidence(db: Db, taskId: string): Promise<CleaningTaskEvidenceRow[]> {
    return selectRows<CleaningTaskEvidenceRow>(
      db,
      `SELECT ev.*, u.name AS uploaded_by_name
         FROM cleaning_task_evidence ev
         LEFT JOIN users u ON u.id = ev.uploaded_by
        WHERE ev.task_id = ? AND ev.deleted_at IS NULL
        ORDER BY ev.created_at`,
      [taskId],
    );
  },

  async countEvidence(db: Db, taskId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_task_evidence
        WHERE task_id = ? AND deleted_at IS NULL`,
      [taskId],
    );
    return Number(row?.total ?? 0);
  },

  async softDeleteEvidence(db: Db, id: string): Promise<boolean> {
    const result = await mutate(
      db,
      `UPDATE cleaning_task_evidence SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  /* --------------------------------------------------------------- verifications */

  async nextVerificationAttempt(db: Db, taskId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(attempt), 0) AS total FROM cleaning_verifications
        WHERE task_id = ? FOR UPDATE`,
      [taskId],
    );
    return Number(row?.total ?? 0) + 1;
  },

  async insertVerification(
    db: Db,
    input: {
      id: string;
      taskId: string;
      attempt: number;
      method: CleaningVerificationMethod;
      outcome: CleaningVerificationOutcome;
      standardId: string | null;
      verifiedBy: string;
      failureReason: string | null;
      note: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_verifications
         (id, task_id, attempt, method, outcome, standard_id, verified_by, verified_at,
          failure_reason, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.taskId,
        input.attempt,
        input.method,
        input.outcome,
        input.standardId,
        input.verifiedBy,
        now,
        input.failureReason,
        input.note,
        now,
      ],
    );
  },

  async insertVerificationResults(
    db: Db,
    verificationId: string,
    rows: ReadonlyArray<{
      id: string;
      label: string;
      passed: boolean | null;
      measuredValue: number | null;
      measureUnit: string | null;
      expectedMin: number | null;
      expectedMax: number | null;
      note: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_verification_results
         (id, verification_id, label, passed, measured_value, measure_unit,
          expected_min, expected_max, note, created_at)
       VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(', ')}`,
      rows.flatMap((row) => [
        row.id,
        verificationId,
        row.label,
        row.passed === null ? null : row.passed ? 1 : 0,
        row.measuredValue,
        row.measureUnit,
        row.expectedMin,
        row.expectedMax,
        row.note,
        now,
      ]),
    );
  },

  async listVerifications(db: Db, taskId: string): Promise<CleaningVerificationRow[]> {
    return selectRows<CleaningVerificationRow>(
      db,
      `SELECT v.*, s.name AS standard_name, u.name AS verified_by_name
         FROM cleaning_verifications v
         LEFT JOIN cleaning_standards s ON s.id = v.standard_id
         LEFT JOIN users u ON u.id = v.verified_by
        WHERE v.task_id = ?
        ORDER BY v.attempt`,
      [taskId],
    );
  },

  async listVerificationResults(
    db: Db,
    verificationIds: readonly string[],
  ): Promise<CleaningVerificationResultRow[]> {
    if (verificationIds.length === 0) return [];
    return selectRows<CleaningVerificationResultRow>(
      db,
      `SELECT * FROM cleaning_verification_results
        WHERE verification_id IN (${verificationIds.map(() => '?').join(',')})
        ORDER BY label`,
      [...verificationIds],
    );
  },

  /* ----------------------------------------------------------- corrective actions */

  async insertCorrectiveAction(
    db: Db,
    input: {
      id: string;
      taskId: string;
      verificationId: string | null;
      cleanableAssetId: string;
      areaId: string;
      failureSummary: string;
      immediateAction: string | null;
      assignedTo: string | null;
      dueAt: string | null;
      raisedBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_corrective_actions
         (id, task_id, verification_id, cleanable_asset_id, area_id, failure_summary,
          immediate_action, assigned_to, due_at, status, requires_verification, raised_by,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'OPEN',1,?,?,?)`,
      [
        input.id,
        input.taskId,
        input.verificationId,
        input.cleanableAssetId,
        input.areaId,
        input.failureSummary,
        input.immediateAction,
        input.assignedTo,
        input.dueAt,
        input.raisedBy,
        now,
        now,
      ],
    );
  },

  async listCorrectiveActions(
    db: Db,
    filter: {
      taskId?: string;
      status?: CorrectiveActionStatus;
      areaId?: string;
      assignedTo?: string;
      openOnly?: boolean;
      overdueOnly?: boolean;
      limit: number;
      offset: number;
    },
  ): Promise<CleaningCorrectiveActionRow[]> {
    const { where, params } = correctiveWhere(filter);
    return selectRows<CleaningCorrectiveActionRow>(
      db,
      `SELECT ca.*, ct.task_name, a.name AS cleanable_asset_name, ar.name AS area_name,
              au.name AS assigned_to_name, ru.name AS raised_by_name, cu.name AS closed_by_name
         FROM cleaning_corrective_actions ca
         JOIN cleaning_tasks ct ON ct.id = ca.task_id
         JOIN cleanable_assets a ON a.id = ca.cleanable_asset_id
         LEFT JOIN equipment_areas ar ON ar.id = ca.area_id
         LEFT JOIN users au ON au.id = ca.assigned_to
         LEFT JOIN users ru ON ru.id = ca.raised_by
         LEFT JOIN users cu ON cu.id = ca.closed_by
        ${where}
        ORDER BY ca.due_at IS NULL, ca.due_at, ca.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async countCorrectiveActions(
    db: Db,
    filter: {
      taskId?: string;
      status?: CorrectiveActionStatus;
      areaId?: string;
      assignedTo?: string;
      openOnly?: boolean;
      overdueOnly?: boolean;
    },
  ): Promise<number> {
    const { where, params } = correctiveWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_corrective_actions ca ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findCorrectiveAction(db: Db, id: string): Promise<CleaningCorrectiveActionRow | null> {
    return selectOne<CleaningCorrectiveActionRow>(
      db,
      `SELECT ca.*, ct.task_name, a.name AS cleanable_asset_name, ar.name AS area_name,
              au.name AS assigned_to_name, ru.name AS raised_by_name, cu.name AS closed_by_name
         FROM cleaning_corrective_actions ca
         JOIN cleaning_tasks ct ON ct.id = ca.task_id
         JOIN cleanable_assets a ON a.id = ca.cleanable_asset_id
         LEFT JOIN equipment_areas ar ON ar.id = ca.area_id
         LEFT JOIN users au ON au.id = ca.assigned_to
         LEFT JOIN users ru ON ru.id = ca.raised_by
         LEFT JOIN users cu ON cu.id = ca.closed_by
        WHERE ca.id = ?`,
      [id],
    );
  },

  async updateCorrectiveAction(
    db: Db,
    id: string,
    assignments: string[],
    params: unknown[],
  ): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE cleaning_corrective_actions SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  /* ------------------------------------------------------- dashboard aggregates */

  /**
   * `dueToday` is bucketed against the **local** day, passed in as a UTC window rather than
   * compared with `UTC_DATE()`. The DB session runs in UTC, so a raw `UTC_DATE()` comparison
   * would call an 02:00 IST deadline "yesterday" and quietly drop it off the dashboard.
   */
  async counts(db: Db): Promise<CleaningCountsRow | null> {
    const { from, to } = localDayWindow();
    return selectOne<CleaningCountsRow>(
      db,
      `SELECT
         SUM(ct.status NOT IN ('CLOSED','CANCELLED')) AS open_tasks,
         SUM(ct.status NOT IN ('CLOSED','CANCELLED')
             AND ct.due_at IS NOT NULL AND ct.due_at < UTC_TIMESTAMP(3)) AS overdue_tasks,
         SUM(ct.status NOT IN ('CLOSED','CANCELLED') AND ct.assigned_to IS NULL) AS unassigned_tasks,
         SUM(ct.status NOT IN ('CLOSED','CANCELLED')
             AND ct.due_at >= ? AND ct.due_at <= ?) AS due_today,
         SUM(ct.status = 'STARTED') AS in_progress,
         SUM(ct.status IN ('VERIFICATION_REQUIRED','REVERIFICATION_REQUIRED')) AS awaiting_verification,
         SUM(ct.status = 'FAILED') AS failed_verifications,
         SUM(ct.status = 'RECLEAN_REQUIRED') AS reclean_required
       FROM cleaning_tasks ct`,
      [from, to],
    );
  },

  async byArea(db: Db, sinceDays: number): Promise<AreaCleaningStatusRow[]> {
    const { from, to } = localDayWindow();
    return selectRows<AreaCleaningStatusRow>(
      db,
      `SELECT ar.id AS area_id, ar.name AS area_name, f.name AS floor_name,
              COALESCE(SUM(ct.status NOT IN ('CLOSED','CANCELLED')), 0) AS open_tasks,
              COALESCE(SUM(ct.status NOT IN ('CLOSED','CANCELLED')
                  AND ct.due_at IS NOT NULL AND ct.due_at < UTC_TIMESTAMP(3)), 0) AS overdue_tasks,
              COALESCE(SUM(ct.status NOT IN ('CLOSED','CANCELLED')
                  AND ct.due_at >= ? AND ct.due_at <= ?), 0) AS due_today,
              (SELECT COUNT(*) FROM cleanable_assets a
                WHERE a.area_id = ar.id AND a.deleted_at IS NULL AND a.status = 'ACTIVE') AS asset_count,
              COALESCE(SUM(ct.due_at IS NOT NULL
                  AND ct.due_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)
                  AND ct.completed_at IS NOT NULL AND ct.completed_at <= ct.due_at), 0) AS closed_on_time,
              COALESCE(SUM(ct.due_at IS NOT NULL
                  AND ct.due_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)
                  AND ct.due_at <= UTC_TIMESTAMP(3)), 0) AS fell_due
         FROM equipment_areas ar
         LEFT JOIN equipment_floors f ON f.id = ar.floor_id
         LEFT JOIN cleaning_tasks ct ON ct.area_id = ar.id
        WHERE ar.deleted_at IS NULL AND ar.status = 'ACTIVE'
        GROUP BY ar.id, ar.name, f.name
        ORDER BY overdue_tasks DESC, ar.name`,
      [from, to, sinceDays, sinceDays],
    );
  },

  /** Rolling-window compliance: how many fell due, and how many were finished before they did. */
  async complianceWindow(
    db: Db,
    days: number,
  ): Promise<{ fellDue: number; onTime: number; verified: number; failed: number }> {
    const row = await selectOne<CleaningWindowRow>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM cleaning_tasks ct
           WHERE ct.due_at IS NOT NULL AND ct.due_at <= UTC_TIMESTAMP(3)
             AND ct.due_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)) AS fell_due,
         (SELECT COUNT(*) FROM cleaning_tasks ct
           WHERE ct.due_at IS NOT NULL AND ct.due_at <= UTC_TIMESTAMP(3)
             AND ct.due_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)
             AND ct.completed_at IS NOT NULL AND ct.completed_at <= ct.due_at) AS on_time,
         (SELECT COUNT(*) FROM cleaning_verifications v
           WHERE v.outcome = 'PASS'
             AND v.verified_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)) AS verified,
         (SELECT COUNT(*) FROM cleaning_verifications v
           WHERE v.outcome = 'FAIL'
             AND v.verified_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY)) AS failed`,
      [days, days, days, days],
    );
    return {
      fellDue: Number(row?.fell_due ?? 0),
      onTime: Number(row?.on_time ?? 0),
      verified: Number(row?.verified ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  },

  async countOpenForUser(db: Db, userId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_tasks ct
        WHERE ct.assigned_to = ? AND ${OPEN_CLAUSE}`,
      [userId],
    );
    return Number(row?.total ?? 0);
  },

  /** Open tasks whose due moment has passed and which nobody has been reminded about yet. */
  async listNewlyOverdue(db: Db, graceMinutes: number): Promise<CleaningTaskRow[]> {
    return selectRows<CleaningTaskRow>(
      db,
      `${TASK_SELECT}
        WHERE ${OPEN_CLAUSE}
          AND ct.due_at IS NOT NULL
          AND ct.due_at < UTC_TIMESTAMP(3)
          AND ct.due_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
        ORDER BY ct.due_at`,
      [graceMinutes],
    );
  },

  async listUnassignedOpen(db: Db, limit: number): Promise<CleaningTaskRow[]> {
    return selectRows<CleaningTaskRow>(
      db,
      `${TASK_SELECT}
        WHERE ${OPEN_CLAUSE} AND ct.assigned_to IS NULL
        ORDER BY ct.priority = 'CRITICAL' DESC, ct.due_at IS NULL, ct.due_at
        LIMIT ?`,
      [limit],
    );
  },
};

/**
 * Today, as the operator's clock sees it, expressed as the UTC instants that bracket it.
 *
 * Wall-clock reasoning in this module is local (see `CleaningEngineService`'s header); stored
 * instants are UTC. This is the one place the two meet.
 */
function localDayWindow(at: Date = new Date()): { from: string; to: string } {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59, 999);
  return { from: toDbDateTime(start), to: toDbDateTime(end) };
}

function correctiveWhere(filter: {
  taskId?: string;
  status?: CorrectiveActionStatus;
  areaId?: string;
  assignedTo?: string;
  openOnly?: boolean;
  overdueOnly?: boolean;
}): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.taskId !== undefined) {
    conditions.push('ca.task_id = ?');
    params.push(filter.taskId);
  }
  if (filter.status !== undefined) {
    conditions.push('ca.status = ?');
    params.push(filter.status);
  } else if (filter.openOnly === true) {
    conditions.push("ca.status NOT IN ('CLOSED','CANCELLED')");
  }
  if (filter.areaId !== undefined) {
    conditions.push('ca.area_id = ?');
    params.push(filter.areaId);
  }
  if (filter.assignedTo !== undefined) {
    conditions.push('ca.assigned_to = ?');
    params.push(filter.assignedTo);
  }
  if (filter.overdueOnly === true) {
    conditions.push(
      "ca.status NOT IN ('CLOSED','CANCELLED') AND ca.due_at IS NOT NULL AND ca.due_at < UTC_TIMESTAMP(3)",
    );
  }
  return {
    where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`,
    params,
  };
}
