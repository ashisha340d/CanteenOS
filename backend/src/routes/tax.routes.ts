import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { TaxController } from '../controllers/TaxController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createTaxProfileSchema,
  gstSyncRunListQuerySchema,
  hsnSacSearchQuerySchema,
  idParam,
  taxProfileListQuerySchema,
  updateTaxProfileSchema,
} from '../validation/schemas';

/**
 * Tax & Compliance masters.
 *
 * TAX_READ is held by every role, so the Food Item screen can offer a Tax Profile and search
 * the HSN/SAC master. TAX_WRITE and TAX_SYNC are Admin/Super Admin only — a normal user may
 * select a tax treatment but never author one, and only an administrator may pull a new
 * classification dataset from the official source.
 */
export function taxRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.TAX_READ);
  const write = requireCapability(Capability.TAX_WRITE);
  const sync = requireCapability(Capability.TAX_SYNC);

  /* HSN/SAC classification master — read-only by construction. There is no create/update
     endpoint: this data has exactly one author, and it is the official GST/GSTN dataset. */
  router.get(
    '/hsn-sac',
    read,
    validate({ query: hsnSacSearchQuerySchema }),
    asyncHandler(TaxController.searchHsnSac),
  );
  router.get('/hsn-sac/summary', read, asyncHandler(TaxController.getSummary));
  router.get(
    '/hsn-sac/:id',
    read,
    validate({ params: idParam }),
    asyncHandler(TaxController.getHsnSacById),
  );

  /* Synchronization */
  router.post('/gst-sync', sync, asyncHandler(TaxController.sync));
  router.get(
    '/gst-sync/runs',
    read,
    validate({ query: gstSyncRunListQuerySchema }),
    asyncHandler(TaxController.listSyncRuns),
  );
  router.get(
    '/gst-sync/runs/:id',
    read,
    validate({ params: idParam }),
    asyncHandler(TaxController.getSyncRun),
  );

  /* Tax profiles */
  router.get(
    '/tax-profiles',
    read,
    validate({ query: taxProfileListQuerySchema }),
    asyncHandler(TaxController.listProfiles),
  );
  router.get(
    '/tax-profiles/:id',
    read,
    validate({ params: idParam }),
    asyncHandler(TaxController.getProfile),
  );
  router.post(
    '/tax-profiles',
    write,
    validate({ body: createTaxProfileSchema }),
    asyncHandler(TaxController.createProfile),
  );
  router.patch(
    '/tax-profiles/:id',
    write,
    validate({ params: idParam, body: updateTaxProfileSchema }),
    asyncHandler(TaxController.updateProfile),
  );
  router.delete(
    '/tax-profiles/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(TaxController.deleteProfile),
  );

  return router;
}
