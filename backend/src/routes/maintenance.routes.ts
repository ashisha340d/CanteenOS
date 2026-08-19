import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { MaintenanceController } from '../controllers/MaintenanceController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  callLogSchema,
  callOutcomeSchema,
  communicationLogQuerySchema,
  createMaintenanceScheduleSchema,
  createMaintenanceTicketSchema,
  createSupplierContactSchema,
  createSupplierSchema,
  idParam,
  maintenanceAssignSchema,
  maintenanceAttachmentsSchema,
  maintenanceCompleteSchema,
  maintenanceNoteSchema,
  maintenanceScheduleListQuerySchema,
  maintenanceStatusChangeSchema,
  maintenanceTicketListQuerySchema,
  supplierListQuerySchema,
  updateMaintenanceScheduleSchema,
  updateMaintenanceTicketSchema,
  updateSupplierContactSchema,
  updateSupplierSchema,
  whatsappDraftSchema,
  whatsappSendSchema,
} from '../validation/schemas';

/**
 * Maintenance tickets, preventive schedules and the supplier master.
 *
 * Raising and working a ticket reaches all the way down to Employee — whoever is standing in
 * front of the broken oven must be able to report it and, once it is theirs, finish it.
 * Routing the work (assign, verify, close, schedule) starts at Manager, and deleting a ticket
 * outright — which erases its timeline — at Admin.
 *
 * `maintenance.approve` and `maintenance.close` are checked inside the controller rather than
 * here, because they gate two particular *target* statuses of one endpoint.
 */
