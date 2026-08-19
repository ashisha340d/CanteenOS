import type { Request, Response } from 'express';
import {
  Capability,
  MaintenanceTicketStatus,
  type CallOutcome,
  type EquipmentCallLogRequest,
  type EquipmentCallOutcomeRequest,
  type EquipmentSupplierWriteRequest,
  type MaintenanceAssignRequest,
  type MaintenanceCompleteRequest,
  type MaintenanceScheduleWriteRequest,
  type MaintenanceStatusChangeRequest,
  type MaintenanceTicketCreateRequest,
  type MaintenanceTicketListQuery,
  type MaintenanceTicketUpdateRequest,
  type MasterStatus,
  type SupplierContactWriteRequest,
  type WhatsappSendRequest,
} from '@menuboard/shared';
import { maintenanceSchedulerService } from '../services/MaintenanceSchedulerService';
import { maintenanceService } from '../services/MaintenanceService';
import { supplierService } from '../services/SupplierService';
import { requireAuth } from '../middleware/types';
import { ForbiddenError } from '../utils/errors';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Maintenance tickets, preventive schedules, and the supplier master they reach out to.
 *
 * Two authorisation decisions live here rather than on the route, because the same endpoint
 * legitimately serves two audiences:
 *
 *  - **Verifying and closing** are separately grantable powers (`maintenance.approve` /
 *    `maintenance.close`), so the status endpoint checks the *target* status.
 *  - **Completing work** is done by whoever the ticket was handed to. A manager may finish
 *    anybody's ticket; everyone else may only finish their own.
 */
function has(req: Request, capability: Capability): boolean {
  return requireAuth(req).capabilities.includes(capability);
}

