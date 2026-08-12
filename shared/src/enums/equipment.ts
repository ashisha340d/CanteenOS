/**
 * Equipment Monitoring & Maintenance Management enums.
 *
 * Kept in their own module rather than appended to `enums/index.ts` (which re-exports this
 * file, so the import path is unchanged) purely for size: the module contributes as many
 * closed sets as the rest of the product put together.
 */

/**
 * Operational state of a physical asset, set by a human or by the maintenance workflow —
 * never by a sensor. IoT telemetry, if it is ever attached, annotates an asset; it does not
 * own this column, because an oven whose probe is unplugged is not thereby "out of service".
 *
 * RUNNING/IDLE are the two shades of "working normally" that a kitchen actually distinguishes;
 * OPERATIONAL is the resting default for equipment nobody is watching minute to minute.
 */
export const EquipmentStatus = {
  OPERATIONAL: 'OPERATIONAL',
  RUNNING: 'RUNNING',
  IDLE: 'IDLE',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  PROBLEM: 'PROBLEM',
  UNDER_MAINTENANCE: 'UNDER_MAINTENANCE',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
  RETIRED: 'RETIRED',
} as const;
export type EquipmentStatus = (typeof EquipmentStatus)[keyof typeof EquipmentStatus];

export const EQUIPMENT_STATUS_LABELS: Readonly<Record<EquipmentStatus, string>> = {
  OPERATIONAL: 'Operational',
  RUNNING: 'Running',
  IDLE: 'Idle',
  NEEDS_ATTENTION: 'Needs Attention',
  PROBLEM: 'Problem',
  UNDER_MAINTENANCE: 'Under Maintenance',
  OUT_OF_SERVICE: 'Out of Service',
  RETIRED: 'Retired',
};

/** Statuses that mean the asset cannot be relied on for service right now. */
export const IMPAIRED_EQUIPMENT_STATUSES: readonly EquipmentStatus[] = [
  EquipmentStatus.PROBLEM,
  EquipmentStatus.UNDER_MAINTENANCE,
  EquipmentStatus.OUT_OF_SERVICE,
];

/**
 * Derived from the warranty expiry date and today — never stored, so it can never go stale.
 * UNKNOWN is the honest answer when no warranty document has been captured yet.
 */
export const WarrantyStatus = {
  UNKNOWN: 'UNKNOWN',
  ACTIVE: 'ACTIVE',
  EXPIRING_SOON: 'EXPIRING_SOON',
  EXPIRED: 'EXPIRED',
} as const;
export type WarrantyStatus = (typeof WarrantyStatus)[keyof typeof WarrantyStatus];

/** How far ahead a warranty counts as "expiring soon" on dashboards and cards. */
export const WARRANTY_EXPIRING_DAYS = 60;

