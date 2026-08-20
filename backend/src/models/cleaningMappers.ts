import {
  CLEANING_TASK_OPEN_STATUSES,
  CleaningTaskStatus,
  type AreaCleaningStatusDto,
  type CleanableAssetDto,
  type CleanableAssetTypeDto,
  type CleaningAssignmentRuleDto,
  type CleaningChemicalDto,
  type CleaningComplianceRowDto,
  type CleaningCorrectiveActionDto,
  type CleaningEventDto,
  type CleaningMethodDto,
  type CleaningProcedureChemicalDto,
  type CleaningProcedureDto,
  type CleaningProcedureStepDto,
  type CleaningProcedureToolDto,
  type CleaningProcedureVersionDto,
  type CleaningRuleDto,
  type CleaningRuleSkillDto,
  type CleaningStandardDto,
  type CleaningTaskAssignmentDto,
  type CleaningTaskDto,
  type CleaningTaskEvidenceDto,
  type CleaningTaskStateChangeDto,
  type CleaningTaskStepResultDto,
  type CleaningToolDto,
  type CleaningTriggerEvent,
  type CleaningVerificationDto,
  type CleaningVerificationResultDto,
  type ShiftDto,
  type SkillDto,
  type UserAreaResponsibilityDto,
  type UserShiftAssignmentDto,
  type UserSkillDto,
} from '@menuboard/shared';
import type {
  AreaCleaningStatusRow,
  CleanableAssetRow,
  CleanableAssetTypeRow,
  CleaningAssignmentRuleRow,
  CleaningChemicalRow,
  CleaningComplianceRow,
  CleaningCorrectiveActionRow,
  CleaningEventRow,
  CleaningMethodRow,
  CleaningProcedureChemicalRow,
  CleaningProcedureRow,
  CleaningProcedureStepRow,
  CleaningProcedureToolRow,
  CleaningProcedureVersionRow,
  CleaningRuleRow,
  CleaningRuleSkillRow,
  CleaningStandardRow,
  CleaningTaskAssignmentRow,
  CleaningTaskEvidenceRow,
  CleaningTaskRow,
  CleaningTaskStateHistoryRow,
  CleaningTaskStepResultRow,
  CleaningToolRow,
  CleaningVerificationResultRow,
  CleaningVerificationRow,
  ShiftRow,
  SkillRow,
  UserAreaResponsibilityRow,
  UserShiftAssignmentRow,
  UserSkillRow,
} from './cleaningRows';
import { locationPathOf } from './equipmentMappers';
import { parseJsonColumn } from '../utils/json';
import { fromDbDate, fromDbDateTime, fromDbDateTimeRequired, fromDbTime } from '../utils/time';
import { signMenuMediaUrl } from '../utils/mediaStorage';

/**
 * Row → DTO for Cleaning & Hygiene.
 *
 * Same two rules as the equipment mappers, for the same reasons:
 *
 *  - **Signed media URLs are minted per response**, so every mapper that returns a file takes
 *    the viewing user's id. A stored URL is a URL that stops working.
 *  - **Derived state is computed, never read.** Overdue-ness, "is this still open", expiry and
 *    the per-viewer action flags come from status and the clock on every read, so a row can
 *    never sit in the database claiming a task is on time three days after it lapsed.
 */

function bool(value: number | null | undefined): boolean {
  return value === 1;
}

