import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CleanableAssetAvailabilityRequest,
  CleanableAssetCreateRequest,
  CleanableAssetListQuery,
  CleanableAssetTypeWriteRequest,
  CleanableAssetUpdateRequest,
  CleaningAssignmentRuleWriteRequest,
  CleaningChemicalWriteRequest,
  CleaningComplianceQuery,
  CleaningEventListQuery,
  CleaningMethodWriteRequest,
  CleaningProcedureVersionWriteRequest,
  CleaningProcedureWriteRequest,
  CleaningReportRequest,
  CleaningRuleListQuery,
  CleaningRuleUpdateRequest,
  CleaningRuleWriteRequest,
  CleaningStandardWriteRequest,
  CleaningTaskAssignRequest,
  CleaningTaskCancelRequest,
  CleaningTaskCompleteRequest,
  CleaningTaskListQuery,
  CleaningTaskStepUpdateRequest,
  CleaningToolWriteRequest,
  CleaningVerifyRequest,
  CorrectiveActionListQuery,
  CorrectiveActionUpdateRequest,
  MasterListQuery,
  ShiftWriteRequest,
  SkillWriteRequest,
  UserAreaResponsibilityWriteRequest,
  UserShiftAssignmentWriteRequest,
  UserSkillWriteRequest,
} from '@menuboard/shared';
import { cleaningApi, type ProcedureListQuery } from '../api/cleaning';

/**
 * Query keys are coarse on purpose, for the same reason the equipment module's are: almost
 * every write here changes something a neighbouring screen shows. Verifying a task changes the
 * task, the asset's counters, the area's compliance, the dashboard and the corrective-action
 * list — so a write invalidates the module rather than trying to predict the blast radius and
 * getting it wrong.
 */
const MODULE_KEY = 'cleaning';

function useCleaningMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: [MODULE_KEY] }),
  });
}

/* ---------------------------------------------------------------- reference */

export function useCleaningSetup() {
  return useQuery({
    queryKey: [MODULE_KEY, 'setup'],
    queryFn: () => cleaningApi.setup(),
    // The masters behind a form change rarely; refetching them on every focus is noise.
    staleTime: 5 * 60 * 1000,
  });
}

export function useCleaningDashboard() {
  return useQuery({
    queryKey: [MODULE_KEY, 'dashboard'],
    queryFn: () => cleaningApi.dashboard(),
    refetchInterval: 60_000,
  });
}

export function useMyCleaning() {
  return useQuery({ queryKey: [MODULE_KEY, 'mine'], queryFn: () => cleaningApi.mine() });
}

/* -------------------------------------------------------------------- tasks */

export function useCleaningTasks(query: CleaningTaskListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'tasks', query],
    queryFn: () => cleaningApi.listTasks(query),
  });
}

export function useCleaningTask(id: string | null) {
  return useQuery({
    queryKey: [MODULE_KEY, 'task', id],
    queryFn: () => cleaningApi.getTask(id as string),
    enabled: id !== null,
  });
}

export function useTaskCandidates(id: string | null) {
  return useQuery({
    queryKey: [MODULE_KEY, 'task-candidates', id],
    queryFn: () => cleaningApi.taskCandidates(id as string),
    enabled: id !== null,
  });
}

export function useAssignCleaningTask() {
  return useCleaningMutation(({ id, body }: { id: string; body: CleaningTaskAssignRequest }) =>
    cleaningApi.assignTask(id, body),
  );
}

export function useStartCleaningTask() {
  return useCleaningMutation((id: string) => cleaningApi.startTask(id));
}

export function useRecordCleaningStep() {
  return useCleaningMutation(
    ({ id, stepId, body }: { id: string; stepId: string; body: CleaningTaskStepUpdateRequest }) =>
      cleaningApi.recordStep(id, stepId, body),
  );
}

export function useCompleteCleaningTask() {
  return useCleaningMutation(({ id, body }: { id: string; body: CleaningTaskCompleteRequest }) =>
    cleaningApi.completeTask(id, body),
  );
}

