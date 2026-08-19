import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { KdsController } from '../controllers/KdsController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  kdsCounterIdParam,
  kdsExchangeSchema,
  kdsLineIdParam,
  kdsOrderIdParam,
  kdsPrintingGroupIdParam,
  kdsServeAllSchema,
  kdsStationMenuItemParam,
  kdsStationMenuParam,
  kdsStationMenuUpsertSchema,
} from '../validation/schemas';

/**
 * Kitchen and customer displays.
 *
 * Two of the till's capabilities, reused: POS_READ to watch a board and the active bill,
 * POS_OPERATE to move lines through the kitchen flow. The board never takes money, so
 * POS_CHECKOUT has no route here.
 */
export function kdsRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.POS_READ);
  const operate = requireCapability(Capability.POS_OPERATE);

  router.get('/config', read, asyncHandler(KdsController.config));
  router.get('/counters', read, asyncHandler(KdsController.counters));
  router.get('/kitchen-groups', read, asyncHandler(KdsController.kitchenGroups));

  router.get(
    '/counter/:counterId/queue',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(KdsController.counterQueue),
  );
  router.get(
    '/counter/:counterId/metrics',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(KdsController.metrics),
  );
  router.get(
    '/counter/:counterId/sellables',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(KdsController.sellables),
  );
  router.get(
    '/counter/:counterId/recent-actions',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(KdsController.recentActions),
  );

  router.get(
    '/kitchen/:printingGroupId/queue',
    read,
    validate({ params: kdsPrintingGroupIdParam }),
    asyncHandler(KdsController.kitchenQueue),
  );

  router.post(
    '/lines/:lineId/acknowledge',
    operate,
    validate({ params: kdsLineIdParam }),
    asyncHandler(KdsController.acknowledgeLine),
  );
  router.post(
    '/lines/:lineId/serve',
    operate,
    validate({ params: kdsLineIdParam }),
    asyncHandler(KdsController.serveLine),
  );
  router.post(
    '/lines/:lineId/revert',
    operate,
    validate({ params: kdsLineIdParam }),
    asyncHandler(KdsController.revertLine),
  );

  router.post(
    '/orders/:orderId/serve-all',
    operate,
    validate({ params: kdsOrderIdParam, body: kdsServeAllSchema }),
    asyncHandler(KdsController.serveAll),
  );
  router.post(
    '/orders/:orderId/exchange',
    operate,
    validate({ params: kdsOrderIdParam, body: kdsExchangeSchema }),
    asyncHandler(KdsController.exchange),
  );

  router.get(
    '/cds/counter/:counterId/bill',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(KdsController.cdsBill),
  );

  // The station's own menu file: renames and finished flags that never touch Menu Master.
  router.get(
    '/station/:kind/:stationId/menu',
    read,
    validate({ params: kdsStationMenuParam }),
    asyncHandler(KdsController.stationMenu),
  );
  router.put(
    '/station/:kind/:stationId/menu/:menuItemId',
    operate,
    validate({ params: kdsStationMenuItemParam, body: kdsStationMenuUpsertSchema }),
    asyncHandler(KdsController.saveStationMenuItem),
  );

  return router;
}
