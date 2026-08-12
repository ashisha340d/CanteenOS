import type { RowDataPacket } from 'mysql2/promise';
import type {
  CallOutcome,
  CallStatus,
  CaptureSource,
  EquipmentDocumentType,
  EquipmentStatus,
  EquipmentSupplierRole,
  MaintenanceActivityType,
  MaintenanceAttachmentKind,
  MaintenanceFrequency,
  MaintenancePriority,
  MaintenanceRequestKind,
  MaintenanceTicketStatus,
  MasterStatus,
  ProblemCategory,
} from '@menuboard/shared';

/**
 * Database row shapes for 025_equipment_maintenance.sql.
 *
 * Re-exported from `models/rows.ts`, so the rest of the backend keeps importing row types from
 * one place; they live here only because this module contributes as many tables as the rest of
 * the schema put together.
 *
 * Columns marked "resolved by the SELECT's joins" are not on the table — they come from the
 * repository's join list and are optional so an insert-shaped object still type-checks.
 */

export interface EquipmentFloorRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  level_index: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  area_count?: number;
  equipment_count?: number;
  floor_plan_count?: number;
}

export interface EquipmentAreaRow extends RowDataPacket {
  id: string;
  floor_id: string;
  code: string;
  name: string;
  asset_segment: string;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  floor_name?: string;
  equipment_count?: number;
}

export interface EquipmentLocationRow extends RowDataPacket {
  id: string;
  area_id: string;
  name: string;
  room: string | null;
  section: string | null;
  position: string | null;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  area_name?: string;
  floor_id?: string;
  floor_name?: string;
  equipment_count?: number;
}

export interface EquipmentCategoryRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  asset_segment: string;
  description: string | null;
  default_frequency: MaintenanceFrequency | null;
  default_interval_days: number | null;
  sort_order: number;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  equipment_count?: number;
}

export interface EquipmentSupplierRow extends RowDataPacket {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  service_category: string | null;
  service_area: string | null;
  notes: string | null;
  entity_id: string | null;
  status: MasterStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  entity_name?: string | null;
  equipment_count?: number;
  open_ticket_count?: number;
  /** Comma-joined by GROUP_CONCAT; split by the mapper. */
  category_ids?: string | null;
  category_names?: string | null;
}

export interface SupplierContactRow extends RowDataPacket {
  id: string;
  supplier_id: string;
  name: string;
  role: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  is_primary: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface EquipmentSupplierLinkRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  supplier_id: string;
  role: EquipmentSupplierRole;
  is_default: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  supplier_name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  contact_person?: string | null;
}

export interface EquipmentRow extends RowDataPacket {
  id: string;
  asset_id: string;
  name: string;
  equipment_type: string | null;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  category_id: string | null;
  location_id: string | null;
  status: EquipmentStatus;
  status_note: string | null;
  status_changed_at: string | null;
  image_media_id: string | null;
  specifications: string | null;
  purchase_date: string | null;
  installation_date: string | null;
  purchase_price: string | number | null;
  invoice_number: string | null;
  supplier_name: string | null;
  warranty_expiry: string | null;
  last_maintenance_at: string | null;
  next_maintenance_at: string | null;
  open_ticket_count: number;
  critical_ticket_count: number;
  qr_code: string | null;
  nfc_tag_id: string | null;
  telemetry_device_id: string | null;
  notes: string | null;
  captured_via: CaptureSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Resolved by the SELECT's joins. */
  category_name?: string | null;
  location_name?: string | null;
  room?: string | null;
  section?: string | null;
  position?: string | null;
  area_id?: string | null;
  area_name?: string | null;
  floor_id?: string | null;
  floor_name?: string | null;
  created_by_name?: string | null;
}

export interface EquipmentDocumentRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  media_id: string;
  doc_type: EquipmentDocumentType;
  title: string | null;
  extracted: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  file_name?: string;
  mime_type?: string;
  size_bytes?: string | number;
  uploaded_by_name?: string;
}

export interface EquipmentWarrantyRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  provider: string | null;
  policy_number: string | null;
  start_date: string | null;
  expiry_date: string | null;
  months: number | null;
  terms: string | null;
  document_id: string | null;
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FloorPlanRow extends RowDataPacket {
  id: string;
  floor_id: string;
  name: string;
  media_id: string;
  width: number | null;
  height: number | null;
  is_active: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  floor_name?: string;
  position_count?: number;
}

export interface FloorPlanPositionRow extends RowDataPacket {
  id: string;
  floor_plan_id: string;
  equipment_id: string;
  x: string | number;
  y: string | number;
  placed_by: string | null;
  created_at: string;
  updated_at: string;
  /** Resolved by the SELECT's joins so one request paints the whole plan. */
  asset_id?: string;
  equipment_name?: string;
  status?: EquipmentStatus;
  image_media_id?: string | null;
  category_name?: string | null;
  open_ticket_count?: number;
  next_maintenance_at?: string | null;
}

