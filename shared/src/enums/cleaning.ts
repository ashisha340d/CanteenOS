/**
 * Cleaning & Hygiene Management — closed sets (§3e).
 *
 * Kept in their own module rather than appended to `enums/index.ts` (which re-exports this
 * file, so the import path is unchanged) for the same reason `enums/equipment.ts` is: the
 * module contributes more closed sets than most of the product put together.
 *
 * The task state machine lives here too. It is a pure closed set with no I/O, both clients
 * need to reason about it to render the right action, and keeping it beside the status enum is
 * what stops a screen inventing a transition the server would refuse.
 */

/** How badly a lapse on this asset matters. Drives task priority when the rule leaves it open. */
export const CleaningRiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type CleaningRiskLevel = (typeof CleaningRiskLevel)[keyof typeof CleaningRiskLevel];

export const CLEANING_RISK_LEVEL_LABELS: Readonly<Record<CleaningRiskLevel, string>> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

/**
 * Whether the surface touches food. Recorded per asset because it changes what a lapse means,
 * not because the software enforces a rule from it: a chopping board and a corridor floor are
 * both cleaned, and only one of them can poison somebody.
 */
export const FoodContactClass = {
  DIRECT: 'DIRECT',
  INDIRECT: 'INDIRECT',
  NON_FOOD: 'NON_FOOD',
} as const;
export type FoodContactClass = (typeof FoodContactClass)[keyof typeof FoodContactClass];

export const FOOD_CONTACT_CLASS_LABELS: Readonly<Record<FoodContactClass, string>> = {
  DIRECT: 'Direct food contact',
  INDIRECT: 'Indirect food contact',
  NON_FOOD: 'Non-food contact',
};

/**
 * How often a rule comes due.
 *
 * An enum rather than the `frequencies` master the brief asks for: every member below needs
 * matching code in the frequency engine to compute a next occurrence, so a user adding a row
 * to a table would create a frequency the engine cannot honour. The *parameters* (interval,
 * anchor, shift, times per shift) are data on the rule; the kinds are a closed set.
 */
export const CleaningFrequencyKind = {
  AFTER_EVERY_USE: 'AFTER_EVERY_USE',
  AFTER_EVERY_BATCH: 'AFTER_EVERY_BATCH',
  AFTER_PRODUCTION_CYCLE: 'AFTER_PRODUCTION_CYCLE',
  AFTER_CONTAMINATION: 'AFTER_CONTAMINATION',
  AFTER_SPILL: 'AFTER_SPILL',
  AFTER_MAINTENANCE: 'AFTER_MAINTENANCE',
  PER_SHIFT: 'PER_SHIFT',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  PERIODIC: 'PERIODIC',
  CONDITION_BASED: 'CONDITION_BASED',
} as const;
export type CleaningFrequencyKind =
  (typeof CleaningFrequencyKind)[keyof typeof CleaningFrequencyKind];

export const CLEANING_FREQUENCY_KIND_LABELS: Readonly<Record<CleaningFrequencyKind, string>> = {
  AFTER_EVERY_USE: 'After every use',
  AFTER_EVERY_BATCH: 'After every batch',
  AFTER_PRODUCTION_CYCLE: 'After every production cycle',
  AFTER_CONTAMINATION: 'After contamination',
  AFTER_SPILL: 'After a spill',
  AFTER_MAINTENANCE: 'After maintenance',
  PER_SHIFT: 'Per shift',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  PERIODIC: 'Every N days',
  CONDITION_BASED: 'Condition based',
};

/**
 * Frequencies whose next occurrence is a date the scheduler can compute ahead of time. The
 * rest only ever come due because an operational event said so, which is why the engine is
 * event-driven and the sweep is a safety net rather than the mechanism.
 */
export const CALENDAR_FREQUENCY_KINDS: readonly CleaningFrequencyKind[] = [
  CleaningFrequencyKind.DAILY,
  CleaningFrequencyKind.WEEKLY,
  CleaningFrequencyKind.MONTHLY,
  CleaningFrequencyKind.PERIODIC,
  CleaningFrequencyKind.PER_SHIFT,
];