export function maintenanceRoutes(): Router {
  const router = Router();
  const view = requireCapability(Capability.MAINTENANCE_VIEW);
  const create = requireCapability(Capability.MAINTENANCE_CREATE);
  const assign = requireCapability(Capability.MAINTENANCE_ASSIGN);
  const schedule = requireCapability(Capability.MAINTENANCE_SCHEDULE);
  const destroy = requireCapability(Capability.MAINTENANCE_DELETE);
  const supplierView = requireCapability(Capability.SUPPLIER_VIEW);
  const supplierManage = requireCapability(Capability.SUPPLIER_MANAGE);
  const supplierContact = requireCapability(Capability.SUPPLIER_CONTACT);

  /* ------------------------------------------------------------------- tickets */

  router.get('/maintenance/mine', view, asyncHandler(MaintenanceController.mine));

  router.get(
    '/maintenance/tickets',
    view,
    validate({ query: maintenanceTicketListQuerySchema }),
    asyncHandler(MaintenanceController.list),
  );
  router.post(
    '/maintenance/tickets',
    create,
    validate({ body: createMaintenanceTicketSchema }),
    asyncHandler(MaintenanceController.create),
  );
  router.get(
    '/maintenance/tickets/:id',
    view,
    validate({ params: idParam }),
    asyncHandler(MaintenanceController.getById),
  );
  router.patch(
    '/maintenance/tickets/:id',
    assign,
    validate({ params: idParam, body: updateMaintenanceTicketSchema }),
    asyncHandler(MaintenanceController.update),
  );
  router.delete(
    '/maintenance/tickets/:id',
    destroy,
    validate({ params: idParam }),
    asyncHandler(MaintenanceController.remove),
  );

  router.post(
    '/maintenance/tickets/:id/status',
    assign,
    validate({ params: idParam, body: maintenanceStatusChangeSchema }),
    asyncHandler(MaintenanceController.changeStatus),
  );
  router.post(
    '/maintenance/tickets/:id/assign',
    assign,
    validate({ params: idParam, body: maintenanceAssignSchema }),
    asyncHandler(MaintenanceController.assign),
  );
  router.post(
    '/maintenance/tickets/:id/complete',
    create,
    validate({ params: idParam, body: maintenanceCompleteSchema }),
    asyncHandler(MaintenanceController.complete),
  );
  router.post(
    '/maintenance/tickets/:id/attachments',
    create,
    validate({ params: idParam, body: maintenanceAttachmentsSchema }),
    asyncHandler(MaintenanceController.addAttachments),
  );
  router.post(
    '/maintenance/tickets/:id/notes',
    create,
    validate({ params: idParam, body: maintenanceNoteSchema }),
    asyncHandler(MaintenanceController.addNote),
  );

  /* ----------------------------------------------------------------- schedules */

  router.get(
    '/maintenance/schedules',
    view,
    validate({ query: maintenanceScheduleListQuerySchema }),
    asyncHandler(MaintenanceController.listSchedules),
  );
  router.post(
    '/maintenance/schedules',
    schedule,
    validate({ body: createMaintenanceScheduleSchema }),
    asyncHandler(MaintenanceController.createSchedule),
  );
  router.patch(
    '/maintenance/schedules/:id',
    schedule,
    validate({ params: idParam, body: updateMaintenanceScheduleSchema }),
    asyncHandler(MaintenanceController.updateSchedule),
  );
  router.delete(
    '/maintenance/schedules/:id',
    schedule,
    validate({ params: idParam }),
    asyncHandler(MaintenanceController.removeSchedule),
  );

  // Manual trigger for the preventive sweep. Idempotent, so pressing it twice is harmless.
  router.post('/maintenance/run-sweep', schedule, asyncHandler(MaintenanceController.runSweep));

  /* ------------------------------------------------------------------ suppliers */

  // Communication endpoints are registered before `/suppliers/:id` so their literal first
  // segment is not read as a supplier id.
  router.post(
    '/suppliers/calls',
    supplierContact,
    validate({ body: callLogSchema }),
    asyncHandler(MaintenanceController.logCall),
  );
  router.post(
    '/suppliers/calls/:id/outcome',
    supplierContact,
    validate({ params: idParam, body: callOutcomeSchema }),
    asyncHandler(MaintenanceController.recordCallOutcome),
  );
  router.get(
    '/suppliers/calls',
    supplierView,
    validate({ query: communicationLogQuerySchema }),
    asyncHandler(MaintenanceController.listCallLogs),
  );
  router.post(
    '/suppliers/whatsapp/draft',
    supplierContact,
    validate({ body: whatsappDraftSchema }),
    asyncHandler(MaintenanceController.whatsappDraft),
  );
  router.post(
    '/suppliers/whatsapp',
    supplierContact,
    validate({ body: whatsappSendSchema }),
    asyncHandler(MaintenanceController.logWhatsapp),
  );
  router.get(
    '/suppliers/whatsapp',
    supplierView,
    validate({ query: communicationLogQuerySchema }),
    asyncHandler(MaintenanceController.listWhatsappLogs),
  );

  router.patch(
    '/suppliers/contacts/:id',
    supplierManage,
    validate({ params: idParam, body: updateSupplierContactSchema }),
    asyncHandler(MaintenanceController.updateSupplierContact),
  );
  router.delete(
    '/suppliers/contacts/:id',
    supplierManage,
    validate({ params: idParam }),
    asyncHandler(MaintenanceController.removeSupplierContact),
  );

  router.get(
    '/suppliers',
    supplierView,
    validate({ query: supplierListQuerySchema }),
    asyncHandler(MaintenanceController.listSuppliers),
  );
  router.post(
    '/suppliers',
    supplierManage,
    validate({ body: createSupplierSchema }),
    asyncHandler(MaintenanceController.createSupplier),
  );
  router.get(
    '/suppliers/:id',
    supplierView,
    validate({ params: idParam }),
    asyncHandler(MaintenanceController.getSupplier),
  );
  router.patch(
    '/suppliers/:id',
    supplierManage,
    validate({ params: idParam, body: updateSupplierSchema }),
    asyncHandler(MaintenanceController.updateSupplier),
  );
  router.delete(
    '/suppliers/:id',
    supplierManage,
    validate({ params: idParam }),
    asyncHandler(MaintenanceController.removeSupplier),
  );

  router.get(
    '/suppliers/:id/contacts',
    supplierView,
    validate({ params: idParam }),
    asyncHandler(MaintenanceController.listSupplierContacts),
  );
  router.post(
    '/suppliers/:id/contacts',
    supplierManage,
    validate({ params: idParam, body: createSupplierContactSchema }),
    asyncHandler(MaintenanceController.addSupplierContact),
  );

  return router;
}
