import type {
  ApiResponse,
  CleanableAssetDto,
  CleanableAssetListQuery,
  CleaningAssignmentCandidateDto,
  CleaningCorrectiveActionDto,
  CleaningDashboardDto,
  CleaningEventDto,
  CleaningEventListQuery,
  CleaningReportRequest,
  CleaningReportResultDto,
  CleaningSetupDto,
  CleaningTaskAssignRequest,
  CleaningTaskCancelRequest,
  CleaningTaskCompleteRequest,
  CleaningTaskDto,
  CleaningTaskEvidenceRequest,
  CleaningTaskListQuery,
  CleaningTaskStartRequest,
  CleaningTaskStepUpdateRequest,
  CleaningVerifyRequest,
  CorrectiveActionListQuery,
  CorrectiveActionUpdateRequest,
  MyCleaningDto,
} from '@menuboard/shared';
import { apiClient, unwrap } from './client';
import { equipmentErrorMessage, type EquipmentPage } from './equipment';

/**
 * Cleaning & Hygiene Management.
 *
 * Deliberately **online-only**, like `equipmentApi` and `tasksApi`: none of these entities takes
 * part in the delta-sync engine, so this module talks to the server directly and the screens
 * treat a failed request as an ordinary outcome rather than an exception.
 *
 * That is also the honest model for the domain. A cleaning task is assigned by an engine that
 * weighs who is on shift right now; two phones queueing an offline "I did it" would both
 * believe they owned the job, and a hygiene record that disagrees with itself is worse than no
 * record at all.
 */

/** Re-exported so cleaning screens need only import from one module. */
export { equipmentErrorMessage as cleaningErrorMessage };
export type { EquipmentPage as CleaningPage };

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

/** Strips `undefined` so a `.strict()` query schema never sees a key it does not know. */
function definedOnly(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
}