/** Operational events a cleaning rule can subscribe to. */
export const CleaningTriggerEvent = {
  SHIFT_STARTED: 'SHIFT_STARTED',
  SHIFT_ENDED: 'SHIFT_ENDED',
  EQUIPMENT_USED: 'EQUIPMENT_USED',
  BATCH_COMPLETED: 'BATCH_COMPLETED',
  PRODUCTION_COMPLETED: 'PRODUCTION_COMPLETED',
  SPILL_REPORTED: 'SPILL_REPORTED',
  CONTAMINATION_REPORTED: 'CONTAMINATION_REPORTED',
  MAINTENANCE_COMPLETED: 'MAINTENANCE_COMPLETED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_FAILED: 'TASK_FAILED',
  INSPECTION_FAILED: 'INSPECTION_FAILED',
  MANUAL_TRIGGER: 'MANUAL_TRIGGER',
  /** Raised by the sweep for calendar frequencies. Not publishable from outside. */
  SCHEDULE_DUE: 'SCHEDULE_DUE',
} as const;
export type CleaningTriggerEvent =
  (typeof CleaningTriggerEvent)[keyof typeof CleaningTriggerEvent];

export const CLEANING_TRIGGER_EVENT_LABELS: Readonly<Record<CleaningTriggerEvent, string>> = {
  SHIFT_STARTED: 'Shift started',
  SHIFT_ENDED: 'Shift ended',
  EQUIPMENT_USED: 'Equipment used',
  BATCH_COMPLETED: 'Batch completed',
  PRODUCTION_COMPLETED: 'Production completed',
  SPILL_REPORTED: 'Spill reported',
  CONTAMINATION_REPORTED: 'Contamination reported',
  MAINTENANCE_COMPLETED: 'Maintenance completed',
  TASK_COMPLETED: 'Cleaning task completed',
  TASK_FAILED: 'Cleaning task failed',
  INSPECTION_FAILED: 'Inspection failed',
  MANUAL_TRIGGER: 'Raised by hand',
  SCHEDULE_DUE: 'Schedule came due',
};

/**
 * `SCHEDULE_DUE` is the scheduler's own signal and is refused on the ingest endpoint: letting
 * a client claim a schedule is due would let it manufacture occurrences the frequency engine
 * never computed, and duplicate-prevention keys off exactly that occurrence.
 */
export const PUBLISHABLE_TRIGGER_EVENTS: readonly CleaningTriggerEvent[] = [
  CleaningTriggerEvent.SHIFT_STARTED,
  CleaningTriggerEvent.SHIFT_ENDED,
  CleaningTriggerEvent.EQUIPMENT_USED,
  CleaningTriggerEvent.BATCH_COMPLETED,
  CleaningTriggerEvent.PRODUCTION_COMPLETED,
  CleaningTriggerEvent.SPILL_REPORTED,
  CleaningTriggerEvent.CONTAMINATION_REPORTED,
  CleaningTriggerEvent.MAINTENANCE_COMPLETED,
  CleaningTriggerEvent.TASK_COMPLETED,
  CleaningTriggerEvent.TASK_FAILED,
  CleaningTriggerEvent.INSPECTION_FAILED,
  CleaningTriggerEvent.MANUAL_TRIGGER,
];

/** Where an event came from. Lets the module be measured against its own premise. */
export const CleaningEventSource = {
  SCHEDULER: 'SCHEDULER',
  MOBILE: 'MOBILE',
  ADMIN: 'ADMIN',
  POS: 'POS',
  KDS: 'KDS',
  PRODUCTION: 'PRODUCTION',
  MAINTENANCE: 'MAINTENANCE',
  INTEGRATION: 'INTEGRATION',
  SYSTEM: 'SYSTEM',
} as const;
export type CleaningEventSource = (typeof CleaningEventSource)[keyof typeof CleaningEventSource];

/** What a rule targets. Resolved to concrete assets by the task generator. */
export const CleaningRuleScope = {
  /** One named asset. */
  ASSET: 'ASSET',
  /** Every asset of a type within one area — "all food contact surfaces in the Bakery". */
  ASSET_TYPE_IN_AREA: 'ASSET_TYPE_IN_AREA',
  /** Every asset of a type, everywhere. */
  ASSET_TYPE_GLOBAL: 'ASSET_TYPE_GLOBAL',
} as const;
export type CleaningRuleScope = (typeof CleaningRuleScope)[keyof typeof CleaningRuleScope];

