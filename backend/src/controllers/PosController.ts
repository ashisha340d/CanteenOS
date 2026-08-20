import type { Request, Response } from 'express';
import type {
  CreatePosOrderRequest,
  PosAnalyticsQuery,
  PosCheckoutRequest,
  PosOrderListQuery,
  PosVoidRequest,
  PrintPosBillRequest,
  SendPosBillWhatsAppRequest,
  UpdatePosOrderRequest,
  UpdatePosOrderStatusRequest,
} from '@menuboard/shared';
import { posService, type PosScope } from '../services/PosService';
import { kioskService } from '../services/KioskService';
import { receiptService } from '../services/ReceiptService';
import { whatsAppService } from '../services/WhatsAppService';
import { created, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/** Point of sale. HTTP in, HTTP out — every rule about money lives in PosService. */
export const PosController = {
  async dashboard(req: Request, res: Response): Promise<void> {
    ok(res, await posService.dashboard(req.query as unknown as PosScope));
  },

  async salesSummary(req: Request, res: Response): Promise<void> {
    ok(res, await posService.salesSummary(req.query as unknown as PosAnalyticsQuery));
  },

  async topItems(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await posService.topItems(req.query as unknown as PosAnalyticsQuery & { limit?: number }),
    );
  },

  async busyHours(req: Request, res: Response): Promise<void> {
    ok(res, await posService.busyHours(req.query as unknown as PosAnalyticsQuery));
  },

  async list(req: Request, res: Response): Promise<void> {
    paginated(res, await posService.list(req.query as unknown as PosOrderListQuery));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await posService.getDetail(req.params.posOrderId as string));
  },

  /**
   * How the organisation wants its self-service kiosks to look and speak, and — when the
   * tablet says which stand it is — that stand's own binding. One request rather than two,
   * because both are polled on the same timer and a kiosk that has the skin but not the menu
   * is not in a usable state.
   */
  async kioskProfile(req: Request, res: Response): Promise<void> {
    const code = typeof req.query.device === 'string' ? req.query.device : null;
    ok(res, await kioskService.profile(code));
  },

  /** The stands a tablet may identify itself as. Names only — see `mapKioskDeviceSummary`. */
  async kioskDevices(_req: Request, res: Response): Promise<void> {
    ok(res, await kioskService.listDeviceSummaries());
  },

  async printBill(req: Request, res: Response): Promise<void> {
    const body = req.body as PrintPosBillRequest;
    ok(
      res,
      await receiptService.printToNetwork(
        req.params.posOrderId as string,
        body.copies ?? 1,
        actorFrom(req),
      ),
    );
  },

  async sendBillWhatsApp(req: Request, res: Response): Promise<void> {
    const body = req.body as SendPosBillWhatsAppRequest;
    ok(
      res,
      await whatsAppService.sendBill(
        req.params.posOrderId as string,
        body.phone ?? null,
        actorFrom(req),
      ),
    );
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
