import type { Request, Response } from 'express';
import type {
  CreateStockAdjustmentRequest,
  CreateStockCountRequest,
  RecordStockCountLinesRequest,
  StockAdjustmentListQuery,
  StockBalanceListQuery,
  StockBatchListQuery,
  StockCountListQuery,
  StockLedgerListQuery,
  UpdateStockAdjustmentRequest,
} from '@menuboard/shared';
import { stockService } from '../services/StockService';
import { created, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Inventory: balances, the ledger, batches, adjustments and counts.
 *
 * HTTP in, HTTP out — every rule lives in StockService. Note what is missing: the ledger has
 * a list handler and nothing else, because a movement is never written by a request.
 */
export const StockController = {
  /* ------------------------------------------------------------- read side */

  async listBalances(req: Request, res: Response): Promise<void> {
    paginated(res, await stockService.listBalances(req.query as unknown as StockBalanceListQuery));
  },

  async summary(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.summary(req.query as unknown as { locationId?: string }));
  },

  async listLedger(req: Request, res: Response): Promise<void> {
    paginated(res, await stockService.listLedger(req.query as unknown as StockLedgerListQuery));
  },

  async listBatches(req: Request, res: Response): Promise<void> {
    paginated(res, await stockService.listBatches(req.query as unknown as StockBatchListQuery));
  },

  /* ---------------------------------------------------------- adjustments */

  async listAdjustments(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await stockService.listAdjustments(req.query as unknown as StockAdjustmentListQuery),
    );
  },

  async createAdjustment(req: Request, res: Response): Promise<void> {
    created(
      res,
      await stockService.createAdjustment(
        req.body as CreateStockAdjustmentRequest,
        actorFrom(req),
      ),
    );
  },

  async getAdjustment(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.getAdjustment(req.params.adjustmentId as string));
  },

  async updateAdjustment(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await stockService.updateAdjustment(
        req.params.adjustmentId as string,
        req.body as UpdateStockAdjustmentRequest,
        actorFrom(req),
      ),
    );
  },

  async submitAdjustment(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.submitAdjustment(req.params.adjustmentId as string, actorFrom(req)));
  },

  async postAdjustment(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.postAdjustment(req.params.adjustmentId as string, actorFrom(req)));
  },

  async cancelAdjustment(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.cancelAdjustment(req.params.adjustmentId as string, actorFrom(req)));
  },

  /* --------------------------------------------------------------- counts */

  async listCounts(req: Request, res: Response): Promise<void> {
    paginated(res, await stockService.listCounts(req.query as unknown as StockCountListQuery));
  },

  async createCount(req: Request, res: Response): Promise<void> {
    created(
      res,
      await stockService.createCount(req.body as CreateStockCountRequest, actorFrom(req)),
    );
  },

  async getCount(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.getCount(req.params.countId as string));
  },

  async recordCountLines(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await stockService.recordCountLines(
        req.params.countId as string,
        req.body as RecordStockCountLinesRequest,
        actorFrom(req),
      ),
    );
  },

  async submitCount(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.submitCount(req.params.countId as string, actorFrom(req)));
  },

  async approveCount(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.approveCount(req.params.countId as string, actorFrom(req)));
  },

  async cancelCount(req: Request, res: Response): Promise<void> {
    ok(res, await stockService.cancelCount(req.params.countId as string, actorFrom(req)));
  },
};