export function warrantyStatusFor(expiry: string | null, today = new Date()): WarrantyStatus {
  if (expiry === null || expiry === '') return WarrantyStatus.UNKNOWN;
  const expiryDate = new Date(`${expiry.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(expiryDate.getTime())) return WarrantyStatus.UNKNOWN;
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((expiryDate.getTime() - midnight) / 86_400_000);
  if (days < 0) return WarrantyStatus.EXPIRED;
  if (days <= WARRANTY_EXPIRING_DAYS) return WarrantyStatus.EXPIRING_SOON;
  return WarrantyStatus.ACTIVE;
}

export const MaintenanceFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  HALF_YEARLY: 'HALF_YEARLY',
  YEARLY: 'YEARLY',
  /** Interval comes from the schedule's own day count instead of the frequency name. */
  CUSTOM: 'CUSTOM',
} as const;
export type MaintenanceFrequency = (typeof MaintenanceFrequency)[keyof typeof MaintenanceFrequency];

/** Days per frequency. CUSTOM has none — its schedule carries an explicit interval. */
export const MAINTENANCE_FREQUENCY_DAYS: Readonly<Record<MaintenanceFrequency, number | null>> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 91,
  HALF_YEARLY: 182,
  YEARLY: 365,
  CUSTOM: null,
};

export const MAINTENANCE_FREQUENCY_LABELS: Readonly<Record<MaintenanceFrequency, string>> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-yearly',
  YEARLY: 'Yearly',
  CUSTOM: 'Custom interval',
};

/** Resolves the day count a schedule advances by. */
export function maintenanceIntervalDays(
  frequency: MaintenanceFrequency,
  customDays: number | null,
): number {
  const fixed = MAINTENANCE_FREQUENCY_DAYS[frequency];
  if (fixed !== null) return fixed;
  return customDays !== null && customDays > 0 ? customDays : 30;
}

/** What the field worker pressed. Decides the ticket's default priority and wording. */
export const MaintenanceRequestKind = {
  PROBLEM: 'PROBLEM',
  FAULT: 'FAULT',
  MAINTENANCE: 'MAINTENANCE',
  INSPECTION: 'INSPECTION',
  /** Raised by the scheduler when a preventive service falls due. */
  SCHEDULED: 'SCHEDULED',
} as const;
export type MaintenanceRequestKind =
  (typeof MaintenanceRequestKind)[keyof typeof MaintenanceRequestKind];

export const MAINTENANCE_REQUEST_KIND_LABELS: Readonly<Record<MaintenanceRequestKind, string>> = {
  PROBLEM: 'Problem',
  FAULT: 'Fault',
  MAINTENANCE: 'Maintenance request',
  INSPECTION: 'Inspection request',
  SCHEDULED: 'Scheduled service',
};

export const MaintenancePriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type MaintenancePriority = (typeof MaintenancePriority)[keyof typeof MaintenancePriority];

export const MAINTENANCE_PRIORITY_LABELS: Readonly<Record<MaintenancePriority, string>> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

/**
 * The ticket lifecycle. Linear by intent, but three shortcuts are real: a ticket may be
 * cancelled from any open state, resolved by skipping ahead, and reopened from RESOLVED when
 * the fix did not hold.
 */
export const MaintenanceTicketStatus = {
  REPORTED: 'REPORTED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  ASSIGNED: 'ASSIGNED',
  SUPPLIER_CONTACTED: 'SUPPLIER_CONTACTED',
  TECHNICIAN_SCHEDULED: 'TECHNICIAN_SCHEDULED',
  UNDER_MAINTENANCE: 'UNDER_MAINTENANCE',
  WAITING_FOR_PARTS: 'WAITING_FOR_PARTS',
  RESOLVED: 'RESOLVED',
  VERIFIED: 'VERIFIED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type MaintenanceTicketStatus =
  (typeof MaintenanceTicketStatus)[keyof typeof MaintenanceTicketStatus];

export const MAINTENANCE_TICKET_STATUS_LABELS: Readonly<Record<MaintenanceTicketStatus, string>> = {
  REPORTED: 'Reported',
  ACKNOWLEDGED: 'Acknowledged',
  ASSIGNED: 'Assigned',
  SUPPLIER_CONTACTED: 'Supplier Contacted',
  TECHNICIAN_SCHEDULED: 'Technician Scheduled',
  UNDER_MAINTENANCE: 'Under Maintenance',
  WAITING_FOR_PARTS: 'Waiting for Parts',
  RESOLVED: 'Resolved',
  VERIFIED: 'Verified',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/** A ticket in one of these no longer counts as open work. */
export const TERMINAL_MAINTENANCE_STATUSES: readonly MaintenanceTicketStatus[] = [
  MaintenanceTicketStatus.CLOSED,
  MaintenanceTicketStatus.CANCELLED,
];

/** Still being worked, so it shows on the dashboard and counts against the equipment. */
export const OPEN_MAINTENANCE_STATUSES: readonly MaintenanceTicketStatus[] = [
  MaintenanceTicketStatus.REPORTED,
  MaintenanceTicketStatus.ACKNOWLEDGED,
  MaintenanceTicketStatus.ASSIGNED,
  MaintenanceTicketStatus.SUPPLIER_CONTACTED,
  MaintenanceTicketStatus.TECHNICIAN_SCHEDULED,
  MaintenanceTicketStatus.UNDER_MAINTENANCE,
  MaintenanceTicketStatus.WAITING_FOR_PARTS,
];

const MAINTENANCE_STATUS_ORDER: readonly MaintenanceTicketStatus[] = [
  MaintenanceTicketStatus.REPORTED,
  MaintenanceTicketStatus.ACKNOWLEDGED,
  MaintenanceTicketStatus.ASSIGNED,
  MaintenanceTicketStatus.SUPPLIER_CONTACTED,
  MaintenanceTicketStatus.TECHNICIAN_SCHEDULED,
  MaintenanceTicketStatus.UNDER_MAINTENANCE,
  MaintenanceTicketStatus.WAITING_FOR_PARTS,
  MaintenanceTicketStatus.RESOLVED,
  MaintenanceTicketStatus.VERIFIED,
  MaintenanceTicketStatus.CLOSED,
];

/**
 * Whether `to` may follow `from`.
 *
 * Forward movement along the ladder is always allowed and may skip rungs — a manager who
 * WhatsApps the supplier the moment a problem lands should not have to click "acknowledge"
 * first. Going backwards is refused, except RESOLVED -> UNDER_MAINTENANCE, which is how a fix
 * that did not hold is reopened without losing the ticket's history.
 */
export function canTransitionMaintenanceStatus(
  from: MaintenanceTicketStatus,
  to: MaintenanceTicketStatus,
): boolean {
  if (from === to) return true;
  if (TERMINAL_MAINTENANCE_STATUSES.includes(from)) return false;
  if (to === MaintenanceTicketStatus.CANCELLED) return true;
  if (
    from === MaintenanceTicketStatus.RESOLVED &&
    to === MaintenanceTicketStatus.UNDER_MAINTENANCE
  ) {
    return true;
  }
  const fromIndex = MAINTENANCE_STATUS_ORDER.indexOf(from);
  const toIndex = MAINTENANCE_STATUS_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex > fromIndex;
}

/**
 * What is wrong, in the words a cook would use. Deliberately coarse: the point is to route the
 * ticket to the right supplier and convey urgency, not to diagnose the fault.
 */
export const ProblemCategory = {
  NOT_WORKING: 'NOT_WORKING',
  ABNORMAL_NOISE: 'ABNORMAL_NOISE',
  TEMPERATURE: 'TEMPERATURE',
  LEAKAGE: 'LEAKAGE',
  ELECTRICAL: 'ELECTRICAL',
  PHYSICAL_DAMAGE: 'PHYSICAL_DAMAGE',
  PERFORMANCE: 'PERFORMANCE',
  CLEANING: 'CLEANING',
  SAFETY: 'SAFETY',
  OTHER: 'OTHER',
} as const;
export type ProblemCategory = (typeof ProblemCategory)[keyof typeof ProblemCategory];

export const PROBLEM_CATEGORY_LABELS: Readonly<Record<ProblemCategory, string>> = {
  NOT_WORKING: 'Equipment not working',
  ABNORMAL_NOISE: 'Abnormal noise',
  TEMPERATURE: 'Temperature problem',
  LEAKAGE: 'Leakage',
  ELECTRICAL: 'Electrical problem',
  PHYSICAL_DAMAGE: 'Physical damage',
  PERFORMANCE: 'Performance problem',
  CLEANING: 'Cleaning issue',
  SAFETY: 'Safety issue',
  OTHER: 'Other',
};

/** Categories that open a ticket at CRITICAL unless the reporter says otherwise. */
export const CRITICAL_PROBLEM_CATEGORIES: readonly ProblemCategory[] = [
  ProblemCategory.SAFETY,
  ProblemCategory.ELECTRICAL,
];

/**
 * One row per thing that happened to an asset or a ticket. This is the user-facing timeline;
 * `audit_logs` remains the security record. The two are separate on purpose — a cook should
 * read "Supplier called", not a before/after JSON diff.
 */
export const MaintenanceActivityType = {
  EQUIPMENT_REGISTERED: 'EQUIPMENT_REGISTERED',
  EQUIPMENT_UPDATED: 'EQUIPMENT_UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  LOCATION_CHANGED: 'LOCATION_CHANGED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  WARRANTY_RECORDED: 'WARRANTY_RECORDED',
  SCHEDULE_CREATED: 'SCHEDULE_CREATED',
  SCHEDULE_UPDATED: 'SCHEDULE_UPDATED',
  PROBLEM_REPORTED: 'PROBLEM_REPORTED',
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  NOTE_ADDED: 'NOTE_ADDED',
  SUPPLIER_CONTACTED: 'SUPPLIER_CONTACTED',
  CALL_MADE: 'CALL_MADE',
  WHATSAPP_SENT: 'WHATSAPP_SENT',
  TECHNICIAN_ASSIGNED: 'TECHNICIAN_ASSIGNED',
  TECHNICIAN_VISIT: 'TECHNICIAN_VISIT',
  PARTS_REQUIRED: 'PARTS_REQUIRED',
  PARTS_REPLACED: 'PARTS_REPLACED',
  MAINTENANCE_COMPLETED: 'MAINTENANCE_COMPLETED',
  PROBLEM_RESOLVED: 'PROBLEM_RESOLVED',
  TICKET_VERIFIED: 'TICKET_VERIFIED',
  TICKET_CLOSED: 'TICKET_CLOSED',
} as const;
export type MaintenanceActivityType =
  (typeof MaintenanceActivityType)[keyof typeof MaintenanceActivityType];

export const MAINTENANCE_ACTIVITY_LABELS: Readonly<Record<MaintenanceActivityType, string>> = {
  EQUIPMENT_REGISTERED: 'Equipment registered',
  EQUIPMENT_UPDATED: 'Equipment details updated',
  STATUS_CHANGED: 'Status changed',
  LOCATION_CHANGED: 'Location changed',
  DOCUMENT_UPLOADED: 'Document uploaded',
  WARRANTY_RECORDED: 'Warranty recorded',
  SCHEDULE_CREATED: 'Maintenance scheduled',
  SCHEDULE_UPDATED: 'Maintenance schedule updated',
  PROBLEM_REPORTED: 'Problem reported',
  TICKET_STATUS_CHANGED: 'Ticket status changed',
  ATTACHMENT_ADDED: 'Attachment added',
  NOTE_ADDED: 'Note added',
  SUPPLIER_CONTACTED: 'Supplier contacted',
  CALL_MADE: 'Phone call made',
  WHATSAPP_SENT: 'WhatsApp message sent',
  TECHNICIAN_ASSIGNED: 'Technician assigned',
  TECHNICIAN_VISIT: 'Technician visit',
  PARTS_REQUIRED: 'Parts required',
  PARTS_REPLACED: 'Parts replaced',
  MAINTENANCE_COMPLETED: 'Maintenance completed',
  PROBLEM_RESOLVED: 'Problem resolved',
  TICKET_VERIFIED: 'Resolution verified',
  TICKET_CLOSED: 'Ticket closed',
};

export const EquipmentDocumentType = {
  WARRANTY: 'WARRANTY',
  INVOICE: 'INVOICE',
  PURCHASE_BILL: 'PURCHASE_BILL',
  INSTALLATION: 'INSTALLATION',
  SERVICE_REPORT: 'SERVICE_REPORT',
  MAINTENANCE_INVOICE: 'MAINTENANCE_INVOICE',
  MANUAL: 'MANUAL',
  CERTIFICATE: 'CERTIFICATE',
  PHOTO: 'PHOTO',
  OTHER: 'OTHER',
} as const;
export type EquipmentDocumentType =
  (typeof EquipmentDocumentType)[keyof typeof EquipmentDocumentType];

export const EQUIPMENT_DOCUMENT_TYPE_LABELS: Readonly<Record<EquipmentDocumentType, string>> = {
  WARRANTY: 'Warranty card',
  INVOICE: 'Invoice',
  PURCHASE_BILL: 'Purchase bill',
  INSTALLATION: 'Installation document',
  SERVICE_REPORT: 'Service report',
  MAINTENANCE_INVOICE: 'Maintenance invoice',
  MANUAL: 'Equipment manual',
  CERTIFICATE: 'Certificate',
  PHOTO: 'Photo',
  OTHER: 'Other',
};

/** Document types worth running OCR extraction over. A manual is a book; skip it. */
export const OCR_DOCUMENT_TYPES: readonly EquipmentDocumentType[] = [
  EquipmentDocumentType.WARRANTY,
  EquipmentDocumentType.INVOICE,
  EquipmentDocumentType.PURCHASE_BILL,
  EquipmentDocumentType.INSTALLATION,
  EquipmentDocumentType.SERVICE_REPORT,
  EquipmentDocumentType.MAINTENANCE_INVOICE,
];

/** Which of an asset's up-to-three suppliers a link represents. */
export const EquipmentSupplierRole = {
  PRIMARY: 'PRIMARY',
  MAINTENANCE: 'MAINTENANCE',
  ALTERNATIVE: 'ALTERNATIVE',
} as const;
export type EquipmentSupplierRole =
  (typeof EquipmentSupplierRole)[keyof typeof EquipmentSupplierRole];

export const EQUIPMENT_SUPPLIER_ROLE_LABELS: Readonly<Record<EquipmentSupplierRole, string>> = {
  PRIMARY: 'Primary supplier',
  MAINTENANCE: 'Maintenance supplier',
  ALTERNATIVE: 'Alternative supplier',
};

/**
 * Which supplier a one-tap Call/WhatsApp reaches, in order. The maintenance supplier is tried
 * first because a broken oven is a service call, not a purchasing question.
 */
export const SUPPLIER_CONTACT_PREFERENCE: readonly EquipmentSupplierRole[] = [
  EquipmentSupplierRole.MAINTENANCE,
  EquipmentSupplierRole.PRIMARY,
  EquipmentSupplierRole.ALTERNATIVE,
];

/** The short outcome a caller taps after hanging up. Nothing longer is ever asked for. */
export const CallOutcome = {
  RESOLVED: 'RESOLVED',
  TECHNICIAN_SCHEDULED: 'TECHNICIAN_SCHEDULED',
  PARTS_REQUIRED: 'PARTS_REQUIRED',
  FOLLOW_UP_REQUIRED: 'FOLLOW_UP_REQUIRED',
  NO_ANSWER: 'NO_ANSWER',
  OTHER: 'OTHER',
} as const;
export type CallOutcome = (typeof CallOutcome)[keyof typeof CallOutcome];

export const CALL_OUTCOME_LABELS: Readonly<Record<CallOutcome, string>> = {
  RESOLVED: 'Resolved',
  TECHNICIAN_SCHEDULED: 'Technician Scheduled',
  PARTS_REQUIRED: 'Parts Required',
  FOLLOW_UP_REQUIRED: 'Follow-up Required',
  NO_ANSWER: 'No Answer',
  OTHER: 'Other',
};

/**
 * Whether the handset reported the call as connected. UNKNOWN is the normal answer: Android
 * exposes a call log only under READ_CALL_LOG, which this app deliberately does not request,
 * so the activity record is written from the dial intent and refined by the outcome the user
 * taps afterwards.
 */
export const CallStatus = {
  UNKNOWN: 'UNKNOWN',
  DIALLED: 'DIALLED',
  CONNECTED: 'CONNECTED',
  MISSED: 'MISSED',
  FAILED: 'FAILED',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

export const MaintenanceAttachmentKind = {
  PHOTO: 'PHOTO',
  VIDEO: 'VIDEO',
  VOICE: 'VOICE',
  DOCUMENT: 'DOCUMENT',
} as const;
export type MaintenanceAttachmentKind =
  (typeof MaintenanceAttachmentKind)[keyof typeof MaintenanceAttachmentKind];

/** How a record came into being — shown on the timeline, and the module's own scorecard. */
export const CaptureSource = {
  /** Camera -> AI -> confirm, the intended path. */
  PHOTO_AI: 'PHOTO_AI',
  VOICE: 'VOICE',
  QR_SCAN: 'QR_SCAN',
  NFC: 'NFC',
  DOCUMENT_OCR: 'DOCUMENT_OCR',
  MANUAL: 'MANUAL',
  /** Written by the scheduler rather than by a person. */
  SYSTEM: 'SYSTEM',
} as const;
export type CaptureSource = (typeof CaptureSource)[keyof typeof CaptureSource];

/** Floor-plan markers are positioned in normalised 0..1 space, so any image size works. */
export const FLOOR_PLAN_COORDINATE_MAX = 1;
