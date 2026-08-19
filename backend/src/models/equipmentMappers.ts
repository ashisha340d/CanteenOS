import {
  warrantyStatusFor,
  type EquipmentAreaDto,
  type EquipmentCallLogDto,
  type EquipmentCategoryDto,
  type EquipmentDocumentDto,
  type EquipmentDto,
  type EquipmentFloorDto,
  type EquipmentLocationDto,
  type EquipmentLocationHistoryDto,
  type EquipmentSpecificationsDto,
  type EquipmentStatusHistoryDto,
  type EquipmentSupplierDto,
  type EquipmentSupplierLinkDto,
  type EquipmentWarrantyDto,
  type EquipmentWhatsappLogDto,
  type DocumentExtractionDto,
  type FloorPlanDto,
  type FloorPlanPositionDto,
  type MaintenanceActivityDto,
  type MaintenanceAssignmentDto,
  type MaintenanceAttachmentDto,
  type MaintenanceProblemDto,
  type MaintenanceScheduleDto,
  type MaintenanceTicketDto,
  type SupplierContactDto,
} from '@menuboard/shared';
import type {
  EquipmentAreaRow,
  EquipmentCallLogRow,
  EquipmentCategoryRow,
  EquipmentDocumentRow,
  EquipmentFloorRow,
  EquipmentLocationHistoryRow,
  EquipmentLocationRow,
  EquipmentRow,
  EquipmentStatusHistoryRow,
  EquipmentSupplierLinkRow,
  EquipmentSupplierRow,
  EquipmentWarrantyRow,
  EquipmentWhatsappLogRow,
  FloorPlanPositionRow,
  FloorPlanRow,
  MaintenanceActivityRow,
  MaintenanceAssignmentRow,
  MaintenanceAttachmentRow,
  MaintenanceProblemRow,
  MaintenanceScheduleRow,
  MaintenanceTicketRow,
  SupplierContactRow,
} from './equipmentRows';
import { parseJsonColumn } from '../utils/json';
import { fromDbDate, fromDbDateTime, fromDbDateTimeRequired } from '../utils/time';
import { signMenuMediaUrl } from '../utils/mediaStorage';

/**
 * Row -> DTO for the Equipment & Maintenance module.
 *
 * Two things happen here that do not happen in the other mappers:
 *
 *  - **Signed media URLs are minted per response.** Every mapper that returns a file takes the
 *    viewing user's id, because the URL is signed for that user and expires. A stored URL
 *    would be a URL that stops working.
 *  - **Derived state is computed, never read.** Warranty status and days-until-due come from
 *    dates and today, so a record cannot sit in the database claiming a warranty is active
 *    three years after it lapsed.
 */

/** Whole days from today (UTC midnight) to an ISO date. Negative once the date has passed. */
function daysUntil(date: string | null, today = new Date()): number | null {
  if (date === null) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target.getTime() - midnight) / 86_400_000);
}

/** "Main Kitchen · Hot Line · Position 3" — assembled once here, never by a client. */
export function locationPathOf(parts: {
  floor_name?: string | null;
  area_name?: string | null;
  location_name?: string | null;
  room?: string | null;
  section?: string | null;
  position?: string | null;
}): string {
  const segments = [
    parts.floor_name,
    parts.area_name,
    parts.location_name,
    parts.room,
    parts.section,
    parts.position,
  ].filter((segment): segment is string => typeof segment === 'string' && segment.trim() !== '');
  // A location whose room repeats its own name reads badly ("Main Kitchen · Main Kitchen").
  const deduped = segments.filter((segment, index) => segments.indexOf(segment) === index);
  return deduped.join(' · ');
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------ location tree */

export function mapEquipmentFloor(row: EquipmentFloorRow): EquipmentFloorDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    levelIndex: Number(row.level_index),
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.area_count !== undefined ? { areaCount: Number(row.area_count) } : {}),
    ...(row.equipment_count !== undefined ? { equipmentCount: Number(row.equipment_count) } : {}),
    ...(row.floor_plan_count !== undefined
      ? { hasFloorPlan: Number(row.floor_plan_count) > 0 }
      : {}),
  };
}