export function useVerifyCleaningTask() {
  return useCleaningMutation(({ id, body }: { id: string; body: CleaningVerifyRequest }) =>
    cleaningApi.verifyTask(id, body),
  );
}

export function useCancelCleaningTask() {
  return useCleaningMutation(({ id, body }: { id: string; body: CleaningTaskCancelRequest }) =>
    cleaningApi.cancelTask(id, body),
  );
}

export function useDeleteCleaningTask() {
  return useCleaningMutation((id: string) => cleaningApi.deleteTask(id));
}

/* -------------------------------------------------------- corrective actions */

export function useCorrectiveActions(query: CorrectiveActionListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'corrective-actions', query],
    queryFn: () => cleaningApi.listCorrectiveActions(query),
  });
}

export function useUpdateCorrectiveAction() {
  return useCleaningMutation(({ id, body }: { id: string; body: CorrectiveActionUpdateRequest }) =>
    cleaningApi.updateCorrectiveAction(id, body),
  );
}

/* ------------------------------------------------------- reports and events */

export function useCleaningEvents(query: CleaningEventListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'events', query],
    queryFn: () => cleaningApi.listEvents(query),
  });
}

export function useReportCleaning() {
  return useCleaningMutation((body: CleaningReportRequest) => cleaningApi.report(body));
}

/* --------------------------------------------------------- cleanable assets */

export function useCleanableAssets(query: CleanableAssetListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'assets', query],
    queryFn: () => cleaningApi.listAssets(query),
  });
}

export function useCleanableAsset(id: string | null) {
  return useQuery({
    queryKey: [MODULE_KEY, 'asset', id],
    queryFn: () => cleaningApi.getAsset(id as string),
    enabled: id !== null,
  });
}

export function useCreateCleanableAsset() {
  return useCleaningMutation((body: CleanableAssetCreateRequest) => cleaningApi.createAsset(body));
}

export function useUpdateCleanableAsset() {
  return useCleaningMutation(({ id, body }: { id: string; body: CleanableAssetUpdateRequest }) =>
    cleaningApi.updateAsset(id, body),
  );
}

export function useSetAssetAvailability() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: CleanableAssetAvailabilityRequest }) =>
      cleaningApi.setAssetAvailability(id, body),
  );
}

export function useDeleteCleanableAsset() {
  return useCleaningMutation((id: string) => cleaningApi.deleteAsset(id));
}

/* ---------------------------------------------------------------- procedures */

export function useCleaningProcedures(query: ProcedureListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'procedures', query],
    queryFn: () => cleaningApi.listProcedures(query),
  });
}

export function useCleaningProcedure(id: string | null) {
  return useQuery({
    queryKey: [MODULE_KEY, 'procedure', id],
    queryFn: () => cleaningApi.getProcedure(id as string),
    enabled: id !== null,
  });
}

export function useCreateProcedure() {
  return useCleaningMutation((body: CleaningProcedureWriteRequest) =>
    cleaningApi.createProcedure(body),
  );
}

export function useUpdateProcedure() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: Partial<CleaningProcedureWriteRequest> }) =>
      cleaningApi.updateProcedure(id, body),
  );
}

export function useDeleteProcedure() {
  return useCleaningMutation((id: string) => cleaningApi.deleteProcedure(id));
}

export function useSaveProcedureDraft() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: CleaningProcedureVersionWriteRequest }) =>
      cleaningApi.saveProcedureDraft(id, body),
  );
}

export function useCloneProcedureDraft() {
  return useCleaningMutation((id: string) => cleaningApi.cloneProcedureDraft(id));
}

export function useDiscardProcedureDraft() {
  return useCleaningMutation((id: string) => cleaningApi.discardProcedureDraft(id));
}

export function usePublishProcedure() {
  return useCleaningMutation((id: string) => cleaningApi.publishProcedure(id));
}

