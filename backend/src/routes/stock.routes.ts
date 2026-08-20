import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { StockController } from '../controllers/StockController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  adjustmentIdParam,
  countIdParam,
  createStockAdjustmentSchema,
  createStockCountSchema,
  recordStockCountLinesSchema,
  stockAdjustmentListQuerySchema,
  stockBalanceListQuerySchema,
  stockBatchListQuerySchema,
  stockCountListQuerySchema,
  stockLedgerListQuerySchema,
  stockSummaryQuerySchema,
  updateStockAdjustmentSchema,
} from '../validation/stockSchemas';

/**
 * Inventory, mounted at `/purchase/stock`.
 *
 * The capability split is the point of this file. Reading a balance (INVENTORY_READ) reaches
 * every storekeeper; reading the ledger is separate (STOCK_LEDGER_READ) because it exposes
 * cost. Counting is a floor job (STOCK_COUNT_CREATE) but approving the count is not
 * (STOCK_COUNT_APPROVE), and raising an adjustment is deliberately not the same grant as
 * posting one — posting rewrites the physical truth with no supplier document behind it, so
 * STOCK_ADJUSTMENT_APPROVE is held by Admin alone.
 *
 * There is no POST, PATCH or DELETE for `/ledger`, and there never will be.
 */
export function stockRoutes(): Router {
  const router = Router();

  const inventoryRead = requireCapability(Capability.INVENTORY_READ);
  const ledgerRead = requireCapability(Capability.STOCK_LEDGER_READ);
  const adjustmentCreate = requireCapability(Capability.STOCK_ADJUSTMENT_CREATE);
  const adjustmentApprove = requireCapability(Capability.STOCK_ADJUSTMENT_APPROVE);
  const countCreate = requireCapability(Capability.STOCK_COUNT_CREATE);
  const countApprove = requireCapability(Capability.STOCK_COUNT_APPROVE);

  /* --------------------------------------------------- balances & summary */

  router.get(
    '/balances',
    inventoryRead,
    validate({ query: stockBalanceListQuerySchema }),
    asyncHandler(StockController.listBalances),
  );
  router.get(
    '/summary',
    inventoryRead,
    validate({ query: stockSummaryQuerySchema }),
    asyncHandler(StockController.summary),
  );

  /* ------------------------------------------------------------- ledger */

  router.get(
    '/ledger',
    ledgerRead,
    validate({ query: stockLedgerListQuerySchema }),
    asyncHandler(StockController.listLedger),
  );

  /* ------------------------------------------------------------ batches */

  router.get(
    '/batches',
    inventoryRead,
    validate({ query: stockBatchListQuerySchema }),
    asyncHandler(StockController.listBatches),
  );

  /* -------------------------------------------------------- adjustments */

  router.get(
    '/adjustments',
    inventoryRead,
    validate({ query: stockAdjustmentListQuerySchema }),
    asyncHandler(StockController.listAdjustments),
  );
  router.post(
    '/adjustments',
    adjustmentCreate,
    validate({ body: createStockAdjustmentSchema }),
    asyncHandler(StockController.createAdjustment),
  );
  router.get(
    '/adjustments/:adjustmentId',
    inventoryRead,
    validate({ params: adjustmentIdParam }),
    asyncHandler(StockController.getAdjustment),
  );
  router.patch(
    '/adjustments/:adjustmentId',
    adjustmentCreate,
    validate({ params: adjustmentIdParam, body: updateStockAdjustmentSchema }),
    asyncHandler(StockController.updateAdjustment),
  );
  router.post(
    '/adjustments/:adjustmentId/submit',
    adjustmentCreate,
    validate({ params: adjustmentIdParam }),
    asyncHandler(StockController.submitAdjustment),
  );
  // The one route that moves stock. Its own capability, held by Admin alone.
  router.post(
    '/adjustments/:adjustmentId/post',
    adjustmentApprove,
    validate({ params: adjustmentIdParam }),
    asyncHandler(StockController.postAdjustment),
  );
  router.post(
    '/adjustments/:adjustmentId/cancel',
    adjustmentCreate,
    validate({ params: adjustmentIdParam }),
    asyncHandler(StockController.cancelAdjustment),
  );

  /* ------------------------------------------------------------- counts */

  router.get(
    '/counts',
    inventoryRead,
    validate({ query: stockCountListQuerySchema }),
    asyncHandler(StockController.listCounts),
  );
  router.post(
    '/counts',
    countCreate,
    validate({ body: createStockCountSchema }),
    asyncHandler(StockController.createCount),
  );
  router.get(
    '/counts/:countId',
    inventoryRead,
    validate({ params: countIdParam }),
    asyncHandler(StockController.getCount),
  );
  router.patch(
    '/counts/:countId/lines',
    countCreate,
    validate({ params: countIdParam, body: recordStockCountLinesSchema }),
    asyncHandler(StockController.recordCountLines),
  );
  router.post(
    '/counts/:countId/submit',
    countCreate,
    validate({ params: countIdParam }),
    asyncHandler(StockController.submitCount),
  );
  // Approving is what turns a variance into a posted adjustment, so it is a Manager's grant
  // rather than the counter's.
  router.post(
    '/counts/:countId/approve',
    countApprove,
    validate({ params: countIdParam }),
    asyncHandler(StockController.approveCount),
  );
  router.post(
    '/counts/:countId/cancel',
    countCreate,
    validate({ params: countIdParam }),
    asyncHandler(StockController.cancelCount),
  );

  return router;
}