export function mapEquipmentArea(row: EquipmentAreaRow): EquipmentAreaDto {
  return {
    id: row.id,
    floorId: row.floor_id,
    code: row.code,
    name: row.name,
    assetSegment: row.asset_segment,
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.floor_name !== undefined ? { floorName: row.floor_name } : {}),
    ...(row.equipment_count !== undefined ? { equipmentCount: Number(row.equipment_count) } : {}),
  };
}

export function mapEquipmentLocation(row: EquipmentLocationRow): EquipmentLocationDto {
  return {
    id: row.id,
    areaId: row.area_id,
    name: row.name,
    room: row.room,
    section: row.section,
    position: row.position,
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.area_name !== undefined ? { areaName: row.area_name } : {}),
    ...(row.floor_id !== undefined && row.floor_id !== null ? { floorId: row.floor_id } : {}),
    ...(row.floor_name !== undefined ? { floorName: row.floor_name } : {}),
    ...(row.equipment_count !== undefined ? { equipmentCount: Number(row.equipment_count) } : {}),
  };
}

export function mapEquipmentCategory(row: EquipmentCategoryRow): EquipmentCategoryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    assetSegment: row.asset_segment,
    description: row.description,
    defaultFrequency: row.default_frequency,
    defaultIntervalDays: row.default_interval_days === null ? null : Number(row.default_interval_days),
    sortOrder: Number(row.sort_order),
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.equipment_count !== undefined ? { equipmentCount: Number(row.equipment_count) } : {}),
  };
}

/* -------------------------------------------------------------------- suppliers */

export function mapSupplierContact(row: SupplierContactRow): SupplierContactDto {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    isPrimary: row.is_primary === 1,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

/** GROUP_CONCAT returns 'a,b,c' or null; never an empty string entry. */
function splitConcat(value: string | null | undefined): string[] {
  if (value === null || value === undefined || value === '') return [];
  return value.split(',').filter((entry) => entry !== '');
}

export function mapEquipmentSupplier(row: EquipmentSupplierRow): EquipmentSupplierDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    serviceCategory: row.service_category,
    categoryIds: splitConcat(row.category_ids),
    serviceArea: row.service_area,
    notes: row.notes,
    entityId: row.entity_id,
    status: row.status,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.category_names !== undefined
      ? { categoryNames: splitConcat(row.category_names) }
      : {}),
    ...(row.entity_name !== undefined ? { entityName: row.entity_name } : {}),
    ...(row.equipment_count !== undefined ? { equipmentCount: Number(row.equipment_count) } : {}),
    ...(row.open_ticket_count !== undefined
      ? { openTicketCount: Number(row.open_ticket_count) }
      : {}),
  };
}

export function mapEquipmentSupplierLink(row: EquipmentSupplierLinkRow): EquipmentSupplierLinkDto {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    supplierId: row.supplier_id,
    role: row.role,
    isDefault: row.is_default === 1,
    supplierName: row.supplier_name ?? '',
    phone: row.phone ?? null,
    whatsapp: row.whatsapp ?? null,
    contactPerson: row.contact_person ?? null,
  };
}

/* -------------------------------------------------------------------- equipment */

