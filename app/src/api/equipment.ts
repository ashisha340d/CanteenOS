import { AxiosError } from 'axios';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type {
  ApiResponse,
  DocumentExtractionDraft,
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
  DocumentExtractionDto,
  FloorPlanDto,
  FloorPlanPositionDto,
  FloorPlanPositionWriteRequest,
  FloorPlanViewDto,
  LocationTreeDto,
  MaintenanceActivityDto,
  MaintenanceAssignRequest,
  MaintenanceAttachmentKind,
  MaintenanceCompleteRequest,
  MaintenanceScheduleDto,
  MaintenanceScheduleWriteRequest,
  MaintenanceStatusChangeRequest,
  MaintenanceTicketCreateRequest,
  MaintenanceTicketDto,
  MaintenanceTicketListQuery,
  MaintenanceTicketUpdateRequest,
  MediaAssetDto,
  MyMaintenanceDto,
  ProblemClassificationDraft,
  ProblemClassifyRequest,
  SupplierContactDto,
  SupplierContactWriteRequest,
  WhatsappDraftDto,
  WhatsappSendRequest,
} from '@menuboard/shared';
import { ClientType, HEADERS } from '@menuboard/shared';
import { apiClient, ApiError, unwrap } from './client';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { secureTokenStore } from '../utils/secureTokenStore';

/**
 * Equipment Monitoring & Maintenance Management.
 *
 * Deliberately **online-only**, like `tasksApi` and `shoppingApi`: none of these entities takes
 * part in the delta-sync engine, so this module talks to the server directly and the screens
 * treat a failed request as an ordinary outcome rather than an exception. That is also the
 * honest model for the domain — an asset id is allocated by the server, a ticket number is
 * server-sequential, and two devices queuing an offline "acknowledge" would both believe they
 * own the repair.
 */

/** `{ success, data, meta }` for the list endpoints, flattened into one object. */
export interface EquipmentPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function unwrapPage<T>(response: { data: ApiResponse<T[]> }): EquipmentPage<T> {
  const items = unwrap(response);
  const meta = (response.data.success ? response.data.meta : undefined) ?? {};
  const numberAt = (key: string, fallback: number): number => {
    const value = meta[key];
    return typeof value === 'number' ? value : fallback;
  };
  return {
    items,
    page: numberAt('page', 1),
    pageSize: numberAt('pageSize', items.length),
    total: numberAt('total', items.length),
    totalPages: numberAt('totalPages', 1),
  };
}

/**
 * The server's own wording for a refused request, which callers show verbatim.
 *
 * The AI endpoints in particular answer 400 with an explanation the user can act on ("AI
 * assistance is not configured on this server … enter the details manually instead"), so
 * flattening every failure into "something went wrong" would throw away the only useful part.
 */
export function equipmentErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof AxiosError) {
    const body = error.response?.data as ApiResponse<unknown> | undefined;
    if (body !== undefined && body.success === false) return body.error.message;
    return fallback;
  }
  return fallback;
}

/** Strips `undefined` so a `.strict()` query schema never sees a key it does not know. */
function definedOnly(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
}

/* --------------------------------------------------------------- media upload */

export interface EquipmentMediaUpload {
  uri: string;
  fileName: string;
  mimeType: string;
  title?: string;
}

async function uploadHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = secureTokenStore.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  headers[HEADERS.CLIENT_TYPE] = ClientType.ANDROID;
  headers[HEADERS.DEVICE_ID] = await getOrCreateDeviceId();
  return headers;
}

