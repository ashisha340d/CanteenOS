import { Router, type Request } from 'express';
import { Capability } from '@menuboard/shared';
import { OrderController } from '../controllers/OrderController';
import { requireResolvedBoardAccess } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { getPool } from '../db/pool';
import { orderRepository } from '../repositories/OrderRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import {
  assignOrderSchema,
  createAcknowledgementSchema,
  createOrderSchema,
  createThreadMessageSchema,
  messageIdParamSchema,
  orderIdParam,
  orderListQuerySchema,
  threadListQuerySchema,
  updateOrderQuantitiesSchema,
  updateOrderSchema,
  updateOrderStatusSchema,
} from '../validation/schemas';

/** Resolves the board that owns an order, for the authorisation guard. */
async function boardIdForOrder(req: Request): Promise<string | null> {
  const order = await orderRepository.findById(getPool(), req.params.orderId as string);
  return order === null ? null : order.board_id;
}

/** Resolves the board that owns a thread message. */
async function boardIdForMessage(req: Request): Promise<string | null> {
  const message = await threadRepository.findById(getPool(), req.params.messageId as string);
  return message === null ? null : message.board_id;
}

/**
 * Orders, their discussion thread and acknowledgements.
 *
 * `POST /orders` cannot use a board guard keyed on the URL, because the board arrives in the
 * body — the service performs the membership check there instead.
 */
export function orderRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: orderListQuerySchema }),
    asyncHandler(OrderController.list),
  );

  router.post(
    '/',
    validate({ body: createOrderSchema }),
    // Board membership for the target board is verified inside OrderService.create.
    asyncHandler(OrderController.create),
  );

  router.get(
    '/:orderId',
    validate({ params: orderIdParam }),
    requireResolvedBoardAccess(Capability.ORDER_READ, boardIdForOrder),
    asyncHandler(OrderController.getById),
  );

  router.patch(
    '/:orderId',
    validate({ params: orderIdParam, body: updateOrderSchema }),
    requireResolvedBoardAccess(Capability.ORDER_UPDATE, boardIdForOrder),
    asyncHandler(OrderController.update),
  );

  router.post(
    '/:orderId/status',
    validate({ params: orderIdParam, body: updateOrderStatusSchema }),
    requireResolvedBoardAccess(Capability.ORDER_STATUS_UPDATE, boardIdForOrder),
    asyncHandler(OrderController.updateStatus),
  );

  // Assignment is its own endpoint rather than a field on PATCH: it carries a different
  // capability, and it must stay usable on an order nobody is allowed to otherwise edit.
  router.post(
    '/:orderId/assign',
    validate({ params: orderIdParam, body: assignOrderSchema }),
    requireResolvedBoardAccess(Capability.ORDER_ASSIGN, boardIdForOrder),
    asyncHandler(OrderController.assign),
  );

  // Quantity and pax edits are Manager-and-above and narrate themselves into the board feed,
  // so they are a separate endpoint from the general PATCH.
  router.patch(
    '/:orderId/quantities',
    validate({ params: orderIdParam, body: updateOrderQuantitiesSchema }),
    requireResolvedBoardAccess(Capability.ORDER_QUANTITY_EDIT, boardIdForOrder),
    asyncHandler(OrderController.updateQuantities),
  );

  /* ------------------------------------------------------------ thread */

  router.get(
    '/:orderId/thread',
    validate({ params: orderIdParam, query: threadListQuerySchema }),
    requireResolvedBoardAccess(Capability.THREAD_READ, boardIdForOrder),
    asyncHandler(OrderController.listThread),
  );

  router.post(
    '/:orderId/thread',
    validate({ params: orderIdParam, body: createThreadMessageSchema }),
    requireResolvedBoardAccess(Capability.THREAD_POST, boardIdForOrder),
    asyncHandler(OrderController.postThreadMessage),
  );

  // Guarded by THREAD_READ: the author may always delete their own message, and the controller
  // checks THREAD_DELETE_ANY from the board role the guard already resolved.
  router.delete(
    '/thread/:messageId',
    validate({ params: messageIdParamSchema }),
    requireResolvedBoardAccess(Capability.THREAD_READ, boardIdForMessage),
    asyncHandler(OrderController.deleteThreadMessage),
  );

  /* -------------------------------------------------- acknowledgements */

  router.get(
    '/:orderId/acknowledgements',
    validate({ params: orderIdParam }),
    requireResolvedBoardAccess(Capability.ORDER_READ, boardIdForOrder),
    asyncHandler(OrderController.listAcknowledgements),
  );

  router.post(
    '/:orderId/acknowledgements',
    validate({ params: orderIdParam, body: createAcknowledgementSchema }),
    requireResolvedBoardAccess(Capability.ORDER_ACKNOWLEDGE, boardIdForOrder),
    asyncHandler(OrderController.acknowledge),
  );

  router.delete(
    '/:orderId/acknowledgements',
    validate({ params: orderIdParam }),
    requireResolvedBoardAccess(Capability.ORDER_ACKNOWLEDGE, boardIdForOrder),
    asyncHandler(OrderController.withdrawAcknowledgement),
  );

  return router;
}