export function mapEquipment(row: EquipmentRow, userId: string): EquipmentDto {
  const warrantyExpiry = fromDbDate(row.warranty_expiry);
  const nextMaintenance = fromDbDate(row.next_maintenance_at);
  const maintenanceDays = daysUntil(nextMaintenance);
  const locationPath = locationPathOf(row);

  return {
    id: row.id,
    assetId: row.asset_id,
    name: row.name,
    equipmentType: row.equipment_type,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    manufacturer: row.manufacturer,
    categoryId: row.category_id,
    locationId: row.location_id,
    status: row.status,
    statusNote: row.status_note,
    statusChangedAt: fromDbDateTime(row.status_changed_at),
    imageMediaId: row.image_media_id,
    imageUrl: row.image_media_id === null ? null : signMenuMediaUrl(row.image_media_id, userId),
    specifications: parseJsonColumn<EquipmentSpecificationsDto | null>(row.specifications, null),
    purchaseDate: fromDbDate(row.purchase_date),
    installationDate: fromDbDate(row.installation_date),
    purchasePrice: numberOrNull(row.purchase_price),
    invoiceNumber: row.invoice_number,
    supplierName: row.supplier_name,
    warrantyExpiry,
    warrantyStatus: warrantyStatusFor(warrantyExpiry),
    warrantyDaysRemaining: daysUntil(warrantyExpiry),
    lastMaintenanceAt: fromDbDate(row.last_maintenance_at),
    nextMaintenanceAt: nextMaintenance,
    maintenanceDaysUntilDue: maintenanceDays,
    isMaintenanceOverdue: maintenanceDays !== null && maintenanceDays < 0,
    openTicketCount: Number(row.open_ticket_count),
    criticalTicketCount: Number(row.critical_ticket_count),
    qrCode: row.qr_code,
    nfcTagId: row.nfc_tag_id,
    telemetryDeviceId: row.telemetry_device_id,
    notes: row.notes,
    capturedVia: row.captured_via,
    createdBy: row.created_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.category_name !== undefined ? { categoryName: row.category_name } : {}),
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    ...(row.area_id !== undefined ? { areaId: row.area_id } : {}),
    ...(row.area_name !== undefined ? { areaName: row.area_name } : {}),
    ...(row.floor_id !== undefined ? { floorId: row.floor_id } : {}),
    ...(row.floor_name !== undefined ? { floorName: row.floor_name } : {}),
    ...(locationPath !== '' ? { locationPath } : {}),
    ...(row.created_by_name !== undefined ? { createdByName: row.created_by_name } : {}),
  };
}

export function mapEquipmentDocument(
  row: EquipmentDocumentRow,
  userId: string,
): EquipmentDocumentDto {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    mediaId: row.media_id,
    docType: row.doc_type,
    title: row.title,
    fileName: row.file_name ?? '',
    mimeType: row.mime_type ?? 'application/octet-stream',
    sizeBytes: Number(row.size_bytes ?? 0),
    url: signMenuMediaUrl(row.media_id, userId),
    extracted: parseJsonColumn<DocumentExtractionDto | null>(row.extracted, null),
    uploadedBy: row.uploaded_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.uploaded_by_name !== undefined ? { uploadedByName: row.uploaded_by_name } : {}),
  };
}

export function mapEquipmentWarranty(row: EquipmentWarrantyRow): EquipmentWarrantyDto {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    provider: row.provider,
    policyNumber: row.policy_number,
    startDate: fromDbDate(row.start_date),
    expiryDate: fromDbDate(row.expiry_date),
    months: row.months === null ? null : Number(row.months),
    terms: row.terms,
    documentId: row.document_id,
    isActive: row.is_active === 1,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
  };
}

export function mapEquipmentStatusHistory(
  row: EquipmentStatusHistoryRow,
): EquipmentStatusHistoryDto {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    ticketId: row.ticket_id,
    changedBy: row.changed_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.changed_by_name !== undefined ? { changedByName: row.changed_by_name } : {}),
  };
}

export function mapEquipmentLocationHistory(
  row: EquipmentLocationHistoryRow,
): EquipmentLocationHistoryDto {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    fromLocationPath: row.from_path,
    toLocationPath: row.to_path,
    note: row.note,
    movedBy: row.moved_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.moved_by_name !== undefined ? { movedByName: row.moved_by_name } : {}),
  };
}

/* ------------------------------------------------------------------ floor plans */

export function mapFloorPlan(row: FloorPlanRow, userId: string): FloorPlanDto {
  return {
    id: row.id,
    floorId: row.floor_id,
    name: row.name,
    mediaId: row.media_id,
    url: signMenuMediaUrl(row.media_id, userId),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    isActive: row.is_active === 1,
    uploadedBy: row.uploaded_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.floor_name !== undefined ? { floorName: row.floor_name } : {}),
    ...(row.position_count !== undefined ? { positionCount: Number(row.position_count) } : {}),
  };
}