function parseUploadBody(body: string, status: number): MediaAssetDto {
  let parsed: ApiResponse<MediaAssetDto>;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Upload failed with status ${status}`);
  }
  if (!parsed.success) throw new ApiError(parsed.error);
  return parsed.data;
}

/* ------------------------------------------------------------------ equipment */

export const equipmentApi = {
  async dashboard(): Promise<EquipmentDashboardDto> {
    return unwrap(await apiClient.get<ApiResponse<EquipmentDashboardDto>>('/equipment/dashboard'));
  },

  /** A scanned QR payload, an NFC tag id or a typed asset id — all three resolve alike. */
  async resolve(code: string): Promise<EquipmentDto> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentDto>>('/equipment/resolve', { params: { code } }),
    );
  },

  async list(query: EquipmentListQuery = {}): Promise<EquipmentPage<EquipmentDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<EquipmentDto[]>>('/equipment', {
        params: definedOnly({
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          status: query.status,
          categoryId: query.categoryId,
          floorId: query.floorId,
          areaId: query.areaId,
          locationId: query.locationId,
          supplierId: query.supplierId,
          warrantyStatus: query.warrantyStatus,
          hasOpenProblems: query.hasOpenProblems,
          maintenanceDue: query.maintenanceDue,
          maintenanceOverdue: query.maintenanceOverdue,
        }),
      }),
    );
  },

  async getById(id: string): Promise<EquipmentDto> {
    return unwrap(await apiClient.get<ApiResponse<EquipmentDto>>(`/equipment/${id}`));
  },

  async create(input: EquipmentCreateRequest): Promise<EquipmentDto> {
    return unwrap(await apiClient.post<ApiResponse<EquipmentDto>>('/equipment', input));
  },

  async update(id: string, input: EquipmentUpdateRequest): Promise<EquipmentDto> {
    return unwrap(await apiClient.patch<ApiResponse<EquipmentDto>>(`/equipment/${id}`, input));
  },

  async changeStatus(id: string, input: EquipmentStatusChangeRequest): Promise<EquipmentDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentDto>>(`/equipment/${id}/status`, input),
    );
  },

  async move(id: string, input: EquipmentMoveRequest): Promise<EquipmentDto> {
    return unwrap(await apiClient.post<ApiResponse<EquipmentDto>>(`/equipment/${id}/move`, input));
  },

  async activity(id: string): Promise<MaintenanceActivityDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<MaintenanceActivityDto[]>>(`/equipment/${id}/activity`),
    );
  },

  async statusHistory(id: string): Promise<EquipmentStatusHistoryDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentStatusHistoryDto[]>>(
        `/equipment/${id}/status-history`,
      ),
    );
  },

  async locationHistory(id: string): Promise<EquipmentLocationHistoryDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentLocationHistoryDto[]>>(
        `/equipment/${id}/location-history`,
      ),
    );
  },

  async listDocuments(id: string): Promise<EquipmentDocumentDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentDocumentDto[]>>(`/equipment/${id}/documents`),
    );
  },

  async addDocument(
    id: string,
    input: {
      mediaId: string;
      docType?: EquipmentDocumentType;
      title?: string;
      extracted?: DocumentExtractionDto | null;
      applyWarranty?: boolean;
    },
  ): Promise<EquipmentDocumentDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentDocumentDto>>(
        `/equipment/${id}/documents`,
        definedOnly({ ...input }),
      ),
    );
  },

  async listWarranties(id: string): Promise<EquipmentWarrantyDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentWarrantyDto[]>>(`/equipment/${id}/warranties`),
    );
  },

  async addWarranty(
    id: string,
    input: {
      provider?: string | null;
      policyNumber?: string | null;
      startDate?: string | null;
      expiryDate?: string | null;
      months?: number | null;
      terms?: string | null;
      documentId?: string | null;
    },
  ): Promise<EquipmentWarrantyDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentWarrantyDto>>(
        `/equipment/${id}/warranties`,
        definedOnly({ ...input }),
      ),
    );
  },

  async listSupplierLinks(id: string): Promise<EquipmentSupplierLinkDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentSupplierLinkDto[]>>(`/equipment/${id}/suppliers`),
    );
  },

  async setSupplierLink(
    id: string,
    input: { supplierId: string; role: EquipmentSupplierRole; isDefault?: boolean },
  ): Promise<EquipmentSupplierLinkDto[]> {
    return unwrap(
      await apiClient.put<ApiResponse<EquipmentSupplierLinkDto[]>>(
        `/equipment/${id}/suppliers`,
        definedOnly({ ...input }),
      ),
    );
  },

  async removeSupplierLink(
    id: string,
    role: EquipmentSupplierRole,
  ): Promise<EquipmentSupplierLinkDto[]> {
    return unwrap(
      await apiClient.delete<ApiResponse<EquipmentSupplierLinkDto[]>>(
        `/equipment/${id}/suppliers/${role}`,
      ),
    );
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`/equipment/${id}`);
  },

  /**
   * Multipart POST under the field name `file`. Accepts images, audio, PDF **and video** — a
   * fault is often something you can only show.
   *
   * Native goes through Expo's `uploadAsync` rather than axios: React Native's FormData is
   * unreliable for multipart bodies read from a `file://` URI, exactly as `attachmentsApi`
   * already found. The browser path needs a real Blob, which RN's `{uri,name,type}` shim is not.
   */
  async uploadMedia(input: EquipmentMediaUpload): Promise<MediaAssetDto> {
    if (Platform.OS === 'web') {
      const fileResponse = await fetch(input.uri);
      const blob = await fileResponse.blob();
      const formData = new FormData();
      formData.append('file', blob, input.fileName);
      return unwrap(
        await apiClient.post<ApiResponse<MediaAssetDto>>('/equipment/media', formData, {
          params: definedOnly({ title: input.title }),
        }),
      );
    }

    const baseUrl = apiClient.defaults.baseURL ?? '';
    const query = input.title === undefined ? '' : `?title=${encodeURIComponent(input.title)}`;
    const result = await FileSystem.uploadAsync(`${baseUrl}/equipment/media${query}`, input.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: input.mimeType,
      headers: await uploadHeaders(),
    });
    return parseUploadBody(result.body, result.status);
  },

  /* --------------------------------------------------------------- masters */

  async listCategories(): Promise<EquipmentCategoryDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentCategoryDto[]>>('/equipment-categories'),
    );
  },

  async locationTree(): Promise<LocationTreeDto> {
    return unwrap(
      await apiClient.get<ApiResponse<LocationTreeDto>>('/equipment-locations/tree'),
    );
  },

  async listFloors(): Promise<EquipmentFloorDto[]> {
    return unwrap(await apiClient.get<ApiResponse<EquipmentFloorDto[]>>('/equipment-floors'));
  },

  async listAreas(floorId?: string): Promise<EquipmentAreaDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentAreaDto[]>>('/equipment-areas', {
        params: definedOnly({ floorId }),
      }),
    );
  },

  async listLocations(query: { floorId?: string; areaId?: string } = {}): Promise<
    EquipmentLocationDto[]
  > {
    return unwrap(
      await apiClient.get<ApiResponse<EquipmentLocationDto[]>>('/equipment-locations', {
        params: definedOnly({ ...query }),
      }),
    );
  },

  async createFloor(input: {
    code: string;
    name: string;
    levelIndex?: number;
  }): Promise<EquipmentFloorDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentFloorDto>>(
        '/equipment-floors',
        definedOnly({ ...input }),
      ),
    );
  },

  async createArea(input: {
    floorId: string;
    code: string;
    name: string;
    assetSegment: string;
  }): Promise<EquipmentAreaDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentAreaDto>>(
        '/equipment-areas',
        definedOnly({ ...input }),
      ),
    );
  },

  async createLocation(input: {
    areaId: string;
    name: string;
    room?: string | null;
    section?: string | null;
    position?: string | null;
  }): Promise<EquipmentLocationDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentLocationDto>>(
        '/equipment-locations',
        definedOnly({ ...input }),
      ),
    );
  },

  async createCategory(input: EquipmentCategoryWriteRequest): Promise<EquipmentCategoryDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentCategoryDto>>(
        '/equipment-categories',
        definedOnly({ ...input }),
      ),
    );
  },

  /* -------------------------------------------------------------- floor plans */

  /** Null when the floor has no plan uploaded — an ordinary answer, not an error. */
  async floorPlanView(floorId: string): Promise<FloorPlanViewDto | null> {
    return unwrap(
      await apiClient.get<ApiResponse<FloorPlanViewDto | null>>(`/floor-plans/floor/${floorId}`),
    );
  },

  async createFloorPlan(input: {
    floorId: string;
    name: string;
    mediaId: string;
  }): Promise<FloorPlanDto> {
    return unwrap(await apiClient.post<ApiResponse<FloorPlanDto>>('/floor-plans', input));
  },

  /** Coordinates are fractions of the image (0..1), never pixels. */
  async setFloorPlanPosition(
    planId: string,
    input: FloorPlanPositionWriteRequest,
  ): Promise<FloorPlanPositionDto[]> {
    return unwrap(
      await apiClient.put<ApiResponse<FloorPlanPositionDto[]>>(
        `/floor-plans/${planId}/positions`,
        input,
      ),
    );
  },

  async removeFloorPlanPosition(
    planId: string,
    equipmentId: string,
  ): Promise<FloorPlanPositionDto[]> {
    return unwrap(
      await apiClient.delete<ApiResponse<FloorPlanPositionDto[]>>(
        `/floor-plans/${planId}/positions/${equipmentId}`,
      ),
    );
  },

  /* -------------------------------------------------------------------- AI */

  /**
   * Every AI call is optional and every one has a manual path behind it. With `GEMINI_API_KEY`
   * unset the server answers 400 with a sentence worth showing, which is why callers pass the
   * rejection through `equipmentErrorMessage` instead of inventing their own copy.
   */
  async identify(mediaId: string): Promise<EquipmentIdentificationDraft> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentIdentificationDraft>>('/equipment/ai/identify', {
        mediaId,
      }),
    );
  },

  async scanDocument(
    mediaId: string,
    docType: EquipmentDocumentType,
  ): Promise<DocumentExtractionDraft> {
    return unwrap(
      await apiClient.post<ApiResponse<DocumentExtractionDraft>>('/equipment/ai/document', {
        mediaId,
        docType,
      }),
    );
  },

  async classifyProblem(input: ProblemClassifyRequest): Promise<ProblemClassificationDraft> {
    return unwrap(
      await apiClient.post<ApiResponse<ProblemClassificationDraft>>(
        '/equipment/ai/classify-problem',
        definedOnly({ ...input }),
      ),
    );
  },
};

