import type {
  CleaningAssignmentReason,
  CleaningAssignmentStrategy,
  CleaningChemicalKind,
  CleaningEventSource,
  CleaningEvidenceKind,
  CleaningFrequencyKind,
  CleaningProcedureVersionStatus,
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
  MasterStatus,
  SkillLevel,
  UserRole,
} from '../enums';
import type { ClockTime, IsoDate, IsoDateTime, PageQuery, Uuid } from './common';

/**
 * Cleaning & Hygiene Management wire contract (§3e).
 *
 * Three rules shape every type here, and they are the reason the module is usable rather than
 * merely complete:
 *
 *  1. **Reporting costs one tap and one sentence.** `CleaningReportRequest` carries a place and
 *     a note. Everything else — which rules match, which asset, which procedure, who gets it,
 *     when it is due — is resolved on the server from the report and the configuration.
 *  2. **A task is an occurrence, not a template.** The rule says what and how often; the task
 *     is one instance of it, pinned to the *published procedure version* that was current when
 *     it was raised, so a procedure edited next month cannot rewrite last month's record.
 *  3. **Nothing derived is stored twice.** Overdue-ness, compliance rates and "who may act on
 *     this" are computed on read from status and time, never persisted as a flag that can
 *     quietly become a lie.
 */

/* ==================================================================== masters */