export function mapFloorPlanPosition(
  row: FloorPlanPositionRow,
  userId: string,
): FloorPlanPositionDto {
  return {
    id: row.id,
    floorPlanId: row.floor_plan_id,
    equipmentId: row.equipment_id,
    x: Number(row.x),
    y: Number(row.y),
    ...(row.asset_id !== undefined ? { assetId: row.asset_id } : {}),
    ...(row.equipment_name !== undefined ? { equipmentName: row.equipment_name } : {}),
    ...(row.status !== undefined ? { status: row.status } : {}),
    ...(row.image_media_id !== undefined
      ? {
        imageUrl:
          row.image_media_id === null ? null : signMenuMediaUrl(row.image_media_id, userId),
      }
      : {}),
    ...(row.category_name !== undefined ? { categoryName: row.category_name } : {}),
    ...(row.open_ticket_count !== undefined
      ? { openTicketCount: Number(row.open_ticket_count) }
      : {}),
    ...(row.next_maintenance_at !== undefined
      ? { nextMaintenanceAt: fromDbDate(row.next_maintenance_at) }
      : {}),
  };
}

/* --------------------------------------------------------------- maintenance */

export function mapMaintenanceSchedule(row: MaintenanceScheduleRow): MaintenanceScheduleDto {
  const nextDue = fromDbDate(row.next_due_at) ?? row.next_due_at;
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    title: row.title,
    frequency: row.frequency,
    intervalDays: row.interval_days === null ? null : Number(row.interval_days),
    anchorDate: fromDbDate(row.anchor_date) ?? row.anchor_date,
    lastPerformedAt: fromDbDate(row.last_performed_at),
    nextDueAt: nextDue,
    reminderDays: Number(row.reminder_days),
    assignedTo: row.assigned_to,
    supplierId: row.supplier_id,
    instructions: row.instructions,
    isActive: row.is_active === 1,
    daysUntilDue: daysUntil(nextDue) ?? 0,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.equipment_name !== undefined ? { equipmentName: row.equipment_name } : {}),
    ...(row.asset_id !== undefined ? { assetId: row.asset_id } : {}),
    ...(row.assigned_to_name !== undefined ? { assignedToName: row.assigned_to_name } : {}),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
  };
}

export function mapMaintenanceProblem(row: MaintenanceProblemRow): MaintenanceProblemDto {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    category: row.category,
    description: row.description,
    aiSuggestedCategory: row.ai_suggested_category,
    aiConfidence: numberOrNull(row.ai_confidence),
    confirmedByUser: row.confirmed_by_user === 1,
    createdAt: fromDbDateTimeRequired(row.created_at),
  };
}

export function mapMaintenanceAttachment(
  row: MaintenanceAttachmentRow,
  userId: string,
): MaintenanceAttachmentDto {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    mediaId: row.media_id,
    kind: row.kind,
    url: signMenuMediaUrl(row.media_id, userId),
    fileName: row.file_name ?? '',
    mimeType: row.mime_type ?? 'application/octet-stream',
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    transcript: row.transcript,
    uploadedBy: row.uploaded_by,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.uploaded_by_name !== undefined ? { uploadedByName: row.uploaded_by_name } : {}),
  };
}

export function mapMaintenanceAssignment(
  row: MaintenanceAssignmentRow,
): MaintenanceAssignmentDto {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    assignedTo: row.assigned_to,
    supplierId: row.supplier_id,
    technicianName: row.technician_name,
    technicianPhone: row.technician_phone,
    scheduledAt: fromDbDateTime(row.scheduled_at),
    completedAt: fromDbDateTime(row.completed_at),
    notes: row.notes,
    assignedBy: row.assigned_by,
    isActive: row.is_active === 1,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.assigned_to_name !== undefined ? { assignedToName: row.assigned_to_name } : {}),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.assigned_by_name !== undefined ? { assignedByName: row.assigned_by_name } : {}),
  };
}

