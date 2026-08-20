import type { RowDataPacket } from 'mysql2/promise';
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
} from '@menuboard/shared';

/**
 * Database row shapes for the Cleaning & Hygiene tables.
 *
 * Re-exported from `models/rows.ts` so the rest of the backend keeps importing row types from
 * one place; they live here for the same reason `equipmentRows.ts` does — the module
 * contributes twenty-odd tables and burying them in the shared file would make neither
 * readable.
 *
 * Columns marked "resolved by the SELECT's joins" are not on the table. They are optional so
 * an insert-shaped object still type-checks against the same interface.
 */

/* ==================================================================== masters */

export interface CleanableAssetTypeRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  description: string | null;
  default_risk_level: CleaningRiskLevel;
  default_food_contact: FoodContactClass;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  asset_count?: number;
}

export interface CleaningMethodRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CleaningStandardRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  acceptance_text: string;
  measure_unit: string | null;
  min_value: string | number | null;
  max_value: string | number | null;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CleaningChemicalRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  supplier_name: string | null;
  supplier_entity_id: string | null;
  purpose: string | null;
  chemical_kind: CleaningChemicalKind;
  dilution_ratio: string | null;
  concentration_ppm: number | null;
  contact_time_seconds: number | null;
  application_method: string | null;
  storage_requirement: string | null;
  safety_information: string | null;
  expiry_date: string | null;
  safety_sheet_media_id: string | null;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CleaningToolRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  tool_kind: CleaningToolKind;
  colour_code: string | null;
  description: string | null;
  storage_location: string | null;
  restricted_area_id: string | null;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  restricted_area_name?: string | null;
}

/* ============================================================ cleanable assets */

export interface CleanableAssetRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  asset_type_id: string;
  area_id: string;
  location_id: string | null;
  equipment_id: string | null;
  description: string | null;
  position_note: string | null;
  risk_level: CleaningRiskLevel;
  food_contact: FoodContactClass;
  is_available: number;
  unavailable_reason: string | null;
  image_media_id: string | null;
  notes: string | null;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /* resolved by the SELECT's joins */
  asset_type_name?: string;
  area_name?: string;
  floor_id?: string | null;
  floor_name?: string | null;
  location_name?: string | null;
  room?: string | null;
  section?: string | null;
  position?: string | null;
  equipment_asset_id?: string | null;
  equipment_name?: string | null;
  open_task_count?: number;
  overdue_task_count?: number;
  rule_count?: number;
  last_cleaned_at?: string | null;
  last_cleaned_by_name?: string | null;
}

/* ================================================================= procedures */

export interface CleaningProcedureRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  description: string | null;
  current_version_id: string | null;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  current_version?: number | null;
  version_count?: number;
  rule_count?: number;
  draft_count?: number;
}

export interface CleaningProcedureVersionRow extends RowDataPacket {
  id: string;
  procedure_id: string;
  version: number;
  status: CleaningProcedureVersionStatus;
  method_id: string | null;
  standard_id: string | null;
  published_at: string | null;
  published_by: string | null;
  archived_at: string | null;
  change_note: string | null;
  ppe_required: string | null;
  requires_disassembly: number;
  requires_rinse: number;
  requires_final_rinse: number;
  requires_drying: number;
  contact_time_seconds: number | null;
  estimated_minutes: number | null;
  safety_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  procedure_name?: string;
  procedure_code?: string;
  method_name?: string | null;
  standard_name?: string | null;
  standard_acceptance_text?: string | null;
  published_by_name?: string | null;
}

export interface CleaningProcedureStepRow extends RowDataPacket {
  id: string;
  version_id: string;
  step_number: number;
  title: string;
  instruction: string | null;
  chemical_id: string | null;
  tool_id: string | null;
  duration_seconds: number | null;
  is_mandatory: number;
  requires_photo: number;
  created_at: string;
  updated_at: string;
  chemical_name?: string | null;
  tool_name?: string | null;
}

export interface CleaningProcedureChemicalRow extends RowDataPacket {
  version_id: string;
  chemical_id: string;
  concentration_ppm: number | null;
  dilution_ratio: string | null;
  contact_time_seconds: number | null;
  note: string | null;
  created_at: string;
  chemical_name?: string;
  chemical_kind?: CleaningChemicalKind;
}

export interface CleaningProcedureToolRow extends RowDataPacket {
  version_id: string;
  tool_id: string;
  note: string | null;
  created_at: string;
  tool_name?: string;
  tool_kind?: CleaningToolKind;
  colour_code?: string | null;
}

/* ====================================================================== rules */