export const CleaningTaskPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type CleaningTaskPriority =
  (typeof CleaningTaskPriority)[keyof typeof CleaningTaskPriority];

export const CLEANING_TASK_PRIORITY_LABELS: Readonly<Record<CleaningTaskPriority, string>> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

/** Worst first. Used for ordering both in SQL and in the clients. */
export const CLEANING_TASK_PRIORITY_ORDER: readonly CleaningTaskPriority[] = [
  CleaningTaskPriority.CRITICAL,
  CleaningTaskPriority.HIGH,
  CleaningTaskPriority.NORMAL,
  CleaningTaskPriority.LOW,
];

/**
 * The task lifecycle.
 *
 * `UNASSIGNED` is not in the brief's diagram and is deliberate: automatic assignment can fail
 * (nobody on shift holds the skill), and the alternative to a state for it is a task that
 * claims to be PLANNED forever while no human knows it needs a decision. It is the one state
 * a supervisor is paged about.
 *
 * A failed verification keeps the same task rather than opening a second one. The brief says
 * both ("Reclean Task Created" in the frequency section, RECLEAN_REQUIRED on the same chain in
 * the lifecycle section); one object with a complete transition history is the reading that
 * keeps "what happened to this occurrence" answerable by a single query.
 */
export const CleaningTaskStatus = {
  PLANNED: 'PLANNED',
  UNASSIGNED: 'UNASSIGNED',
  ASSIGNED: 'ASSIGNED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  VERIFICATION_REQUIRED: 'VERIFICATION_REQUIRED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  RECLEAN_REQUIRED: 'RECLEAN_REQUIRED',
  RECLEANED: 'RECLEANED',
  REVERIFICATION_REQUIRED: 'REVERIFICATION_REQUIRED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type CleaningTaskStatus = (typeof CleaningTaskStatus)[keyof typeof CleaningTaskStatus];

export const CLEANING_TASK_STATUS_LABELS: Readonly<Record<CleaningTaskStatus, string>> = {
  PLANNED: 'Planned',
  UNASSIGNED: 'Needs an owner',
  ASSIGNED: 'Assigned',
  STARTED: 'In progress',
  COMPLETED: 'Done',
  VERIFICATION_REQUIRED: 'Awaiting check',
  VERIFIED: 'Checked',
  FAILED: 'Failed the check',
  RECLEAN_REQUIRED: 'Needs recleaning',
  RECLEANED: 'Recleaned',
  REVERIFICATION_REQUIRED: 'Awaiting recheck',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/** Nothing may leave these. */
export const CLEANING_TASK_TERMINAL_STATUSES: readonly CleaningTaskStatus[] = [
  CleaningTaskStatus.CLOSED,
  CleaningTaskStatus.CANCELLED,
];

/** States where the task is still somebody's outstanding work. Drives every "open" count. */
export const CLEANING_TASK_OPEN_STATUSES: readonly CleaningTaskStatus[] = [
  CleaningTaskStatus.PLANNED,
  CleaningTaskStatus.UNASSIGNED,
  CleaningTaskStatus.ASSIGNED,
  CleaningTaskStatus.STARTED,
  CleaningTaskStatus.COMPLETED,
  CleaningTaskStatus.VERIFICATION_REQUIRED,
  CleaningTaskStatus.VERIFIED,
  CleaningTaskStatus.FAILED,
  CleaningTaskStatus.RECLEAN_REQUIRED,
  CleaningTaskStatus.RECLEANED,
  CleaningTaskStatus.REVERIFICATION_REQUIRED,
];

/** States the assigned operator can act on from their task list. */
export const CLEANING_TASK_ACTIONABLE_STATUSES: readonly CleaningTaskStatus[] = [
  CleaningTaskStatus.ASSIGNED,
  CleaningTaskStatus.STARTED,
  CleaningTaskStatus.RECLEAN_REQUIRED,
];

/**
 * The only permitted moves. Anything absent here is refused by the service and by both
 * clients, so a status can never be set by an arbitrary write.
 */
export const CLEANING_TASK_TRANSITIONS: Readonly<
  Record<CleaningTaskStatus, readonly CleaningTaskStatus[]>
> = {
  PLANNED: [
    CleaningTaskStatus.ASSIGNED,
    CleaningTaskStatus.UNASSIGNED,
    CleaningTaskStatus.CANCELLED,
  ],
  UNASSIGNED: [CleaningTaskStatus.ASSIGNED, CleaningTaskStatus.CANCELLED],
  ASSIGNED: [
    CleaningTaskStatus.STARTED,
    // Reassignment lands back on ASSIGNED; a self-move is refused by the service, not here.
    CleaningTaskStatus.ASSIGNED,
    CleaningTaskStatus.UNASSIGNED,
    CleaningTaskStatus.CANCELLED,
  ],
  STARTED: [CleaningTaskStatus.COMPLETED, CleaningTaskStatus.CANCELLED],
  // Verification-required is decided from the rule, in the same transaction as completion.
  COMPLETED: [
    CleaningTaskStatus.VERIFICATION_REQUIRED,
    CleaningTaskStatus.CLOSED,
    CleaningTaskStatus.CANCELLED,
  ],
  VERIFICATION_REQUIRED: [
    CleaningTaskStatus.VERIFIED,
    CleaningTaskStatus.FAILED,
    CleaningTaskStatus.CANCELLED,
  ],
  VERIFIED: [CleaningTaskStatus.CLOSED],
  FAILED: [CleaningTaskStatus.RECLEAN_REQUIRED, CleaningTaskStatus.CANCELLED],
  RECLEAN_REQUIRED: [CleaningTaskStatus.RECLEANED, CleaningTaskStatus.CANCELLED],
  RECLEANED: [CleaningTaskStatus.REVERIFICATION_REQUIRED, CleaningTaskStatus.CANCELLED],
  REVERIFICATION_REQUIRED: [
    CleaningTaskStatus.VERIFIED,
    CleaningTaskStatus.FAILED,
    CleaningTaskStatus.CANCELLED,
  ],
  CLOSED: [],
  CANCELLED: [],
};

/** True when `to` is a permitted next state of `from`. */
export function canTransitionCleaningTask(
  from: CleaningTaskStatus,
  to: CleaningTaskStatus,
): boolean {
  return CLEANING_TASK_TRANSITIONS[from].includes(to);
}

export function isCleaningTaskTerminal(status: CleaningTaskStatus): boolean {
  return CLEANING_TASK_TERMINAL_STATUSES.includes(status);
}

export function isCleaningTaskOpen(status: CleaningTaskStatus): boolean {
  return CLEANING_TASK_OPEN_STATUSES.includes(status);
}

/** How a completed clean is checked. Configured per rule. */
export const CleaningVerificationMethod = {
  VISUAL_INSPECTION: 'VISUAL_INSPECTION',
  CHECKLIST: 'CHECKLIST',
  CHEMICAL_CONCENTRATION: 'CHEMICAL_CONCENTRATION',
  ATP: 'ATP',
  MICROBIOLOGICAL: 'MICROBIOLOGICAL',
  PHOTO_EVIDENCE: 'PHOTO_EVIDENCE',
  TEMPERATURE: 'TEMPERATURE',
  SUPERVISOR_APPROVAL: 'SUPERVISOR_APPROVAL',
} as const;
export type CleaningVerificationMethod =
  (typeof CleaningVerificationMethod)[keyof typeof CleaningVerificationMethod];

export const CLEANING_VERIFICATION_METHOD_LABELS: Readonly<
  Record<CleaningVerificationMethod, string>
> = {
  VISUAL_INSPECTION: 'Visual inspection',
  CHECKLIST: 'Checklist',
  CHEMICAL_CONCENTRATION: 'Chemical concentration',
  ATP: 'ATP swab',
  MICROBIOLOGICAL: 'Microbiological result',
  PHOTO_EVIDENCE: 'Photo evidence',
  TEMPERATURE: 'Temperature measurement',
  SUPERVISOR_APPROVAL: 'Supervisor approval',
};

/** Methods that carry a number, so the UI asks for one and the record keeps it. */
export const MEASURED_VERIFICATION_METHODS: readonly CleaningVerificationMethod[] = [
  CleaningVerificationMethod.CHEMICAL_CONCENTRATION,
  CleaningVerificationMethod.ATP,
  CleaningVerificationMethod.TEMPERATURE,
  CleaningVerificationMethod.MICROBIOLOGICAL,
];

export const CleaningVerificationOutcome = {
  PASS: 'PASS',
  FAIL: 'FAIL',
} as const;
export type CleaningVerificationOutcome =
  (typeof CleaningVerificationOutcome)[keyof typeof CleaningVerificationOutcome];

/** Publication state of a procedure version. Only PUBLISHED versions are ever pinned to a task. */
export const CleaningProcedureVersionStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CleaningProcedureVersionStatus =
  (typeof CleaningProcedureVersionStatus)[keyof typeof CleaningProcedureVersionStatus];

export const CleaningStepStatus = {
  PENDING: 'PENDING',
  DONE: 'DONE',
  SKIPPED: 'SKIPPED',
} as const;
export type CleaningStepStatus = (typeof CleaningStepStatus)[keyof typeof CleaningStepStatus];

export const CorrectiveActionStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  VERIFICATION_PENDING: 'VERIFICATION_PENDING',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type CorrectiveActionStatus =
  (typeof CorrectiveActionStatus)[keyof typeof CorrectiveActionStatus];

export const CORRECTIVE_ACTION_STATUS_LABELS: Readonly<Record<CorrectiveActionStatus, string>> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  VERIFICATION_PENDING: 'Awaiting recheck',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/**
 * How the assignment engine breaks a tie between equally eligible people. Configured per area
 * rather than compiled in, because a bakery with two ovens and a canteen with thirty staff do
 * not want the same answer.
 */
export const CleaningAssignmentStrategy = {
  /** Whoever is named responsible for the area first, then least loaded. */
  PRIMARY_RESPONSIBLE_FIRST: 'PRIMARY_RESPONSIBLE_FIRST',
  /** Fewest open cleaning tasks wins. */
  LEAST_LOADED: 'LEAST_LOADED',
  /** Whoever went longest without being given one. */
  ROUND_ROBIN: 'ROUND_ROBIN',
} as const;
export type CleaningAssignmentStrategy =
  (typeof CleaningAssignmentStrategy)[keyof typeof CleaningAssignmentStrategy];

/** Why a task ended up with the person it did. Recorded so a disputed roster can be explained. */
export const CleaningAssignmentReason = {
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
  REASSIGNED: 'REASSIGNED',
  ESCALATED: 'ESCALATED',
  NO_ELIGIBLE_EMPLOYEE: 'NO_ELIGIBLE_EMPLOYEE',
} as const;
export type CleaningAssignmentReason =
  (typeof CleaningAssignmentReason)[keyof typeof CleaningAssignmentReason];

/** Competence held by a person, required by a rule. */
export const SkillLevel = {
  BASIC: 'BASIC',
  COMPETENT: 'COMPETENT',
  EXPERT: 'EXPERT',
} as const;
export type SkillLevel = (typeof SkillLevel)[keyof typeof SkillLevel];

/** Ascending, so "holds at least COMPETENT" is an index comparison. */
export const SKILL_LEVEL_ORDER: readonly SkillLevel[] = [
  SkillLevel.BASIC,
  SkillLevel.COMPETENT,
  SkillLevel.EXPERT,
];

export function skillLevelMeets(held: SkillLevel, required: SkillLevel): boolean {
  return SKILL_LEVEL_ORDER.indexOf(held) >= SKILL_LEVEL_ORDER.indexOf(required);
}

/** What a chemical is for. Drives the icon, the filter and nothing else — the dosage is data. */
export const CleaningChemicalKind = {
  DETERGENT: 'DETERGENT',
  SANITISER: 'SANITISER',
  DISINFECTANT: 'DISINFECTANT',
  DEGREASER: 'DEGREASER',
  DESCALER: 'DESCALER',
  BLEACH: 'BLEACH',
  SOAP: 'SOAP',
  ALCOHOL: 'ALCOHOL',
  OTHER: 'OTHER',
} as const;
export type CleaningChemicalKind =
  (typeof CleaningChemicalKind)[keyof typeof CleaningChemicalKind];

export const CLEANING_CHEMICAL_KIND_LABELS: Readonly<Record<CleaningChemicalKind, string>> = {
  DETERGENT: 'Detergent',
  SANITISER: 'Sanitiser',
  DISINFECTANT: 'Disinfectant',
  DEGREASER: 'Degreaser',
  DESCALER: 'Descaler',
  BLEACH: 'Bleach',
  SOAP: 'Soap',
  ALCOHOL: 'Alcohol',
  OTHER: 'Other',
};

/** The physical implement. Colour-coding lives on the tool row, not in this set. */
export const CleaningToolKind = {
  BRUSH: 'BRUSH',
  MOP: 'MOP',
  CLOTH: 'CLOTH',
  SCRAPER: 'SCRAPER',
  SPONGE: 'SPONGE',
  SQUEEGEE: 'SQUEEGEE',
  BUCKET: 'BUCKET',
  SPRAYER: 'SPRAYER',
  VACUUM: 'VACUUM',
  PRESSURE_WASHER: 'PRESSURE_WASHER',
  OTHER: 'OTHER',
} as const;
export type CleaningToolKind = (typeof CleaningToolKind)[keyof typeof CleaningToolKind];

export const CLEANING_TOOL_KIND_LABELS: Readonly<Record<CleaningToolKind, string>> = {
  BRUSH: 'Brush',
  MOP: 'Mop',
  CLOTH: 'Cloth',
  SCRAPER: 'Scraper',
  SPONGE: 'Sponge',
  SQUEEGEE: 'Squeegee',
  BUCKET: 'Bucket',
  SPRAYER: 'Sprayer',
  VACUUM: 'Vacuum',
  PRESSURE_WASHER: 'Pressure washer',
  OTHER: 'Other',
};

/**
 * What a photo on a task is showing. `BEFORE`/`AFTER` are the pair a hygiene auditor asks
 * for; `STEP` binds the photo to the procedure step that demanded it.
 */
export const CleaningEvidenceKind = {
  BEFORE: 'BEFORE',
  AFTER: 'AFTER',
  STEP: 'STEP',
  VERIFICATION: 'VERIFICATION',
  CORRECTIVE_ACTION: 'CORRECTIVE_ACTION',
  OTHER: 'OTHER',
} as const;
export type CleaningEvidenceKind =
  (typeof CleaningEvidenceKind)[keyof typeof CleaningEvidenceKind];

export const CLEANING_EVIDENCE_KIND_LABELS: Readonly<Record<CleaningEvidenceKind, string>> = {
  BEFORE: 'Before',
  AFTER: 'After',
  STEP: 'Step',
  VERIFICATION: 'Verification',
  CORRECTIVE_ACTION: 'Corrective action',
  OTHER: 'Other',
};

/**
 * The events a person may raise from the floor as a cleaning *report*, as opposed to the
 * machine-published ones. This is the closed set behind "anybody can say what needs cleaning":
 * the reporter picks one of these, names the place, and the engine does the rest.
 */
export const CLEANING_REPORTABLE_EVENTS: readonly CleaningTriggerEvent[] = [
  CleaningTriggerEvent.SPILL_REPORTED,
  CleaningTriggerEvent.CONTAMINATION_REPORTED,
  CleaningTriggerEvent.MANUAL_TRIGGER,
];

export const CLEANING_ASSIGNMENT_STRATEGY_LABELS: Readonly<
  Record<CleaningAssignmentStrategy, string>
> = {
  PRIMARY_RESPONSIBLE_FIRST: 'Whoever is responsible for the area',
  LEAST_LOADED: 'Whoever has the fewest open tasks',
  ROUND_ROBIN: 'Whoever went longest without one',
};

export const CLEANING_ASSIGNMENT_REASON_LABELS: Readonly<
  Record<CleaningAssignmentReason, string>
> = {
  AUTOMATIC: 'Assigned automatically',
  MANUAL: 'Assigned by hand',
  REASSIGNED: 'Reassigned',
  ESCALATED: 'Escalated',
  NO_ELIGIBLE_EMPLOYEE: 'Nobody eligible was on shift',
};

export const SKILL_LEVEL_LABELS: Readonly<Record<SkillLevel, string>> = {
  BASIC: 'Basic',
  COMPETENT: 'Competent',
  EXPERT: 'Expert',
};