export function mapMaintenanceActivity(row: MaintenanceActivityRow): MaintenanceActivityDto {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    ticketId: row.ticket_id,
    type: row.type,
    summary: row.summary,
    detail: row.detail,
    metadata: parseJsonColumn<Record<string, unknown> | null>(row.metadata, null),
    actorId: row.actor_id,
    actorRole: row.actor_role,
    source: row.source,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.actor_name !== undefined ? { actorName: row.actor_name } : {}),
  };
}

export function mapMaintenanceTicket(
  row: MaintenanceTicketRow,
  userId: string,
): MaintenanceTicketDto {
  const locationPath = locationPathOf(row);
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    equipmentId: row.equipment_id,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    title: row.title,
    description: row.description,
    problemCategory: row.problem_category,
    reportedBy: row.reported_by,
    reportedAt: fromDbDateTimeRequired(row.reported_at),
    acknowledgedAt: fromDbDateTime(row.acknowledged_at),
    assignedTo: row.assigned_to,
    supplierId: row.supplier_id,
    scheduledAt: fromDbDateTime(row.scheduled_at),
    resolvedAt: fromDbDateTime(row.resolved_at),
    verifiedAt: fromDbDateTime(row.verified_at),
    closedAt: fromDbDateTime(row.closed_at),
    resolutionNotes: row.resolution_notes,
    partsRequired: row.parts_required,
    costAmount: numberOrNull(row.cost_amount),
    scheduleId: row.schedule_id,
    capturedVia: row.captured_via,
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    ...(row.reported_by_name !== undefined ? { reportedByName: row.reported_by_name } : {}),
    ...(row.assigned_to_name !== undefined ? { assignedToName: row.assigned_to_name } : {}),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.supplier_phone !== undefined ? { supplierPhone: row.supplier_phone } : {}),
    ...(row.supplier_whatsapp !== undefined ? { supplierWhatsapp: row.supplier_whatsapp } : {}),
    ...(row.asset_id !== undefined ? { assetId: row.asset_id } : {}),
    ...(row.equipment_name !== undefined ? { equipmentName: row.equipment_name } : {}),
    ...(row.equipment_image_media_id !== undefined
      ? {
        equipmentImageUrl:
          row.equipment_image_media_id === null
            ? null
            : signMenuMediaUrl(row.equipment_image_media_id, userId),
      }
      : {}),
    ...(row.category_name !== undefined ? { categoryName: row.category_name } : {}),
    ...(locationPath !== '' ? { locationPath } : {}),
    ...(row.attachment_count !== undefined
      ? { attachmentCount: Number(row.attachment_count) }
      : {}),
  };
}

export function mapEquipmentCallLog(row: EquipmentCallLogRow): EquipmentCallLogDto {
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    ticketId: row.ticket_id,
    supplierId: row.supplier_id,
    contactId: row.contact_id,
    phoneNumber: row.phone_number,
    calledBy: row.called_by,
    calledAt: fromDbDateTimeRequired(row.called_at),
    status: row.status,
    outcome: row.outcome,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    notes: row.notes,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.called_by_name !== undefined ? { calledByName: row.called_by_name } : {}),
  };
}

export function mapEquipmentWhatsappLog(
  row: EquipmentWhatsappLogRow,
  userId: string,
): EquipmentWhatsappLogDto {
  const mediaIds = parseJsonColumn<string[]>(row.media_ids, []);
  return {
    id: row.id,
    equipmentId: row.equipment_id,
    ticketId: row.ticket_id,
    supplierId: row.supplier_id,
    phoneNumber: row.phone_number,
    message: row.message,
    mediaUrls: mediaIds.map((mediaId) => signMenuMediaUrl(mediaId, userId)),
    sentBy: row.sent_by,
    sentAt: fromDbDateTimeRequired(row.sent_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.supplier_name !== undefined ? { supplierName: row.supplier_name } : {}),
    ...(row.sent_by_name !== undefined ? { sentByName: row.sent_by_name } : {}),
  };
}
