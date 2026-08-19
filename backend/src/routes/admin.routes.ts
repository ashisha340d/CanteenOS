import { Router } from 'express';
import { Capability, ClientType } from '@menuboard/shared';
import { z } from 'zod';
import { AdminController } from '../controllers/AdminController';
import { denyClient, requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  auditListQuerySchema,
  billingListQuerySchema,
  billingStatusSchema,
  boardRoleCapabilityParam,
  createKioskDeviceSchema,
  generateBillingSchema,
  idParam,
  reportKindParamSchema,
  reportQuerySchema,
  roleCapabilityParam,
  settingKeyParamSchema,
  settingValueSchema,
  updateKioskDeviceSchema,
  updatePermissionSchema,
} from '../validation/schemas';

const entityAuditParams = z
  .object({ entityType: z.string().trim().min(1).max(60), entityId: z.string().trim().min(1).max(64) })
  .strict();

/**
 * Admin Portal surface: dashboard, permissions, reports, billing, audit, settings.
 *
 * `denyClient(ANDROID)` blocks the whole group at the mount point. The individual capability
 * guards would already refuse, but a single explicit boundary makes the rule visible and means a
 * future route added here cannot accidentally become reachable from the mobile app.
 */
export function adminRoutes(): Router {
  const router = Router();

  router.use(denyClient(ClientType.ANDROID, ClientType.KIOSK));

  router.get(
    '/dashboard',
    requireCapability(Capability.REPORT_READ),
    asyncHandler(AdminController.dashboard),
  );

  router.get(
    '/permissions',
    requireCapability(Capability.PERMISSION_READ),
    asyncHandler(AdminController.permissions),
  );

  router.patch(
    '/permissions/role/:role/:capability',
    requireCapability(Capability.PERMISSION_WRITE),
    validate({ params: roleCapabilityParam, body: updatePermissionSchema }),
    asyncHandler(AdminController.updateRoleCapability),
  );

  router.patch(
    '/permissions/board-role/:boardRole/:capability',
    requireCapability(Capability.PERMISSION_WRITE),
    validate({ params: boardRoleCapabilityParam, body: updatePermissionSchema }),
    asyncHandler(AdminController.updateBoardRoleCapability),
  );

  /* ------------------------------------------------------------- reports */

  router.get(
    '/reports/:kind',
    requireCapability(Capability.REPORT_READ),
    validate({ params: reportKindParamSchema, query: reportQuerySchema }),
    asyncHandler(AdminController.report),
  );

  /* ------------------------------------------------------------- billing */

  router.get(
    '/billing',
    requireCapability(Capability.BILLING_READ),
    validate({ query: billingListQuerySchema }),
    asyncHandler(AdminController.listBilling),
  );

  router.get(
    '/billing/:id',
    requireCapability(Capability.BILLING_READ),
    validate({ params: idParam }),
    asyncHandler(AdminController.getBilling),
  );

  router.get(
    '/billing/:id/snapshot',
    requireCapability(Capability.BILLING_READ),
    validate({ params: idParam }),
    asyncHandler(AdminController.getBillingSnapshot),
  );

  // The explicit "Generate Billing" action. One-way, immutable, audited.
  router.post(
    '/billing/generate',
    requireCapability(Capability.BILLING_GENERATE),
    validate({ body: generateBillingSchema }),
    asyncHandler(AdminController.generateBilling),
  );

  router.post(
    '/billing/:id/status',
    requireCapability(Capability.BILLING_GENERATE),
    validate({ params: idParam, body: billingStatusSchema }),
    asyncHandler(AdminController.updateBillingStatus),
  );

  /* --------------------------------------------------------------- audit */

  router.get(
    '/audit',
    requireCapability(Capability.AUDIT_READ),
    validate({ query: auditListQuerySchema }),
    asyncHandler(AdminController.listAudit),
  );

  router.get(
    '/audit/:entityType/:entityId',
    requireCapability(Capability.AUDIT_READ),
    validate({ params: entityAuditParams }),
    asyncHandler(AdminController.entityAudit),
  );

  /* ------------------------------------------------------------ settings */

  router.get(
    '/settings',
    requireCapability(Capability.SETTINGS_READ),
    asyncHandler(AdminController.listSettings),
  );

  router.put(
    '/settings/:key',
    requireCapability(Capability.SETTINGS_WRITE),
    validate({ params: settingKeyParamSchema, body: settingValueSchema }),
    asyncHandler(AdminController.updateSetting),
  );

  /* -------------------------------------------------------- kiosk devices */

  /*
   * The self-service stands. Under the settings capabilities rather than a pair of its own:
   * a kiosk row is configuration of how the organisation presents itself and takes money at a
   * counter, which is the same authority that already sets the GSTIN and the payee's own
   * printer. `denyClient(ANDROID, KIOSK)` at the mount point is what keeps a tablet in the
   * hall from reaching its own registry — it reads the narrow projection under POS_READ.
   */
  router.get(
    '/kiosk-devices',
    requireCapability(Capability.SETTINGS_READ),
    asyncHandler(AdminController.listKioskDevices),
  );

  router.post(
    '/kiosk-devices',
    requireCapability(Capability.SETTINGS_WRITE),
    validate({ body: createKioskDeviceSchema }),
    asyncHandler(AdminController.createKioskDevice),
  );

  router.patch(
    '/kiosk-devices/:id',
    requireCapability(Capability.SETTINGS_WRITE),
    validate({ params: idParam, body: updateKioskDeviceSchema }),
    asyncHandler(AdminController.updateKioskDevice),
  );

  router.delete(
    '/kiosk-devices/:id',
    requireCapability(Capability.SETTINGS_WRITE),
    validate({ params: idParam }),
    asyncHandler(AdminController.deleteKioskDevice),
  );

  return router;
}