export interface CleaningRuleRow extends RowDataPacket {
  id: string;
  code: string;
  task_name: string;
  purpose: string | null;
  scope: CleaningRuleScope;
  cleanable_asset_id: string | null;
  asset_type_id: string | null;
  area_id: string | null;
  procedure_id: string;
  frequency_kind: CleaningFrequencyKind;
  interval_days: number | null;
  day_of_week: number | null;
  day_of_month: number | null;
  shift_id: string | null;
  due_time: string | null;
  due_within_minutes: number | null;
  responsible_role: UserRole | null;
  estimated_minutes: number | null;
  priority: CleaningTaskPriority;
  requires_verification: number;
  verification_method: CleaningVerificationMethod | null;
  verifier_role: UserRole | null;
  standard_id: string | null;
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  procedure_name?: string;
  procedure_code?: string;
  published_version_id?: string | null;
  cleanable_asset_name?: string | null;
  asset_type_name?: string | null;
  area_name?: string | null;
  shift_name?: string | null;
  standard_name?: string | null;
  target_asset_count?: number;
  open_task_count?: number;
  last_generated_at?: string | null;
  /** GROUP_CONCAT of the rule's trigger events. */
  trigger_events?: string | null;
}

export interface CleaningRuleSkillRow extends RowDataPacket {
  rule_id: string;
  skill_id: string;
  required_level: SkillLevel;
  created_at: string;
  skill_name?: string;
}

export interface CleaningRuleTriggerRow extends RowDataPacket {
  rule_id: string;
  event_type: CleaningTriggerEvent;
  created_at: string;
}

/* ====================================================================== tasks */

export interface CleaningTaskRow extends RowDataPacket {
  id: string;
  rule_id: string;
  cleanable_asset_id: string;
  area_id: string;
  procedure_version_id: string;
  occurrence_key: string;
  trigger_event_id: string | null;
  trigger_event_type: CleaningTriggerEvent;
  task_name: string;
  priority: CleaningTaskPriority;
  estimated_minutes: number | null;
  shift_id: string | null;
  scheduled_at: string;
  due_at: string | null;
  status: CleaningTaskStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  closed_at: string | null;
  cancelled_reason: string | null;
  requires_verification: number;
  verification_method: CleaningVerificationMethod | null;
  verifier_role: UserRole | null;
  verified_at: string | null;
  verified_by: string | null;
  reclean_count: number;
  completion_note: string | null;
  created_at: string;
  updated_at: string;
  rule_code?: string;
  cleanable_asset_code?: string;
  cleanable_asset_name?: string;
  asset_type_name?: string;
  risk_level?: CleaningRiskLevel;
  food_contact?: FoodContactClass;
  area_name?: string;
  floor_name?: string | null;
  location_name?: string | null;
  room?: string | null;
  section?: string | null;
  position?: string | null;
  procedure_name?: string;
  procedure_version?: number;
  method_name?: string | null;
  shift_name?: string | null;
  assigned_to_name?: string | null;
  completed_by_name?: string | null;
  verified_by_name?: string | null;
  step_count?: number;
  steps_done?: number;
  evidence_count?: number;
}

export interface CleaningTaskStepResultRow extends RowDataPacket {
  id: string;
  task_id: string;
  step_id: string;
  step_number: number;
  status: CleaningStepStatus;
  skip_reason: string | null;
  note: string | null;
  performed_by: string | null;
  performed_at: string | null;
  created_at: string;
  updated_at: string;
  title?: string;
  instruction?: string | null;
  chemical_name?: string | null;
  tool_name?: string | null;
  duration_seconds?: number | null;
  is_mandatory?: number;
  requires_photo?: number;
  performed_by_name?: string | null;
}

export interface CleaningTaskEvidenceRow extends RowDataPacket {
  id: string;
  task_id: string;
  media_id: string;
  kind: CleaningEvidenceKind;
  step_id: string | null;
  caption: string | null;
  uploaded_by: string;
  created_at: string;
  deleted_at: string | null;
  uploaded_by_name?: string | null;
}

export interface CleaningTaskStateHistoryRow extends RowDataPacket {
  id: string;
  task_id: string;
  from_status: CleaningTaskStatus | null;
  to_status: CleaningTaskStatus;
  actor_id: string | null;
  actor_role: string | null;
  source: CleaningEventSource;
  note: string | null;
  created_at: string;
  actor_name?: string | null;
}

export interface CleaningTaskAssignmentRow extends RowDataPacket {
  id: string;
  task_id: string;
  assigned_to: string | null;
  assigned_by: string | null;
  reason: CleaningAssignmentReason;
  strategy: CleaningAssignmentStrategy | null;
  decision: string | null;
  note: string | null;
  is_active: number;
  created_at: string;
  assigned_to_name?: string | null;
  assigned_by_name?: string | null;
}

export interface CleaningVerificationRow extends RowDataPacket {
  id: string;
  task_id: string;
  attempt: number;
  method: CleaningVerificationMethod;
  outcome: CleaningVerificationOutcome;
  standard_id: string | null;
  verified_by: string;
  verified_at: string;
  failure_reason: string | null;
  note: string | null;
  created_at: string;
  standard_name?: string | null;
  verified_by_name?: string | null;
}

