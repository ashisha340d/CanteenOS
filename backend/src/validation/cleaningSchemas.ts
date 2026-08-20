import { z } from 'zod';
import {
  CleaningAssignmentStrategy,
  CleaningChemicalKind,
  CleaningEventSource,
  CleaningEvidenceKind,
  CleaningFrequencyKind,
  CleaningRiskLevel,
  CleaningRuleScope,
  CleaningStepStatus,
  CleaningTaskPriority,
  CleaningTaskStatus,
  CleaningToolKind,
  CleaningTriggerEvent,
  CleaningVerificationMethod,
  CleaningVerificationOutcome,
  CorrectiveActionStatus,
  FoodContactClass,
  LIMITS,
  MasterStatus,
  SkillLevel,
  UserRole,
} from '@menuboard/shared';
import {
  clockTime,
  isoDate,
  isoDateTime,
  optionalText,
  pageQuery,
  text,
  uuid,
} from './common';

/**
 * Cleaning & Hygiene request schemas.
 *
 * Their own module, re-exported from `schemas.ts` so every route keeps importing schemas from
 * one place — the same shape `enums/cleaning.ts` and `dto/cleaning.ts` take, and for the same
 * reason: this module contributes more request shapes than most of the product put together.
 *
 * Every object is `.strict()`. An unknown key is a client bug or an attempted mass assignment,
 * and silently ignoring it is how both survive to production.
 */

const enumOf = <T extends Record<string, string>>(source: T) =>
  z.enum(Object.values(source) as [string, ...string[]]);

/** A query-string boolean: `?openOnly=true` and a JSON `true` both mean the same thing. */
const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .optional();

/** Upper-cased identifier code. Trimmed and normalised so `abc` and `ABC` cannot both exist. */
const code = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'A code is required')
    .max(max)
    .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, digits, dot, dash or underscore');

const positiveInt = (max: number) => z.coerce.number().int().min(0).max(max);

export const masterListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    includeInactive: booleanFlag,
  })
  .strict();

/* ==================================================================== masters */