export interface CleanableAssetTypeDto {
  id: Uuid;
  code: string;
  name: string;
  description: string | null;
  defaultRiskLevel: CleaningRiskLevel;
  defaultFoodContact: FoodContactClass;
  sortOrder: number;
  status: MasterStatus;
  /** Present on list reads: how many assets currently carry this type. */
  assetCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleanableAssetTypeWriteRequest {
  code: string;
  name: string;
  description?: string | null;
  defaultRiskLevel?: CleaningRiskLevel;
  defaultFoodContact?: FoodContactClass;
  sortOrder?: number;
  status?: MasterStatus;
}

export interface CleaningMethodDto {
  id: Uuid;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: MasterStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningMethodWriteRequest {
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  status?: MasterStatus;
}

/**
 * "Clean enough" written down. A standard with `minValue`/`maxValue` turns a verification into
 * a measurement the result row can be judged against automatically.
 */
export interface CleaningStandardDto {
  id: Uuid;
  code: string;
  name: string;
  acceptanceText: string;
  measureUnit: string | null;
  minValue: number | null;
  maxValue: number | null;
  status: MasterStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningStandardWriteRequest {
  code: string;
  name: string;
  acceptanceText: string;
  measureUnit?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  status?: MasterStatus;
}

export interface CleaningChemicalDto {
  id: Uuid;
  code: string;
  name: string;
  chemicalKind: CleaningChemicalKind;
  supplierName: string | null;
  supplierEntityId: Uuid | null;
  purpose: string | null;
  dilutionRatio: string | null;
  concentrationPpm: number | null;
  contactTimeSeconds: number | null;
  applicationMethod: string | null;
  storageRequirement: string | null;
  safetyInformation: string | null;
  expiryDate: IsoDate | null;
  safetySheetMediaId: Uuid | null;
  /** Signed, expiring, minted per response for the viewing user. Never stored. */
  safetySheetUrl: string | null;
  status: MasterStatus;
  /** Derived from `expiryDate` and today, never persisted. */
  isExpired: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningChemicalWriteRequest {
  code: string;
  name: string;
  chemicalKind?: CleaningChemicalKind;
  supplierName?: string | null;
  supplierEntityId?: Uuid | null;
  purpose?: string | null;
  dilutionRatio?: string | null;
  concentrationPpm?: number | null;
  contactTimeSeconds?: number | null;
  applicationMethod?: string | null;
  storageRequirement?: string | null;
  safetyInformation?: string | null;
  expiryDate?: IsoDate | null;
  safetySheetMediaId?: Uuid | null;
  status?: MasterStatus;
}

export interface CleaningToolDto {
  id: Uuid;
  code: string;
  name: string;
  toolKind: CleaningToolKind;
  /** The colour-coding scheme that keeps a toilet brush out of the prep room. */
  colourCode: string | null;
  description: string | null;
  storageLocation: string | null;
  restrictedAreaId: Uuid | null;
  restrictedAreaName?: string | null;
  status: MasterStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningToolWriteRequest {
  code: string;
  name: string;
  toolKind?: CleaningToolKind;
  colourCode?: string | null;
  description?: string | null;
  storageLocation?: string | null;
  restrictedAreaId?: Uuid | null;
  status?: MasterStatus;
}

export interface MasterListQuery {
  search?: string;
  includeInactive?: boolean;
}

/* ============================================================ cleanable assets */

/**
 * A thing that gets cleaned. Not the same as a piece of equipment: a chopping board, a drain
 * and a corridor floor are all cleanable and none of them is an asset the maintenance module
 * would recognise. `equipmentId` links the two where they *are* the same object.
 */
export interface CleanableAssetDto {
  id: Uuid;
  code: string;
  name: string;
  assetTypeId: Uuid;
  assetTypeName?: string;
  areaId: Uuid;
  areaName?: string;
  floorId?: Uuid | null;
  floorName?: string | null;
  locationId: Uuid | null;
  locationName?: string | null;
  /** "Ground Floor · Main Kitchen · Hot Line" — assembled server-side, never by a client. */
  locationPath?: string;
  equipmentId: Uuid | null;
  equipmentAssetId?: string | null;
  equipmentName?: string | null;
  description: string | null;
  positionNote: string | null;
  riskLevel: CleaningRiskLevel;
  foodContact: FoodContactClass;
  /** False while the asset is out of use — the generator skips it rather than raising work. */
  isAvailable: boolean;
  unavailableReason: string | null;
  imageMediaId: Uuid | null;
  imageUrl: string | null;
  notes: string | null;
  status: MasterStatus;
  /** Live counters, recomputed from the tasks themselves on every change. */
  openTaskCount?: number;
  overdueTaskCount?: number;
  ruleCount?: number;
  lastCleanedAt?: IsoDateTime | null;
  lastCleanedByName?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleanableAssetCreateRequest {
  name: string;
  assetTypeId: Uuid;
  areaId: Uuid;
  /** Server-generated from the area and type segments when omitted. */
  code?: string;
  locationId?: Uuid | null;
  equipmentId?: Uuid | null;
  description?: string | null;
  positionNote?: string | null;
  riskLevel?: CleaningRiskLevel;
  foodContact?: FoodContactClass;
  imageMediaId?: Uuid | null;
  notes?: string | null;
}

export interface CleanableAssetUpdateRequest {
  name?: string;
  assetTypeId?: Uuid;
  areaId?: Uuid;
  locationId?: Uuid | null;
  equipmentId?: Uuid | null;
  description?: string | null;
  positionNote?: string | null;
  riskLevel?: CleaningRiskLevel;
  foodContact?: FoodContactClass;
  imageMediaId?: Uuid | null;
  notes?: string | null;
  status?: MasterStatus;
}

/** Taking an asset out of service, and putting it back. Its own endpoint, so it is audited. */
export interface CleanableAssetAvailabilityRequest {
  isAvailable: boolean;
  reason?: string | null;
}

export interface CleanableAssetListQuery extends PageQuery {
  areaId?: Uuid;
  floorId?: Uuid;
  assetTypeId?: Uuid;
  riskLevel?: CleaningRiskLevel;
  foodContact?: FoodContactClass;
  status?: MasterStatus;
  equipmentId?: Uuid;
  availableOnly?: boolean;
  /** Assets no cleaning rule reaches — the register's most useful single filter. */
  withoutRules?: boolean;
}

/* ================================================================= procedures */

export interface CleaningProcedureStepDto {
  id: Uuid;
  versionId: Uuid;
  stepNumber: number;
  title: string;
  instruction: string | null;
  chemicalId: Uuid | null;
  chemicalName?: string | null;
  toolId: Uuid | null;
  toolName?: string | null;
  durationSeconds: number | null;
  isMandatory: boolean;
  requiresPhoto: boolean;
}

export interface CleaningProcedureStepWriteRequest {
  stepNumber: number;
  title: string;
  instruction?: string | null;
  chemicalId?: Uuid | null;
  toolId?: Uuid | null;
  durationSeconds?: number | null;
  isMandatory?: boolean;
  requiresPhoto?: boolean;
}

export interface CleaningProcedureChemicalDto {
  chemicalId: Uuid;
  chemicalName: string;
  chemicalKind: CleaningChemicalKind;
  concentrationPpm: number | null;
  dilutionRatio: string | null;
  contactTimeSeconds: number | null;
  note: string | null;
}

export interface CleaningProcedureToolDto {
  toolId: Uuid;
  toolName: string;
  toolKind: CleaningToolKind;
  colourCode: string | null;
  note: string | null;
}

/**
 * One immutable-once-published revision of a procedure. Tasks pin a version id, so editing a
 * procedure never rewrites what somebody already did.
 */
export interface CleaningProcedureVersionDto {
  id: Uuid;
  procedureId: Uuid;
  procedureName?: string;
  procedureCode?: string;
  version: number;
  status: CleaningProcedureVersionStatus;
  methodId: Uuid | null;
  methodName?: string | null;
  standardId: Uuid | null;
  standardName?: string | null;
  standardAcceptanceText?: string | null;
  publishedAt: IsoDateTime | null;
  publishedByName?: string | null;
  archivedAt: IsoDateTime | null;
  changeNote: string | null;
  ppeRequired: string | null;
  requiresDisassembly: boolean;
  requiresRinse: boolean;
  requiresFinalRinse: boolean;
  requiresDrying: boolean;
  contactTimeSeconds: number | null;
  estimatedMinutes: number | null;
  safetyNotes: string | null;
  steps: CleaningProcedureStepDto[];
  chemicals: CleaningProcedureChemicalDto[];
  tools: CleaningProcedureToolDto[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningProcedureDto {
  id: Uuid;
  code: string;
  name: string;
  description: string | null;
  currentVersionId: Uuid | null;
  /** The published version's number, or null while the procedure has never been published. */
  currentVersion: number | null;
  status: MasterStatus;
  versionCount?: number;
  ruleCount?: number;
  hasDraft?: boolean;
  /** Present on the detail read only. */
  versions?: CleaningProcedureVersionDto[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningProcedureWriteRequest {
  code: string;
  name: string;
  description?: string | null;
  status?: MasterStatus;
}

/**
 * Creating or editing a draft version. Steps arrive whole rather than one at a time: a
 * procedure is read as an ordered list, and PATCHing step 4 into a version whose step 3 was
 * deleted by somebody else is a race with no useful answer.
 */
export interface CleaningProcedureVersionWriteRequest {
  methodId?: Uuid | null;
  standardId?: Uuid | null;
  changeNote?: string | null;
  ppeRequired?: string | null;
  requiresDisassembly?: boolean;
  requiresRinse?: boolean;
  requiresFinalRinse?: boolean;
  requiresDrying?: boolean;
  contactTimeSeconds?: number | null;
  estimatedMinutes?: number | null;
  safetyNotes?: string | null;
  steps?: CleaningProcedureStepWriteRequest[];
  chemicals?: Array<{
    chemicalId: Uuid;
    concentrationPpm?: number | null;
    dilutionRatio?: string | null;
    contactTimeSeconds?: number | null;
    note?: string | null;
  }>;
  tools?: Array<{ toolId: Uuid; note?: string | null }>;
}

/* ====================================================================== rules */

export interface CleaningRuleSkillDto {
  skillId: Uuid;
  skillName: string;
  requiredLevel: SkillLevel;
}

/**
 * What must be cleaned, how often, to what standard, and who is allowed to do it.
 *
 * The frequency *kind* is a closed set because each member needs matching code in the engine;
 * its parameters (interval, day, shift, due window) are data on the row.
 */
export interface CleaningRuleDto {
  id: Uuid;
  code: string;
  taskName: string;
  purpose: string | null;

  scope: CleaningRuleScope;
  cleanableAssetId: Uuid | null;
  cleanableAssetName?: string | null;
  assetTypeId: Uuid | null;
  assetTypeName?: string | null;
  areaId: Uuid | null;
  areaName?: string | null;

  procedureId: Uuid;
  procedureName?: string;
  procedureCode?: string;
  /** Null while the procedure has no published version — such a rule cannot raise work. */
  publishedVersionId?: Uuid | null;

  frequencyKind: CleaningFrequencyKind;
  intervalDays: number | null;
  /** 0 = Sunday .. 6 = Saturday. */
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  shiftId: Uuid | null;
  shiftName?: string | null;
  dueTime: ClockTime | null;
  dueWithinMinutes: number | null;

  triggers: CleaningTriggerEvent[];
  requiredSkills: CleaningRuleSkillDto[];

  responsibleRole: UserRole | null;
  estimatedMinutes: number | null;
  priority: CleaningTaskPriority;

  requiresVerification: boolean;
  verificationMethod: CleaningVerificationMethod | null;
  verifierRole: UserRole | null;
  standardId: Uuid | null;
  standardName?: string | null;

  isActive: boolean;
  /** How many assets this rule currently resolves to. Zero is a configuration mistake. */
  targetAssetCount?: number;
  openTaskCount?: number;
  lastGeneratedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningRuleWriteRequest {
  code: string;
  taskName: string;
  purpose?: string | null;
  scope: CleaningRuleScope;
  cleanableAssetId?: Uuid | null;
  assetTypeId?: Uuid | null;
  areaId?: Uuid | null;
  procedureId: Uuid;
  frequencyKind: CleaningFrequencyKind;
  intervalDays?: number | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  shiftId?: Uuid | null;
  dueTime?: ClockTime | null;
  dueWithinMinutes?: number | null;
  triggers?: CleaningTriggerEvent[];
  requiredSkills?: Array<{ skillId: Uuid; requiredLevel?: SkillLevel }>;
  responsibleRole?: UserRole | null;
  estimatedMinutes?: number | null;
  priority?: CleaningTaskPriority;
  requiresVerification?: boolean;
  verificationMethod?: CleaningVerificationMethod | null;
  verifierRole?: UserRole | null;
  standardId?: Uuid | null;
  isActive?: boolean;
}

export type CleaningRuleUpdateRequest = Partial<CleaningRuleWriteRequest>;

export interface CleaningRuleListQuery extends PageQuery {
  scope?: CleaningRuleScope;
  areaId?: Uuid;
  assetTypeId?: Uuid;
  cleanableAssetId?: Uuid;
  procedureId?: Uuid;
  frequencyKind?: CleaningFrequencyKind;
  priority?: CleaningTaskPriority;
  includeInactive?: boolean;
  /** Rules whose procedure has no published version, or which resolve to no asset at all. */
  problemsOnly?: boolean;
}

/** What a rule would raise right now, shown before it is saved or run by hand. */
export interface CleaningRulePreviewDto {
  ruleId: Uuid;
  taskName: string;
  targets: Array<Pick<CleanableAssetDto, 'id' | 'code' | 'name' | 'areaName' | 'locationPath'>>;
  nextDueAt: IsoDateTime | null;
  /** Non-empty when the rule cannot currently raise work, in plain words. */
  blockers: string[];
}

/* ====================================================================== tasks */

export interface CleaningTaskStepResultDto {
  id: Uuid;
  taskId: Uuid;
  stepId: Uuid;
  stepNumber: number;
  title: string;
  instruction: string | null;
  chemicalName: string | null;
  toolName: string | null;
  durationSeconds: number | null;
  isMandatory: boolean;
  requiresPhoto: boolean;
  status: CleaningStepStatus;
  skipReason: string | null;
  note: string | null;
  performedByName: string | null;
  performedAt: IsoDateTime | null;
}

export interface CleaningTaskEvidenceDto {
  id: Uuid;
  taskId: Uuid;
  mediaId: Uuid;
  /** Signed and expiring; minted for the viewing user on every read. */
  url: string;
  kind: CleaningEvidenceKind;
  stepId: Uuid | null;
  caption: string | null;
  uploadedById: Uuid;
  uploadedByName: string | null;
  createdAt: IsoDateTime;
}

export interface CleaningVerificationResultDto {
  id: Uuid;
  verificationId: Uuid;
  label: string;
  passed: boolean | null;
  measuredValue: number | null;
  measureUnit: string | null;
  expectedMin: number | null;
  expectedMax: number | null;
  note: string | null;
}

export interface CleaningVerificationDto {
  id: Uuid;
  taskId: Uuid;
  /** 1 for the first check, 2 for the recheck after a reclean, and so on. */
  attempt: number;
  method: CleaningVerificationMethod;
  outcome: CleaningVerificationOutcome;
  standardId: Uuid | null;
  standardName: string | null;
  verifiedById: Uuid;
  verifiedByName: string | null;
  verifiedAt: IsoDateTime;
  failureReason: string | null;
  note: string | null;
  results: CleaningVerificationResultDto[];
}

export interface CleaningTaskAssignmentDto {
  id: Uuid;
  taskId: Uuid;
  assignedToId: Uuid | null;
  assignedToName: string | null;
  assignedById: Uuid | null;
  assignedByName: string | null;
  reason: CleaningAssignmentReason;
  strategy: CleaningAssignmentStrategy | null;
  /** Why this person and not another — the candidate list and the scores, as recorded. */
  decision: Record<string, unknown> | null;
  note: string | null;
  isActive: boolean;
  createdAt: IsoDateTime;
}

export interface CleaningTaskStateChangeDto {
  id: Uuid;
  taskId: Uuid;
  fromStatus: CleaningTaskStatus | null;
  toStatus: CleaningTaskStatus;
  actorId: Uuid | null;
  actorName: string | null;
  actorRole: string | null;
  source: CleaningEventSource;
  note: string | null;
  createdAt: IsoDateTime;
}

export interface CleaningCorrectiveActionDto {
  id: Uuid;
  taskId: Uuid;
  taskName?: string;
  verificationId: Uuid | null;
  cleanableAssetId: Uuid;
  cleanableAssetName?: string;
  areaId: Uuid;
  areaName?: string;
  failureSummary: string;
  immediateAction: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  assignedToId: Uuid | null;
  assignedToName: string | null;
  dueAt: IsoDateTime | null;
  status: CorrectiveActionStatus;
  requiresVerification: boolean;
  raisedById: Uuid | null;
  raisedByName: string | null;
  closedById: Uuid | null;
  closedByName: string | null;
  closedAt: IsoDateTime | null;
  closureNote: string | null;
  /** Derived from `dueAt` and now. */
  isOverdue: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * One occurrence of one rule against one asset.
 *
 * `canStart` / `canComplete` / `canVerify` are computed per viewing user, so a phone renders
 * exactly the buttons the server would accept — the state machine is asked once, on the
 * server, rather than reimplemented in two clients.
 */
export interface CleaningTaskDto {
  id: Uuid;
  ruleId: Uuid;
  ruleCode?: string;
  taskName: string;

  cleanableAssetId: Uuid;
  cleanableAssetCode?: string;
  cleanableAssetName?: string;
  assetTypeName?: string;
  riskLevel?: CleaningRiskLevel;
  foodContact?: FoodContactClass;
  areaId: Uuid;
  areaName?: string;
  locationPath?: string;

  procedureVersionId: Uuid;
  procedureName?: string;
  procedureVersion?: number;
  methodName?: string | null;

  occurrenceKey: string;
  triggerEventId: Uuid | null;
  triggerEventType: CleaningTriggerEvent;

  priority: CleaningTaskPriority;
  estimatedMinutes: number | null;
  shiftId: Uuid | null;
  shiftName?: string | null;
  scheduledAt: IsoDateTime;
  dueAt: IsoDateTime | null;

  status: CleaningTaskStatus;
  assignedToId: Uuid | null;
  assignedToName: string | null;
  assignedAt: IsoDateTime | null;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  completedByName: string | null;
  closedAt: IsoDateTime | null;
  cancelledReason: string | null;

  requiresVerification: boolean;
  verificationMethod: CleaningVerificationMethod | null;
  verifierRole: UserRole | null;
  verifiedAt: IsoDateTime | null;
  verifiedByName: string | null;
  recleanCount: number;
  completionNote: string | null;

  /** Derived on read, never stored. */
  isOverdue: boolean;
  minutesOverdue: number | null;
  isOpen: boolean;
  stepCount?: number;
  stepsDone?: number;
  evidenceCount?: number;

  /** What this viewer may do right now. Absent on list reads that carry no viewer context. */
  canStart?: boolean;
  canComplete?: boolean;
  canVerify?: boolean;

  /** Detail read only. */
  steps?: CleaningTaskStepResultDto[];
  evidence?: CleaningTaskEvidenceDto[];
  verifications?: CleaningVerificationDto[];
  assignments?: CleaningTaskAssignmentDto[];
  history?: CleaningTaskStateChangeDto[];
  correctiveActions?: CleaningCorrectiveActionDto[];
  procedure?: CleaningProcedureVersionDto;

  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningTaskListQuery extends PageQuery {
  status?: CleaningTaskStatus;
  priority?: CleaningTaskPriority;
  areaId?: Uuid;
  floorId?: Uuid;
  cleanableAssetId?: Uuid;
  assetTypeId?: Uuid;
  ruleId?: Uuid;
  shiftId?: Uuid;
  assignedTo?: Uuid;
  /** Resolved to the caller server-side, so a client cannot ask for somebody else's list. */
  mine?: boolean;
  openOnly?: boolean;
  overdueOnly?: boolean;
  unassignedOnly?: boolean;
  awaitingVerification?: boolean;
  dueFrom?: IsoDateTime;
  dueTo?: IsoDateTime;
}

export interface CleaningTaskAssignRequest {
  /** Null hands the task back to the pool as UNASSIGNED. */
  assignedTo: Uuid | null;
  note?: string | null;
}

export interface CleaningTaskStartRequest {
  note?: string | null;
}

export interface CleaningTaskStepUpdateRequest {
  status: CleaningStepStatus;
  skipReason?: string | null;
  note?: string | null;
}

export interface CleaningTaskCompleteRequest {
  note?: string | null;
  /** Steps not reported individually may be settled in one call at completion. */
  steps?: Array<{ stepId: Uuid; status: CleaningStepStatus; skipReason?: string | null }>;
  evidence?: Array<{
    mediaId: Uuid;
    kind?: CleaningEvidenceKind;
    stepId?: Uuid | null;
    caption?: string | null;
  }>;
}

export interface CleaningTaskEvidenceRequest {
  mediaId: Uuid;
  kind?: CleaningEvidenceKind;
  stepId?: Uuid | null;
  caption?: string | null;
}

export interface CleaningTaskCancelRequest {
  reason: string;
}

export interface CleaningVerifyRequest {
  outcome: CleaningVerificationOutcome;
  /** Defaults to the method the rule pinned onto the task. */
  method?: CleaningVerificationMethod;
  failureReason?: string | null;
  note?: string | null;
  results?: Array<{
    label: string;
    passed?: boolean | null;
    measuredValue?: number | null;
    measureUnit?: string | null;
    note?: string | null;
  }>;
  evidence?: Array<{ mediaId: Uuid; caption?: string | null }>;
  /** On a FAIL: raise the corrective action in the same call. */
  correctiveAction?: {
    immediateAction?: string | null;
    assignedTo?: Uuid | null;
    dueAt?: IsoDateTime | null;
  };
}

export interface CorrectiveActionUpdateRequest {
  rootCause?: string | null;
  correctiveAction?: string | null;
  preventiveAction?: string | null;
  immediateAction?: string | null;
  assignedTo?: Uuid | null;
  dueAt?: IsoDateTime | null;
  status?: CorrectiveActionStatus;
  closureNote?: string | null;
}

export interface CorrectiveActionListQuery extends PageQuery {
  status?: CorrectiveActionStatus;
  areaId?: Uuid;
  assignedTo?: Uuid;
  mine?: boolean;
  openOnly?: boolean;
  overdueOnly?: boolean;
}

/* ================================================= events, reports and triggers */

export interface CleaningEventDto {
  id: Uuid;
  eventType: CleaningTriggerEvent;
  source: CleaningEventSource;
  occurredAt: IsoDateTime;
  cleanableAssetId: Uuid | null;
  cleanableAssetName: string | null;
  areaId: Uuid | null;
  areaName: string | null;
  equipmentId: Uuid | null;
  equipmentName: string | null;
  shiftId: Uuid | null;
  assetTypeId: Uuid | null;
  reportedById: Uuid | null;
  reportedByName: string | null;
  note: string | null;
  payload: Record<string, unknown> | null;
  processedAt: IsoDateTime | null;
  tasksCreated: number;
  processError: string | null;
  createdAt: IsoDateTime;
}

/**
 * "This needs cleaning." The whole point of the module reaching every user.
 *
 * One of `cleanableAssetId` or `areaId` is required and that is the only hard requirement: a
 * report naming just an area is resolved against that area's general cleanable asset, so a
 * person who does not know the register can still raise real, assignable work.
 */
export interface CleaningReportRequest {
  /** Defaults to MANUAL_TRIGGER — "it needs cleaning", with no incident behind it. */
  eventType?: CleaningTriggerEvent;
  cleanableAssetId?: Uuid | null;
  areaId?: Uuid | null;
  equipmentId?: Uuid | null;
  note?: string | null;
  /** Raises the generated work above its rule's default. Ignored when it would lower it. */
  priority?: CleaningTaskPriority;
  photoMediaIds?: Uuid[];
}

/** What a report actually produced, so the reporter is never left guessing. */
export interface CleaningReportResultDto {
  event: CleaningEventDto;
  tasks: CleaningTaskDto[];
  /** True when no rule matched and the ad-hoc clean-up task carried the report instead. */
  usedFallback: boolean;
  message: string;
}

/** The machine-to-machine ingest. Same engine, different door, Manager and above. */
export interface CleaningEventPublishRequest {
  eventType: CleaningTriggerEvent;
  source?: CleaningEventSource;
  occurredAt?: IsoDateTime;
  cleanableAssetId?: Uuid | null;
  areaId?: Uuid | null;
  equipmentId?: Uuid | null;
  shiftId?: Uuid | null;
  assetTypeId?: Uuid | null;
  note?: string | null;
  payload?: Record<string, unknown> | null;
  /** Idempotency key: a second publish with the same value is accepted and does nothing. */
  dedupeKey?: string | null;
}

export interface CleaningEventListQuery extends PageQuery {
  eventType?: CleaningTriggerEvent;
  source?: CleaningEventSource;
  areaId?: Uuid;
  cleanableAssetId?: Uuid;
  reportedBy?: Uuid;
  mine?: boolean;
  unprocessedOnly?: boolean;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

/* ================================================================== workforce */

export interface SkillDto {
  id: Uuid;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: MasterStatus;
  holderCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface SkillWriteRequest {
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  status?: MasterStatus;
}

export interface ShiftDto {
  id: Uuid;
  code: string;
  name: string;
  startsAt: ClockTime;
  endsAt: ClockTime;
  /** True when `endsAt` is earlier than `startsAt` — a night shift. */
  crossesMidnight: boolean;
  /** 0 = Sunday .. 6 = Saturday. Empty means every day. */
  days: number[];
  sortOrder: number;
  status: MasterStatus;
  memberCount?: number;
  /** Derived from the clock, per request. */
  isCurrent?: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ShiftWriteRequest {
  code: string;
  name: string;
  startsAt: ClockTime;
  endsAt: ClockTime;
  days?: number[];
  sortOrder?: number;
  status?: MasterStatus;
}

export interface UserSkillDto {
  userId: Uuid;
  userName?: string;
  skillId: Uuid;
  skillName?: string;
  level: SkillLevel;
  certifiedAt: IsoDate | null;
  certifiedUntil: IsoDate | null;
  note: string | null;
  grantedByName?: string | null;
  /** Derived: a lapsed certificate no longer satisfies a rule that requires the skill. */
  isExpired: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface UserSkillWriteRequest {
  skillId: Uuid;
  level?: SkillLevel;
  certifiedAt?: IsoDate | null;
  certifiedUntil?: IsoDate | null;
  note?: string | null;
}

export interface UserShiftAssignmentDto {
  id: Uuid;
  userId: Uuid;
  userName?: string;
  shiftId: Uuid;
  shiftName?: string;
  shiftStartsAt?: ClockTime;
  shiftEndsAt?: ClockTime;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  isCurrent: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface UserShiftAssignmentWriteRequest {
  shiftId: Uuid;
  effectiveFrom: IsoDate;
  effectiveTo?: IsoDate | null;
}

export interface UserAreaResponsibilityDto {
  userId: Uuid;
  userName?: string;
  areaId: Uuid;
  areaName?: string;
  floorName?: string | null;
  isPrimary: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface UserAreaResponsibilityWriteRequest {
  areaId: Uuid;
  isPrimary?: boolean;
}

/** One person, seen the way the assignment engine sees them. */
export interface CleaningWorkforceMemberDto {
  userId: Uuid;
  name: string;
  username: string;
  role: UserRole;
  skills: UserSkillDto[];
  shifts: UserShiftAssignmentDto[];
  areas: UserAreaResponsibilityDto[];
  openTaskCount: number;
  overdueTaskCount: number;
  /** Whether the clock currently places them inside one of their shifts. */
  onShiftNow: boolean;
}

export interface CleaningAssignmentRuleDto {
  id: Uuid;
  /** Null is the fallback that applies to every area with no rule of its own. */
  areaId: Uuid | null;
  areaName: string | null;
  strategy: CleaningAssignmentStrategy;
  requireSkillMatch: boolean;
  requireShiftMatch: boolean;
  requireAreaMatch: boolean;
  maxOpenTasks: number;
  /**
   * When nobody satisfies every requirement, try again ignoring shift and area rather than
   * leaving the task unowned. Off by default: a supervisor deciding beats a bad guess.
   */
  allowRelaxedFallback: boolean;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CleaningAssignmentRuleWriteRequest {
  areaId?: Uuid | null;
  strategy?: CleaningAssignmentStrategy;
  requireSkillMatch?: boolean;
  requireShiftMatch?: boolean;
  requireAreaMatch?: boolean;
  maxOpenTasks?: number;
  allowRelaxedFallback?: boolean;
  isActive?: boolean;
}

/** Who the engine would pick, and why, without committing to it. */
export interface CleaningAssignmentCandidateDto {
  userId: Uuid;
  name: string;
  role: UserRole;
  openTaskCount: number;
  onShift: boolean;
  isAreaResponsible: boolean;
  isPrimaryForArea: boolean;
  hasEverySkill: boolean;
  missingSkills: string[];
  /** Higher wins. Composed from the strategy; shown so a disputed roster can be explained. */
  score: number;
  eligible: boolean;
  ineligibleReason: string | null;
}

/* ================================================== dashboards and compliance */

export interface CleaningDashboardDto {
  counts: {
    openTasks: number;
    overdueTasks: number;
    unassignedTasks: number;
    dueToday: number;
    inProgress: number;
    awaitingVerification: number;
    failedVerifications: number;
    recleanRequired: number;
    openCorrectiveActions: number;
    overdueCorrectiveActions: number;
    reportsToday: number;
    criticalAssetsUncleaned: number;
    assetsWithoutRules: number;
    expiredChemicals: number;
  };
  /** Rolling 7-day rate: closed-on-time ÷ everything that fell due. 0..100. */
  complianceRate: number;
  /** Verification pass rate over the same window. 0..100. */
  verificationPassRate: number;
  overdue: CleaningTaskDto[];
  awaitingVerification: CleaningTaskDto[];
  recentReports: CleaningEventDto[];
  byArea: AreaCleaningStatusDto[];
}

export interface AreaCleaningStatusDto {
  areaId: Uuid;
  areaName: string;
  floorName: string | null;
  openTasks: number;
  overdueTasks: number;
  dueToday: number;
  assetCount: number;
  /** 0..100, same definition as the dashboard's. */
  complianceRate: number;
  responsibleNames: string[];
}

/** The phone's landing payload. Four questions, four lists, no merged feed. */
export interface MyCleaningDto {
  assigned: CleaningTaskDto[];
  dueToday: CleaningTaskDto[];
  toVerify: CleaningTaskDto[];
  reported: CleaningEventDto[];
  correctiveActions: CleaningCorrectiveActionDto[];
  counts: {
    assigned: number;
    dueToday: number;
    overdue: number;
    toVerify: number;
    correctiveActions: number;
  };
}

export interface CleaningComplianceQuery {
  from?: IsoDate;
  to?: IsoDate;
  areaId?: Uuid;
  assetTypeId?: Uuid;
  shiftId?: Uuid;
}

export interface CleaningComplianceRowDto {
  key: string;
  label: string;
  due: number;
  completed: number;
  onTime: number;
  late: number;
  missed: number;
  verified: number;
  failed: number;
  complianceRate: number;
  onTimeRate: number;
  passRate: number;
}

/**
 * The hygiene record, cut four ways. One report rather than four, because an auditor asks the
 * same question of each dimension and the totals must agree across all of them.
 */
export interface CleaningComplianceDto {
  from: IsoDate;
  to: IsoDate;
  totals: CleaningComplianceRowDto;
  byArea: CleaningComplianceRowDto[];
  byAssetType: CleaningComplianceRowDto[];
  byShift: CleaningComplianceRowDto[];
  byPerson: CleaningComplianceRowDto[];
  /** Assets that fell due and were never cleaned in the window. The auditor's first question. */
  missedAssets: Array<{
    cleanableAssetId: Uuid;
    code: string;
    name: string;
    areaName: string;
    riskLevel: CleaningRiskLevel;
    foodContact: FoodContactClass;
    missed: number;
    lastCleanedAt: IsoDateTime | null;
  }>;
}

/**
 * The whole configuration a form needs in one request. Every write screen in both clients
 * needs the same eight lookups, and eight round trips on a phone over canteen wifi is the
 * difference between a form that opens and one that spins.
 */
export interface CleaningSetupDto {
  areas: Array<{ id: Uuid; name: string; floorId: Uuid | null; floorName: string | null }>;
  assetTypes: CleanableAssetTypeDto[];
  methods: CleaningMethodDto[];
  standards: CleaningStandardDto[];
  chemicals: CleaningChemicalDto[];
  tools: CleaningToolDto[];
  skills: SkillDto[];
  shifts: ShiftDto[];
  procedures: Array<Pick<CleaningProcedureDto, 'id' | 'code' | 'name' | 'currentVersionId'>>;
}
