import type { Request, Response } from 'express';
import type {
  AssignOrderRequest,
  CreateAcknowledgementRequest,
  CreateOrderRequest,
  CreateThreadMessageRequest,
  OrderListQuery,
  UpdateOrderQuantitiesRequest,
  UpdateOrderRequest,
  UpdateOrderStatusRequest,
} from '@menuboard/shared';
import { Capability } from '@menuboard/shared';
import { acknowledgementService } from '../services/AcknowledgementService';
import { orderService } from '../services/OrderService';
import { permissionsCacheService } from '../services/PermissionsCacheService';
import { threadService } from '../services/ThreadService';
import { requireAuth } from '../middleware/types';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

export const OrderController = {
  async list(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    paginated(res, await orderService.list(auth, req.query as unknown as OrderListQuery));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await orderService.getDetail(req.params.orderId as string));
  },

  async create(req: Request, res: Response): Promise<void> {
    created(res, await orderService.create(req.body as CreateOrderRequest, actorFrom(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await orderService.update(
        req.params.orderId as string,
        req.body as UpdateOrderRequest,
        actorFrom(req),
      ),
    );
  },

  async updateStatus(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await orderService.updateStatus(
        req.params.orderId as string,
        req.body as UpdateOrderStatusRequest,
        actorFrom(req),
      ),
    );
  },

  async assign(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await orderService.assign(
        req.params.orderId as string,
        req.body as AssignOrderRequest,
        actorFrom(req),
      ),
    );
  },

  async updateQuantities(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await orderService.updateQuantities(
        req.params.orderId as string,
        req.body as UpdateOrderQuantitiesRequest,
        actorFrom(req),
      ),
    );
  },

  /* -------------------------------------------------------------- thread */

  async listThread(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as { limit?: number; before?: string };
    ok(
      res,
      await threadService.list(req.params.orderId as string, {
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.before !== undefined ? { before: query.before } : {}),
      }),
    );
  },

  async postThreadMessage(req: Request, res: Response): Promise<void> {
    created(
      res,
      await threadService.post(
        { boardId: null, orderId: req.params.orderId as string },
        req.body as CreateThreadMessageRequest,
        actorFrom(req),
      ),
    );
  },

  async deleteThreadMessage(req: Request, res: Response): Promise<void> {
    // Whether the caller may remove someone else's message is a board-role question, resolved
    // by the middleware that already loaded the membership.
    const canDeleteAny =
      req.boardRole !== null &&
      req.boardRole !== undefined &&
      permissionsCacheService.boardRoleHasCapability(req.boardRole, Capability.THREAD_DELETE_ANY);

    await threadService.remove(req.params.messageId as string, actorFrom(req), { canDeleteAny });
    noContent(res);
  },

  /* ----------------------------------------------------- acknowledgements */

  async listAcknowledgements(req: Request, res: Response): Promise<void> {
    ok(res, await acknowledgementService.summary(req.params.orderId as string));
  },

  async acknowledge(req: Request, res: Response): Promise<void> {
    created(
      res,
      await acknowledgementService.acknowledge(
        req.params.orderId as string,
        req.body as CreateAcknowledgementRequest,
        actorFrom(req),
      ),
    );
  },

  async withdrawAcknowledgement(req: Request, res: Response): Promise<void> {
    await acknowledgementService.withdraw(req.params.orderId as string, actorFrom(req));
    noContent(res);
  },
};