/** A JSON column that is genuinely optional: absent stays null rather than becoming `{}`. */
function jsonOrNull(value: unknown): Record<string, unknown> | null {
  return parseJsonColumn<Record<string, unknown> | null>(value, null);
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whole minutes from `value` to now. Negative while the moment is still in the future. */
function minutesSince(value: string | null, now = Date.now()): number | null {
  if (value === null) return null;
  const iso = fromDbDateTime(value);
  if (iso === null) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.floor((now - at) / 60_000);
}

/* ==================================================================== masters */

export function mapCleanableAssetType(row: CleanableAssetTypeRow): CleanableAssetTypeDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    defaultRiskLevel: row.default_risk_level,
    defaultFoodContact: row.default_food_contact,
    sortOrder: Number(row.sort_order),
    status: row.status,
    ...(row.asset_count !== undefined ? { assetCount: Number(row.asset_count) } : {}),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapCleaningMethod(row: CleaningMethodRow): CleaningMethodDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapCleaningStandard(row: CleaningStandardRow): CleaningStandardDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    acceptanceText: row.acceptance_text,
    measureUnit: row.measure_unit,
    minValue: numberOrNull(row.min_value),
    maxValue: numberOrNull(row.max_value),
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapCleaningChemical(row: CleaningChemicalRow, userId: string): CleaningChemicalDto {
  const expiry = fromDbDate(row.expiry_date);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    chemicalKind: row.chemical_kind,
    supplierName: row.supplier_name,
    supplierEntityId: row.supplier_entity_id,
    purpose: row.purpose,
    dilutionRatio: row.dilution_ratio,
    concentrationPpm: numberOrNull(row.concentration_ppm),
    contactTimeSeconds: numberOrNull(row.contact_time_seconds),
    applicationMethod: row.application_method,
    storageRequirement: row.storage_requirement,
    safetyInformation: row.safety_information,
    expiryDate: expiry,
    safetySheetMediaId: row.safety_sheet_media_id,
    safetySheetUrl:
      row.safety_sheet_media_id === null
        ? null
        : signMenuMediaUrl(row.safety_sheet_media_id, userId),
    status: row.status,
    isExpired: expiry !== null && expiry < new Date().toISOString().slice(0, 10),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapCleaningTool(row: CleaningToolRow): CleaningToolDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    toolKind: row.tool_kind,
    colourCode: row.colour_code,
    description: row.description,
    storageLocation: row.storage_location,
    restrictedAreaId: row.restricted_area_id,
    ...(row.restricted_area_name !== undefined
      ? { restrictedAreaName: row.restricted_area_name }
      : {}),
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/* ============================================================ cleanable assets */

export function mapCleanableAsset(row: CleanableAssetRow, userId: string): CleanableAssetDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    assetTypeId: row.asset_type_id,
    ...(row.asset_type_name !== undefined ? { assetTypeName: row.asset_type_name } : {}),
    areaId: row.area_id,
    ...(row.area_name !== undefined ? { areaName: row.area_name } : {}),
    ...(row.floor_id !== undefined ? { floorId: row.floor_id } : {}),
    ...(row.floor_name !== undefined ? { floorName: row.floor_name } : {}),
    locationId: row.location_id,
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    locationPath: locationPathOf({
      floor_name: row.floor_name ?? null,
      area_name: row.area_name ?? null,
      location_name: row.location_name ?? null,
      room: row.room ?? null,
      section: row.section ?? null,
      position: row.position ?? null,
    }),
    equipmentId: row.equipment_id,
    ...(row.equipment_asset_id !== undefined ? { equipmentAssetId: row.equipment_asset_id } : {}),
    ...(row.equipment_name !== undefined ? { equipmentName: row.equipment_name } : {}),
    description: row.description,
    positionNote: row.position_note,
    riskLevel: row.risk_level,
    foodContact: row.food_contact,
    isAvailable: bool(row.is_available),
    unavailableReason: row.unavailable_reason,
    imageMediaId: row.image_media_id,
    imageUrl: row.image_media_id === null ? null : signMenuMediaUrl(row.image_media_id, userId),
    notes: row.notes,
    status: row.status,
    ...(row.open_task_count !== undefined ? { openTaskCount: Number(row.open_task_count) } : {}),
    ...(row.overdue_task_count !== undefined
      ? { overdueTaskCount: Number(row.overdue_task_count) }
      : {}),
    ...(row.rule_count !== undefined ? { ruleCount: Number(row.rule_count) } : {}),
    ...(row.last_cleaned_at !== undefined
      ? { lastCleanedAt: fromDbDateTime(row.last_cleaned_at) }
      : {}),
    ...(row.last_cleaned_by_name !== undefined
      ? { lastCleanedByName: row.last_cleaned_by_name }
      : {}),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/* ================================================================= procedures */

export function mapCleaningProcedureStep(row: CleaningProcedureStepRow): CleaningProcedureStepDto {
  return {
    id: row.id,
    versionId: row.version_id,
    stepNumber: Number(row.step_number),
    title: row.title,
    instruction: row.instruction,
    chemicalId: row.chemical_id,
    ...(row.chemical_name !== undefined ? { chemicalName: row.chemical_name } : {}),
    toolId: row.tool_id,
    ...(row.tool_name !== undefined ? { toolName: row.tool_name } : {}),
    durationSeconds: numberOrNull(row.duration_seconds),
    isMandatory: bool(row.is_mandatory),
    requiresPhoto: bool(row.requires_photo),
  };
}

export function mapCleaningProcedureChemical(
  row: CleaningProcedureChemicalRow,
): CleaningProcedureChemicalDto {
  return {
    chemicalId: row.chemical_id,
    chemicalName: row.chemical_name ?? '',
    chemicalKind: row.chemical_kind ?? 'OTHER',
    concentrationPpm: numberOrNull(row.concentration_ppm),
    dilutionRatio: row.dilution_ratio,
    contactTimeSeconds: numberOrNull(row.contact_time_seconds),
    note: row.note,
  };
}

export function mapCleaningProcedureTool(row: CleaningProcedureToolRow): CleaningProcedureToolDto {
  return {
    toolId: row.tool_id,
    toolName: row.tool_name ?? '',
    toolKind: row.tool_kind ?? 'OTHER',
    colourCode: row.colour_code ?? null,
    note: row.note,
  };
}

export function mapCleaningProcedureVersion(
  row: CleaningProcedureVersionRow,
  parts: {
    steps?: CleaningProcedureStepRow[];
    chemicals?: CleaningProcedureChemicalRow[];
    tools?: CleaningProcedureToolRow[];
  } = {},
): CleaningProcedureVersionDto {
  return {
    id: row.id,
    procedureId: row.procedure_id,
    ...(row.procedure_name !== undefined ? { procedureName: row.procedure_name } : {}),
    ...(row.procedure_code !== undefined ? { procedureCode: row.procedure_code } : {}),
    version: Number(row.version),
    status: row.status,
    methodId: row.method_id,
    ...(row.method_name !== undefined ? { methodName: row.method_name } : {}),
    standardId: row.standard_id,
    ...(row.standard_name !== undefined ? { standardName: row.standard_name } : {}),
    ...(row.standard_acceptance_text !== undefined
      ? { standardAcceptanceText: row.standard_acceptance_text }
      : {}),
    publishedAt: fromDbDateTime(row.published_at),
    ...(row.published_by_name !== undefined ? { publishedByName: row.published_by_name } : {}),
    archivedAt: fromDbDateTime(row.archived_at),
    changeNote: row.change_note,
    ppeRequired: row.ppe_required,
    requiresDisassembly: bool(row.requires_disassembly),
    requiresRinse: bool(row.requires_rinse),
    requiresFinalRinse: bool(row.requires_final_rinse),
    requiresDrying: bool(row.requires_drying),
    contactTimeSeconds: numberOrNull(row.contact_time_seconds),
    estimatedMinutes: numberOrNull(row.estimated_minutes),
    safetyNotes: row.safety_notes,
    steps: (parts.steps ?? []).map(mapCleaningProcedureStep),
    chemicals: (parts.chemicals ?? []).map(mapCleaningProcedureChemical),
    tools: (parts.tools ?? []).map(mapCleaningProcedureTool),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapCleaningProcedure(row: CleaningProcedureRow): CleaningProcedureDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    currentVersion: numberOrNull(row.current_version ?? null),
    status: row.status,
    ...(row.version_count !== undefined ? { versionCount: Number(row.version_count) } : {}),
    ...(row.rule_count !== undefined ? { ruleCount: Number(row.rule_count) } : {}),
    ...(row.draft_count !== undefined ? { hasDraft: Number(row.draft_count) > 0 } : {}),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/* ====================================================================== rules */

export function mapCleaningRuleSkill(row: CleaningRuleSkillRow): CleaningRuleSkillDto {
  return {
    skillId: row.skill_id,
    skillName: row.skill_name ?? '',
    requiredLevel: row.required_level,
  };
}

/** GROUP_CONCAT returns 'a,b,c' or null; never an empty entry. */
function splitConcat(value: string | null | undefined): string[] {
  if (value === null || value === undefined || value === '') return [];
  return value.split(',').filter((entry) => entry !== '');
}

export function mapCleaningRule(
  row: CleaningRuleRow,
  skills: CleaningRuleSkillRow[] = [],
): CleaningRuleDto {
  return {
    id: row.id,
    code: row.code,
    taskName: row.task_name,
    purpose: row.purpose,
    scope: row.scope,
    cleanableAssetId: row.cleanable_asset_id,
    ...(row.cleanable_asset_name !== undefined
      ? { cleanableAssetName: row.cleanable_asset_name }
      : {}),
    assetTypeId: row.asset_type_id,
    ...(row.asset_type_name !== undefined ? { assetTypeName: row.asset_type_name } : {}),
    areaId: row.area_id,
    ...(row.area_name !== undefined ? { areaName: row.area_name } : {}),
    procedureId: row.procedure_id,
    ...(row.procedure_name !== undefined ? { procedureName: row.procedure_name } : {}),
    ...(row.procedure_code !== undefined ? { procedureCode: row.procedure_code } : {}),
    ...(row.published_version_id !== undefined
      ? { publishedVersionId: row.published_version_id }
      : {}),
    frequencyKind: row.frequency_kind,
    intervalDays: numberOrNull(row.interval_days),
    dayOfWeek: numberOrNull(row.day_of_week),
    dayOfMonth: numberOrNull(row.day_of_month),
    shiftId: row.shift_id,
    ...(row.shift_name !== undefined ? { shiftName: row.shift_name } : {}),
    dueTime: fromDbTime(row.due_time),
    dueWithinMinutes: numberOrNull(row.due_within_minutes),
    triggers: splitConcat(row.trigger_events) as CleaningTriggerEvent[],
    requiredSkills: skills.map(mapCleaningRuleSkill),
    responsibleRole: row.responsible_role,
    estimatedMinutes: numberOrNull(row.estimated_minutes),
    priority: row.priority,
    requiresVerification: bool(row.requires_verification),
    verificationMethod: row.verification_method,
    verifierRole: row.verifier_role,
    standardId: row.standard_id,
    ...(row.standard_name !== undefined ? { standardName: row.standard_name } : {}),
    isActive: bool(row.is_active),
    ...(row.target_asset_count !== undefined
      ? { targetAssetCount: Number(row.target_asset_count) }
      : {}),
    ...(row.open_task_count !== undefined ? { openTaskCount: Number(row.open_task_count) } : {}),
    ...(row.last_generated_at !== undefined
      ? { lastGeneratedAt: fromDbDateTime(row.last_generated_at) }
      : {}),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/* ====================================================================== tasks */

export function mapCleaningTaskStepResult(
  row: CleaningTaskStepResultRow,
): CleaningTaskStepResultDto {
  return {
    id: row.id,
    taskId: row.task_id,
    stepId: row.step_id,
    stepNumber: Number(row.step_number),
    title: row.title ?? '',
    instruction: row.instruction ?? null,
    chemicalName: row.chemical_name ?? null,
    toolName: row.tool_name ?? null,
    durationSeconds: numberOrNull(row.duration_seconds ?? null),
    isMandatory: bool(row.is_mandatory),
    requiresPhoto: bool(row.requires_photo),
    status: row.status,
    skipReason: row.skip_reason,
    note: row.note,
    performedByName: row.performed_by_name ?? null,
    performedAt: fromDbDateTime(row.performed_at),
  };
}

export function mapCleaningTaskEvidence(
  row: CleaningTaskEvidenceRow,
  userId: string,
): CleaningTaskEvidenceDto {
  return {
    id: row.id,
    taskId: row.task_id,
    mediaId: row.media_id,
    url: signMenuMediaUrl(row.media_id, userId),
    kind: row.kind,
    stepId: row.step_id,
    caption: row.caption,
    uploadedById: row.uploaded_by,
    uploadedByName: row.uploaded_by_name ?? null,
    createdAt: fromDbDateTimeRequired(row.created_at),
  };
}

export function mapCleaningVerificationResult(
  row: CleaningVerificationResultRow,
): CleaningVerificationResultDto {
  return {
    id: row.id,
    verificationId: row.verification_id,
    label: row.label,
    passed: row.passed === null ? null : row.passed === 1,
    measuredValue: numberOrNull(row.measured_value),
    measureUnit: row.measure_unit,
    expectedMin: numberOrNull(row.expected_min),
    expectedMax: numberOrNull(row.expected_max),
    note: row.note,
  };
}

export function mapCleaningVerification(
  row: CleaningVerificationRow,
  results: CleaningVerificationResultRow[] = [],
): CleaningVerificationDto {
  return {
    id: row.id,
    taskId: row.task_id,
    attempt: Number(row.attempt),
    method: row.method,
    outcome: row.outcome,
    standardId: row.standard_id,
    standardName: row.standard_name ?? null,
    verifiedById: row.verified_by,
    verifiedByName: row.verified_by_name ?? null,
    verifiedAt: fromDbDateTimeRequired(row.verified_at),
    failureReason: row.failure_reason,
    note: row.note,
    results: results.map(mapCleaningVerificationResult),
  };
}

export function mapCleaningTaskAssignment(
  row: CleaningTaskAssignmentRow,
): CleaningTaskAssignmentDto {
  return {
    id: row.id,
    taskId: row.task_id,
    assignedToId: row.assigned_to,
    assignedToName: row.assigned_to_name ?? null,
    assignedById: row.assigned_by,
    assignedByName: row.assigned_by_name ?? null,
    reason: row.reason,
    strategy: row.strategy,
    decision: jsonOrNull(row.decision),
    note: row.note,
    isActive: bool(row.is_active),
    createdAt: fromDbDateTimeRequired(row.created_at),
  };
}

export function mapCleaningTaskStateChange(
  row: CleaningTaskStateHistoryRow,
): CleaningTaskStateChangeDto {
  return {
    id: row.id,
    taskId: row.task_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    actorName: row.actor_name ?? null,
    actorRole: row.actor_role,
    source: row.source,
    note: row.note,
    createdAt: fromDbDateTimeRequired(row.created_at),
  };
}

export function mapCleaningCorrectiveAction(
  row: CleaningCorrectiveActionRow,
): CleaningCorrectiveActionDto {
  const open =
    row.status !== 'CLOSED' && row.status !== 'CANCELLED';
  const overdueMinutes = minutesSince(row.due_at);
  return {
    id: row.id,
    taskId: row.task_id,
    ...(row.task_name !== undefined ? { taskName: row.task_name } : {}),
    verificationId: row.verification_id,
    cleanableAssetId: row.cleanable_asset_id,
    ...(row.cleanable_asset_name !== undefined
      ? { cleanableAssetName: row.cleanable_asset_name }
      : {}),
    areaId: row.area_id,
    ...(row.area_name !== undefined ? { areaName: row.area_name } : {}),
    failureSummary: row.failure_summary,
    immediateAction: row.immediate_action,
    rootCause: row.root_cause,
    correctiveAction: row.corrective_action,
    preventiveAction: row.preventive_action,
    assignedToId: row.assigned_to,
    assignedToName: row.assigned_to_name ?? null,
    dueAt: fromDbDateTime(row.due_at),
    status: row.status,
    requiresVerification: bool(row.requires_verification),
    raisedById: row.raised_by,
    raisedByName: row.raised_by_name ?? null,
    closedById: row.closed_by,
    closedByName: row.closed_by_name ?? null,
    closedAt: fromDbDateTime(row.closed_at),
    closureNote: row.closure_note,
    isOverdue: open && overdueMinutes !== null && overdueMinutes > 0,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/**
 * The viewer-dependent part of a task.
 *
 * Passed in rather than computed here because deciding whether *this* person may verify needs
 * their capabilities, which the mapper has no business knowing. Absent on reads that carry no
 * viewer context, which is exactly what the DTO's optional flags mean.
 */
export interface CleaningTaskViewerContext {
  userId: string;
  canWork: boolean;
  canVerify: boolean;
  canAssign: boolean;
}

export function mapCleaningTask(
  row: CleaningTaskRow,
  viewer?: CleaningTaskViewerContext,
): CleaningTaskDto {
  const isOpen = CLEANING_TASK_OPEN_STATUSES.includes(row.status);
  const overdueMinutes = minutesSince(row.due_at);
  const isOverdue =
    isOpen &&
    row.status !== CleaningTaskStatus.CLOSED &&
    overdueMinutes !== null &&
    overdueMinutes > 0;

  const mine = viewer !== undefined && row.assigned_to === viewer.userId;
  // Working a task is the assignee's job; a supervisor who can reassign can also finish it.
  const mayWork = viewer !== undefined && viewer.canWork && (mine || viewer.canAssign);
  // Nobody signs off their own clean — that is the whole reason verification exists.
  const mayVerify =
    viewer !== undefined && viewer.canVerify && row.completed_by !== viewer.userId;

  const dto: CleaningTaskDto = {
    id: row.id,
    ruleId: row.rule_id,
    ...(row.rule_code !== undefined ? { ruleCode: row.rule_code } : {}),
    taskName: row.task_name,
    cleanableAssetId: row.cleanable_asset_id,
    ...(row.cleanable_asset_code !== undefined
      ? { cleanableAssetCode: row.cleanable_asset_code }
      : {}),
    ...(row.cleanable_asset_name !== undefined
      ? { cleanableAssetName: row.cleanable_asset_name }
      : {}),
    ...(row.asset_type_name !== undefined ? { assetTypeName: row.asset_type_name } : {}),
    ...(row.risk_level !== undefined ? { riskLevel: row.risk_level } : {}),
    ...(row.food_contact !== undefined ? { foodContact: row.food_contact } : {}),
    areaId: row.area_id,
    ...(row.area_name !== undefined ? { areaName: row.area_name } : {}),
    locationPath: locationPathOf({
      floor_name: row.floor_name ?? null,
      area_name: row.area_name ?? null,
      location_name: row.location_name ?? null,
      room: row.room ?? null,
      section: row.section ?? null,
      position: row.position ?? null,
    }),
    procedureVersionId: row.procedure_version_id,
    ...(row.procedure_name !== undefined ? { procedureName: row.procedure_name } : {}),
    ...(row.procedure_version !== undefined
      ? { procedureVersion: Number(row.procedure_version) }
      : {}),
    ...(row.method_name !== undefined ? { methodName: row.method_name } : {}),
    occurrenceKey: row.occurrence_key,
    triggerEventId: row.trigger_event_id,
    triggerEventType: row.trigger_event_type,
    priority: row.priority,
    estimatedMinutes: numberOrNull(row.estimated_minutes),
    shiftId: row.shift_id,
    ...(row.shift_name !== undefined ? { shiftName: row.shift_name } : {}),
    scheduledAt: fromDbDateTimeRequired(row.scheduled_at),
    dueAt: fromDbDateTime(row.due_at),
    status: row.status,
    assignedToId: row.assigned_to,
    assignedToName: row.assigned_to_name ?? null,
    assignedAt: fromDbDateTime(row.assigned_at),
    startedAt: fromDbDateTime(row.started_at),
    completedAt: fromDbDateTime(row.completed_at),
    completedByName: row.completed_by_name ?? null,
    closedAt: fromDbDateTime(row.closed_at),
    cancelledReason: row.cancelled_reason,
    requiresVerification: bool(row.requires_verification),
    verificationMethod: row.verification_method,
    verifierRole: row.verifier_role,
    verifiedAt: fromDbDateTime(row.verified_at),
    verifiedByName: row.verified_by_name ?? null,
    recleanCount: Number(row.reclean_count),
    completionNote: row.completion_note,
    isOverdue,
    minutesOverdue: isOverdue ? overdueMinutes : null,
    isOpen,
    ...(row.step_count !== undefined ? { stepCount: Number(row.step_count) } : {}),
    ...(row.steps_done !== undefined ? { stepsDone: Number(row.steps_done) } : {}),
    ...(row.evidence_count !== undefined ? { evidenceCount: Number(row.evidence_count) } : {}),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };

  if (viewer !== undefined) {
    dto.canStart =
      mayWork &&
      (row.status === CleaningTaskStatus.ASSIGNED ||
        row.status === CleaningTaskStatus.RECLEAN_REQUIRED);
    dto.canComplete =
      mayWork &&
      (row.status === CleaningTaskStatus.STARTED ||
        row.status === CleaningTaskStatus.RECLEAN_REQUIRED);
    dto.canVerify =
      mayVerify &&
      (row.status === CleaningTaskStatus.VERIFICATION_REQUIRED ||
        row.status === CleaningTaskStatus.REVERIFICATION_REQUIRED);
  }

  return dto;
}

/* ===================================================================== events */

export function mapCleaningEvent(row: CleaningEventRow): CleaningEventDto {
  return {
    id: row.id,
    eventType: row.event_type,
    source: row.source,
    occurredAt: fromDbDateTimeRequired(row.occurred_at),
    cleanableAssetId: row.cleanable_asset_id,
    cleanableAssetName: row.cleanable_asset_name ?? null,
    areaId: row.area_id,
    areaName: row.area_name ?? null,
    equipmentId: row.equipment_id,
    equipmentName: row.equipment_name ?? null,
    shiftId: row.shift_id,
    assetTypeId: row.asset_type_id,
    reportedById: row.reported_by,
    reportedByName: row.reported_by_name ?? null,
    note: row.note,
    payload: jsonOrNull(row.payload),
    processedAt: fromDbDateTime(row.processed_at),
    tasksCreated: Number(row.tasks_created),
    processError: row.process_error,
    createdAt: fromDbDateTimeRequired(row.created_at),
  };
}

/* ================================================================== workforce */

export function mapSkill(row: SkillRow): SkillDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    sortOrder: Number(row.sort_order),
    status: row.status,
    ...(row.holder_count !== undefined ? { holderCount: Number(row.holder_count) } : {}),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/**
 * True when `now` (local wall clock, minutes past midnight) falls inside the shift. A shift
 * that crosses midnight is two ranges, which is why this is not a single comparison.
 */
export function isWithinShift(
  startsAt: string,
  endsAt: string,
  now: Date = new Date(),
): boolean {
  const toMinutes = (value: string): number => {
    const [h, m] = value.split(':');
    return Number(h) * 60 + Number(m ?? 0);
  };
  const start = toMinutes(startsAt);
  const end = toMinutes(endsAt);
  const current = now.getHours() * 60 + now.getMinutes();
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

export function mapShift(row: ShiftRow): ShiftDto {
  const startsAt = fromDbTime(row.starts_at) ?? '00:00';
  const endsAt = fromDbTime(row.ends_at) ?? '00:00';
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    startsAt,
    endsAt,
    crossesMidnight: bool(row.crosses_midnight),
    days: splitConcat(row.day_numbers)
      .map(Number)
      .filter((day) => Number.isInteger(day))
      .sort((a, b) => a - b),
    sortOrder: Number(row.sort_order),
    status: row.status,
    ...(row.member_count !== undefined ? { memberCount: Number(row.member_count) } : {}),
    isCurrent: isWithinShift(startsAt, endsAt),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapUserSkill(row: UserSkillRow): UserSkillDto {
  const until = fromDbDate(row.certified_until);
  return {
    userId: row.user_id,
    ...(row.user_name !== undefined ? { userName: row.user_name } : {}),
    skillId: row.skill_id,
    ...(row.skill_name !== undefined ? { skillName: row.skill_name } : {}),
    level: row.level,
    certifiedAt: fromDbDate(row.certified_at),
    certifiedUntil: until,
    note: row.note,
    ...(row.granted_by_name !== undefined ? { grantedByName: row.granted_by_name } : {}),
    isExpired: until !== null && until < new Date().toISOString().slice(0, 10),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapUserShiftAssignment(row: UserShiftAssignmentRow): UserShiftAssignmentDto {
  const today = new Date().toISOString().slice(0, 10);
  const from = fromDbDate(row.effective_from) ?? today;
  const to = fromDbDate(row.effective_to);
  return {
    id: row.id,
    userId: row.user_id,
    ...(row.user_name !== undefined ? { userName: row.user_name } : {}),
    shiftId: row.shift_id,
    ...(row.shift_name !== undefined ? { shiftName: row.shift_name } : {}),
    ...(row.shift_starts_at !== undefined
      ? { shiftStartsAt: fromDbTime(row.shift_starts_at) ?? '00:00' }
      : {}),
    ...(row.shift_ends_at !== undefined
      ? { shiftEndsAt: fromDbTime(row.shift_ends_at) ?? '00:00' }
      : {}),
    effectiveFrom: from,
    effectiveTo: to,
    isCurrent: from <= today && (to === null || to >= today),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapUserAreaResponsibility(
  row: UserAreaResponsibilityRow,
): UserAreaResponsibilityDto {
  return {
    userId: row.user_id,
    ...(row.user_name !== undefined ? { userName: row.user_name } : {}),
    areaId: row.area_id,
    ...(row.area_name !== undefined ? { areaName: row.area_name } : {}),
    ...(row.floor_name !== undefined ? { floorName: row.floor_name } : {}),
    isPrimary: bool(row.is_primary),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapCleaningAssignmentRule(
  row: CleaningAssignmentRuleRow,
): CleaningAssignmentRuleDto {
  return {
    id: row.id,
    areaId: row.area_id,
    areaName: row.area_name ?? null,
    strategy: row.strategy,
    requireSkillMatch: bool(row.require_skill_match),
    requireShiftMatch: bool(row.require_shift_match),
    requireAreaMatch: bool(row.require_area_match),
    maxOpenTasks: Number(row.max_open_tasks),
    allowRelaxedFallback: bool(row.allow_relaxed_fallback),
    isActive: bool(row.is_active),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/* ================================================ dashboard and compliance rows */

/** Percentage, 0..100, one decimal place. Zero denominators read as 100, not 0 — nothing
 *  fell due, so nothing was missed, and a fresh install must not open on a red dashboard. */
export function rateOf(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function mapAreaCleaningStatus(
  row: AreaCleaningStatusRow,
  responsibleNames: string[] = [],
): AreaCleaningStatusDto {
  return {
    areaId: row.area_id,
    areaName: row.area_name,
    floorName: row.floor_name,
    openTasks: Number(row.open_tasks),
    overdueTasks: Number(row.overdue_tasks),
    dueToday: Number(row.due_today),
    assetCount: Number(row.asset_count),
    complianceRate: rateOf(Number(row.closed_on_time), Number(row.fell_due)),
    responsibleNames,
  };
}

export function mapComplianceRow(row: CleaningComplianceRow): CleaningComplianceRowDto {
  const due = Number(row.due_count);
  const completed = Number(row.completed_count);
  const onTime = Number(row.on_time_count);
  const verified = Number(row.verified_count);
  const failed = Number(row.failed_count);
  return {
    key: row.group_key,
    label: row.group_label,
    due,
    completed,
    onTime,
    late: Number(row.late_count),
    missed: Number(row.missed_count),
    verified,
    failed,
    complianceRate: rateOf(completed, due),
    onTimeRate: rateOf(onTime, due),
    passRate: rateOf(verified, verified + failed),
  };
}
