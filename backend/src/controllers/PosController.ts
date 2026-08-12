import type { Request, Response } from 'express';
import type {
  CreatePosOrderRequest,
  PosCheckoutRequest,
  PosOrderListQuery,
  PosVoidRequest,
  UpdatePosOrderRequest,
  UpdatePosOrderStatusRequest,
} from '@menuboard/shared';
import { posService, type PosScope } from '../services/PosService';
import { created, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/** Point of sale. HTTP in, HTTP out — every rule about money lives in PosService. */
export const PosController = {
  async dashboard(req: Request, res: Response): Promise<void> {
    ok(res, await posService.dashboard(req.query as unknown as PosScope));
  },

  async list(req: Request, res: Response): Promise<void> {
    paginated(res, await posService.list(req.query as unknown as PosOrderListQuery));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await posService.getDetail(req.params.posOrderId as string));
  },

  async create(req: Request, res: Response): Promise<void> {
    created(res, await posService.create(req.body as CreatePosOrderRequest, actorFrom(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await posService.update(
        req.params.posOrderId as string,
        req.body as UpdatePosOrderRequest,
        actorFrom(req),
      ),
    );
  },

  async updateStatus(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await posService.updateStatus(
        req.params.posOrderId as string,
        req.body as UpdatePosOrderStatusRequest,
        actorFrom(req),
      ),
    );
  },

  async checkout(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await posService.checkout(
        req.params.posOrderId as string,
        req.body as PosCheckoutRequest,
        actorFrom(req),
      ),
    );
  },

  async void(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await posService.voidOrder(
        req.params.posOrderId as string,
        req.body as PosVoidRequest,
        actorFrom(req),
      ),
    );
  },
};