/* --------------------------------------------------------------------- rules */

export function useCleaningRules(query: CleaningRuleListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'rules', query],
    queryFn: () => cleaningApi.listRules(query),
  });
}

export function useCleaningRule(id: string | null) {
  return useQuery({
    queryKey: [MODULE_KEY, 'rule', id],
    queryFn: () => cleaningApi.getRule(id as string),
    enabled: id !== null,
  });
}

export function useRulePreview(id: string | null) {
  return useQuery({
    queryKey: [MODULE_KEY, 'rule-preview', id],
    queryFn: () => cleaningApi.previewRule(id as string),
    enabled: id !== null,
  });
}

export function useCreateCleaningRule() {
  return useCleaningMutation((body: CleaningRuleWriteRequest) => cleaningApi.createRule(body));
}

export function useUpdateCleaningRule() {
  return useCleaningMutation(({ id, body }: { id: string; body: CleaningRuleUpdateRequest }) =>
    cleaningApi.updateRule(id, body),
  );
}

export function useDeleteCleaningRule() {
  return useCleaningMutation((id: string) => cleaningApi.deleteRule(id));
}

export function useRunCleaningRule() {
  return useCleaningMutation((id: string) => cleaningApi.runRule(id));
}

export function useRunCleaningSweep() {
  return useCleaningMutation(() => cleaningApi.runSweep());
}

/* ------------------------------------------------------------------- masters */

export function useCleaningAssetTypes(query: MasterListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'asset-types', query],
    queryFn: () => cleaningApi.listAssetTypes(query),
  });
}
export function useCreateAssetType() {
  return useCleaningMutation((body: CleanableAssetTypeWriteRequest) =>
    cleaningApi.createAssetType(body),
  );
}
export function useUpdateAssetType() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: Partial<CleanableAssetTypeWriteRequest> }) =>
      cleaningApi.updateAssetType(id, body),
  );
}
export function useDeleteAssetType() {
  return useCleaningMutation((id: string) => cleaningApi.deleteAssetType(id));
}

export function useCleaningMethods(query: MasterListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'methods', query],
    queryFn: () => cleaningApi.listMethods(query),
  });
}
export function useCreateMethod() {
  return useCleaningMutation((body: CleaningMethodWriteRequest) => cleaningApi.createMethod(body));
}
export function useUpdateMethod() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: Partial<CleaningMethodWriteRequest> }) =>
      cleaningApi.updateMethod(id, body),
  );
}
export function useDeleteMethod() {
  return useCleaningMutation((id: string) => cleaningApi.deleteMethod(id));
}

export function useCleaningStandards(query: MasterListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'standards', query],
    queryFn: () => cleaningApi.listStandards(query),
  });
}
export function useCreateStandard() {
  return useCleaningMutation((body: CleaningStandardWriteRequest) =>
    cleaningApi.createStandard(body),
  );
}
export function useUpdateStandard() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: Partial<CleaningStandardWriteRequest> }) =>
      cleaningApi.updateStandard(id, body),
  );
}
export function useDeleteStandard() {
  return useCleaningMutation((id: string) => cleaningApi.deleteStandard(id));
}

export function useCleaningChemicals(query: MasterListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'chemicals', query],
    queryFn: () => cleaningApi.listChemicals(query),
  });
}
export function useCreateChemical() {
  return useCleaningMutation((body: CleaningChemicalWriteRequest) =>
    cleaningApi.createChemical(body),
  );
}
export function useUpdateChemical() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: Partial<CleaningChemicalWriteRequest> }) =>
      cleaningApi.updateChemical(id, body),
  );
}
export function useDeleteChemical() {
  return useCleaningMutation((id: string) => cleaningApi.deleteChemical(id));
}

