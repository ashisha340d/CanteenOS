import type { Request, Response } from 'express';
import {
  Capability,
  type CleanableAssetAvailabilityRequest,
  type CleanableAssetCreateRequest,
  type CleanableAssetListQuery,
  type CleanableAssetTypeWriteRequest,
  type CleanableAssetUpdateRequest,
  type CleaningAssignmentRuleWriteRequest,
  type CleaningChemicalWriteRequest,
  type CleaningComplianceQuery,
  type CleaningEventListQuery,
  type CleaningEventPublishRequest,
  type CleaningMethodWriteRequest,
  type CleaningProcedureVersionWriteRequest,
  type CleaningProcedureWriteRequest,
  type CleaningReportRequest,
  type CleaningRuleListQuery,
  type CleaningRuleUpdateRequest,
  type CleaningRuleWriteRequest,
  type CleaningStandardWriteRequest,
  type CleaningTaskAssignRequest,
  type CleaningTaskCancelRequest,
  type CleaningTaskCompleteRequest,
  type CleaningTaskEvidenceRequest,
  type CleaningTaskListQuery,
  type CleaningTaskStartRequest,
  type CleaningTaskStepUpdateRequest,
  type CleaningToolWriteRequest,
  type CleaningVerifyRequest,
  type CorrectiveActionListQuery,
  type CorrectiveActionUpdateRequest,
  type MasterListQuery,
  type ShiftWriteRequest,
  type SkillWriteRequest,
  type UserAreaResponsibilityWriteRequest,
  type UserShiftAssignmentWriteRequest,
  type UserSkillWriteRequest,
} from '@menuboard/shared';
import { requireAuth } from '../middleware/types';
import { cleaningAssetService } from '../services/CleaningAssetService';
import { cleaningComplianceService } from '../services/CleaningComplianceService';
import { cleaningMasterService } from '../services/CleaningMasterService';
import {
  cleaningProcedureService,
  type ProcedureListQuery,
} from '../services/CleaningProcedureService';
import { cleaningReportService } from '../services/CleaningReportService';
import { cleaningRuleService } from '../services/CleaningRuleService';
import { cleaningSchedulerService } from '../services/CleaningSchedulerService';
import { cleaningTaskService } from '../services/CleaningTaskService';
import { cleaningWorkforceService } from '../services/CleaningWorkforceService';
import { ForbiddenError } from '../utils/errors';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Cleaning & Hygiene Management.
 *
 * The routes carry the capability gates; two decisions live here instead, because the same
 * endpoint legitimately serves two audiences:
 *
 *  - **Deleting a cleaning record destroys compliance history**, so `cleaning.delete` is
 *    checked against the target rather than granted to everyone who may edit.
 *  - **Working a task** is the assignee's job and a supervisor's fallback. That check needs
 *    the task, so it lives in `CleaningTaskService`, not on the route.
 */
function has(req: Request, capability: Capability): boolean {
  return requireAuth(req).capabilities.includes(capability);
}

function viewer(req: Request): string {
  return requireAuth(req).userId;
}

