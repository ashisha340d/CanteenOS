import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { EquipmentController } from '../controllers/EquipmentController';
import { requireAnyCapability, requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { uploadRateLimit } from '../middleware/rateLimit';
import { uploadSingleEquipmentMedia } from '../middleware/upload';
import { validate } from '../middleware/validate';
import {
  createEquipmentSchema,
  createFloorPlanSchema,
  equipmentAreaSchema,
  equipmentCategorySchema,
  equipmentDocumentSchema,
  equipmentDocumentScanSchema,
  equipmentFloorSchema,
  equipmentIdentifySchema,
  equipmentListQuerySchema,
  equipmentLocationSchema,
  equipmentMasterQuerySchema,
  equipmentMediaQuerySchema,
  equipmentMoveSchema,
  equipmentResolveQuerySchema,
  equipmentStatusChangeSchema,
  equipmentSupplierLinkSchema,
  equipmentSupplierRoleParam,
  equipmentWarrantySchema,
  floorIdParam,
  floorPlanPositionParam,
  floorPlanPositionSchema,
  floorPlanQuerySchema,
  idParam,
  problemClassifySchema,
  updateEquipmentAreaSchema,
  updateEquipmentCategorySchema,
  updateEquipmentFloorSchema,
  updateEquipmentLocationSchema,
  updateEquipmentSchema,
  updateFloorPlanSchema,
} from '../validation/schemas';

/**
 * Equipment Monitoring — the asset register, its location tree, its documents and the floor
 * plans it is pinned on.
 *
 * Two audiences, deliberately unequal:
 *
 *  - **Monitoring and managing** (`equipment.view` and up) is Manager and Admin: the register,
 *    the dashboard, floor plans, the location and category masters, timelines and history.
 *  - **Reporting** (`equipment.report_problem`, from User up) reaches exactly two reads —
 *    resolve one machine by its QR code or asset id, and read that machine — and the media
 *    upload that carries the photo or video of the fault. It grants no way to browse the estate,
 *    and the two shared reads return a trimmed payload for a caller who holds nothing more
 *    (see `EquipmentController.detailScope`).
 *
 * Media upload has its own endpoint rather than reusing `/media/upload`: that route is gated by
 * MASTER_WRITE and takes images only, while this one accepts the voice note and the video clip
 * a fault report is made of.
 */
export function equipmentRoutes(): Router {
  const router = Router();
  const view = requireCapability(Capability.EQUIPMENT_VIEW);
  /** The two reads a reporter shares with a monitor. */
  const viewOrReport = requireAnyCapability(
    Capability.EQUIPMENT_VIEW,
    Capability.EQUIPMENT_REPORT_PROBLEM,
  );
  const create = requireCapability(Capability.EQUIPMENT_CREATE);
  const edit = requireCapability(Capability.EQUIPMENT_EDIT);
  const destroy = requireCapability(Capability.EQUIPMENT_DELETE);
  const upload = requireCapability(Capability.EQUIPMENT_UPLOAD_DOCUMENT);
  const report = requireCapability(Capability.EQUIPMENT_REPORT_PROBLEM);
  const manageLocation = requireCapability(Capability.EQUIPMENT_MANAGE_LOCATION);
  const manageFloorPlan = requireCapability(Capability.EQUIPMENT_MANAGE_FLOORPLAN);
  const supplierView = requireCapability(Capability.SUPPLIER_VIEW);
  const supplierManage = requireCapability(Capability.SUPPLIER_MANAGE);

  /* ------------------------------------------------------------------ masters */

  router.get(
    '/equipment-floors',
    view,
    validate({ query: equipmentMasterQuerySchema }),
    asyncHandler(EquipmentController.listFloors),
  );
  router.post(
    '/equipment-floors',
    manageLocation,
    validate({ body: equipmentFloorSchema }),
    asyncHandler(EquipmentController.createFloor),
  );
  router.patch(
    '/equipment-floors/:id',
    manageLocation,
    validate({ params: idParam, body: updateEquipmentFloorSchema }),
    asyncHandler(EquipmentController.updateFloor),
  );

  router.get(
    '/equipment-areas',
    view,
    validate({ query: equipmentMasterQuerySchema }),
    asyncHandler(EquipmentController.listAreas),
  );
  router.post(
    '/equipment-areas',
    manageLocation,
    validate({ body: equipmentAreaSchema }),
    asyncHandler(EquipmentController.createArea),
  );
  router.patch(
    '/equipment-areas/:id',
    manageLocation,
    validate({ params: idParam, body: updateEquipmentAreaSchema }),
    asyncHandler(EquipmentController.updateArea),
  );

  // Registered before `/equipment-locations` so the literal segment wins over `:id`.
  router.get(
    '/equipment-locations/tree',
    view,
    validate({ query: equipmentMasterQuerySchema }),
    asyncHandler(EquipmentController.locationTree),
  );
  router.get(
    '/equipment-locations',
    view,
    validate({ query: equipmentMasterQuerySchema }),
    asyncHandler(EquipmentController.listLocations),
  );
  router.post(
    '/equipment-locations',
    manageLocation,
    validate({ body: equipmentLocationSchema }),
    asyncHandler(EquipmentController.createLocation),
  );
  router.patch(
    '/equipment-locations/:id',
    manageLocation,
    validate({ params: idParam, body: updateEquipmentLocationSchema }),
    asyncHandler(EquipmentController.updateLocation),
  );

  router.get(
    '/equipment-categories',
    view,
    validate({ query: equipmentMasterQuerySchema }),
    asyncHandler(EquipmentController.listCategories),
  );
  router.post(
    '/equipment-categories',
    edit,
    validate({ body: equipmentCategorySchema }),
    asyncHandler(EquipmentController.createCategory),
  );
  router.patch(
    '/equipment-categories/:id',
    edit,
    validate({ params: idParam, body: updateEquipmentCategorySchema }),
    asyncHandler(EquipmentController.updateCategory),
  );
  router.delete(
    '/equipment-categories/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.removeCategory),
  );

  /* --------------------------------------------------------------- floor plans */

  router.get(
    '/floor-plans',
    view,
    validate({ query: floorPlanQuerySchema }),
    asyncHandler(EquipmentController.listFloorPlans),
  );
  router.get(
    '/floor-plans/floor/:floorId',
    view,
    validate({ params: floorIdParam }),
    asyncHandler(EquipmentController.floorPlanView),
  );
  router.post(
    '/floor-plans',
    manageFloorPlan,
    validate({ body: createFloorPlanSchema }),
    asyncHandler(EquipmentController.createFloorPlan),
  );
  router.patch(
    '/floor-plans/:id',
    manageFloorPlan,
    validate({ params: idParam, body: updateFloorPlanSchema }),
    asyncHandler(EquipmentController.updateFloorPlan),
  );
  router.delete(
    '/floor-plans/:id',
    manageFloorPlan,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.removeFloorPlan),
  );
  router.put(
    '/floor-plans/:id/positions',
    manageFloorPlan,
    validate({ params: idParam, body: floorPlanPositionSchema }),
    asyncHandler(EquipmentController.setFloorPlanPosition),
  );
  router.delete(
    '/floor-plans/:id/positions/:equipmentId',
    manageFloorPlan,
    validate({ params: floorPlanPositionParam }),
    asyncHandler(EquipmentController.removeFloorPlanPosition),
  );

  /* -------------------------------------------------------------------- media */

  /**
   * Gated by `equipment.report_problem` — which everyone holds — rather than by
   * `equipment.upload_document`, which starts at User. The whole module rests on a cook being
   * able to photograph the broken machine and record a sentence about it, and an Employee
   * holds `report_problem` but not `upload_document`. Putting the bytes into the media library
   * is therefore universal; *binding* a document to an asset (below) still needs
   * `upload_document`, which is what that capability actually describes.
   */
  router.post(
    '/equipment/media',
    report,
    uploadRateLimit,
    uploadSingleEquipmentMedia,
    validate({ query: equipmentMediaQuerySchema }),
    asyncHandler(EquipmentController.uploadMedia),
  );

  /* ----------------------------------------------------------------------- AI */

  router.post(
    '/equipment/ai/identify',
    create,
    validate({ body: equipmentIdentifySchema }),
    asyncHandler(EquipmentController.identify),
  );
  router.post(
    '/equipment/ai/document',
    upload,
    validate({ body: equipmentDocumentScanSchema }),
    asyncHandler(EquipmentController.scanDocument),
  );
  router.post(
    '/equipment/ai/classify-problem',
    report,
    validate({ body: problemClassifySchema }),
    asyncHandler(EquipmentController.classifyProblem),
  );

  /* ---------------------------------------------------------------- equipment */

  // Both literal paths precede `/equipment/:id`, which would otherwise swallow them.
  router.get('/equipment/dashboard', view, asyncHandler(EquipmentController.dashboard));
  // Scanning a label is how a reporter reaches the one machine they may see at all.
  router.get(
    '/equipment/resolve',
    viewOrReport,
    validate({ query: equipmentResolveQuerySchema }),
    asyncHandler(EquipmentController.resolve),
  );

  router.delete(
    '/equipment/documents/:id',
    edit,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.removeDocument),
  );

  router.get(
    '/equipment',
    view,
    validate({ query: equipmentListQuerySchema }),
    asyncHandler(EquipmentController.list),
  );
  router.post(
    '/equipment',
    create,
    validate({ body: createEquipmentSchema }),
    asyncHandler(EquipmentController.create),
  );
  router.get(
    '/equipment/:id',
    viewOrReport,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.getById),
  );
  router.patch(
    '/equipment/:id',
    edit,
    validate({ params: idParam, body: updateEquipmentSchema }),
    asyncHandler(EquipmentController.update),
  );
  router.delete(
    '/equipment/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.remove),
  );

  router.post(
    '/equipment/:id/status',
    edit,
    validate({ params: idParam, body: equipmentStatusChangeSchema }),
    asyncHandler(EquipmentController.changeStatus),
  );
  router.post(
    '/equipment/:id/move',
    manageLocation,
    validate({ params: idParam, body: equipmentMoveSchema }),
    asyncHandler(EquipmentController.move),
  );

  router.get(
    '/equipment/:id/status-history',
    view,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.statusHistory),
  );
  router.get(
    '/equipment/:id/location-history',
    view,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.locationHistory),
  );
  router.get(
    '/equipment/:id/activity',
    view,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.activity),
  );

  router.get(
    '/equipment/:id/documents',
    view,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.listDocuments),
  );
  router.post(
    '/equipment/:id/documents',
    upload,
    validate({ params: idParam, body: equipmentDocumentSchema }),
    asyncHandler(EquipmentController.addDocument),
  );

  router.get(
    '/equipment/:id/warranties',
    view,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.listWarranties),
  );
  router.post(
    '/equipment/:id/warranties',
    upload,
    validate({ params: idParam, body: equipmentWarrantySchema }),
    asyncHandler(EquipmentController.addWarranty),
  );

  router.get(
    '/equipment/:id/suppliers',
    supplierView,
    validate({ params: idParam }),
    asyncHandler(EquipmentController.listSupplierLinks),
  );
  router.put(
    '/equipment/:id/suppliers',
    supplierManage,
    validate({ params: idParam, body: equipmentSupplierLinkSchema }),
    asyncHandler(EquipmentController.setSupplierLink),
  );
  router.delete(
    '/equipment/:id/suppliers/:role',
    supplierManage,
    validate({ params: equipmentSupplierRoleParam }),
    asyncHandler(EquipmentController.removeSupplierLink),
  );

  return router;
}
