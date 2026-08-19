import type { Request, Response } from 'express';
import type { KdsExchangeRequest, KdsStationKind, KdsStationMenuUpsertRequest } from '@menuboard/shared';
import { kdsService } from '../services/KdsService';
import { ok } from '../utils/http';
import { actorFrom } from './context';

/** Kitchen and customer displays. HTTP in, HTTP out — every rule lives in KdsService. */
export const KdsController = {
  async config(_req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.config());
  },

  async counters(_req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.listCounters());
  },

  async kitchenGroups(_req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.listPrintingGroups());
  },

  async counterQueue(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.counterQueue(req.params.counterId as string));
  },

  async kitchenQueue(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.kitchenQueue(req.params.printingGroupId as string));
  },

  async metrics(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.metrics(req.params.counterId as string));
  },

  /** The counter's sellable menu tree — the exchange modal's catalogue. */
  async sellables(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.sellables(req.params.counterId as string, actorFrom(req)));
  },

  async recentActions(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.recentActions(req.params.counterId as string));
  },

  async acknowledgeLine(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.acknowledgeLine(req.params.lineId as string, actorFrom(req)));
  },

  async serveLine(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.serveLine(req.params.lineId as string, actorFrom(req)));
  },

  async revertLine(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.revertLine(req.params.lineId as string, actorFrom(req)));
  },

  async serveAll(req: Request, res: Response): Promise<void> {
    const body = req.body as { counterId: string };
    ok(
      res,
      await kdsService.serveOrderForCounter(
        req.params.orderId as string,
        body.counterId,
        actorFrom(req),
      ),
    );
  },

  async exchange(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await kdsService.exchange(
        req.params.orderId as string,
        req.body as KdsExchangeRequest,
        actorFrom(req),
      ),
    );
  },

  async cdsBill(req: Request, res: Response): Promise<void> {
    ok(res, await kdsService.cdsBill(req.params.counterId as string));
  },

  /** The station's own menu file — master menu with this screen's renames and finished flags. */
  async stationMenu(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await kdsService.stationMenu(
        req.params.kind as KdsStationKind,
        req.params.stationId as string,
        actorFrom(req),
      ),
    );
  },

  async saveStationMenuItem(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await kdsService.saveStationMenuItem(
        req.params.kind as KdsStationKind,
        req.params.stationId as string,
        req.params.menuItemId as string,
        req.body as KdsStationMenuUpsertRequest,
        actorFrom(req),
      ),
    );
  },
};