export interface MaintenanceScheduleRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  title: string;
  frequency: MaintenanceFrequency;
  interval_days: number | null;
  anchor_date: string;
  last_performed_at: string | null;
  next_due_at: string;
  reminder_days: number;
  assigned_to: string | null;
  supplier_id: string | null;
  instructions: string | null;
  is_active: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  equipment_name?: string;
  asset_id?: string;
  assigned_to_name?: string | null;
  supplier_name?: string | null;
}

export interface MaintenanceTicketRow extends RowDataPacket {
  id: string;
  ticket_number: string;
  business_date: string;
  daily_sequence: number;
  equipment_id: string;
  kind: MaintenanceRequestKind;
  status: MaintenanceTicketStatus;
  priority: MaintenancePriority;
  title: string;
  description: string | null;
  problem_category: ProblemCategory | null;
  reported_by: string;
  reported_at: string;
  acknowledged_at: string | null;
  assigned_to: string | null;
  supplier_id: string | null;
  scheduled_at: string | null;
  resolved_at: string | null;
  verified_at: string | null;
  closed_at: string | null;
  resolution_notes: string | null;
  parts_required: string | null;
  cost_amount: string | number | null;
  schedule_id: string | null;
  captured_via: CaptureSource;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Resolved by the SELECT's joins — every ticket view needs all of it. */
  reported_by_name?: string;
  assigned_to_name?: string | null;
  supplier_name?: string | null;
  supplier_phone?: string | null;
  supplier_whatsapp?: string | null;
  asset_id?: string;
  equipment_name?: string;
  equipment_image_media_id?: string | null;
  category_name?: string | null;
  location_name?: string | null;
  room?: string | null;
  section?: string | null;
  area_name?: string | null;
  floor_name?: string | null;
  attachment_count?: number;
}

export interface MaintenanceProblemRow extends RowDataPacket {
  id: string;
  ticket_id: string;
  category: ProblemCategory;
  description: string | null;
  ai_suggested_category: ProblemCategory | null;
  ai_confidence: string | number | null;
  confirmed_by_user: number;
  created_by: string | null;
  created_at: string;
}

export interface MaintenanceAttachmentRow extends RowDataPacket {
  id: string;
  ticket_id: string;
  media_id: string;
  kind: MaintenanceAttachmentKind;
  transcript: string | null;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  file_name?: string;
  mime_type?: string;
  duration_ms?: number | null;
  uploaded_by_name?: string;
}

export interface MaintenanceAssignmentRow extends RowDataPacket {
  id: string;
  ticket_id: string;
  assigned_to: string | null;
  supplier_id: string | null;
  technician_name: string | null;
  technician_phone: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
  assigned_by: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  assigned_to_name?: string | null;
  supplier_name?: string | null;
  assigned_by_name?: string | null;
}

export interface MaintenanceActivityRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  ticket_id: string | null;
  type: MaintenanceActivityType;
  summary: string;
  detail: string | null;
  metadata: string | null;
  actor_id: string | null;
  actor_role: string | null;
  source: CaptureSource;
  created_at: string;
  actor_name?: string | null;
}

export interface EquipmentStatusHistoryRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  from_status: EquipmentStatus | null;
  to_status: EquipmentStatus;
  note: string | null;
  ticket_id: string | null;
  changed_by: string | null;
  created_at: string;
  changed_by_name?: string | null;
}

export interface EquipmentLocationHistoryRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_path: string | null;
  to_path: string | null;
  note: string | null;
  moved_by: string | null;
  created_at: string;
  moved_by_name?: string | null;
}

export interface EquipmentCallLogRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  ticket_id: string | null;
  supplier_id: string | null;
  contact_id: string | null;
  phone_number: string;
  called_by: string;
  called_at: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  duration_seconds: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  supplier_name?: string | null;
  called_by_name?: string;
}

export interface EquipmentWhatsappLogRow extends RowDataPacket {
  id: string;
  equipment_id: string;
  ticket_id: string | null;
  supplier_id: string | null;
  phone_number: string;
  message: string;
  media_ids: string | null;
  sent_by: string;
  sent_at: string;
  created_at: string;
  supplier_name?: string | null;
  sent_by_name?: string;
}

/** Aggregate row behind the dashboard's counter strip; every field is computed. */
export interface EquipmentDashboardCountsRow extends RowDataPacket {
  total_equipment: number;
  operational: number;
  needing_attention: number;
  out_of_service: number;
  maintenance_due: number;
  maintenance_overdue: number;
  open_problems: number;
  critical_problems: number;
  open_tickets: number;
  technician_visits_pending: number;
  parts_required: number;
  supplier_follow_ups: number;
  warranty_expiring: number;
}
