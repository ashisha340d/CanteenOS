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
  WarrantyStatus,
} from '../enums';
import type { IsoDate, IsoDateTime, PageQuery, Uuid } from './common';

/**
 * Equipment Monitoring + Maintenance Management wire contract.
 *
 * Two rules shape every type here:
 *
 *  1. **Nothing the system already knows is asked for.** A report-problem request carries an
 *     equipment id and, optionally, a photo and a voice clip. Location, asset id, supplier,
 *     reporter, timestamps and priority are resolved server-side from the equipment record.
 *  2. **AI proposes, the user disposes.** Every AI-derived field arrives inside a `*Draft`
 *     type that is never persisted on its own — it is shown for confirmation, edited if
 *     wrong, and only then submitted as an ordinary create request.
 */

/* ------------------------------------------------------------------ location tree */

export interface EquipmentFloorDto {
  id: Uuid;
  code: string;
  name: string;
  /** Ground floor is 0; basements are negative. Orders the floor switcher. */
  levelIndex: number;
  status: MasterStatus;
  areaCount?: number;
  equipmentCount?: number;
  hasFloorPlan?: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface EquipmentAreaDto {
  id: Uuid;
  floorId: Uuid;
  code: string;
  name: string;
  /** Three letters that become the middle segment of every asset id here (KIT, STO, BAK). */
  assetSegment: string;
  sortOrder: number;
  status: MasterStatus;
  floorName?: string;
  equipmentCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * The finest-grained place an asset sits: a room, a section within it, and where in that
 * section the thing physically stands. All three are one row rather than three tables — a
 * canteen has "Main Kitchen / Hot Line / Position 3", not a five-level hierarchy.
 */
export interface EquipmentLocationDto {
  id: Uuid;
  areaId: Uuid;
  name: string;
  room: string | null;
  section: string | null;
  position: string | null;
  status: MasterStatus;
  areaName?: string;
  floorId?: Uuid;
  floorName?: string;
  equipmentCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Floor -> Area -> Location in one payload, for the pickers on both clients. */
export interface LocationTreeDto {
  floors: Array<
    EquipmentFloorDto & {
      areas: Array<EquipmentAreaDto & { locations: EquipmentLocationDto[] }>;
    }
  >;
}

/* ------------------------------------------------------------------- categories */

export interface EquipmentCategoryDto {
  id: Uuid;
  code: string;
  name: string;
  /** Three letters that become the last segment of an asset id (OVN, MIX, FRZ). */
  assetSegment: string;
  description: string | null;
  /** Seeds a new asset's schedule so nobody has to think about it at registration time. */
  defaultFrequency: MaintenanceFrequency | null;
  defaultIntervalDays: number | null;
  sortOrder: number;
  status: MasterStatus;
  equipmentCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface EquipmentCategoryWriteRequest {
  code: string;
  name: string;
  assetSegment: string;
  description?: string | null;
  defaultFrequency?: MaintenanceFrequency | null;
  defaultIntervalDays?: number | null;
  sortOrder?: number;
  status?: MasterStatus;
}

/* -------------------------------------------------------------------- suppliers */

export interface SupplierContactDto {
  id: Uuid;
  supplierId: Uuid;
  name: string;
  role: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  isPrimary: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface EquipmentSupplierDto {
  id: Uuid;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  /** E.164 without the leading +, which is what wa.me expects. */
  whatsapp: string | null;
  email: string | null;
  serviceCategory: string | null;
  /** Category ids this supplier services; drives "suggested supplier" on a new ticket. */
  categoryIds: Uuid[];
  serviceArea: string | null;
  notes: string | null;
  /** Set when this supplier is also a VENDOR row in the Entity master, never duplicated. */
  entityId: Uuid | null;
  status: MasterStatus;
  contacts?: SupplierContactDto[];
  equipmentCount?: number;
  openTicketCount?: number;
  categoryNames?: string[];
  entityName?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface EquipmentSupplierWriteRequest {
  name: string;
  code?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  serviceCategory?: string | null;
  categoryIds?: Uuid[];
  serviceArea?: string | null;
  notes?: string | null;
  entityId?: Uuid | null;
  status?: MasterStatus;
}

export interface SupplierContactWriteRequest {
  name: string;
  role?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  isPrimary?: boolean;
}

/** An asset's supplier in a given role, flattened for the equipment profile's action bar. */
export interface EquipmentSupplierLinkDto {
  id: Uuid;
  equipmentId: Uuid;
  supplierId: Uuid;
  role: EquipmentSupplierRole;
  isDefault: boolean;
  supplierName: string;
  phone: string | null;
  whatsapp: string | null;
  contactPerson: string | null;
}

/* ------------------------------------------------------------------- equipment */

export interface EquipmentDocumentDto {
  id: Uuid;
  equipmentId: Uuid;
  mediaId: Uuid;
  docType: EquipmentDocumentType;
  title: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Signed, expiring URL. Regenerated per response; never stored. */
  url: string;
  /** What OCR pulled out, as confirmed or corrected by the uploader. */
  extracted: DocumentExtractionDto | null;
  uploadedBy: Uuid;
  uploadedByName?: string;
  createdAt: IsoDateTime;
}

/** Fields OCR looks for on a warranty card, invoice or purchase bill. All optional. */
export interface DocumentExtractionDto {
  purchaseDate?: IsoDate | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  warrantyMonths?: number | null;
  warrantyExpiry?: IsoDate | null;
  purchasePrice?: number | null;
  serialNumber?: string | null;
  notes?: string | null;
}

export interface EquipmentWarrantyDto {
  id: Uuid;
  equipmentId: Uuid;
  provider: string | null;
  policyNumber: string | null;
  startDate: IsoDate | null;
  expiryDate: IsoDate | null;
  months: number | null;
  terms: string | null;
  documentId: Uuid | null;
  isActive: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MaintenanceScheduleDto {
  id: Uuid;
  equipmentId: Uuid;
  title: string;
  frequency: MaintenanceFrequency;
  /** Only meaningful for CUSTOM; otherwise derived from the frequency. */
  intervalDays: number | null;
  /** What the clock started from — installation, purchase, or the last service done. */
  anchorDate: IsoDate;
  lastPerformedAt: IsoDate | null;
  nextDueAt: IsoDate;
  /** How many days before the due date a reminder fires. */
  reminderDays: number;
  assignedTo: Uuid | null;
  supplierId: Uuid | null;
  instructions: string | null;
  isActive: boolean;
  /** Derived: negative when overdue. */
  daysUntilDue?: number;
  equipmentName?: string;
  assetId?: string;
  assignedToName?: string | null;
  supplierName?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MaintenanceScheduleWriteRequest {
  equipmentId: Uuid;
  title?: string;
  frequency: MaintenanceFrequency;
  intervalDays?: number | null;
  anchorDate?: IsoDate;
  reminderDays?: number;
  assignedTo?: Uuid | null;
  supplierId?: Uuid | null;
  instructions?: string | null;
  isActive?: boolean;
}

/**
 * The equipment record as every surface reads it. Denormalised deliberately: an equipment
 * card must render location, status, supplier and maintenance state without four more round
 * trips, and the phone may be on a slow connection in a basement store room.
 */
export interface EquipmentDto {
  id: Uuid;
  /** Human-quotable, allocated by the server: MTC-KIT-OVN-001. */
  assetId: string;
  name: string;
  equipmentType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  categoryId: Uuid | null;
  categoryName?: string | null;

  locationId: Uuid | null;
  locationName?: string | null;
  areaId?: Uuid | null;
  areaName?: string | null;
  floorId?: Uuid | null;
  floorName?: string | null;
  /** "Main Kitchen · Hot Line · Position 3" — precomputed so clients never assemble it. */
  locationPath?: string;

  status: EquipmentStatus;
  statusNote: string | null;
  statusChangedAt: IsoDateTime | null;

  /** Primary photograph. Signed URL, regenerated per response. */
  imageUrl: string | null;
  imageMediaId: Uuid | null;

  specifications: EquipmentSpecificationsDto | null;
  purchaseDate: IsoDate | null;
  installationDate: IsoDate | null;
  purchasePrice: number | null;
  invoiceNumber: string | null;
  supplierName: string | null;

  warrantyExpiry: IsoDate | null;
  /** Derived from `warrantyExpiry` on every read; never stored. */
  warrantyStatus: WarrantyStatus;
  warrantyDaysRemaining: number | null;

  lastMaintenanceAt: IsoDate | null;
  nextMaintenanceAt: IsoDate | null;
  /** Negative when overdue, null when the asset has no active schedule. */
  maintenanceDaysUntilDue: number | null;
  isMaintenanceOverdue: boolean;

  openTicketCount: number;
  criticalTicketCount: number;

  /** Optional QR payload; the phone resolves it straight to this profile. */
  qrCode: string | null;
  /** Optional NFC tag id, where the hardware exists. */
  nfcTagId: string | null;

  /** Set only when an external sensor has been attached later. Absent by design. */
  telemetryDeviceId: string | null;

  notes: string | null;
  capturedVia: CaptureSource;
  createdBy: Uuid | null;
  createdByName?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;

  /** Present on the detail response only. */
  suppliers?: EquipmentSupplierLinkDto[];
  documents?: EquipmentDocumentDto[];
  warranties?: EquipmentWarrantyDto[];
  schedules?: MaintenanceScheduleDto[];
  openTickets?: MaintenanceTicketDto[];
  position?: FloorPlanPositionDto | null;
}

/** Whatever the plate says. Free-form because equipment plates are not standardised. */
export interface EquipmentSpecificationsDto {
  capacity?: string | null;
  voltage?: string | null;
  powerRating?: string | null;
  dimensions?: string | null;
  weight?: string | null;
  fuelType?: string | null;
  temperatureRange?: string | null;
  /** Anything else legible on the plate, key -> value. */
  other?: Record<string, string>;
}

export interface EquipmentListQuery extends PageQuery {
  status?: EquipmentStatus;
  categoryId?: Uuid;
  floorId?: Uuid;
  areaId?: Uuid;
  locationId?: Uuid;
  supplierId?: Uuid;
  warrantyStatus?: WarrantyStatus;
  /** Only assets with at least one open ticket. */
  hasOpenProblems?: boolean;
  maintenanceDue?: boolean;
  maintenanceOverdue?: boolean;
}

export interface EquipmentCreateRequest {
  name: string;
  equipmentType?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  categoryId?: Uuid | null;
  locationId?: Uuid | null;
  status?: EquipmentStatus;
  /** A media asset already uploaded through `POST /equipment/media`. */
  imageMediaId?: Uuid | null;
  specifications?: EquipmentSpecificationsDto | null;
  purchaseDate?: IsoDate | null;
  installationDate?: IsoDate | null;
  purchasePrice?: number | null;
  invoiceNumber?: string | null;
  supplierName?: string | null;
  warrantyExpiry?: IsoDate | null;
  nfcTagId?: string | null;
  notes?: string | null;
  capturedVia?: CaptureSource;
  /** Documents uploaded during the wizard, bound to the asset on creation. */
  documentIds?: Uuid[];
  suppliers?: Array<{ supplierId: Uuid; role: EquipmentSupplierRole; isDefault?: boolean }>;
  /** Creates the first preventive schedule in the same transaction. */
  schedule?: {
    frequency: MaintenanceFrequency;
    intervalDays?: number | null;
    anchorDate?: IsoDate;
  } | null;
  /** Pins the asset on a floor plan straight from the registration wizard. */
  position?: { floorPlanId: Uuid; x: number; y: number } | null;
}

export type EquipmentUpdateRequest = Partial<
  Omit<EquipmentCreateRequest, 'documentIds' | 'schedule' | 'position' | 'capturedVia'>
>;

export interface EquipmentStatusChangeRequest {
  status: EquipmentStatus;
  note?: string | null;
}

export interface EquipmentMoveRequest {
  locationId: Uuid;
  note?: string | null;
}

export interface EquipmentStatusHistoryDto {
  id: Uuid;
  equipmentId: Uuid;
  fromStatus: EquipmentStatus | null;
  toStatus: EquipmentStatus;
  note: string | null;
  ticketId: Uuid | null;
  changedBy: Uuid | null;
  changedByName?: string | null;
  createdAt: IsoDateTime;
}

export interface EquipmentLocationHistoryDto {
  id: Uuid;
  equipmentId: Uuid;
  fromLocationId: Uuid | null;
  toLocationId: Uuid | null;
  fromLocationPath: string | null;
  toLocationPath: string | null;
  note: string | null;
  movedBy: Uuid | null;
  movedByName?: string | null;
  createdAt: IsoDateTime;
}

/* ------------------------------------------------------------------ floor plans */

export interface FloorPlanDto {
  id: Uuid;
  floorId: Uuid;
  name: string;
  mediaId: Uuid;
  url: string;
  width: number | null;
  height: number | null;
  isActive: boolean;
  floorName?: string;
  positionCount?: number;
  uploadedBy: Uuid | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** A pin. Coordinates are fractions of the image (0..1) so any render size works. */
export interface FloorPlanPositionDto {
  id: Uuid;
  floorPlanId: Uuid;
  equipmentId: Uuid;
  x: number;
  y: number;
  /** Denormalised so one request paints the whole plan. */
  assetId?: string;
  equipmentName?: string;
  status?: EquipmentStatus;
  imageUrl?: string | null;
  categoryName?: string | null;
  openTicketCount?: number;
  nextMaintenanceAt?: IsoDate | null;
}

export interface FloorPlanViewDto {
  plan: FloorPlanDto;
  positions: FloorPlanPositionDto[];
  /** Assets on this floor that have not been pinned yet. */
  unplaced: Array<Pick<EquipmentDto, 'id' | 'assetId' | 'name' | 'status' | 'imageUrl'>>;
}

export interface FloorPlanPositionWriteRequest {
  equipmentId: Uuid;
  x: number;
  y: number;
}

/* --------------------------------------------------------- maintenance tickets */

export interface MaintenanceProblemDto {
  id: Uuid;
  ticketId: Uuid;
  category: ProblemCategory;
  description: string | null;
  /** What AI proposed, kept alongside what the user confirmed so the two can be compared. */
  aiSuggestedCategory: ProblemCategory | null;
  aiConfidence: number | null;
  confirmedByUser: boolean;
  createdAt: IsoDateTime;
}

export interface MaintenanceAttachmentDto {
  id: Uuid;
  ticketId: Uuid;
  mediaId: Uuid;
  kind: MaintenanceAttachmentKind;
  url: string;
  fileName: string;
  mimeType: string;
  durationMs: number | null;
  /** Speech-to-text of a voice note, or AI's reading of a photo. Editable by the author. */
  transcript: string | null;
  uploadedBy: Uuid;
  uploadedByName?: string;
  createdAt: IsoDateTime;
}

export interface MaintenanceAssignmentDto {
  id: Uuid;
  ticketId: Uuid;
  assignedTo: Uuid | null;
  assignedToName?: string | null;
  supplierId: Uuid | null;
  supplierName?: string | null;
  technicianName: string | null;
  technicianPhone: string | null;
  scheduledAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  notes: string | null;
  assignedBy: Uuid | null;
  assignedByName?: string | null;
  isActive: boolean;
  createdAt: IsoDateTime;
}

export interface MaintenanceActivityDto {
  id: Uuid;
  equipmentId: Uuid;
  ticketId: Uuid | null;
  type: MaintenanceActivityType;
  /** One line, already written for display. The clients never compose activity prose. */
  summary: string;
  detail: string | null;
  /** Type-specific payload: previous/next status, phone number, outcome, parts, etc. */
  metadata: Record<string, unknown> | null;
  actorId: Uuid | null;
  actorName?: string | null;
  actorRole: string | null;
  source: CaptureSource;
  createdAt: IsoDateTime;
}

export interface MaintenanceTicketDto {
  id: Uuid;
  /** MTK-YYYYMMDD-NNNN. Server-sequential; quoted to suppliers. */
  ticketNumber: string;
  equipmentId: Uuid;
  kind: MaintenanceRequestKind;
  status: MaintenanceTicketStatus;
  priority: MaintenancePriority;
  title: string;
  description: string | null;
  problemCategory: ProblemCategory | null;

  reportedBy: Uuid;
  reportedByName?: string;
  reportedAt: IsoDateTime;
  acknowledgedAt: IsoDateTime | null;
  assignedTo: Uuid | null;
  assignedToName?: string | null;
  supplierId: Uuid | null;
  supplierName?: string | null;
  scheduledAt: IsoDateTime | null;
  resolvedAt: IsoDateTime | null;
  verifiedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
  resolutionNotes: string | null;
  partsRequired: string | null;
  costAmount: number | null;
  /** The schedule this ticket discharges, when it was raised by the scheduler. */
  scheduleId: Uuid | null;

  /** Denormalised equipment context — every ticket view needs all of it. */
  assetId?: string;
  equipmentName?: string;
  equipmentImageUrl?: string | null;
  locationPath?: string;
  categoryName?: string | null;
  supplierPhone?: string | null;
  supplierWhatsapp?: string | null;

  attachmentCount?: number;
  /** Detail response only. */
  problems?: MaintenanceProblemDto[];
  attachments?: MaintenanceAttachmentDto[];
  assignments?: MaintenanceAssignmentDto[];
  activities?: MaintenanceActivityDto[];

  capturedVia: CaptureSource;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MaintenanceTicketListQuery extends PageQuery {
  equipmentId?: Uuid;
  status?: MaintenanceTicketStatus;
  priority?: MaintenancePriority;
  kind?: MaintenanceRequestKind;
  problemCategory?: ProblemCategory;
  supplierId?: Uuid;
  assignedTo?: Uuid;
  reportedBy?: Uuid;
  floorId?: Uuid;
  areaId?: Uuid;
  /** Everything not CLOSED/CANCELLED, which is what the dashboard means by "open". */
  openOnly?: boolean;
  /** Tickets assigned to the caller. The phone's "My maintenance" list. */
  mine?: boolean;
}

/**
 * Opening a ticket. `equipmentId` is the only required field — everything else is either
 * derived server-side or supplied by AI and confirmed by the user.
 */
export interface MaintenanceTicketCreateRequest {
  equipmentId: Uuid;
  kind?: MaintenanceRequestKind;
  problemCategory?: ProblemCategory | null;
  /** Free text or a voice transcript. Becomes the ticket title when no title is given. */
  description?: string | null;
  title?: string | null;
  priority?: MaintenancePriority;
  /** Media already uploaded through `POST /equipment/media`, bound on creation. */
  attachments?: Array<{
    mediaId: Uuid;
    kind: MaintenanceAttachmentKind;
    transcript?: string | null;
  }>;
  /** What AI proposed, recorded next to what the user confirmed. */
  aiSuggestedCategory?: ProblemCategory | null;
  aiConfidence?: number | null;
  capturedVia?: CaptureSource;
}

export interface MaintenanceTicketUpdateRequest {
  title?: string;
  description?: string | null;
  priority?: MaintenancePriority;
  problemCategory?: ProblemCategory | null;
  partsRequired?: string | null;
  costAmount?: number | null;
  resolutionNotes?: string | null;
}

export interface MaintenanceStatusChangeRequest {
  status: MaintenanceTicketStatus;
  note?: string | null;
  /** Recorded when moving to RESOLVED. */
  resolutionNotes?: string | null;
  partsRequired?: string | null;
  costAmount?: number | null;
}

export interface MaintenanceAssignRequest {
  assignedTo?: Uuid | null;
  supplierId?: Uuid | null;
  technicianName?: string | null;
  technicianPhone?: string | null;
  scheduledAt?: IsoDateTime | null;
  notes?: string | null;
}

/** Completing work from the phone: a photo, optionally a word, and it is done. */
export interface MaintenanceCompleteRequest {
  resolutionNotes?: string | null;
  partsReplaced?: string | null;
  costAmount?: number | null;
  attachments?: Array<{ mediaId: Uuid; kind: MaintenanceAttachmentKind; transcript?: string | null }>;
  /** Whether the equipment is back in service. Defaults to true. */
  restoreEquipment?: boolean;
}

/* ------------------------------------------------------- supplier communication */

export interface EquipmentCallLogDto {
  id: Uuid;
  equipmentId: Uuid;
  ticketId: Uuid | null;
  supplierId: Uuid | null;
  supplierName?: string | null;
  contactId: Uuid | null;
  phoneNumber: string;
  calledBy: Uuid;
  calledByName?: string;
  calledAt: IsoDateTime;
  status: CallStatus;
  outcome: CallOutcome | null;
  durationSeconds: number | null;
  notes: string | null;
  createdAt: IsoDateTime;
}

/** Logged when the dialer opens, before the call is even answered. */
export interface EquipmentCallLogRequest {
  equipmentId: Uuid;
  ticketId?: Uuid | null;
  supplierId?: Uuid | null;
  contactId?: Uuid | null;
  phoneNumber: string;
}

export interface EquipmentCallOutcomeRequest {
  outcome: CallOutcome;
  status?: CallStatus;
  durationSeconds?: number | null;
  notes?: string | null;
}

export interface EquipmentWhatsappLogDto {
  id: Uuid;
  equipmentId: Uuid;
  ticketId: Uuid | null;
  supplierId: Uuid | null;
  supplierName?: string | null;
  phoneNumber: string;
  message: string;
  /** Signed URLs for photos referenced in the message body. */
  mediaUrls: string[];
  sentBy: Uuid;
  sentByName?: string;
  sentAt: IsoDateTime;
  createdAt: IsoDateTime;
}

/**
 * The server composes the message and hands back a `wa.me` deep link; the phone only opens
 * it. Composition lives server-side so the wording, the asset id and the photo links are
 * identical whether the request came from the phone or the portal.
 */
export interface WhatsappDraftDto {
  supplierId: Uuid;
  supplierName: string;
  phoneNumber: string;
  message: string;
  /** `https://wa.me/<number>?text=<encoded message>` — ready to open. */
  deepLink: string;
  mediaUrls: string[];
}

export interface WhatsappSendRequest {
  equipmentId: Uuid;
  ticketId?: Uuid | null;
  supplierId?: Uuid | null;
  /** Overrides the generated wording; normally absent. */
  message?: string | null;
}

/* ---------------------------------------------------------------- AI assistance */

/**
 * What the vision model read off a photograph of a machine. Every field is nullable: a blurry
 * plate yields a brand and nothing else, and that is a useful result, not a failure.
 */
export interface EquipmentIdentificationDraft {
  name: string | null;
  equipmentType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  /** Matched against the category master server-side; null when nothing matched. */
  categoryId: Uuid | null;
  categoryName: string | null;
  specifications: EquipmentSpecificationsDto | null;
  /** 0..1. Shown as "AI suggestion" rather than a number the user has to interpret. */
  confidence: number;
  /** Everything the model was unsure about, for the confirmation screen's warning line. */
  uncertainFields: string[];
  /** The uploaded photo, already stored so confirming does not re-upload it. */
  mediaId: Uuid;
  imageUrl: string;
}

/** What OCR read off a warranty card, invoice or bill. */
export interface DocumentExtractionDraft {
  docType: EquipmentDocumentType;
  extracted: DocumentExtractionDto;
  confidence: number;
  mediaId: Uuid;
  url: string;
  /** Raw text, kept so the user can check a value the parser mangled. */
  rawText: string | null;
}

/**
 * "Oven is not heating" -> a ticket, minus the confirmation tap.
 *
 * Never auto-submitted: the module states a suggestion and the user accepts it, because an
 * automatic technical diagnosis is exactly the thing a maintenance system must not do.
 */
export interface ProblemClassificationDraft {
  category: ProblemCategory;
  title: string;
  description: string;
  priority: MaintenancePriority;
  confidence: number;
  /** Resolved from the equipment's supplier links plus category coverage. */
  suggestedSupplierId: Uuid | null;
  suggestedSupplierName: string | null;
  suggestedAction: string | null;
  /** Set when the input was audio; the text the user can correct before submitting. */
  transcript: string | null;
  /** Set when the request identified the equipment from a photo rather than an id. */
  equipmentId: Uuid | null;
}

export interface ProblemClassifyRequest {
  equipmentId?: Uuid | null;
  /** Typed text, or a transcript the phone produced locally. */
  text?: string | null;
  /** A media asset holding a voice clip or a photo of the fault. */
  mediaId?: Uuid | null;
}

/* -------------------------------------------------------------------- dashboard */

/**
 * The dashboard leads with problems, not statistics: the counters exist to be clicked
 * through to a list, and the two lists below them are the actual content.
 */
export interface EquipmentDashboardDto {
  counts: {
    totalEquipment: number;
    operational: number;
    needingAttention: number;
    outOfService: number;
    maintenanceDue: number;
    maintenanceOverdue: number;
    openProblems: number;
    criticalProblems: number;
    openTickets: number;
    technicianVisitsPending: number;
    partsRequired: number;
    supplierFollowUps: number;
    warrantyExpiring: number;
  };
  /** Newest first, already carrying everything the action row needs. */
  recentProblems: MaintenanceTicketDto[];
  /** Soonest first, overdue at the top. */
  upcomingMaintenance: MaintenanceScheduleDto[];
  warrantyExpiring: Array<
    Pick<EquipmentDto, 'id' | 'assetId' | 'name' | 'warrantyExpiry' | 'warrantyDaysRemaining' | 'imageUrl'>
  >;
}

/** The phone's landing payload: what is near me, what is mine, what is wrong. */
export interface MyMaintenanceDto {
  assigned: MaintenanceTicketDto[];
  reported: MaintenanceTicketDto[];
  dueToday: MaintenanceScheduleDto[];
}