export const MaintenanceController = {
  /* ------------------------------------------------------------------- tickets */

  async list(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await maintenanceService.list(
        req.query as unknown as MaintenanceTicketListQuery,
        requireAuth(req).userId,
      ),
    );
  },

  async mine(req: Request, res: Response): Promise<void> {
    ok(res, await maintenanceService.myMaintenance(requireAuth(req).userId));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await maintenanceService.getById(req.params.id as string, requireAuth(req).userId));
  },

  async create(req: Request, res: Response): Promise<void> {
    created(
      res,
      await maintenanceService.create(
        req.body as MaintenanceTicketCreateRequest,
        actorFrom(req),
      ),
    );
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await maintenanceService.update(
        req.params.id as string,
        req.body as MaintenanceTicketUpdateRequest,
        actorFrom(req),
      ),
    );
  },

  async changeStatus(req: Request, res: Response): Promise<void> {
    const body = req.body as MaintenanceStatusChangeRequest;
    if (body.status === MaintenanceTicketStatus.VERIFIED && !has(req, Capability.MAINTENANCE_APPROVE)) {
      throw new ForbiddenError('You cannot sign off a maintenance fix');
    }
    if (
      (body.status === MaintenanceTicketStatus.CLOSED ||
        body.status === MaintenanceTicketStatus.CANCELLED) &&
      !has(req, Capability.MAINTENANCE_CLOSE)
    ) {
      throw new ForbiddenError('You cannot close a maintenance ticket');
    }
    ok(res, await maintenanceService.changeStatus(req.params.id as string, body, actorFrom(req)));
  },

  async assign(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await maintenanceService.assign(
        req.params.id as string,
        req.body as MaintenanceAssignRequest,
        actorFrom(req),
      ),
    );
  },

  async complete(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const auth = requireAuth(req);
    if (!has(req, Capability.MAINTENANCE_ASSIGN)) {
      const ticket = await maintenanceService.getById(id, auth.userId);
      if (ticket.assignedTo !== auth.userId && ticket.reportedBy !== auth.userId) {
        throw new ForbiddenError('That maintenance job belongs to somebody else');
      }
    }
    ok(
      res,
      await maintenanceService.complete(
        id,
        req.body as MaintenanceCompleteRequest,
        actorFrom(req),
      ),
    );
  },

  async addAttachments(req: Request, res: Response): Promise<void> {
    const { attachments } = req.body as {
      attachments: Array<{ mediaId: string; kind: string; transcript?: string | null }>;
    };
    ok(
      res,
      await maintenanceService.addAttachments(req.params.id as string, attachments, actorFrom(req)),
    );
  },

  async addNote(req: Request, res: Response): Promise<void> {
    const { note } = req.body as { note: string };
    ok(res, await maintenanceService.addNote(req.params.id as string, note, actorFrom(req)));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await maintenanceService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ----------------------------------------------------------------- schedules */

  async listSchedules(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await maintenanceService.listSchedules(
        req.query as unknown as { equipmentId?: string; page?: number; pageSize?: number },
      ),
    );
  },

  async createSchedule(req: Request, res: Response): Promise<void> {
    created(
      res,
      await maintenanceService.createSchedule(
        req.body as MaintenanceScheduleWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateSchedule(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await maintenanceService.updateSchedule(
        req.params.id as string,
        req.body as Partial<MaintenanceScheduleWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeSchedule(req: Request, res: Response): Promise<void> {
    await maintenanceService.removeSchedule(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /** Runs the preventive sweep now instead of waiting for the timer. Idempotent. */
  async runSweep(_req: Request, res: Response): Promise<void> {
    ok(res, await maintenanceSchedulerService.sweep());
  },

  /* ------------------------------------------------------------------ suppliers */

  async listSuppliers(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await supplierService.list(
        req.query as unknown as { search?: string; status?: MasterStatus; categoryId?: string },
      ),
    );
  },

  async getSupplier(req: Request, res: Response): Promise<void> {
    ok(res, await supplierService.getById(req.params.id as string));
  },

  async createSupplier(req: Request, res: Response): Promise<void> {
    created(
      res,
      await supplierService.create(req.body as EquipmentSupplierWriteRequest, actorFrom(req)),
    );
  },

  async updateSupplier(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await supplierService.update(
        req.params.id as string,
        req.body as Partial<EquipmentSupplierWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeSupplier(req: Request, res: Response): Promise<void> {
    await supplierService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async listSupplierContacts(req: Request, res: Response): Promise<void> {
    ok(res, await supplierService.listContacts(req.params.id as string));
  },

  async addSupplierContact(req: Request, res: Response): Promise<void> {
    created(
      res,
      await supplierService.addContact(
        req.params.id as string,
        req.body as SupplierContactWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateSupplierContact(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await supplierService.updateContact(
        req.params.id as string,
        req.body as Partial<SupplierContactWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeSupplierContact(req: Request, res: Response): Promise<void> {
    ok(res, await supplierService.removeContact(req.params.id as string, actorFrom(req)));
  },

  /* -------------------------------------------------------------- communication */

  async logCall(req: Request, res: Response): Promise<void> {
    created(res, await supplierService.logCall(req.body as EquipmentCallLogRequest, actorFrom(req)));
  },

  async recordCallOutcome(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await supplierService.recordCallOutcome(
        req.params.id as string,
        req.body as EquipmentCallOutcomeRequest,
        actorFrom(req),
      ),
    );
  },

  async listCallLogs(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await supplierService.listCallLogs(
        req.query as unknown as {
          equipmentId?: string;
          ticketId?: string;
          supplierId?: string;
          outcome?: CallOutcome;
        },
      ),
    );
  },

  async whatsappDraft(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await supplierService.whatsappDraft(
        req.body as { equipmentId: string; ticketId?: string | null; supplierId?: string | null },
        requireAuth(req).userId,
      ),
    );
  },

  async logWhatsapp(req: Request, res: Response): Promise<void> {
    created(res, await supplierService.logWhatsapp(req.body as WhatsappSendRequest, actorFrom(req)));
  },

  async listWhatsappLogs(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await supplierService.listWhatsappLogs(
        req.query as unknown as { equipmentId?: string; ticketId?: string; supplierId?: string },
        requireAuth(req).userId,
      ),
    );
  },
};
