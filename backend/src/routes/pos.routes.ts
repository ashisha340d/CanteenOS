import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { PosController } from '../controllers/PosController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createPosOrderSchema,
  kioskProfileQuerySchema,
  posAnalyticsQuerySchema,
  posCheckoutSchema,
  posDashboardQuerySchema,
  posOrderIdParam,
  posOrderListQuerySchema,
  posTopItemsQuerySchema,
  posVoidSchema,
  printPosBillSchema,
  sendPosBillWhatsAppSchema,
  updatePosOrderSchema,
  updatePosOrderStatusSchema,
} from '../validation/schemas';

/**
 * Point of sale.
 *
 * Four capabilities, deliberately separate: seeing the floor (POS_READ), taking an order
 * (POS_OPERATE), taking money (POS_CHECKOUT) and reversing money already taken (POS_VOID).
 * All are global, not board-scoped — a till belongs to a counter, not to a board — so
 * `requireCapability` is the right guard here.
 */
export function posRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.POS_READ);
  const operate = requireCapability(Capability.POS_OPERATE);
  const checkout = requireCapability(Capability.POS_CHECKOUT);
  const voidSale = requireCapability(Capability.POS_VOID);

  router.get(
    '/dashboard',
    read,
    validate({ query: posDashboardQuerySchema }),
    asyncHandler(PosController.dashboard),
  );

  // Reading the floor after the fact is still reading the floor: the analytics routes sit under
  // POS_READ, and none of them can reach a ticket the dashboard would not already show.
  router.get(
    '/analytics/sales',
    read,
    validate({ query: posAnalyticsQuerySchema }),
    asyncHandler(PosController.salesSummary),
  );

  router.get(
    '/analytics/top-items',
    read,
    validate({ query: posTopItemsQuerySchema }),
    asyncHandler(PosController.topItems),
  );

  router.get(
    '/analytics/busy-hours',
    read,
    validate({ query: posAnalyticsQuerySchema }),
    asyncHandler(PosController.busyHours),
  );

  // How the organisation wants its kiosks to look and speak, plus the binding of the one stand
  // that asked. Under POS_READ rather than SETTINGS_READ deliberately: a kiosk session holds
  // the former and must never hold the latter, and this returns presentation and the billing
  // identity already printed on every receipt — never an operational setting or a credential.
  router.get(
    '/kiosk-profile',
    read,
    validate({ query: kioskProfileQuerySchema }),
    asyncHandler(PosController.kioskProfile),
  );

  // The stands a tablet may say it is. A deliberately narrow projection: enough for a member
  // of staff to recognise the stand in front of them, and nothing about any other one.
  router.get('/kiosk-devices', read, asyncHandler(PosController.kioskDevices));

  router.get(
    '/orders',
    read,
    validate({ query: posOrderListQuerySchema }),
    asyncHandler(PosController.list),
  );

  router.get(
    '/orders/:posOrderId',
    read,
    validate({ params: posOrderIdParam }),
    asyncHandler(PosController.getById),
  );

  router.post(
    '/orders',
    operate,
    validate({ body: createPosOrderSchema }),
    asyncHandler(PosController.create),
  );

  router.patch(
    '/orders/:posOrderId',
    operate,
    validate({ params: posOrderIdParam, body: updatePosOrderSchema }),
    asyncHandler(PosController.update),
  );

  router.post(
    '/orders/:posOrderId/status',
    operate,
    validate({ params: posOrderIdParam, body: updatePosOrderStatusSchema }),
    asyncHandler(PosController.updateStatus),
  );

  router.post(
    '/orders/:posOrderId/checkout',
    checkout,
    validate({ params: posOrderIdParam, body: posCheckoutSchema }),
    asyncHandler(PosController.checkout),
  );

  // Reprinting and re-sending a bill are the same authority as taking the money was: whoever
  // may settle a ticket may hand the guest the document for it, and nobody else may.
  router.post(
    '/orders/:posOrderId/print',
    checkout,
    validate({ params: posOrderIdParam, body: printPosBillSchema }),
    asyncHandler(PosController.printBill),
  );

  router.post(
    '/orders/:posOrderId/whatsapp',
    checkout,
    validate({ params: posOrderIdParam, body: sendPosBillWhatsAppSchema }),
    asyncHandler(PosController.sendBillWhatsApp),
  );

  router.post(
    '/orders/:posOrderId/void',
    voidSale,
    validate({ params: posOrderIdParam, body: posVoidSchema }),
    asyncHandler(PosController.void),
  );

  return router;
}