export const CleaningController = {
  /* ---------------------------------------------------------------- reference */

  async setup(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningMasterService.setup(viewer(req)));
  },

  async listAssetTypes(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningMasterService.listAssetTypes(req.query as MasterListQuery));
  },
  async createAssetType(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningMasterService.createAssetType(
        req.body as CleanableAssetTypeWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async updateAssetType(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.updateAssetType(
        req.params.id as string,
        req.body as Partial<CleanableAssetTypeWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteAssetType(req: Request, res: Response): Promise<void> {
    await cleaningMasterService.deleteAssetType(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listMethods(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningMasterService.listMethods(req.query as MasterListQuery));
  },
  async createMethod(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningMasterService.createMethod(
        req.body as CleaningMethodWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async updateMethod(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.updateMethod(
        req.params.id as string,
        req.body as Partial<CleaningMethodWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteMethod(req: Request, res: Response): Promise<void> {
    await cleaningMasterService.deleteMethod(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listStandards(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningMasterService.listStandards(req.query as MasterListQuery));
  },
  async createStandard(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningMasterService.createStandard(
        req.body as CleaningStandardWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async updateStandard(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.updateStandard(
        req.params.id as string,
        req.body as Partial<CleaningStandardWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteStandard(req: Request, res: Response): Promise<void> {
    await cleaningMasterService.deleteStandard(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listChemicals(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.listChemicals(req.query as MasterListQuery, viewer(req)),
    );
  },
  async createChemical(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningMasterService.createChemical(
        req.body as CleaningChemicalWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async updateChemical(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.updateChemical(
        req.params.id as string,
        req.body as Partial<CleaningChemicalWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteChemical(req: Request, res: Response): Promise<void> {
    await cleaningMasterService.deleteChemical(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listTools(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningMasterService.listTools(req.query as MasterListQuery));
  },
  async createTool(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningMasterService.createTool(req.body as CleaningToolWriteRequest, actorFrom(req)),
    );
  },
  async updateTool(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.updateTool(
        req.params.id as string,
        req.body as Partial<CleaningToolWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteTool(req: Request, res: Response): Promise<void> {
    await cleaningMasterService.deleteTool(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listSkills(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningMasterService.listSkills(req.query as MasterListQuery));
  },
  async createSkill(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningMasterService.createSkill(req.body as SkillWriteRequest, actorFrom(req)),
    );
  },
  async updateSkill(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.updateSkill(
        req.params.id as string,
        req.body as Partial<SkillWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteSkill(req: Request, res: Response): Promise<void> {
    await cleaningMasterService.deleteSkill(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listShifts(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningMasterService.listShifts(req.query as MasterListQuery));
  },
  async createShift(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningMasterService.createShift(req.body as ShiftWriteRequest, actorFrom(req)),
    );
  },
  async updateShift(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningMasterService.updateShift(
        req.params.id as string,
        req.body as Partial<ShiftWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteShift(req: Request, res: Response): Promise<void> {
    await cleaningMasterService.deleteShift(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* --------------------------------------------------------- cleanable assets */

  async listAssets(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await cleaningAssetService.list(
        req.query as unknown as CleanableAssetListQuery,
        viewer(req),
      ),
    );
  },
  async resolveAsset(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningAssetService.resolve(req.query.code as string, viewer(req)));
  },
  async getAsset(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningAssetService.getById(req.params.id as string, viewer(req)));
  },
  async createAsset(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningAssetService.create(
        req.body as CleanableAssetCreateRequest,
        actorFrom(req),
      ),
    );
  },
  async updateAsset(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningAssetService.update(
        req.params.id as string,
        req.body as CleanableAssetUpdateRequest,
        actorFrom(req),
      ),
    );
  },
  async setAssetAvailability(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningAssetService.setAvailability(
        req.params.id as string,
        req.body as CleanableAssetAvailabilityRequest,
        actorFrom(req),
      ),
    );
  },
  async deleteAsset(req: Request, res: Response): Promise<void> {
    await cleaningAssetService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ---------------------------------------------------------------- procedures */

  async listProcedures(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await cleaningProcedureService.list(req.query as unknown as ProcedureListQuery),
    );
  },
  async getProcedure(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningProcedureService.getById(req.params.id as string));
  },
  async createProcedure(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningProcedureService.create(
        req.body as CleaningProcedureWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async updateProcedure(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningProcedureService.update(
        req.params.id as string,
        req.body as Partial<CleaningProcedureWriteRequest>,
        actorFrom(req),
      ),
    );
  },
  async deleteProcedure(req: Request, res: Response): Promise<void> {
    await cleaningProcedureService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },
  async saveProcedureDraft(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningProcedureService.saveDraft(
        req.params.id as string,
        req.body as CleaningProcedureVersionWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async publishProcedure(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningProcedureService.publish(req.params.id as string, actorFrom(req)));
  },
  async cloneProcedureDraft(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningProcedureService.cloneToDraft(req.params.id as string, actorFrom(req)));
  },
  async discardProcedureDraft(req: Request, res: Response): Promise<void> {
    await cleaningProcedureService.discardDraft(req.params.id as string, actorFrom(req));
    noContent(res);
  },
  async getProcedureVersion(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningProcedureService.getVersion(req.params.id as string));
  },

  /* --------------------------------------------------------------------- rules */

  async listRules(req: Request, res: Response): Promise<void> {
    paginated(res, await cleaningRuleService.list(req.query as unknown as CleaningRuleListQuery));
  },
  async getRule(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningRuleService.getById(req.params.id as string));
  },
  async createRule(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningRuleService.create(req.body as CleaningRuleWriteRequest, actorFrom(req)),
    );
  },
  async updateRule(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningRuleService.update(
        req.params.id as string,
        req.body as CleaningRuleUpdateRequest,
        actorFrom(req),
      ),
    );
  },
  async deleteRule(req: Request, res: Response): Promise<void> {
    await cleaningRuleService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },
  async previewRule(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningRuleService.preview(req.params.id as string, viewer(req)));
  },
  async runRule(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningRuleService.runNow(req.params.id as string, actorFrom(req), viewer(req)));
  },

  /* --------------------------------------------------------------------- tasks */

  async listTasks(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await cleaningTaskService.list(req.query as unknown as CleaningTaskListQuery, viewer(req)),
    );
  },
  async myCleaning(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningTaskService.myCleaning(viewer(req)));
  },
  async getTask(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningTaskService.getById(req.params.id as string, viewer(req)));
  },
  async assignTask(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.assign(
        req.params.id as string,
        req.body as CleaningTaskAssignRequest,
        actorFrom(req),
      ),
    );
  },
  async taskCandidates(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningTaskService.candidates(req.params.id as string));
  },
  async startTask(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.start(
        req.params.id as string,
        req.body as CleaningTaskStartRequest,
        actorFrom(req),
      ),
    );
  },
  async recordStep(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.recordStep(
        req.params.id as string,
        req.params.stepId as string,
        req.body as CleaningTaskStepUpdateRequest,
        actorFrom(req),
      ),
    );
  },
  async completeTask(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.complete(
        req.params.id as string,
        req.body as CleaningTaskCompleteRequest,
        actorFrom(req),
      ),
    );
  },
  async verifyTask(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.verify(
        req.params.id as string,
        req.body as CleaningVerifyRequest,
        actorFrom(req),
      ),
    );
  },
  async cancelTask(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.cancel(
        req.params.id as string,
        req.body as CleaningTaskCancelRequest,
        actorFrom(req),
      ),
    );
  },
  async deleteTask(req: Request, res: Response): Promise<void> {
    if (!has(req, Capability.CLEANING_DELETE)) {
      throw new ForbiddenError('You cannot delete a cleaning record');
    }
    await cleaningTaskService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },
  async addEvidence(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.addEvidence(
        req.params.id as string,
        req.body as CleaningTaskEvidenceRequest,
        actorFrom(req),
      ),
    );
  },
  async removeEvidence(req: Request, res: Response): Promise<void> {
    await cleaningTaskService.removeEvidence(
      req.params.id as string,
      req.params.evidenceId as string,
      actorFrom(req),
    );
    noContent(res);
  },

  /* ----------------------------------------------------------- corrective actions */

  async listCorrectiveActions(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await cleaningTaskService.listCorrectiveActions(
        req.query as unknown as CorrectiveActionListQuery,
        viewer(req),
      ),
    );
  },
  async getCorrectiveAction(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningTaskService.getCorrectiveAction(req.params.id as string));
  },
  async updateCorrectiveAction(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningTaskService.updateCorrectiveAction(
        req.params.id as string,
        req.body as CorrectiveActionUpdateRequest,
        actorFrom(req),
      ),
    );
  },

  /* ------------------------------------------------------- reports and events */

  async report(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningReportService.report(
        req.body as CleaningReportRequest,
        actorFrom(req),
        viewer(req),
      ),
    );
  },
  async publishEvent(req: Request, res: Response): Promise<void> {
    created(
      res,
      await cleaningReportService.publishEvent(
        req.body as CleaningEventPublishRequest,
        actorFrom(req),
        viewer(req),
      ),
    );
  },
  async listEvents(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await cleaningReportService.listEvents(
        req.query as unknown as CleaningEventListQuery,
        viewer(req),
      ),
    );
  },
  async getEvent(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningReportService.getEvent(req.params.id as string));
  },

  /* ---------------------------------------------------------------- workforce */

  async roster(_req: Request, res: Response): Promise<void> {
    ok(res, await cleaningWorkforceService.roster());
  },
  async listUserSkills(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningWorkforceService.listUserSkills(req.params.userId as string));
  },
  async grantSkill(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningWorkforceService.grantSkill(
        req.params.userId as string,
        req.body as UserSkillWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async revokeSkill(req: Request, res: Response): Promise<void> {
    await cleaningWorkforceService.revokeSkill(
      req.params.userId as string,
      req.params.skillId as string,
      actorFrom(req),
    );
    noContent(res);
  },
  async listUserShifts(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningWorkforceService.listUserShifts(req.params.userId as string));
  },
  async assignShift(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningWorkforceService.assignShift(
        req.params.userId as string,
        req.body as UserShiftAssignmentWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async removeShift(req: Request, res: Response): Promise<void> {
    await cleaningWorkforceService.removeShift(
      req.params.userId as string,
      req.params.assignmentId as string,
      actorFrom(req),
    );
    noContent(res);
  },
  async listUserAreas(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningWorkforceService.listUserAreas(req.params.userId as string));
  },
  async listAreaResponsibles(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningWorkforceService.listAreaResponsibles(req.params.areaId as string));
  },
  async setAreaResponsibility(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningWorkforceService.setAreaResponsibility(
        req.params.userId as string,
        req.body as UserAreaResponsibilityWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async removeAreaResponsibility(req: Request, res: Response): Promise<void> {
    await cleaningWorkforceService.removeAreaResponsibility(
      req.params.userId as string,
      req.params.areaId as string,
      actorFrom(req),
    );
    noContent(res);
  },
  async listAssignmentRules(_req: Request, res: Response): Promise<void> {
    ok(res, await cleaningWorkforceService.listAssignmentRules());
  },
  async saveAssignmentRule(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningWorkforceService.saveAssignmentRule(
        req.body as CleaningAssignmentRuleWriteRequest,
        actorFrom(req),
      ),
    );
  },
  async deleteAssignmentRule(req: Request, res: Response): Promise<void> {
    await cleaningWorkforceService.deleteAssignmentRule(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* -------------------------------------------------- dashboard and compliance */

  async dashboard(req: Request, res: Response): Promise<void> {
    ok(res, await cleaningComplianceService.dashboard(viewer(req)));
  },
  async compliance(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await cleaningComplianceService.compliance(req.query as unknown as CleaningComplianceQuery),
    );
  },

  /** Runs the sweep now. The same code the timer runs, so nothing here is test-only. */
  async runSweep(_req: Request, res: Response): Promise<void> {
    ok(res, await cleaningSchedulerService.sweep());
  },
};
