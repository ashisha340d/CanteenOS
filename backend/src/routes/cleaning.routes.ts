import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { CleaningController } from '../controllers/CleaningController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  areaIdParam,
  cleanableAssetAvailabilitySchema,
  cleanableAssetListQuerySchema,
  cleanableAssetResolveQuerySchema,
  cleanableAssetTypeSchema,
  cleaningAssignmentRuleSchema,
  cleaningChemicalSchema,
  cleaningComplianceQuerySchema,
  cleaningEventListQuerySchema,
  cleaningEventPublishSchema,
  cleaningMethodSchema,
  cleaningProcedureSchema,
  cleaningProcedureVersionSchema,
  cleaningReportSchema,
  cleaningRuleListQuerySchema,
  cleaningStandardSchema,
  cleaningStepUpdateSchema,
  cleaningTaskAssignSchema,
  cleaningTaskCancelSchema,
  cleaningTaskCompleteSchema,
  cleaningTaskEvidenceParam,
  cleaningTaskEvidenceSchema,
  cleaningTaskListQuerySchema,
  cleaningTaskStartSchema,
  cleaningTaskStepParam,
  cleaningToolSchema,
  cleaningVerifySchema,
  correctiveActionListQuerySchema,
  correctiveActionUpdateSchema,
  createCleanableAssetSchema,
  createCleaningRuleSchema,
  idParam,
  masterListQuerySchema,
  procedureListQuerySchema,
  shiftSchema,
  skillSchema,
  updateCleanableAssetSchema,
  updateCleanableAssetTypeSchema,
  updateCleaningChemicalSchema,
  updateCleaningMethodSchema,
  updateCleaningProcedureSchema,
  updateCleaningRuleSchema,
  updateCleaningStandardSchema,
  updateCleaningToolSchema,
  updateShiftSchema,
  updateSkillSchema,
  userAreaParam,
  userAreaResponsibilitySchema,
  userIdParam,
  userShiftAssignmentSchema,
  userShiftParam,
  userSkillParam,
  userSkillSchema,
} from '../validation/schemas';

/**
 * Cleaning & Hygiene Management.
 *
 * The permission shape is the module's whole design in one place:
 *
 *  - **`cleaning.view`, `cleaning.work` and `cleaning.report_incident` reach Employee.**
 *    Whoever is standing in front of the mess must be able to say so, see what is theirs, and
 *    do it. Withholding any of the three would make the module ornamental.
 *  - **`cleaning.verify` starts at Manager**, and the service additionally refuses to let
 *    anybody sign off their own work — a rule about the person, not the endpoint.
 *  - **Configuration (assets, rules, procedures, chemicals, workforce) is Manager and above**,
 *    because each of those manufactures work for other people.
 *  - **Deletion is Admin**, because a deleted cleaning record is deleted evidence that the
 *    clean happened.
 */