export interface CleaningVerificationResultRow extends RowDataPacket {
  id: string;
  verification_id: string;
  label: string;
  passed: number | null;
  measured_value: string | number | null;
  measure_unit: string | null;
  expected_min: string | number | null;
  expected_max: string | number | null;
  note: string | null;
  created_at: string;
}

export interface CleaningCorrectiveActionRow extends RowDataPacket {
  id: string;
  task_id: string;
  verification_id: string | null;
  cleanable_asset_id: string;
  area_id: string;
  failure_summary: string;
  immediate_action: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  assigned_to: string | null;
  due_at: string | null;
  status: CorrectiveActionStatus;
  requires_verification: number;
  raised_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  closure_note: string | null;
  created_at: string;
  updated_at: string;
  task_name?: string;
  cleanable_asset_name?: string;
  area_name?: string;
  assigned_to_name?: string | null;
  raised_by_name?: string | null;
  closed_by_name?: string | null;
}

/* ===================================================================== events */

export interface CleaningEventRow extends RowDataPacket {
  id: string;
  event_type: CleaningTriggerEvent;
  source: CleaningEventSource;
  occurred_at: string;
  cleanable_asset_id: string | null;
  area_id: string | null;
  equipment_id: string | null;
  shift_id: string | null;
  asset_type_id: string | null;
  reported_by: string | null;
  note: string | null;
  payload: string | null;
  dedupe_key: string | null;
  processed_at: string | null;
  tasks_created: number;
  process_error: string | null;
  created_at: string;
  cleanable_asset_name?: string | null;
  area_name?: string | null;
  equipment_name?: string | null;
  reported_by_name?: string | null;
}

/* ================================================================== workforce */

export interface SkillRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  holder_count?: number;
}

export interface ShiftRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  starts_at: string;
  ends_at: string;
  crosses_midnight: number;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  member_count?: number;
  /** GROUP_CONCAT of `shift_days.day_of_week`. */
  day_numbers?: string | null;
}

export interface ShiftDayRow extends RowDataPacket {
  shift_id: string;
  day_of_week: number;
  created_at: string;
}

export interface UserSkillRow extends RowDataPacket {
  user_id: string;
  skill_id: string;
  level: SkillLevel;
  certified_at: string | null;
  certified_until: string | null;
  note: string | null;
  granted_by: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  skill_name?: string;
  granted_by_name?: string | null;
}

export interface UserShiftAssignmentRow extends RowDataPacket {
  id: string;
  user_id: string;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  shift_name?: string;
  shift_starts_at?: string;
  shift_ends_at?: string;
}

export interface UserAreaResponsibilityRow extends RowDataPacket {
  user_id: string;
  area_id: string;
  is_primary: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  area_name?: string;
  floor_name?: string | null;
}

export interface CleaningAssignmentRuleRow extends RowDataPacket {
  id: string;
  area_id: string | null;
  strategy: CleaningAssignmentStrategy;
  require_skill_match: number;
  require_shift_match: number;
  require_area_match: number;
  max_open_tasks: number;
  allow_relaxed_fallback: number;
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  area_name?: string | null;
}

/* ============================================ aggregate rows for the dashboards */

/** One row per area from the dashboard's grouped query. */
export interface AreaCleaningStatusRow extends RowDataPacket {
  area_id: string;
  area_name: string;
  floor_name: string | null;
  open_tasks: number;
  overdue_tasks: number;
  due_today: number;
  asset_count: number;
  closed_on_time: number;
  fell_due: number;
}

/** One row per grouping key from the compliance report's queries. */
export interface CleaningComplianceRow extends RowDataPacket {
  group_key: string;
  group_label: string;
  due_count: number;
  completed_count: number;
  on_time_count: number;
  late_count: number;
  missed_count: number;
  verified_count: number;
  failed_count: number;
}

export interface CleaningMissedAssetRow extends RowDataPacket {
  cleanable_asset_id: string;
  code: string;
  name: string;
  area_name: string;
  risk_level: CleaningRiskLevel;
  food_contact: FoodContactClass;
  missed: number;
  last_cleaned_at: string | null;
}

/** The dashboard's single COUNT-of-everything row. */
export interface CleaningCountsRow extends RowDataPacket {
  open_tasks: number;
  overdue_tasks: number;
  unassigned_tasks: number;
  due_today: number;
  in_progress: number;
  awaiting_verification: number;
  failed_verifications: number;
  reclean_required: number;
}

/** The dashboard's rolling-window compliance figures, one row. */
export interface CleaningWindowRow extends RowDataPacket {
  fell_due: number;
  on_time: number;
  verified: number;
  failed: number;
}

export interface CandidateRow extends RowDataPacket {
  id: string;
  name: string;
  role: UserRole;
  open_task_count: number;
  on_shift: number;
  is_area_responsible: number;
  is_primary_for_area: number;
  skills_held: number;
  last_assigned_at: string | null;
}