export const cleanableAssetTypeSchema = z
  .object({
    code: code(LIMITS.CLEANABLE_ASSET_TYPE_CODE_MAX),
    name: text(LIMITS.CLEANABLE_ASSET_TYPE_NAME_MAX, 'Name'),
    description: optionalText(LIMITS.CLEANABLE_ASSET_DESCRIPTION_MAX),
    defaultRiskLevel: enumOf(CleaningRiskLevel).optional(),
    defaultFoodContact: enumOf(FoodContactClass).optional(),
    sortOrder: positiveInt(100_000).optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateCleanableAssetTypeSchema = cleanableAssetTypeSchema.partial().strict();

export const cleaningMethodSchema = z
  .object({
    code: code(LIMITS.CLEANING_METHOD_CODE_MAX),
    name: text(LIMITS.CLEANING_METHOD_NAME_MAX, 'Name'),
    description: optionalText(LIMITS.CLEANABLE_ASSET_DESCRIPTION_MAX),
    sortOrder: positiveInt(100_000).optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateCleaningMethodSchema = cleaningMethodSchema.partial().strict();

export const cleaningStandardSchema = z
  .object({
    code: code(LIMITS.CLEANING_STANDARD_CODE_MAX),
    name: text(LIMITS.CLEANING_STANDARD_NAME_MAX, 'Name'),
    acceptanceText: text(LIMITS.CLEANING_STANDARD_ACCEPTANCE_MAX, 'Acceptance criteria'),
    measureUnit: optionalText(LIMITS.CLEANING_STANDARD_UNIT_MAX),
    minValue: z.coerce.number().nullable().optional(),
    maxValue: z.coerce.number().nullable().optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateCleaningStandardSchema = cleaningStandardSchema.partial().strict();

export const cleaningChemicalSchema = z
  .object({
    code: code(LIMITS.CLEANING_CHEMICAL_CODE_MAX),
    name: text(LIMITS.CLEANING_CHEMICAL_NAME_MAX, 'Name'),
    chemicalKind: enumOf(CleaningChemicalKind).optional(),
    supplierName: optionalText(LIMITS.CLEANING_CHEMICAL_NAME_MAX),
    supplierEntityId: uuid.nullable().optional(),
    purpose: optionalText(LIMITS.CLEANING_CHEMICAL_PURPOSE_MAX),
    dilutionRatio: optionalText(LIMITS.CLEANING_CHEMICAL_DILUTION_MAX),
    concentrationPpm: positiveInt(LIMITS.CLEANING_CONCENTRATION_PPM_MAX).nullable().optional(),
    contactTimeSeconds: positiveInt(LIMITS.CLEANING_CONTACT_SECONDS_MAX).nullable().optional(),
    applicationMethod: optionalText(LIMITS.CLEANING_CHEMICAL_APPLICATION_MAX),
    storageRequirement: optionalText(LIMITS.CLEANING_CHEMICAL_STORAGE_MAX),
    safetyInformation: optionalText(LIMITS.CLEANING_CHEMICAL_SAFETY_MAX),
    expiryDate: isoDate.nullable().optional(),
    safetySheetMediaId: uuid.nullable().optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateCleaningChemicalSchema = cleaningChemicalSchema.partial().strict();

export const cleaningToolSchema = z
  .object({
    code: code(LIMITS.CLEANING_TOOL_CODE_MAX),
    name: text(LIMITS.CLEANING_TOOL_NAME_MAX, 'Name'),
    toolKind: enumOf(CleaningToolKind).optional(),
    colourCode: optionalText(LIMITS.CLEANING_TOOL_COLOUR_MAX),
    description: optionalText(LIMITS.CLEANABLE_ASSET_DESCRIPTION_MAX),
    storageLocation: optionalText(LIMITS.CLEANING_TOOL_STORAGE_MAX),
    restrictedAreaId: uuid.nullable().optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateCleaningToolSchema = cleaningToolSchema.partial().strict();

export const skillSchema = z
  .object({
    code: code(LIMITS.SKILL_CODE_MAX),
    name: text(LIMITS.SKILL_NAME_MAX, 'Name'),
    description: optionalText(LIMITS.SKILL_DESCRIPTION_MAX),
    sortOrder: positiveInt(100_000).optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateSkillSchema = skillSchema.partial().strict();

export const shiftSchema = z
  .object({
    code: code(LIMITS.SHIFT_CODE_MAX),
    name: text(LIMITS.SHIFT_NAME_MAX, 'Name'),
    startsAt: clockTime,
    endsAt: clockTime,
    days: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
    sortOrder: positiveInt(100_000).optional(),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateShiftSchema = shiftSchema.partial().strict();

/* ============================================================ cleanable assets */

export const createCleanableAssetSchema = z
  .object({
    name: text(LIMITS.CLEANABLE_ASSET_NAME_MAX, 'Name'),
    assetTypeId: uuid,
    areaId: uuid,
    code: code(LIMITS.CLEANABLE_ASSET_CODE_MAX).optional(),
    locationId: uuid.nullable().optional(),
    equipmentId: uuid.nullable().optional(),
    description: optionalText(LIMITS.CLEANABLE_ASSET_DESCRIPTION_MAX),
    positionNote: optionalText(LIMITS.CLEANABLE_ASSET_POSITION_NOTE_MAX),
    riskLevel: enumOf(CleaningRiskLevel).optional(),
    foodContact: enumOf(FoodContactClass).optional(),
    imageMediaId: uuid.nullable().optional(),
    notes: optionalText(LIMITS.CLEANABLE_ASSET_NOTES_MAX),
  })
  .strict();

export const updateCleanableAssetSchema = createCleanableAssetSchema
  .omit({ code: true })
  .partial()
  .extend({ status: enumOf(MasterStatus).optional() })
  .strict();

export const cleanableAssetAvailabilitySchema = z
  .object({
    isAvailable: z.boolean(),
    reason: optionalText(LIMITS.CLEANABLE_ASSET_UNAVAILABLE_REASON_MAX),
  })
  .strict();

export const cleanableAssetListQuerySchema = pageQuery
  .extend({
    areaId: uuid.optional(),
    floorId: uuid.optional(),
    assetTypeId: uuid.optional(),
    riskLevel: enumOf(CleaningRiskLevel).optional(),
    foodContact: enumOf(FoodContactClass).optional(),
    status: enumOf(MasterStatus).optional(),
    equipmentId: uuid.optional(),
    availableOnly: booleanFlag,
    withoutRules: booleanFlag,
  })
  .strict();

export const cleanableAssetResolveQuerySchema = z
  .object({ code: text(LIMITS.CLEANABLE_ASSET_CODE_MAX, 'Code') })
  .strict();

/* ================================================================= procedures */

export const cleaningProcedureSchema = z
  .object({
    code: code(LIMITS.CLEANING_PROCEDURE_CODE_MAX),
    name: text(LIMITS.CLEANING_PROCEDURE_NAME_MAX, 'Name'),
    description: optionalText(LIMITS.CLEANING_PROCEDURE_DESCRIPTION_MAX),
    status: enumOf(MasterStatus).optional(),
  })
  .strict();
export const updateCleaningProcedureSchema = cleaningProcedureSchema.partial().strict();

const procedureStepSchema = z
  .object({
    stepNumber: z.coerce.number().int().min(1).max(LIMITS.CLEANING_STEPS_PER_VERSION_MAX),
    title: text(LIMITS.CLEANING_STEP_TITLE_MAX, 'Step title'),
    instruction: optionalText(LIMITS.CLEANING_STEP_INSTRUCTION_MAX),
    chemicalId: uuid.nullable().optional(),
    toolId: uuid.nullable().optional(),
    durationSeconds: positiveInt(LIMITS.CLEANING_CONTACT_SECONDS_MAX).nullable().optional(),
    isMandatory: z.boolean().optional(),
    requiresPhoto: z.boolean().optional(),
  })
  .strict();

export const cleaningProcedureVersionSchema = z
  .object({
    methodId: uuid.nullable().optional(),
    standardId: uuid.nullable().optional(),
    changeNote: optionalText(LIMITS.CLEANING_PROCEDURE_CHANGE_NOTE_MAX),
    ppeRequired: optionalText(LIMITS.CLEANING_PROCEDURE_PPE_MAX),
    requiresDisassembly: z.boolean().optional(),
    requiresRinse: z.boolean().optional(),
    requiresFinalRinse: z.boolean().optional(),
    requiresDrying: z.boolean().optional(),
    contactTimeSeconds: positiveInt(LIMITS.CLEANING_CONTACT_SECONDS_MAX).nullable().optional(),
    estimatedMinutes: positiveInt(LIMITS.CLEANING_ESTIMATED_MINUTES_MAX).nullable().optional(),
    safetyNotes: optionalText(LIMITS.CLEANING_PROCEDURE_SAFETY_MAX),
    steps: z.array(procedureStepSchema).max(LIMITS.CLEANING_STEPS_PER_VERSION_MAX).optional(),
    chemicals: z
      .array(
        z
          .object({
            chemicalId: uuid,
            concentrationPpm: positiveInt(LIMITS.CLEANING_CONCENTRATION_PPM_MAX)
              .nullable()
              .optional(),
            dilutionRatio: optionalText(LIMITS.CLEANING_CHEMICAL_DILUTION_MAX),
            contactTimeSeconds: positiveInt(LIMITS.CLEANING_CONTACT_SECONDS_MAX)
              .nullable()
              .optional(),
            note: optionalText(LIMITS.CLEANING_STEP_NOTE_MAX),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    tools: z
      .array(
        z
          .object({ toolId: uuid, note: optionalText(LIMITS.CLEANING_STEP_NOTE_MAX) })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

export const procedureListQuerySchema = pageQuery
  .extend({ includeInactive: booleanFlag, publishedOnly: booleanFlag })
  .strict();

/* ====================================================================== rules */

export const createCleaningRuleSchema = z
  .object({
    code: code(LIMITS.CLEANING_RULE_CODE_MAX),
    taskName: text(LIMITS.CLEANING_RULE_TASK_NAME_MAX, 'Task name'),
    purpose: optionalText(LIMITS.CLEANING_RULE_PURPOSE_MAX),
    scope: enumOf(CleaningRuleScope),
    cleanableAssetId: uuid.nullable().optional(),
    assetTypeId: uuid.nullable().optional(),
    areaId: uuid.nullable().optional(),
    procedureId: uuid,
    frequencyKind: enumOf(CleaningFrequencyKind),
    intervalDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.CLEANING_INTERVAL_DAYS_MAX)
      .nullable()
      .optional(),
    dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().optional(),
    shiftId: uuid.nullable().optional(),
    dueTime: clockTime.nullable().optional(),
    dueWithinMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.CLEANING_DUE_WITHIN_MINUTES_MAX)
      .nullable()
      .optional(),
    triggers: z.array(enumOf(CleaningTriggerEvent)).max(13).optional(),
    requiredSkills: z
      .array(
        z.object({ skillId: uuid, requiredLevel: enumOf(SkillLevel).optional() }).strict(),
      )
      .max(10)
      .optional(),
    responsibleRole: enumOf(UserRole).nullable().optional(),
    estimatedMinutes: positiveInt(LIMITS.CLEANING_ESTIMATED_MINUTES_MAX).nullable().optional(),
    priority: enumOf(CleaningTaskPriority).optional(),
    requiresVerification: z.boolean().optional(),
    verificationMethod: enumOf(CleaningVerificationMethod).nullable().optional(),
    verifierRole: enumOf(UserRole).nullable().optional(),
    standardId: uuid.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateCleaningRuleSchema = createCleaningRuleSchema.partial().strict();

export const cleaningRuleListQuerySchema = pageQuery
  .extend({
    scope: enumOf(CleaningRuleScope).optional(),
    areaId: uuid.optional(),
    assetTypeId: uuid.optional(),
    cleanableAssetId: uuid.optional(),
    procedureId: uuid.optional(),
    frequencyKind: enumOf(CleaningFrequencyKind).optional(),
    priority: enumOf(CleaningTaskPriority).optional(),
    includeInactive: booleanFlag,
    problemsOnly: booleanFlag,
  })
  .strict();

/* ====================================================================== tasks */

export const cleaningTaskListQuerySchema = pageQuery
  .extend({
    status: enumOf(CleaningTaskStatus).optional(),
    priority: enumOf(CleaningTaskPriority).optional(),
    areaId: uuid.optional(),
    floorId: uuid.optional(),
    cleanableAssetId: uuid.optional(),
    assetTypeId: uuid.optional(),
    ruleId: uuid.optional(),
    shiftId: uuid.optional(),
    assignedTo: uuid.optional(),
    mine: booleanFlag,
    openOnly: booleanFlag,
    overdueOnly: booleanFlag,
    unassignedOnly: booleanFlag,
    awaitingVerification: booleanFlag,
    dueFrom: isoDateTime.optional(),
    dueTo: isoDateTime.optional(),
  })
  .strict();

export const cleaningTaskAssignSchema = z
  .object({
    assignedTo: uuid.nullable(),
    note: optionalText(LIMITS.CLEANING_STEP_NOTE_MAX),
  })
  .strict();

export const cleaningTaskStartSchema = z
  .object({ note: optionalText(LIMITS.CLEANING_STEP_NOTE_MAX) })
  .strict();

export const cleaningStepUpdateSchema = z
  .object({
    status: enumOf(CleaningStepStatus),
    skipReason: optionalText(LIMITS.CLEANING_STEP_SKIP_REASON_MAX),
    note: optionalText(LIMITS.CLEANING_STEP_NOTE_MAX),
  })
  .strict();

const evidenceSchema = z
  .object({
    mediaId: uuid,
    kind: enumOf(CleaningEvidenceKind).optional(),
    stepId: uuid.nullable().optional(),
    caption: optionalText(LIMITS.CLEANING_EVIDENCE_CAPTION_MAX),
  })
  .strict();

export const cleaningTaskEvidenceSchema = evidenceSchema;

export const cleaningTaskCompleteSchema = z
  .object({
    note: optionalText(LIMITS.CLEANING_TASK_COMPLETION_NOTE_MAX),
    steps: z
      .array(
        z
          .object({
            stepId: uuid,
            status: enumOf(CleaningStepStatus),
            skipReason: optionalText(LIMITS.CLEANING_STEP_SKIP_REASON_MAX),
          })
          .strict(),
      )
      .max(LIMITS.CLEANING_STEPS_PER_VERSION_MAX)
      .optional(),
    evidence: z.array(evidenceSchema).max(LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX).optional(),
  })
  .strict();

export const cleaningTaskCancelSchema = z
  .object({ reason: text(LIMITS.CLEANING_TASK_CANCEL_REASON_MAX, 'Reason') })
  .strict();

export const cleaningVerifySchema = z
  .object({
    outcome: enumOf(CleaningVerificationOutcome),
    method: enumOf(CleaningVerificationMethod).optional(),
    failureReason: optionalText(LIMITS.CLEANING_VERIFICATION_FAILURE_REASON_MAX),
    note: optionalText(LIMITS.CLEANING_VERIFICATION_NOTE_MAX),
    results: z
      .array(
        z
          .object({
            label: text(LIMITS.CLEANING_VERIFICATION_LABEL_MAX, 'Label'),
            passed: z.boolean().nullable().optional(),
            measuredValue: z.coerce.number().nullable().optional(),
            measureUnit: optionalText(LIMITS.CLEANING_STANDARD_UNIT_MAX),
            note: optionalText(LIMITS.CLEANING_STEP_NOTE_MAX),
          })
          .strict(),
      )
      .max(LIMITS.CLEANING_VERIFICATION_RESULTS_MAX)
      .optional(),
    evidence: z
      .array(
        z
          .object({ mediaId: uuid, caption: optionalText(LIMITS.CLEANING_EVIDENCE_CAPTION_MAX) })
          .strict(),
      )
      .max(LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX)
      .optional(),
    correctiveAction: z
      .object({
        immediateAction: optionalText(LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX),
        assignedTo: uuid.nullable().optional(),
        dueAt: isoDateTime.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const correctiveActionUpdateSchema = z
  .object({
    rootCause: optionalText(LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX),
    correctiveAction: optionalText(LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX),
    preventiveAction: optionalText(LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX),
    immediateAction: optionalText(LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX),
    assignedTo: uuid.nullable().optional(),
    dueAt: isoDateTime.nullable().optional(),
    status: enumOf(CorrectiveActionStatus).optional(),
    closureNote: optionalText(LIMITS.CLEANING_CORRECTIVE_CLOSURE_NOTE_MAX),
  })
  .strict();

export const correctiveActionListQuerySchema = pageQuery
  .extend({
    status: enumOf(CorrectiveActionStatus).optional(),
    areaId: uuid.optional(),
    assignedTo: uuid.optional(),
    mine: booleanFlag,
    openOnly: booleanFlag,
    overdueOnly: booleanFlag,
  })
  .strict();

/* ===================================================== reports and event ingest */

export const cleaningReportSchema = z
  .object({
    eventType: enumOf(CleaningTriggerEvent).optional(),
    cleanableAssetId: uuid.nullable().optional(),
    areaId: uuid.nullable().optional(),
    equipmentId: uuid.nullable().optional(),
    note: optionalText(LIMITS.CLEANING_EVENT_NOTE_MAX),
    priority: enumOf(CleaningTaskPriority).optional(),
    photoMediaIds: z.array(uuid).max(LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX).optional(),
  })
  .strict();

export const cleaningEventPublishSchema = z
  .object({
    eventType: enumOf(CleaningTriggerEvent),
    source: enumOf(CleaningEventSource).optional(),
    occurredAt: isoDateTime.optional(),
    cleanableAssetId: uuid.nullable().optional(),
    areaId: uuid.nullable().optional(),
    equipmentId: uuid.nullable().optional(),
    shiftId: uuid.nullable().optional(),
    assetTypeId: uuid.nullable().optional(),
    note: optionalText(LIMITS.CLEANING_EVENT_NOTE_MAX),
    payload: z.record(z.unknown()).nullable().optional(),
    dedupeKey: optionalText(LIMITS.CLEANING_EVENT_DEDUPE_KEY_MAX),
  })
  .strict();

export const cleaningEventListQuerySchema = pageQuery
  .extend({
    eventType: enumOf(CleaningTriggerEvent).optional(),
    source: enumOf(CleaningEventSource).optional(),
    areaId: uuid.optional(),
    cleanableAssetId: uuid.optional(),
    reportedBy: uuid.optional(),
    mine: booleanFlag,
    unprocessedOnly: booleanFlag,
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
  })
  .strict();

/* ================================================================== workforce */

export const userSkillSchema = z
  .object({
    skillId: uuid,
    level: enumOf(SkillLevel).optional(),
    certifiedAt: isoDate.nullable().optional(),
    certifiedUntil: isoDate.nullable().optional(),
    note: optionalText(LIMITS.SKILL_NOTE_MAX),
  })
  .strict();

export const userShiftAssignmentSchema = z
  .object({
    shiftId: uuid,
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
  })
  .strict();

export const userAreaResponsibilitySchema = z
  .object({ areaId: uuid, isPrimary: z.boolean().optional() })
  .strict();

export const cleaningAssignmentRuleSchema = z
  .object({
    areaId: uuid.nullable().optional(),
    strategy: enumOf(CleaningAssignmentStrategy).optional(),
    requireSkillMatch: z.boolean().optional(),
    requireShiftMatch: z.boolean().optional(),
    requireAreaMatch: z.boolean().optional(),
    maxOpenTasks: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.CLEANING_MAX_OPEN_TASKS_CEILING)
      .optional(),
    allowRelaxedFallback: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/* ================================================================= compliance */

export const cleaningComplianceQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    areaId: uuid.optional(),
    assetTypeId: uuid.optional(),
    shiftId: uuid.optional(),
  })
  .strict();

/* ---------------------------------------------------------------- path params */

export const cleaningTaskStepParam = z.object({ id: uuid, stepId: uuid }).strict();
export const cleaningTaskEvidenceParam = z.object({ id: uuid, evidenceId: uuid }).strict();
export const userSkillParam = z.object({ userId: uuid, skillId: uuid }).strict();
export const userShiftParam = z.object({ userId: uuid, assignmentId: uuid }).strict();
export const userAreaParam = z.object({ userId: uuid, areaId: uuid }).strict();
export const userIdParam = z.object({ userId: uuid }).strict();
export const areaIdParam = z.object({ areaId: uuid }).strict();