export function cleaningRoutes(): Router {
  const router = Router();

  const view = requireCapability(Capability.CLEANING_VIEW);
  const work = requireCapability(Capability.CLEANING_WORK);
  const report = requireCapability(Capability.CLEANING_REPORT_INCIDENT);
  const verify = requireCapability(Capability.CLEANING_VERIFY);
  const assign = requireCapability(Capability.CLEANING_ASSIGN);
  const assets = requireCapability(Capability.CLEANING_ASSET_MANAGE);
  const rules = requireCapability(Capability.CLEANING_RULE_MANAGE);
  const procedures = requireCapability(Capability.CLEANING_PROCEDURE_MANAGE);
  const chemicals = requireCapability(Capability.CLEANING_CHEMICAL_MANAGE);
  const corrective = requireCapability(Capability.CLEANING_CORRECTIVE_ACTION_MANAGE);
  const workforce = requireCapability(Capability.CLEANING_WORKFORCE_MANAGE);
  const publish = requireCapability(Capability.CLEANING_EVENT_PUBLISH);
  const compliance = requireCapability(Capability.CLEANING_COMPLIANCE_VIEW);
  const destroy = requireCapability(Capability.CLEANING_DELETE);

  /* ------------------------------------------------------------------- my work */

  // Before /cleaning/tasks/:id, so "mine" is never read as a task id.
  router.get('/cleaning/mine', view, asyncHandler(CleaningController.myCleaning));
  router.get('/cleaning/setup', view, asyncHandler(CleaningController.setup));
  router.get('/cleaning/dashboard', view, asyncHandler(CleaningController.dashboard));

  /* -------------------------------------------------------------------- report */

  router.post(
    '/cleaning/reports',
    report,
    validate({ body: cleaningReportSchema }),
    asyncHandler(CleaningController.report),
  );
  router.get(
    '/cleaning/events',
    view,
    validate({ query: cleaningEventListQuerySchema }),
    asyncHandler(CleaningController.listEvents),
  );
  router.get(
    '/cleaning/events/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(CleaningController.getEvent),
  );
  router.post(
    '/cleaning/events',
    publish,
    validate({ body: cleaningEventPublishSchema }),
    asyncHandler(CleaningController.publishEvent),
  );

  /* --------------------------------------------------------------------- tasks */

  router.get(
    '/cleaning/tasks',
    view,
    validate({ query: cleaningTaskListQuerySchema }),
    asyncHandler(CleaningController.listTasks),
  );
  router.get(
    '/cleaning/tasks/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(CleaningController.getTask),
  );
  router.post(
    '/cleaning/tasks/:id/assign',
    assign,
    validate({ params: idParam, body: cleaningTaskAssignSchema }),
    asyncHandler(CleaningController.assignTask),
  );
  router.get(
    '/cleaning/tasks/:id/candidates',
    assign,
    validate({ params: idParam }),
    asyncHandler(CleaningController.taskCandidates),
  );
  router.post(
    '/cleaning/tasks/:id/start',
    work,
    validate({ params: idParam, body: cleaningTaskStartSchema }),
    asyncHandler(CleaningController.startTask),
  );
  router.post(
    '/cleaning/tasks/:id/steps/:stepId',
    work,
    validate({ params: cleaningTaskStepParam, body: cleaningStepUpdateSchema }),
    asyncHandler(CleaningController.recordStep),
  );
  router.post(
    '/cleaning/tasks/:id/complete',
    work,
    validate({ params: idParam, body: cleaningTaskCompleteSchema }),
    asyncHandler(CleaningController.completeTask),
  );
  router.post(
    '/cleaning/tasks/:id/evidence',
    work,
    validate({ params: idParam, body: cleaningTaskEvidenceSchema }),
    asyncHandler(CleaningController.addEvidence),
  );
  router.delete(
    '/cleaning/tasks/:id/evidence/:evidenceId',
    work,
    validate({ params: cleaningTaskEvidenceParam }),
    asyncHandler(CleaningController.removeEvidence),
  );
  router.post(
    '/cleaning/tasks/:id/verify',
    verify,
    validate({ params: idParam, body: cleaningVerifySchema }),
    asyncHandler(CleaningController.verifyTask),
  );
  router.post(
    '/cleaning/tasks/:id/cancel',
    assign,
    validate({ params: idParam, body: cleaningTaskCancelSchema }),
    asyncHandler(CleaningController.cancelTask),
  );
  router.delete(
    '/cleaning/tasks/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteTask),
  );

  /* ----------------------------------------------------------- corrective actions */

  router.get(
    '/cleaning/corrective-actions',
    view,
    validate({ query: correctiveActionListQuerySchema }),
    asyncHandler(CleaningController.listCorrectiveActions),
  );
  router.get(
    '/cleaning/corrective-actions/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(CleaningController.getCorrectiveAction),
  );
  router.patch(
    '/cleaning/corrective-actions/:id',
    corrective,
    validate({ params: idParam, body: correctiveActionUpdateSchema }),
    asyncHandler(CleaningController.updateCorrectiveAction),
  );

  /* ---------------------------------------------------------- cleanable assets */

  // Before /cleaning/assets/:id, so "resolve" is never read as an id.
  router.get(
    '/cleaning/assets/resolve',
    view,
    validate({ query: cleanableAssetResolveQuerySchema }),
    asyncHandler(CleaningController.resolveAsset),
  );
  router.get(
    '/cleaning/assets',
    view,
    validate({ query: cleanableAssetListQuerySchema }),
    asyncHandler(CleaningController.listAssets),
  );
  router.get(
    '/cleaning/assets/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(CleaningController.getAsset),
  );
  router.post(
    '/cleaning/assets',
    assets,
    validate({ body: createCleanableAssetSchema }),
    asyncHandler(CleaningController.createAsset),
  );
  router.patch(
    '/cleaning/assets/:id',
    assets,
    validate({ params: idParam, body: updateCleanableAssetSchema }),
    asyncHandler(CleaningController.updateAsset),
  );
  router.post(
    '/cleaning/assets/:id/availability',
    assets,
    validate({ params: idParam, body: cleanableAssetAvailabilitySchema }),
    asyncHandler(CleaningController.setAssetAvailability),
  );
  router.delete(
    '/cleaning/assets/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteAsset),
  );

  /* ---------------------------------------------------------------- procedures */

  router.get(
    '/cleaning/procedures',
    view,
    validate({ query: procedureListQuerySchema }),
    asyncHandler(CleaningController.listProcedures),
  );
  router.get(
    '/cleaning/procedures/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(CleaningController.getProcedure),
  );
  router.post(
    '/cleaning/procedures',
    procedures,
    validate({ body: cleaningProcedureSchema }),
    asyncHandler(CleaningController.createProcedure),
  );
  router.patch(
    '/cleaning/procedures/:id',
    procedures,
    validate({ params: idParam, body: updateCleaningProcedureSchema }),
    asyncHandler(CleaningController.updateProcedure),
  );
  router.delete(
    '/cleaning/procedures/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteProcedure),
  );
  router.put(
    '/cleaning/procedures/:id/draft',
    procedures,
    validate({ params: idParam, body: cleaningProcedureVersionSchema }),
    asyncHandler(CleaningController.saveProcedureDraft),
  );
  router.post(
    '/cleaning/procedures/:id/draft-from-published',
    procedures,
    validate({ params: idParam }),
    asyncHandler(CleaningController.cloneProcedureDraft),
  );
  router.delete(
    '/cleaning/procedures/:id/draft',
    procedures,
    validate({ params: idParam }),
    asyncHandler(CleaningController.discardProcedureDraft),
  );
  router.post(
    '/cleaning/procedures/:id/publish',
    procedures,
    validate({ params: idParam }),
    asyncHandler(CleaningController.publishProcedure),
  );
  router.get(
    '/cleaning/procedure-versions/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(CleaningController.getProcedureVersion),
  );

  /* --------------------------------------------------------------------- rules */

  router.get(
    '/cleaning/rules',
    view,
    validate({ query: cleaningRuleListQuerySchema }),
    asyncHandler(CleaningController.listRules),
  );
  router.get(
    '/cleaning/rules/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(CleaningController.getRule),
  );
  router.get(
    '/cleaning/rules/:id/preview',
    rules,
    validate({ params: idParam }),
    asyncHandler(CleaningController.previewRule),
  );
  router.post(
    '/cleaning/rules',
    rules,
    validate({ body: createCleaningRuleSchema }),
    asyncHandler(CleaningController.createRule),
  );
  router.patch(
    '/cleaning/rules/:id',
    rules,
    validate({ params: idParam, body: updateCleaningRuleSchema }),
    asyncHandler(CleaningController.updateRule),
  );
  router.post(
    '/cleaning/rules/:id/run',
    rules,
    validate({ params: idParam }),
    asyncHandler(CleaningController.runRule),
  );
  router.delete(
    '/cleaning/rules/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteRule),
  );

  /* ------------------------------------------------------------------- masters */

  router.get(
    '/cleaning/asset-types',
    view,
    validate({ query: masterListQuerySchema }),
    asyncHandler(CleaningController.listAssetTypes),
  );
  router.post(
    '/cleaning/asset-types',
    assets,
    validate({ body: cleanableAssetTypeSchema }),
    asyncHandler(CleaningController.createAssetType),
  );
  router.patch(
    '/cleaning/asset-types/:id',
    assets,
    validate({ params: idParam, body: updateCleanableAssetTypeSchema }),
    asyncHandler(CleaningController.updateAssetType),
  );
  router.delete(
    '/cleaning/asset-types/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteAssetType),
  );

  router.get(
    '/cleaning/methods',
    view,
    validate({ query: masterListQuerySchema }),
    asyncHandler(CleaningController.listMethods),
  );
  router.post(
    '/cleaning/methods',
    procedures,
    validate({ body: cleaningMethodSchema }),
    asyncHandler(CleaningController.createMethod),
  );
  router.patch(
    '/cleaning/methods/:id',
    procedures,
    validate({ params: idParam, body: updateCleaningMethodSchema }),
    asyncHandler(CleaningController.updateMethod),
  );
  router.delete(
    '/cleaning/methods/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteMethod),
  );

  router.get(
    '/cleaning/standards',
    view,
    validate({ query: masterListQuerySchema }),
    asyncHandler(CleaningController.listStandards),
  );
  router.post(
    '/cleaning/standards',
    procedures,
    validate({ body: cleaningStandardSchema }),
    asyncHandler(CleaningController.createStandard),
  );
  router.patch(
    '/cleaning/standards/:id',
    procedures,
    validate({ params: idParam, body: updateCleaningStandardSchema }),
    asyncHandler(CleaningController.updateStandard),
  );
  router.delete(
    '/cleaning/standards/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteStandard),
  );

  router.get(
    '/cleaning/chemicals',
    view,
    validate({ query: masterListQuerySchema }),
    asyncHandler(CleaningController.listChemicals),
  );
  router.post(
    '/cleaning/chemicals',
    chemicals,
    validate({ body: cleaningChemicalSchema }),
    asyncHandler(CleaningController.createChemical),
  );
  router.patch(
    '/cleaning/chemicals/:id',
    chemicals,
    validate({ params: idParam, body: updateCleaningChemicalSchema }),
    asyncHandler(CleaningController.updateChemical),
  );
  router.delete(
    '/cleaning/chemicals/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteChemical),
  );

  router.get(
    '/cleaning/tools',
    view,
    validate({ query: masterListQuerySchema }),
    asyncHandler(CleaningController.listTools),
  );
  router.post(
    '/cleaning/tools',
    chemicals,
    validate({ body: cleaningToolSchema }),
    asyncHandler(CleaningController.createTool),
  );
  router.patch(
    '/cleaning/tools/:id',
    chemicals,
    validate({ params: idParam, body: updateCleaningToolSchema }),
    asyncHandler(CleaningController.updateTool),
  );
  router.delete(
    '/cleaning/tools/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteTool),
  );

  /* ----------------------------------------------------------------- workforce */

  router.get(
    '/cleaning/skills',
    view,
    validate({ query: masterListQuerySchema }),
    asyncHandler(CleaningController.listSkills),
  );
  router.post(
    '/cleaning/skills',
    workforce,
    validate({ body: skillSchema }),
    asyncHandler(CleaningController.createSkill),
  );
  router.patch(
    '/cleaning/skills/:id',
    workforce,
    validate({ params: idParam, body: updateSkillSchema }),
    asyncHandler(CleaningController.updateSkill),
  );
  router.delete(
    '/cleaning/skills/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteSkill),
  );

  router.get(
    '/cleaning/shifts',
    view,
    validate({ query: masterListQuerySchema }),
    asyncHandler(CleaningController.listShifts),
  );
  router.post(
    '/cleaning/shifts',
    workforce,
    validate({ body: shiftSchema }),
    asyncHandler(CleaningController.createShift),
  );
  router.patch(
    '/cleaning/shifts/:id',
    workforce,
    validate({ params: idParam, body: updateShiftSchema }),
    asyncHandler(CleaningController.updateShift),
  );
  router.delete(
    '/cleaning/shifts/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteShift),
  );

  router.get('/cleaning/workforce', view, asyncHandler(CleaningController.roster));
  router.get(
    '/cleaning/workforce/:userId/skills',
    view,
    validate({ params: userIdParam }),
    asyncHandler(CleaningController.listUserSkills),
  );
  router.post(
    '/cleaning/workforce/:userId/skills',
    workforce,
    validate({ params: userIdParam, body: userSkillSchema }),
    asyncHandler(CleaningController.grantSkill),
  );
  router.delete(
    '/cleaning/workforce/:userId/skills/:skillId',
    workforce,
    validate({ params: userSkillParam }),
    asyncHandler(CleaningController.revokeSkill),
  );
  router.get(
    '/cleaning/workforce/:userId/shifts',
    view,
    validate({ params: userIdParam }),
    asyncHandler(CleaningController.listUserShifts),
  );
  router.post(
    '/cleaning/workforce/:userId/shifts',
    workforce,
    validate({ params: userIdParam, body: userShiftAssignmentSchema }),
    asyncHandler(CleaningController.assignShift),
  );
  router.delete(
    '/cleaning/workforce/:userId/shifts/:assignmentId',
    workforce,
    validate({ params: userShiftParam }),
    asyncHandler(CleaningController.removeShift),
  );
  router.get(
    '/cleaning/workforce/:userId/areas',
    view,
    validate({ params: userIdParam }),
    asyncHandler(CleaningController.listUserAreas),
  );
  router.post(
    '/cleaning/workforce/:userId/areas',
    workforce,
    validate({ params: userIdParam, body: userAreaResponsibilitySchema }),
    asyncHandler(CleaningController.setAreaResponsibility),
  );
  router.delete(
    '/cleaning/workforce/:userId/areas/:areaId',
    workforce,
    validate({ params: userAreaParam }),
    asyncHandler(CleaningController.removeAreaResponsibility),
  );
  router.get(
    '/cleaning/areas/:areaId/responsibles',
    view,
    validate({ params: areaIdParam }),
    asyncHandler(CleaningController.listAreaResponsibles),
  );

  router.get(
    '/cleaning/assignment-policies',
    view,
    asyncHandler(CleaningController.listAssignmentRules),
  );
  router.put(
    '/cleaning/assignment-policies',
    workforce,
    validate({ body: cleaningAssignmentRuleSchema }),
    asyncHandler(CleaningController.saveAssignmentRule),
  );
  router.delete(
    '/cleaning/assignment-policies/:id',
    workforce,
    validate({ params: idParam }),
    asyncHandler(CleaningController.deleteAssignmentRule),
  );

  /* ---------------------------------------------------------------- compliance */

  router.get(
    '/cleaning/compliance',
    compliance,
    validate({ query: cleaningComplianceQuerySchema }),
    asyncHandler(CleaningController.compliance),
  );

  // Runs the same sweep the timer runs. Gated on rule management because it manufactures work.
  router.post('/cleaning/sweep', rules, asyncHandler(CleaningController.runSweep));

  return router;
}
