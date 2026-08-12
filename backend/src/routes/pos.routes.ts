import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { PosController } from '../controllers/PosController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createPosOrderSchema,
  posCheckoutSchema,
  posDashboardQuerySchema,
  posOrderIdParam,
  posOrderListQuerySchema,
  posVoidSchema,
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

  router.post(
    '/orders/:posOrderId/void',
    voidSale,
    validate({ params: posOrderIdParam, body: posVoidSchema }),
    asyncHandler(PosController.void),
  );

  return router;
}
