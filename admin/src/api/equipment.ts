import type {
  CallOutcome,
  DocumentExtractionDraft,
  DocumentExtractionDto,
  EquipmentAreaDto,
  EquipmentCallLogDto,
  EquipmentCallLogRequest,
  EquipmentCallOutcomeRequest,
  EquipmentCategoryDto,
  EquipmentCategoryWriteRequest,
  EquipmentCreateRequest,
  EquipmentDashboardDto,
  EquipmentDocumentDto,
  EquipmentDocumentType,
  EquipmentDto,
  EquipmentFloorDto,
  EquipmentIdentificationDraft,
  EquipmentListQuery,
  EquipmentLocationDto,
  EquipmentLocationHistoryDto,
  EquipmentMoveRequest,
  EquipmentStatusChangeRequest,
  EquipmentStatusHistoryDto,
  EquipmentSupplierDto,
  EquipmentSupplierLinkDto,
  EquipmentSupplierRole,
  EquipmentSupplierWriteRequest,
  EquipmentUpdateRequest,
  EquipmentWarrantyDto,
  EquipmentWhatsappLogDto,
  FloorPlanDto,
  FloorPlanPositionDto,
  FloorPlanPositionWriteRequest,
  FloorPlanViewDto,
  LocationTreeDto,
  MaintenanceActivityDto,
  MaintenanceAssignRequest,
  MaintenanceCompleteRequest,
  MaintenanceScheduleDto,
  MaintenanceScheduleWriteRequest,
  MaintenanceStatusChangeRequest,
  MaintenanceTicketCreateRequest,
  MaintenanceTicketDto,
  MaintenanceTicketListQuery,
  MaintenanceTicketUpdateRequest,
  MasterStatus,
  MediaAssetDto,
  MyMaintenanceDto,
  PageQuery,
  ProblemClassificationDraft,
  ProblemClassifyRequest,
  SupplierContactDto,
  SupplierContactWriteRequest,
  WhatsappDraftDto,
  WhatsappSendRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

/**
 * Equipment Monitoring & Maintenance Management.
 *
 * One module, one API surface: equipment and maintenance are the same object seen from two
 * angles, so the portal reads both through this file rather than pretending they are separate
 * systems.
 */

export interface SupplierListQuery extends PageQuery {
  status?: MasterStatus;
  categoryId?: string;
}

export interface ScheduleListQuery extends PageQuery {
  equipmentId?: string;
  assignedTo?: string;
  dueBefore?: string;
  includeInactive?: boolean;
}

export interface MasterQuery {
  floorId?: string;
  areaId?: string;
  includeInactive?: boolean;
}

export interface CommunicationLogQuery {
  equipmentId?: string;
  ticketId?: string;
  supplierId?: string;
  outcome?: CallOutcome;
}

export const equipmentApi = {
  /* ------------------------------------------------------------------ masters */

  listFloors: (query: MasterQuery = {}) =>
    unwrap<EquipmentFloorDto[]>(http.get('/equipment-floors', { params: query })),
  createFloor: (body: { code: string; name: string; levelIndex?: number }) =>
    unwrap<EquipmentFloorDto>(http.post('/equipment-floors', body)),
  updateFloor: (
    id: string,
    body: { code?: string; name?: string; levelIndex?: number; status?: MasterStatus },
  ) => unwrap<EquipmentFloorDto>(http.patch(`/equipment-floors/${id}`, body)),

  listAreas: (query: MasterQuery = {}) =>
    unwrap<EquipmentAreaDto[]>(http.get('/equipment-areas', { params: query })),
  createArea: (body: {
    floorId: string;
    code: string;
    name: string;
    assetSegment: string;
    sortOrder?: number;
  }) => unwrap<EquipmentAreaDto>(http.post('/equipment-areas', body)),
  updateArea: (
    id: string,
    body: {
      floorId?: string;
      code?: string;
      name?: string;
      assetSegment?: string;
      sortOrder?: number;
      status?: MasterStatus;
    },
  ) => unwrap<EquipmentAreaDto>(http.patch(`/equipment-areas/${id}`, body)),

  listLocations: (query: MasterQuery = {}) =>
    unwrap<EquipmentLocationDto[]>(http.get('/equipment-locations', { params: query })),
  locationTree: (query: MasterQuery = {}) =>
    unwrap<LocationTreeDto>(http.get('/equipment-locations/tree', { params: query })),
  createLocation: (body: {
    areaId: string;
    name: string;
    room?: string | null;
    section?: string | null;
    position?: string | null;
    sortOrder?: number;
  }) => unwrap<EquipmentLocationDto>(http.post('/equipment-locations', body)),
  updateLocation: (
    id: string,
    body: {
      areaId?: string;
      name?: string;
      room?: string | null;
      section?: string | null;
      position?: string | null;
      status?: MasterStatus;
    },
  ) => unwrap<EquipmentLocationDto>(http.patch(`/equipment-locations/${id}`, body)),

  listCategories: (query: MasterQuery = {}) =>
    unwrap<EquipmentCategoryDto[]>(http.get('/equipment-categories', { params: query })),
  createCategory: (body: EquipmentCategoryWriteRequest) =>
    unwrap<EquipmentCategoryDto>(http.post('/equipment-categories', body)),
  updateCategory: (id: string, body: Partial<EquipmentCategoryWriteRequest>) =>
    unwrap<EquipmentCategoryDto>(http.patch(`/equipment-categories/${id}`, body)),
  removeCategory: (id: string) => unwrap<null>(http.delete(`/equipment-categories/${id}`)),

  /* ---------------------------------------------------------------- equipment */

  dashboard: () => unwrap<EquipmentDashboardDto>(http.get('/equipment/dashboard')),
  list: (query: EquipmentListQuery) =>
    unwrapPaged<EquipmentDto>(http.get('/equipment', { params: query })),
  get: (id: string) => unwrap<EquipmentDto>(http.get(`/equipment/${id}`)),
  resolve: (code: string) => unwrap<EquipmentDto>(http.get('/equipment/resolve', { params: { code } })),
  create: (body: EquipmentCreateRequest) => unwrap<EquipmentDto>(http.post('/equipment', body)),
  update: (id: string, body: EquipmentUpdateRequest) =>
    unwrap<EquipmentDto>(http.patch(`/equipment/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/equipment/${id}`)),
  changeStatus: (id: string, body: EquipmentStatusChangeRequest) =>
    unwrap<EquipmentDto>(http.post(`/equipment/${id}/status`, body)),
  move: (id: string, body: EquipmentMoveRequest) =>
    unwrap<EquipmentDto>(http.post(`/equipment/${id}/move`, body)),

  statusHistory: (id: string) =>
    unwrap<EquipmentStatusHistoryDto[]>(http.get(`/equipment/${id}/status-history`)),
  locationHistory: (id: string) =>
    unwrap<EquipmentLocationHistoryDto[]>(http.get(`/equipment/${id}/location-history`)),
  activity: (id: string) =>
    unwrap<MaintenanceActivityDto[]>(http.get(`/equipment/${id}/activity`)),

  listDocuments: (id: string) =>
    unwrap<EquipmentDocumentDto[]>(http.get(`/equipment/${id}/documents`)),
  addDocument: (
    id: string,
    body: {
      mediaId: string;
      docType?: EquipmentDocumentType;
      title?: string | null;
      extracted?: DocumentExtractionDto | null;
      applyWarranty?: boolean;
    },
  ) => unwrap<EquipmentDocumentDto>(http.post(`/equipment/${id}/documents`, body)),
  removeDocument: (documentId: string) =>
    unwrap<null>(http.delete(`/equipment/documents/${documentId}`)),

  listWarranties: (id: string) =>
    unwrap<EquipmentWarrantyDto[]>(http.get(`/equipment/${id}/warranties`)),
  addWarranty: (
    id: string,
    body: {
      provider?: string | null;
      policyNumber?: string | null;
      startDate?: string | null;
      expiryDate?: string | null;
      months?: number | null;
      terms?: string | null;
      documentId?: string | null;
    },
  ) => unwrap<EquipmentWarrantyDto[]>(http.post(`/equipment/${id}/warranties`, body)),

  listSupplierLinks: (id: string) =>
    unwrap<EquipmentSupplierLinkDto[]>(http.get(`/equipment/${id}/suppliers`)),
  setSupplierLink: (
    id: string,
    body: { supplierId: string; role: EquipmentSupplierRole; isDefault?: boolean },
  ) => unwrap<EquipmentSupplierLinkDto[]>(http.put(`/equipment/${id}/suppliers`, body)),
  removeSupplierLink: (id: string, role: EquipmentSupplierRole) =>
    unwrap<EquipmentSupplierLinkDto[]>(http.delete(`/equipment/${id}/suppliers/${role}`)),

  /**
   * This module's own upload endpoint. The Menu Master's `/media/upload` is gated by
   * MASTER_WRITE and takes images only; this one is gated by `equipment.upload_document` and
   * also accepts PDFs and voice notes.
   */
  uploadMedia: (file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<MediaAssetDto>(
      http.post('/equipment/media', form, {
        params: title === undefined ? undefined : { title },
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },

  /* ----------------------------------------------------------------------- AI */

  identify: (mediaId: string) =>
    unwrap<EquipmentIdentificationDraft>(http.post('/equipment/ai/identify', { mediaId })),
  scanDocument: (mediaId: string, docType: EquipmentDocumentType) =>
    unwrap<DocumentExtractionDraft>(http.post('/equipment/ai/document', { mediaId, docType })),
  classifyProblem: (body: ProblemClassifyRequest) =>
    unwrap<ProblemClassificationDraft>(http.post('/equipment/ai/classify-problem', body)),

  /* --------------------------------------------------------------- floor plans */

  listFloorPlans: (floorId?: string) =>
    unwrap<FloorPlanDto[]>(http.get('/floor-plans', { params: floorId ? { floorId } : undefined })),
  floorPlanView: (floorId: string) =>
    unwrap<FloorPlanViewDto | null>(http.get(`/floor-plans/floor/${floorId}`)),
  createFloorPlan: (body: {
    floorId: string;
    name: string;
    mediaId: string;
    width?: number | null;
    height?: number | null;
  }) => unwrap<FloorPlanDto>(http.post('/floor-plans', body)),
  updateFloorPlan: (id: string, body: { name?: string; isActive?: boolean }) =>
    unwrap<FloorPlanDto>(http.patch(`/floor-plans/${id}`, body)),
  removeFloorPlan: (id: string) => unwrap<null>(http.delete(`/floor-plans/${id}`)),
  setFloorPlanPosition: (id: string, body: FloorPlanPositionWriteRequest) =>
    unwrap<FloorPlanPositionDto[]>(http.put(`/floor-plans/${id}/positions`, body)),
  removeFloorPlanPosition: (id: string, equipmentId: string) =>
    unwrap<FloorPlanPositionDto[]>(http.delete(`/floor-plans/${id}/positions/${equipmentId}`)),
};

export const maintenanceApi = {
  mine: () => unwrap<MyMaintenanceDto>(http.get('/maintenance/mine')),
  listTickets: (query: MaintenanceTicketListQuery) =>
    unwrapPaged<MaintenanceTicketDto>(http.get('/maintenance/tickets', { params: query })),
  getTicket: (id: string) =>
    unwrap<MaintenanceTicketDto>(http.get(`/maintenance/tickets/${id}`)),
  createTicket: (body: MaintenanceTicketCreateRequest) =>
    unwrap<MaintenanceTicketDto>(http.post('/maintenance/tickets', body)),
  updateTicket: (id: string, body: MaintenanceTicketUpdateRequest) =>
    unwrap<MaintenanceTicketDto>(http.patch(`/maintenance/tickets/${id}`, body)),
  changeStatus: (id: string, body: MaintenanceStatusChangeRequest) =>
    unwrap<MaintenanceTicketDto>(http.post(`/maintenance/tickets/${id}/status`, body)),
  assign: (id: string, body: MaintenanceAssignRequest) =>
    unwrap<MaintenanceTicketDto>(http.post(`/maintenance/tickets/${id}/assign`, body)),
  complete: (id: string, body: MaintenanceCompleteRequest) =>
    unwrap<MaintenanceTicketDto>(http.post(`/maintenance/tickets/${id}/complete`, body)),
  addNote: (id: string, note: string) =>
    unwrap<MaintenanceTicketDto>(http.post(`/maintenance/tickets/${id}/notes`, { note })),
  removeTicket: (id: string) => unwrap<null>(http.delete(`/maintenance/tickets/${id}`)),

  listSchedules: (query: ScheduleListQuery) =>
    unwrapPaged<MaintenanceScheduleDto>(http.get('/maintenance/schedules', { params: query })),
  createSchedule: (body: MaintenanceScheduleWriteRequest) =>
    unwrap<MaintenanceScheduleDto>(http.post('/maintenance/schedules', body)),
  updateSchedule: (id: string, body: Partial<MaintenanceScheduleWriteRequest>) =>
    unwrap<MaintenanceScheduleDto>(http.patch(`/maintenance/schedules/${id}`, body)),
  removeSchedule: (id: string) => unwrap<null>(http.delete(`/maintenance/schedules/${id}`)),
  runSweep: () =>
    unwrap<{
      ticketsRaised: number;
      remindersSent: number;
      overdueEscalated: number;
      warrantiesFlagged: number;
    }>(http.post('/maintenance/run-sweep')),
};

export const supplierApi = {
  list: (query: SupplierListQuery) =>
    unwrapPaged<EquipmentSupplierDto>(http.get('/suppliers', { params: query })),
  get: (id: string) => unwrap<EquipmentSupplierDto>(http.get(`/suppliers/${id}`)),
  create: (body: EquipmentSupplierWriteRequest) =>
    unwrap<EquipmentSupplierDto>(http.post('/suppliers', body)),
  update: (id: string, body: Partial<EquipmentSupplierWriteRequest>) =>
    unwrap<EquipmentSupplierDto>(http.patch(`/suppliers/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/suppliers/${id}`)),

  listContacts: (id: string) => unwrap<SupplierContactDto[]>(http.get(`/suppliers/${id}/contacts`)),
  addContact: (id: string, body: SupplierContactWriteRequest) =>
    unwrap<SupplierContactDto[]>(http.post(`/suppliers/${id}/contacts`, body)),
  updateContact: (contactId: string, body: Partial<SupplierContactWriteRequest>) =>
    unwrap<SupplierContactDto[]>(http.patch(`/suppliers/contacts/${contactId}`, body)),
  removeContact: (contactId: string) =>
    unwrap<SupplierContactDto[]>(http.delete(`/suppliers/contacts/${contactId}`)),

  logCall: (body: EquipmentCallLogRequest) =>
    unwrap<EquipmentCallLogDto>(http.post('/suppliers/calls', body)),
  recordCallOutcome: (callLogId: string, body: EquipmentCallOutcomeRequest) =>
    unwrap<EquipmentCallLogDto>(http.post(`/suppliers/calls/${callLogId}/outcome`, body)),
  listCalls: (query: CommunicationLogQuery) =>
    unwrap<EquipmentCallLogDto[]>(http.get('/suppliers/calls', { params: query })),

  whatsappDraft: (body: { equipmentId: string; ticketId?: string | null; supplierId?: string | null }) =>
    unwrap<WhatsappDraftDto>(http.post('/suppliers/whatsapp/draft', body)),
  logWhatsapp: (body: WhatsappSendRequest) =>
    unwrap<EquipmentWhatsappLogDto>(http.post('/suppliers/whatsapp', body)),
  listWhatsapp: (query: CommunicationLogQuery) =>
    unwrap<EquipmentWhatsappLogDto[]>(http.get('/suppliers/whatsapp', { params: query })),
};