export function useCleaningTools(query: MasterListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'tools', query],
    queryFn: () => cleaningApi.listTools(query),
  });
}
export function useCreateTool() {
  return useCleaningMutation((body: CleaningToolWriteRequest) => cleaningApi.createTool(body));
}
export function useUpdateTool() {
  return useCleaningMutation(
    ({ id, body }: { id: string; body: Partial<CleaningToolWriteRequest> }) =>
      cleaningApi.updateTool(id, body),
  );
}
export function useDeleteTool() {
  return useCleaningMutation((id: string) => cleaningApi.deleteTool(id));
}

/* ----------------------------------------------------------------- workforce */

export function useCleaningSkills(query: MasterListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'skills', query],
    queryFn: () => cleaningApi.listSkills(query),
  });
}
export function useCreateSkill() {
  return useCleaningMutation((body: SkillWriteRequest) => cleaningApi.createSkill(body));
}
export function useUpdateSkill() {
  return useCleaningMutation(({ id, body }: { id: string; body: Partial<SkillWriteRequest> }) =>
    cleaningApi.updateSkill(id, body),
  );
}
export function useDeleteSkill() {
  return useCleaningMutation((id: string) => cleaningApi.deleteSkill(id));
}

export function useCleaningShifts(query: MasterListQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'shifts', query],
    queryFn: () => cleaningApi.listShifts(query),
  });
}
export function useCreateShift() {
  return useCleaningMutation((body: ShiftWriteRequest) => cleaningApi.createShift(body));
}
export function useUpdateShift() {
  return useCleaningMutation(({ id, body }: { id: string; body: Partial<ShiftWriteRequest> }) =>
    cleaningApi.updateShift(id, body),
  );
}
export function useDeleteShift() {
  return useCleaningMutation((id: string) => cleaningApi.deleteShift(id));
}

export function useCleaningRoster() {
  return useQuery({ queryKey: [MODULE_KEY, 'roster'], queryFn: () => cleaningApi.roster() });
}

export function useGrantSkill() {
  return useCleaningMutation(({ userId, body }: { userId: string; body: UserSkillWriteRequest }) =>
    cleaningApi.grantSkill(userId, body),
  );
}
export function useRevokeSkill() {
  return useCleaningMutation(({ userId, skillId }: { userId: string; skillId: string }) =>
    cleaningApi.revokeSkill(userId, skillId),
  );
}
export function useAssignShift() {
  return useCleaningMutation(
    ({ userId, body }: { userId: string; body: UserShiftAssignmentWriteRequest }) =>
      cleaningApi.assignShift(userId, body),
  );
}
export function useRemoveShift() {
  return useCleaningMutation(({ userId, assignmentId }: { userId: string; assignmentId: string }) =>
    cleaningApi.removeShift(userId, assignmentId),
  );
}
export function useSetAreaResponsibility() {
  return useCleaningMutation(
    ({ userId, body }: { userId: string; body: UserAreaResponsibilityWriteRequest }) =>
      cleaningApi.setAreaResponsibility(userId, body),
  );
}
export function useRemoveAreaResponsibility() {
  return useCleaningMutation(({ userId, areaId }: { userId: string; areaId: string }) =>
    cleaningApi.removeAreaResponsibility(userId, areaId),
  );
}

export function useAssignmentPolicies() {
  return useQuery({
    queryKey: [MODULE_KEY, 'assignment-policies'],
    queryFn: () => cleaningApi.listAssignmentPolicies(),
  });
}
export function useSaveAssignmentPolicy() {
  return useCleaningMutation((body: CleaningAssignmentRuleWriteRequest) =>
    cleaningApi.saveAssignmentPolicy(body),
  );
}
export function useDeleteAssignmentPolicy() {
  return useCleaningMutation((id: string) => cleaningApi.deleteAssignmentPolicy(id));
}

/* ---------------------------------------------------------------- compliance */

export function useCleaningCompliance(query: CleaningComplianceQuery = {}) {
  return useQuery({
    queryKey: [MODULE_KEY, 'compliance', query],
    queryFn: () => cleaningApi.compliance(query),
  });
}