/* ---------------------------------------------------------------- maintenance */

export const maintenanceApi = {
  async mine(): Promise<MyMaintenanceDto> {
    return unwrap(await apiClient.get<ApiResponse<MyMaintenanceDto>>('/maintenance/mine'));
  },

  async listTickets(
    query: MaintenanceTicketListQuery = {},
  ): Promise<EquipmentPage<MaintenanceTicketDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<MaintenanceTicketDto[]>>('/maintenance/tickets', {
        params: definedOnly({
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          equipmentId: query.equipmentId,
          status: query.status,
          priority: query.priority,
          kind: query.kind,
          problemCategory: query.problemCategory,
          supplierId: query.supplierId,
          assignedTo: query.assignedTo,
          reportedBy: query.reportedBy,
          floorId: query.floorId,
          areaId: query.areaId,
          openOnly: query.openOnly,
          mine: query.mine,
        }),
      }),
    );
  },

  async createTicket(input: MaintenanceTicketCreateRequest): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.post<ApiResponse<MaintenanceTicketDto>>('/maintenance/tickets', input),
    );
  },

  async getTicket(id: string): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.get<ApiResponse<MaintenanceTicketDto>>(`/maintenance/tickets/${id}`),
    );
  },

  async changeTicketStatus(
    id: string,
    input: MaintenanceStatusChangeRequest,
  ): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.post<ApiResponse<MaintenanceTicketDto>>(
        `/maintenance/tickets/${id}/status`,
        input,
      ),
    );
  },

  async assignTicket(id: string, input: MaintenanceAssignRequest): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.post<ApiResponse<MaintenanceTicketDto>>(
        `/maintenance/tickets/${id}/assign`,
        input,
      ),
    );
  },

  async completeTicket(
    id: string,
    input: MaintenanceCompleteRequest,
  ): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.post<ApiResponse<MaintenanceTicketDto>>(
        `/maintenance/tickets/${id}/complete`,
        input,
      ),
    );
  },

  async addTicketAttachments(
    id: string,
    attachments: { mediaId: string; kind: MaintenanceAttachmentKind; transcript?: string | null }[],
  ): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.post<ApiResponse<MaintenanceTicketDto>>(
        `/maintenance/tickets/${id}/attachments`,
        { attachments },
      ),
    );
  },

  async addTicketNote(id: string, note: string): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.post<ApiResponse<MaintenanceTicketDto>>(
        `/maintenance/tickets/${id}/notes`,
        { note },
      ),
    );
  },

  async listSchedules(
    query: {
      page?: number;
      pageSize?: number;
      equipmentId?: string;
      assignedTo?: string;
      dueBefore?: string;
      includeInactive?: boolean;
    } = {},
  ): Promise<EquipmentPage<MaintenanceScheduleDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<MaintenanceScheduleDto[]>>('/maintenance/schedules', {
        params: definedOnly({ ...query }),
      }),
    );
  },

  async createSchedule(input: MaintenanceScheduleWriteRequest): Promise<MaintenanceScheduleDto> {
    return unwrap(
      await apiClient.post<ApiResponse<MaintenanceScheduleDto>>(
        '/maintenance/schedules',
        definedOnly({ ...input }),
      ),
    );
  },

  async updateSchedule(
    id: string,
    input: Partial<MaintenanceScheduleWriteRequest>,
  ): Promise<MaintenanceScheduleDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<MaintenanceScheduleDto>>(
        `/maintenance/schedules/${id}`,
        definedOnly({ ...input }),
      ),
    );
  },

  async removeSchedule(id: string): Promise<void> {
    await apiClient.delete(`/maintenance/schedules/${id}`);
  },

  /** Idempotent: a schedule already covered by an open ticket raises nothing. */
  async runSweep(): Promise<{
    ticketsRaised: number;
    remindersSent: number;
    overdueEscalated: number;
    warrantiesFlagged: number;
  }> {
    return unwrap(
      await apiClient.post<
        ApiResponse<{
          ticketsRaised: number;
          remindersSent: number;
          overdueEscalated: number;
          warrantiesFlagged: number;
        }>
      >('/maintenance/run-sweep'),
    );
  },

  async updateTicket(
    id: string,
    input: MaintenanceTicketUpdateRequest,
  ): Promise<MaintenanceTicketDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<MaintenanceTicketDto>>(
        `/maintenance/tickets/${id}`,
        definedOnly({ ...input }),
      ),
    );
  },
};

