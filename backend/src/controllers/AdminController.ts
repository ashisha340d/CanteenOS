import type { Request, Response } from 'express';
import type {
  BillingStatus,
  BoardRole,
  Capability,
  CreateKioskDeviceRequest,
  GenerateBillingRequest,
  ReportKind,
  ReportQuery,
  UpdateKioskDeviceRequest,
  UserRole,
} from '@menuboard/shared';
import { ANDROID_FORBIDDEN_CAPABILITIES } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { auditService } from '../services/AuditService';
import { billingService } from '../services/BillingService';
import { kioskService } from '../services/KioskService';
import { notificationService } from '../services/NotificationService';
import { permissionsCacheService } from '../services/PermissionsCacheService';
import { reportService } from '../services/ReportService';
import { settingsService } from '../services/SettingsService';
import { requireAuth } from '../middleware/types';
import { NotFoundError } from '../utils/errors';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Admin Portal surface: dashboard, permissions matrix, reports, billing, audit and settings.
 * Every route behind this controller requires a capability listed in
 * ANDROID_FORBIDDEN_CAPABILITIES, so none of it is reachable from the mobile app.
 */
export const AdminController = {
  async dashboard(_req: Request, res: Response): Promise<void> {
    ok(res, await reportService.dashboard());
  },

  /**
   * The authorisation matrix as data, so the Permissions page renders exactly what the backend
   * enforces rather than a hand-maintained copy of it.
   */
  async permissions(_req: Request, res: Response): Promise<void> {
    const { roleCapabilities, boardRoleCapabilities } = permissionsCacheService.listAll();
    ok(res, {
      roleCapabilities,
      boardRoleCapabilities,
      androidForbiddenCapabilities: ANDROID_FORBIDDEN_CAPABILITIES,
    });
  },

  async updateRoleCapability(req: Request, res: Response): Promise<void> {
    const { granted } = req.body as { granted: boolean };
    await permissionsCacheService.setRoleCapability(
      req.params.role as UserRole,
      req.params.capability as Capability,
      granted,
      actorFrom(req),
    );
    noContent(res);
  },

  async updateBoardRoleCapability(req: Request, res: Response): Promise<void> {
    const { granted } = req.body as { granted: boolean };
    await permissionsCacheService.setBoardRoleCapability(
      req.params.boardRole as BoardRole,
      req.params.capability as Capability,
      granted,
      actorFrom(req),
    );
    noContent(res);
  },

  /* -------------------------------------------------------------- reports */

  async report(req: Request, res: Response): Promise<void> {
    const kind = req.params.kind as ReportKind;
    ok(res, await reportService.run(kind, req.query as unknown as ReportQuery));
  },

  /* -------------------------------------------------------------- billing */

  async listBilling(req: Request, res: Response): Promise<void> {
    paginated(res, await billingService.list(req.query as never));
  },

  async getBilling(req: Request, res: Response): Promise<void> {
    ok(res, await billingService.getById(req.params.id as string));
  },

  async getBillingSnapshot(req: Request, res: Response): Promise<void> {
    ok(res, await billingService.getSnapshot(req.params.id as string));
  },

  /** Explicit Admin action. Freezes an immutable snapshot and writes an audit entry. */
  async generateBilling(req: Request, res: Response): Promise<void> {
    created(
      res,
      await billingService.generate(req.body as GenerateBillingRequest, actorFrom(req)),
    );
  },

  async updateBillingStatus(req: Request, res: Response): Promise<void> {
    const input = req.body as { status: BillingStatus };
    ok(
      res,
      await billingService.updateStatus(req.params.id as string, input.status, actorFrom(req)),
    );
  },

  /* ---------------------------------------------------------------- audit */

  async listAudit(req: Request, res: Response): Promise<void> {
    paginated(res, await auditService.list(getPool(), req.query as never));
  },

  async entityAudit(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await auditService.listForEntity(
        getPool(),
        req.params.entityType as string,
        req.params.entityId as string,
      ),
    );
  },

  /* ------------------------------------------------------------- settings */

  async listSettings(_req: Request, res: Response): Promise<void> {
    ok(res, await settingsService.list());
  },

  async updateSetting(req: Request, res: Response): Promise<void> {
    const input = req.body as { value: unknown };
    ok(res, await settingsService.set(req.params.key as string, input.value, actorFrom(req)));
  },

  /* --------------------------------------------------------- kiosk devices */

  async listKioskDevices(_req: Request, res: Response): Promise<void> {
    ok(res, await kioskService.listDevices());
  },

  async createKioskDevice(req: Request, res: Response): Promise<void> {
    const input = req.body as CreateKioskDeviceRequest;
    created(res, await kioskService.createDevice(input, actorFrom(req)));
  },

  async updateKioskDevice(req: Request, res: Response): Promise<void> {
    const input = req.body as UpdateKioskDeviceRequest;
    ok(res, await kioskService.updateDevice(req.params.id as string, input, actorFrom(req)));
  },

  async deleteKioskDevice(req: Request, res: Response): Promise<void> {
    await kioskService.deleteDevice(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};

/** Notifications belong to the signed-in user and are used by both clients. */
export const NotificationController = {
  async list(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    paginated(res, await notificationService.list(auth.userId, req.query as never));
  },

  async unreadCount(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(res, { unread: await notificationService.unreadCount(auth.userId) });
  },

  async markRead(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const input = req.body as { ids: string[] };
    ok(res, await notificationService.markRead(auth.userId, input.ids));
  },

  async markAllRead(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(res, await notificationService.markAllRead(auth.userId));
  },

  async remove(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const { removed, cursor } = await notificationService.remove(auth.userId, req.params.id as string);
    if (!removed) throw new NotFoundError('Notification', req.params.id as string);
    ok(res, { removed, cursor });
  },
};
