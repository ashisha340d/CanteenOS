import type {
  AreaCleaningStatusDto,
  CleanableAssetAvailabilityRequest,
  CleanableAssetCreateRequest,
  CleanableAssetDto,
  CleanableAssetListQuery,
  CleanableAssetTypeDto,
  CleanableAssetTypeWriteRequest,
  CleanableAssetUpdateRequest,
  CleaningAssignmentCandidateDto,
  CleaningAssignmentRuleDto,
  CleaningAssignmentRuleWriteRequest,
  CleaningChemicalDto,
  CleaningChemicalWriteRequest,
  CleaningComplianceDto,
  CleaningComplianceQuery,
  CleaningCorrectiveActionDto,
  CleaningDashboardDto,
  CleaningEventDto,
  CleaningEventListQuery,
  CleaningEventPublishRequest,
  CleaningMethodDto,
  CleaningMethodWriteRequest,
  CleaningProcedureDto,
  CleaningProcedureVersionDto,
  CleaningProcedureVersionWriteRequest,
  CleaningProcedureWriteRequest,
  CleaningReportRequest,
  CleaningReportResultDto,
  CleaningRuleDto,
  CleaningRuleListQuery,
  CleaningRulePreviewDto,
  CleaningRuleUpdateRequest,
  CleaningRuleWriteRequest,
  CleaningSetupDto,
  CleaningStandardDto,
  CleaningStandardWriteRequest,
  CleaningTaskAssignRequest,
  CleaningTaskCancelRequest,
  CleaningTaskCompleteRequest,
  CleaningTaskDto,
  CleaningTaskEvidenceRequest,
  CleaningTaskListQuery,
  CleaningTaskStartRequest,
  CleaningTaskStepUpdateRequest,
  CleaningToolDto,
  CleaningToolWriteRequest,
  CleaningVerifyRequest,
  CleaningWorkforceMemberDto,
  CorrectiveActionListQuery,
  CorrectiveActionUpdateRequest,
  MasterListQuery,
  MyCleaningDto,
  PageQuery,
  ShiftDto,
  ShiftWriteRequest,
  SkillDto,
  SkillWriteRequest,
  UserAreaResponsibilityDto,
  UserAreaResponsibilityWriteRequest,
  UserShiftAssignmentDto,
  UserShiftAssignmentWriteRequest,
  UserSkillDto,
  UserSkillWriteRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

/**
 * Cleaning & Hygiene Management.
 *
 * One API surface for the whole module, because to the portal it is one module: the register,
 * the rules that act on it, the tasks those rules raise, and the record of what was actually
 * done are four views of the same thing.
 */

export interface ProcedureListQuery extends PageQuery {
  includeInactive?: boolean;
  publishedOnly?: boolean;
}

export interface CleaningSweepResult {
  occurrencesRaised: number;
  tasksCreated: number;
  overdueChased: number;
  unassignedEscalated: number;
}

export const cleaningApi = {
  /* ---------------------------------------------------------------- reference */

  setup: () => unwrap<CleaningSetupDto>(http.get('/cleaning/setup')),
  dashboard: () => unwrap<CleaningDashboardDto>(http.get('/cleaning/dashboard')),
  mine: () => unwrap<MyCleaningDto>(http.get('/cleaning/mine')),

  /* -------------------------------------------------------------------- tasks */

  listTasks: (query: CleaningTaskListQuery = {}) =>
    unwrapPaged<CleaningTaskDto>(http.get('/cleaning/tasks', { params: query })),
  getTask: (id: string) => unwrap<CleaningTaskDto>(http.get(`/cleaning/tasks/${id}`)),
  assignTask: (id: string, body: CleaningTaskAssignRequest) =>
    unwrap<CleaningTaskDto>(http.post(`/cleaning/tasks/${id}/assign`, body)),
  taskCandidates: (id: string) =>
    unwrap<CleaningAssignmentCandidateDto[]>(http.get(`/cleaning/tasks/${id}/candidates`)),
  startTask: (id: string, body: CleaningTaskStartRequest = {}) =>
    unwrap<CleaningTaskDto>(http.post(`/cleaning/tasks/${id}/start`, body)),
  recordStep: (id: string, stepId: string, body: CleaningTaskStepUpdateRequest) =>
    unwrap<CleaningTaskDto>(http.post(`/cleaning/tasks/${id}/steps/${stepId}`, body)),
  completeTask: (id: string, body: CleaningTaskCompleteRequest) =>
    unwrap<CleaningTaskDto>(http.post(`/cleaning/tasks/${id}/complete`, body)),
  verifyTask: (id: string, body: CleaningVerifyRequest) =>
    unwrap<CleaningTaskDto>(http.post(`/cleaning/tasks/${id}/verify`, body)),
  cancelTask: (id: string, body: CleaningTaskCancelRequest) =>
    unwrap<CleaningTaskDto>(http.post(`/cleaning/tasks/${id}/cancel`, body)),
  deleteTask: (id: string) => unwrap<null>(http.delete(`/cleaning/tasks/${id}`)),
  addEvidence: (id: string, body: CleaningTaskEvidenceRequest) =>
    unwrap<CleaningTaskDto>(http.post(`/cleaning/tasks/${id}/evidence`, body)),
  removeEvidence: (id: string, evidenceId: string) =>
    unwrap<null>(http.delete(`/cleaning/tasks/${id}/evidence/${evidenceId}`)),

  /* -------------------------------------------------------- corrective actions */

  listCorrectiveActions: (query: CorrectiveActionListQuery = {}) =>
    unwrapPaged<CleaningCorrectiveActionDto>(
      http.get('/cleaning/corrective-actions', { params: query }),
    ),
  getCorrectiveAction: (id: string) =>
    unwrap<CleaningCorrectiveActionDto>(http.get(`/cleaning/corrective-actions/${id}`)),
  updateCorrectiveAction: (id: string, body: CorrectiveActionUpdateRequest) =>
    unwrap<CleaningCorrectiveActionDto>(http.patch(`/cleaning/corrective-actions/${id}`, body)),

  /* ------------------------------------------------------- reports and events */

  report: (body: CleaningReportRequest) =>
    unwrap<CleaningReportResultDto>(http.post('/cleaning/reports', body)),
  publishEvent: (body: CleaningEventPublishRequest) =>
    unwrap<CleaningReportResultDto>(http.post('/cleaning/events', body)),
  listEvents: (query: CleaningEventListQuery = {}) =>
    unwrapPaged<CleaningEventDto>(http.get('/cleaning/events', { params: query })),
  getEvent: (id: string) => unwrap<CleaningEventDto>(http.get(`/cleaning/events/${id}`)),

  /* --------------------------------------------------------- cleanable assets */

  listAssets: (query: CleanableAssetListQuery = {}) =>
    unwrapPaged<CleanableAssetDto>(http.get('/cleaning/assets', { params: query })),
  getAsset: (id: string) => unwrap<CleanableAssetDto>(http.get(`/cleaning/assets/${id}`)),
  resolveAsset: (code: string) =>
    unwrap<CleanableAssetDto>(http.get('/cleaning/assets/resolve', { params: { code } })),
  createAsset: (body: CleanableAssetCreateRequest) =>
    unwrap<CleanableAssetDto>(http.post('/cleaning/assets', body)),
  updateAsset: (id: string, body: CleanableAssetUpdateRequest) =>
    unwrap<CleanableAssetDto>(http.patch(`/cleaning/assets/${id}`, body)),
  setAssetAvailability: (id: string, body: CleanableAssetAvailabilityRequest) =>
    unwrap<CleanableAssetDto>(http.post(`/cleaning/assets/${id}/availability`, body)),
  deleteAsset: (id: string) => unwrap<null>(http.delete(`/cleaning/assets/${id}`)),

  /* ---------------------------------------------------------------- procedures */

  listProcedures: (query: ProcedureListQuery = {}) =>
    unwrapPaged<CleaningProcedureDto>(http.get('/cleaning/procedures', { params: query })),
  getProcedure: (id: string) =>
    unwrap<CleaningProcedureDto>(http.get(`/cleaning/procedures/${id}`)),
  createProcedure: (body: CleaningProcedureWriteRequest) =>
    unwrap<CleaningProcedureDto>(http.post('/cleaning/procedures', body)),
  updateProcedure: (id: string, body: Partial<CleaningProcedureWriteRequest>) =>
    unwrap<CleaningProcedureDto>(http.patch(`/cleaning/procedures/${id}`, body)),
  deleteProcedure: (id: string) => unwrap<null>(http.delete(`/cleaning/procedures/${id}`)),
  saveProcedureDraft: (id: string, body: CleaningProcedureVersionWriteRequest) =>
    unwrap<CleaningProcedureVersionDto>(http.put(`/cleaning/procedures/${id}/draft`, body)),
  cloneProcedureDraft: (id: string) =>
    unwrap<CleaningProcedureVersionDto>(
      http.post(`/cleaning/procedures/${id}/draft-from-published`),
    ),
  discardProcedureDraft: (id: string) =>
    unwrap<null>(http.delete(`/cleaning/procedures/${id}/draft`)),
  publishProcedure: (id: string) =>
    unwrap<CleaningProcedureVersionDto>(http.post(`/cleaning/procedures/${id}/publish`)),
  getProcedureVersion: (id: string) =>
    unwrap<CleaningProcedureVersionDto>(http.get(`/cleaning/procedure-versions/${id}`)),

  /* --------------------------------------------------------------------- rules */

  listRules: (query: CleaningRuleListQuery = {}) =>
    unwrapPaged<CleaningRuleDto>(http.get('/cleaning/rules', { params: query })),
  getRule: (id: string) => unwrap<CleaningRuleDto>(http.get(`/cleaning/rules/${id}`)),
  createRule: (body: CleaningRuleWriteRequest) =>
    unwrap<CleaningRuleDto>(http.post('/cleaning/rules', body)),
  updateRule: (id: string, body: CleaningRuleUpdateRequest) =>
    unwrap<CleaningRuleDto>(http.patch(`/cleaning/rules/${id}`, body)),
  deleteRule: (id: string) => unwrap<null>(http.delete(`/cleaning/rules/${id}`)),
  previewRule: (id: string) =>
    unwrap<CleaningRulePreviewDto>(http.get(`/cleaning/rules/${id}/preview`)),
  runRule: (id: string) => unwrap<CleaningReportResultDto>(http.post(`/cleaning/rules/${id}/run`)),

  /* ------------------------------------------------------------------- masters */

  listAssetTypes: (query: MasterListQuery = {}) =>
    unwrap<CleanableAssetTypeDto[]>(http.get('/cleaning/asset-types', { params: query })),
  createAssetType: (body: CleanableAssetTypeWriteRequest) =>
    unwrap<CleanableAssetTypeDto>(http.post('/cleaning/asset-types', body)),
  updateAssetType: (id: string, body: Partial<CleanableAssetTypeWriteRequest>) =>
    unwrap<CleanableAssetTypeDto>(http.patch(`/cleaning/asset-types/${id}`, body)),
  deleteAssetType: (id: string) => unwrap<null>(http.delete(`/cleaning/asset-types/${id}`)),

  listMethods: (query: MasterListQuery = {}) =>
    unwrap<CleaningMethodDto[]>(http.get('/cleaning/methods', { params: query })),
  createMethod: (body: CleaningMethodWriteRequest) =>
    unwrap<CleaningMethodDto>(http.post('/cleaning/methods', body)),
  updateMethod: (id: string, body: Partial<CleaningMethodWriteRequest>) =>
    unwrap<CleaningMethodDto>(http.patch(`/cleaning/methods/${id}`, body)),
  deleteMethod: (id: string) => unwrap<null>(http.delete(`/cleaning/methods/${id}`)),

  listStandards: (query: MasterListQuery = {}) =>
    unwrap<CleaningStandardDto[]>(http.get('/cleaning/standards', { params: query })),
  createStandard: (body: CleaningStandardWriteRequest) =>
    unwrap<CleaningStandardDto>(http.post('/cleaning/standards', body)),
  updateStandard: (id: string, body: Partial<CleaningStandardWriteRequest>) =>
    unwrap<CleaningStandardDto>(http.patch(`/cleaning/standards/${id}`, body)),
  deleteStandard: (id: string) => unwrap<null>(http.delete(`/cleaning/standards/${id}`)),

  listChemicals: (query: MasterListQuery = {}) =>
    unwrap<CleaningChemicalDto[]>(http.get('/cleaning/chemicals', { params: query })),
  createChemical: (body: CleaningChemicalWriteRequest) =>
    unwrap<CleaningChemicalDto>(http.post('/cleaning/chemicals', body)),
  updateChemical: (id: string, body: Partial<CleaningChemicalWriteRequest>) =>
    unwrap<CleaningChemicalDto>(http.patch(`/cleaning/chemicals/${id}`, body)),
  deleteChemical: (id: string) => unwrap<null>(http.delete(`/cleaning/chemicals/${id}`)),

  listTools: (query: MasterListQuery = {}) =>
    unwrap<CleaningToolDto[]>(http.get('/cleaning/tools', { params: query })),
  createTool: (body: CleaningToolWriteRequest) =>
    unwrap<CleaningToolDto>(http.post('/cleaning/tools', body)),
  updateTool: (id: string, body: Partial<CleaningToolWriteRequest>) =>
    unwrap<CleaningToolDto>(http.patch(`/cleaning/tools/${id}`, body)),
  deleteTool: (id: string) => unwrap<null>(http.delete(`/cleaning/tools/${id}`)),

  /* ----------------------------------------------------------------- workforce */

  listSkills: (query: MasterListQuery = {}) =>
    unwrap<SkillDto[]>(http.get('/cleaning/skills', { params: query })),
  createSkill: (body: SkillWriteRequest) => unwrap<SkillDto>(http.post('/cleaning/skills', body)),
  updateSkill: (id: string, body: Partial<SkillWriteRequest>) =>
    unwrap<SkillDto>(http.patch(`/cleaning/skills/${id}`, body)),
  deleteSkill: (id: string) => unwrap<null>(http.delete(`/cleaning/skills/${id}`)),

  listShifts: (query: MasterListQuery = {}) =>
    unwrap<ShiftDto[]>(http.get('/cleaning/shifts', { params: query })),
  createShift: (body: ShiftWriteRequest) => unwrap<ShiftDto>(http.post('/cleaning/shifts', body)),
  updateShift: (id: string, body: Partial<ShiftWriteRequest>) =>
    unwrap<ShiftDto>(http.patch(`/cleaning/shifts/${id}`, body)),
  deleteShift: (id: string) => unwrap<null>(http.delete(`/cleaning/shifts/${id}`)),

  roster: () => unwrap<CleaningWorkforceMemberDto[]>(http.get('/cleaning/workforce')),
  grantSkill: (userId: string, body: UserSkillWriteRequest) =>
    unwrap<UserSkillDto[]>(http.post(`/cleaning/workforce/${userId}/skills`, body)),
  revokeSkill: (userId: string, skillId: string) =>
    unwrap<null>(http.delete(`/cleaning/workforce/${userId}/skills/${skillId}`)),
  assignShift: (userId: string, body: UserShiftAssignmentWriteRequest) =>
    unwrap<UserShiftAssignmentDto[]>(http.post(`/cleaning/workforce/${userId}/shifts`, body)),
  removeShift: (userId: string, assignmentId: string) =>
    unwrap<null>(http.delete(`/cleaning/workforce/${userId}/shifts/${assignmentId}`)),
  setAreaResponsibility: (userId: string, body: UserAreaResponsibilityWriteRequest) =>
    unwrap<UserAreaResponsibilityDto[]>(http.post(`/cleaning/workforce/${userId}/areas`, body)),
  removeAreaResponsibility: (userId: string, areaId: string) =>
    unwrap<null>(http.delete(`/cleaning/workforce/${userId}/areas/${areaId}`)),
  listAreaResponsibles: (areaId: string) =>
    unwrap<UserAreaResponsibilityDto[]>(http.get(`/cleaning/areas/${areaId}/responsibles`)),

  listAssignmentPolicies: () =>
    unwrap<CleaningAssignmentRuleDto[]>(http.get('/cleaning/assignment-policies')),
  saveAssignmentPolicy: (body: CleaningAssignmentRuleWriteRequest) =>
    unwrap<CleaningAssignmentRuleDto>(http.put('/cleaning/assignment-policies', body)),
  deleteAssignmentPolicy: (id: string) =>
    unwrap<null>(http.delete(`/cleaning/assignment-policies/${id}`)),

  /* ---------------------------------------------------------------- compliance */

  compliance: (query: CleaningComplianceQuery = {}) =>
    unwrap<CleaningComplianceDto>(http.get('/cleaning/compliance', { params: query })),
  runSweep: () => unwrap<CleaningSweepResult>(http.post('/cleaning/sweep')),
};

export type { AreaCleaningStatusDto };