export const cleaningApi = {
  /* ---------------------------------------------------------------- landing */

  /** The phone's landing payload: what is mine, what is due, what needs checking. */
  async mine(): Promise<MyCleaningDto> {
    return unwrap(await apiClient.get<ApiResponse<MyCleaningDto>>('/cleaning/mine'));
  },

  async setup(): Promise<CleaningSetupDto> {
    return unwrap(await apiClient.get<ApiResponse<CleaningSetupDto>>('/cleaning/setup'));
  },

  async dashboard(): Promise<CleaningDashboardDto> {
    return unwrap(await apiClient.get<ApiResponse<CleaningDashboardDto>>('/cleaning/dashboard'));
  },

  /* ------------------------------------------------------------------ tasks */

  async listTasks(query: CleaningTaskListQuery = {}): Promise<EquipmentPage<CleaningTaskDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<CleaningTaskDto[]>>('/cleaning/tasks', {
        params: definedOnly({
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          status: query.status,
          priority: query.priority,
          areaId: query.areaId,
          cleanableAssetId: query.cleanableAssetId,
          shiftId: query.shiftId,
          mine: query.mine,
          openOnly: query.openOnly,
          overdueOnly: query.overdueOnly,
          unassignedOnly: query.unassignedOnly,
          awaitingVerification: query.awaitingVerification,
        }),
      }),
    );
  },

  async getTask(id: string): Promise<CleaningTaskDto> {
    return unwrap(await apiClient.get<ApiResponse<CleaningTaskDto>>(`/cleaning/tasks/${id}`));
  },

  async start(id: string, input: CleaningTaskStartRequest = {}): Promise<CleaningTaskDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningTaskDto>>(`/cleaning/tasks/${id}/start`, input),
    );
  },

  async recordStep(
    id: string,
    stepId: string,
    input: CleaningTaskStepUpdateRequest,
  ): Promise<CleaningTaskDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningTaskDto>>(
        `/cleaning/tasks/${id}/steps/${stepId}`,
        definedOnly({ ...input }),
      ),
    );
  },

  async complete(id: string, input: CleaningTaskCompleteRequest): Promise<CleaningTaskDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningTaskDto>>(
        `/cleaning/tasks/${id}/complete`,
        definedOnly({ ...input }),
      ),
    );
  },

  async addEvidence(id: string, input: CleaningTaskEvidenceRequest): Promise<CleaningTaskDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningTaskDto>>(
        `/cleaning/tasks/${id}/evidence`,
        definedOnly({ ...input }),
      ),
    );
  },

  async verify(id: string, input: CleaningVerifyRequest): Promise<CleaningTaskDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningTaskDto>>(
        `/cleaning/tasks/${id}/verify`,
        definedOnly({ ...input }),
      ),
    );
  },

  async assign(id: string, input: CleaningTaskAssignRequest): Promise<CleaningTaskDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningTaskDto>>(
        `/cleaning/tasks/${id}/assign`,
        definedOnly({ ...input }),
      ),
    );
  },

  async candidates(id: string): Promise<CleaningAssignmentCandidateDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<CleaningAssignmentCandidateDto[]>>(
        `/cleaning/tasks/${id}/candidates`,
      ),
    );
  },

  async cancel(id: string, input: CleaningTaskCancelRequest): Promise<CleaningTaskDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningTaskDto>>(`/cleaning/tasks/${id}/cancel`, input),
    );
  },

  /* ---------------------------------------------------------------- reports */

  /** "This needs cleaning." The endpoint every signed-in user reaches. */
  async report(input: CleaningReportRequest): Promise<CleaningReportResultDto> {
    return unwrap(
      await apiClient.post<ApiResponse<CleaningReportResultDto>>(
        '/cleaning/reports',
        definedOnly({ ...input }),
      ),
    );
  },

  async listEvents(query: CleaningEventListQuery = {}): Promise<EquipmentPage<CleaningEventDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<CleaningEventDto[]>>('/cleaning/events', {
        params: definedOnly({
          page: query.page,
          pageSize: query.pageSize,
          eventType: query.eventType,
          areaId: query.areaId,
          cleanableAssetId: query.cleanableAssetId,
          mine: query.mine,
        }),
      }),
    );
  },

  /* ----------------------------------------------------------------- assets */

  async listAssets(
    query: CleanableAssetListQuery = {},
  ): Promise<EquipmentPage<CleanableAssetDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<CleanableAssetDto[]>>('/cleaning/assets', {
        params: definedOnly({
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          areaId: query.areaId,
          assetTypeId: query.assetTypeId,
          riskLevel: query.riskLevel,
          foodContact: query.foodContact,
          availableOnly: query.availableOnly,
        }),
      }),
    );
  },

  async getAsset(id: string): Promise<CleanableAssetDto> {
    return unwrap(await apiClient.get<ApiResponse<CleanableAssetDto>>(`/cleaning/assets/${id}`));
  },

  /** A scanned label or a typed code — the way in without browsing the register. */
  async resolveAsset(code: string): Promise<CleanableAssetDto> {
    return unwrap(
      await apiClient.get<ApiResponse<CleanableAssetDto>>('/cleaning/assets/resolve', {
        params: { code },
      }),
    );
  },

  /* ---------------------------------------------------------- corrective actions */

  async listCorrectiveActions(
    query: CorrectiveActionListQuery = {},
  ): Promise<EquipmentPage<CleaningCorrectiveActionDto>> {
    return unwrapPage(
      await apiClient.get<ApiResponse<CleaningCorrectiveActionDto[]>>(
        '/cleaning/corrective-actions',
        {
          params: definedOnly({
            page: query.page,
            pageSize: query.pageSize,
            status: query.status,
            mine: query.mine,
            openOnly: query.openOnly,
            overdueOnly: query.overdueOnly,
          }),
        },
      ),
    );
  },

  async getCorrectiveAction(id: string): Promise<CleaningCorrectiveActionDto> {
    return unwrap(
      await apiClient.get<ApiResponse<CleaningCorrectiveActionDto>>(
        `/cleaning/corrective-actions/${id}`,
      ),
    );
  },

  async updateCorrectiveAction(
    id: string,
    input: CorrectiveActionUpdateRequest,
  ): Promise<CleaningCorrectiveActionDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<CleaningCorrectiveActionDto>>(
        `/cleaning/corrective-actions/${id}`,
        definedOnly({ ...input }),
      ),
    );
  },
};