/* ------------------------------------------------------------------ suppliers */

export const suppliersApi = {
  async list(query: { page?: number; pageSize?: number; search?: string; categoryId?: string } = {}):
    Promise<EquipmentPage<EquipmentSupplierDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<EquipmentSupplierDto[]>>('/suppliers', {
        params: definedOnly({ ...query }),
      }),
    );
  },

  async getById(id: string): Promise<EquipmentSupplierDto> {
    return unwrap(await apiClient.get<ApiResponse<EquipmentSupplierDto>>(`/suppliers/${id}`));
  },

  async create(input: EquipmentSupplierWriteRequest): Promise<EquipmentSupplierDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentSupplierDto>>(
        '/suppliers',
        definedOnly({ ...input }),
      ),
    );
  },

  async update(
    id: string,
    input: Partial<EquipmentSupplierWriteRequest>,
  ): Promise<EquipmentSupplierDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<EquipmentSupplierDto>>(
        `/suppliers/${id}`,
        definedOnly({ ...input }),
      ),
    );
  },

  async addContact(id: string, input: SupplierContactWriteRequest): Promise<SupplierContactDto[]> {
    return unwrap(
      await apiClient.post<ApiResponse<SupplierContactDto[]>>(
        `/suppliers/${id}/contacts`,
        definedOnly({ ...input }),
      ),
    );
  },

  async removeContact(contactId: string): Promise<SupplierContactDto[]> {
    return unwrap(
      await apiClient.delete<ApiResponse<SupplierContactDto[]>>(
        `/suppliers/contacts/${contactId}`,
      ),
    );
  },

  /** Logged when the dialler opens, before the call is even answered. */
  async logCall(input: EquipmentCallLogRequest): Promise<EquipmentCallLogDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentCallLogDto>>('/suppliers/calls', input),
    );
  },

  async recordCallOutcome(
    callId: string,
    input: EquipmentCallOutcomeRequest,
  ): Promise<EquipmentCallLogDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EquipmentCallLogDto>>(
        `/suppliers/calls/${callId}/outcome`,
        input,
      ),
    );
  },

  /**
   * The server composes the message and hands back a ready `wa.me` link; the phone only opens
   * it, then calls `logWhatsapp` so the asset's timeline records that it went out.
   */
  async whatsappDraft(input: {
    equipmentId: string;
    ticketId?: string | null;
    supplierId?: string | null;
  }): Promise<WhatsappDraftDto> {
    return unwrap(
      await apiClient.post<ApiResponse<WhatsappDraftDto>>(
        '/suppliers/whatsapp/draft',
        definedOnly({ ...input }),
      ),
    );
  },

  async logWhatsapp(input: WhatsappSendRequest): Promise<unknown> {
    return unwrap(
      await apiClient.post<ApiResponse<unknown>>('/suppliers/whatsapp', definedOnly({ ...input })),
    );
  },
};
