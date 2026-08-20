import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { PurchaseMasterController } from '../controllers/PurchaseMasterController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { purchaseEntryRoutes } from './purchaseEntry.routes';
import { stockRoutes } from './stock.routes';
import {
  createInventoryLocationSchema,
  createProductSchema,
  createUomSchema,
  inventoryLocationIdParam,
  inventoryLocationListQuerySchema,
  productIdParam,
  productListQuerySchema,
  productLocationParams,
  supplierProductIdParam,
  supplierProductListQuerySchema,
  uomIdParam,
  uomListQuerySchema,
  updateInventoryLocationSchema,
  updateProductSchema,
  updateSupplierProductSchema,
  updateUomSchema,
  updateVendorProfileSchema,
  upsertProductLocationSchema,
  upsertSupplierProductSchema,
  vendorIdParam,
  vendorListQuerySchema,
} from '../validation/purchaseSchemas';

/**
 * Purchase master data, mounted at `/purchase`.
 *
 * The capabilities are deliberately not one blanket PURCHASE_MANAGE. Reading the product
 * master (PRODUCT_READ) is held by everyone who touches goods, down to a storekeeper; editing
 * one (PRODUCT_WRITE) starts at Manager; and the three masters that change what *every*
 * product means — units, locations and supplier mappings — carry their own grants so they can
 * be withheld from someone who may otherwise maintain products.
 *
 * The vendor profile is written under ENTITY_WRITE rather than a purchase capability, because
 * a vendor is an `entities` row: whoever may edit the party may edit its credit terms.
 */
export function purchaseMasterRoutes(): Router {
  const router = Router();

  const productRead = requireCapability(Capability.PRODUCT_READ);
  const productWrite = requireCapability(Capability.PRODUCT_WRITE);
  const uomManage = requireCapability(Capability.UOM_MANAGE);
  const locationManage = requireCapability(Capability.INVENTORY_LOCATION_MANAGE);
  const supplierProductManage = requireCapability(Capability.SUPPLIER_PRODUCT_MANAGE);
  const inventoryRead = requireCapability(Capability.INVENTORY_READ);
  const purchaseRead = requireCapability(Capability.PURCHASE_READ);
  const entityWrite = requireCapability(Capability.ENTITY_WRITE);

  /* ------------------------------------------------------- units of measure */

  router.get(
    '/uoms',
    productRead,
    validate({ query: uomListQuerySchema }),
    asyncHandler(PurchaseMasterController.listUoms),
  );
  router.post(
    '/uoms',
    uomManage,
    validate({ body: createUomSchema }),
    asyncHandler(PurchaseMasterController.createUom),
  );
  router.patch(
    '/uoms/:uomId',
    uomManage,
    validate({ params: uomIdParam, body: updateUomSchema }),
    asyncHandler(PurchaseMasterController.updateUom),
  );
  router.delete(
    '/uoms/:uomId',
    uomManage,
    validate({ params: uomIdParam }),
    asyncHandler(PurchaseMasterController.removeUom),
  );

  /* ---------------------------------------------------- inventory locations */

  router.get(
    '/locations',
    inventoryRead,
    validate({ query: inventoryLocationListQuerySchema }),
    asyncHandler(PurchaseMasterController.listLocations),
  );
  router.get(
    '/locations/:locationId',
    inventoryRead,
    validate({ params: inventoryLocationIdParam }),
    asyncHandler(PurchaseMasterController.getLocation),
  );
  router.post(
    '/locations',
    locationManage,
    validate({ body: createInventoryLocationSchema }),
    asyncHandler(PurchaseMasterController.createLocation),
  );
  router.patch(
    '/locations/:locationId',
    locationManage,
    validate({ params: inventoryLocationIdParam, body: updateInventoryLocationSchema }),
    asyncHandler(PurchaseMasterController.updateLocation),
  );
  router.delete(
    '/locations/:locationId',
    locationManage,
    validate({ params: inventoryLocationIdParam }),
    asyncHandler(PurchaseMasterController.removeLocation),
  );

  /* --------------------------------------------------------- product master */

  router.get(
    '/products',
    productRead,
    validate({ query: productListQuerySchema }),
    asyncHandler(PurchaseMasterController.listProducts),
  );
  router.post(
    '/products',
    productWrite,
    validate({ body: createProductSchema }),
    asyncHandler(PurchaseMasterController.createProduct),
  );

  // The per-location routes are declared before `/products/:productId` only for readability;
  // Express matches on the full path, so the order of these two groups does not matter.
  router.get(
    '/products/:productId/locations',
    productRead,
    validate({ params: productIdParam }),
    asyncHandler(PurchaseMasterController.listProductLocations),
  );
  router.put(
    '/products/:productId/locations',
    productWrite,
    validate({ params: productIdParam, body: upsertProductLocationSchema }),
    asyncHandler(PurchaseMasterController.upsertProductLocation),
  );
  router.delete(
    '/products/:productId/locations/:locationId',
    productWrite,
    validate({ params: productLocationParams }),
    asyncHandler(PurchaseMasterController.removeProductLocation),
  );

  router.get(
    '/products/:productId',
    productRead,
    validate({ params: productIdParam }),
    asyncHandler(PurchaseMasterController.getProduct),
  );
  router.patch(
    '/products/:productId',
    productWrite,
    validate({ params: productIdParam, body: updateProductSchema }),
    asyncHandler(PurchaseMasterController.updateProduct),
  );
  router.delete(
    '/products/:productId',
    productWrite,
    validate({ params: productIdParam }),
    asyncHandler(PurchaseMasterController.removeProduct),
  );

  /* -------------------------------------------------- supplier ↔ product map */

  router.get(
    '/supplier-products',
    productRead,
    validate({ query: supplierProductListQuerySchema }),
    asyncHandler(PurchaseMasterController.listSupplierProducts),
  );
  router.post(
    '/supplier-products',
    supplierProductManage,
    validate({ body: upsertSupplierProductSchema }),
    asyncHandler(PurchaseMasterController.upsertSupplierProduct),
  );
  router.patch(
    '/supplier-products/:supplierProductId',
    supplierProductManage,
    validate({ params: supplierProductIdParam, body: updateSupplierProductSchema }),
    asyncHandler(PurchaseMasterController.updateSupplierProduct),
  );
  router.delete(
    '/supplier-products/:supplierProductId',
    supplierProductManage,
    validate({ params: supplierProductIdParam }),
    asyncHandler(PurchaseMasterController.removeSupplierProduct),
  );

  /* --------------------------------------------------- vendor purchase profile */

  router.get(
    '/vendors',
    purchaseRead,
    validate({ query: vendorListQuerySchema }),
    asyncHandler(PurchaseMasterController.listVendors),
  );
  router.get(
    '/vendors/:entityId',
    purchaseRead,
    validate({ params: vendorIdParam }),
    asyncHandler(PurchaseMasterController.getVendor),
  );
  router.patch(
    '/vendors/:entityId/profile',
    entityWrite,
    validate({ params: vendorIdParam, body: updateVendorProfileSchema }),
    asyncHandler(PurchaseMasterController.updateVendorProfile),
  );

  /* ------------------------------------------------------------------ inventory */

  // Balances, the stock ledger, batches, adjustments and counts. Mounted here rather than in
  // `routes/index.ts` because it is the same module under the same `/purchase` prefix, and its
  // own INVENTORY_*/STOCK_* capabilities are declared inside.
  router.use('/stock', stockRoutes());

  /* ------------------------------------------------- the purchase document chain */

  // Entries, the register, generated receipts and invoices, the vendor ledger, payables and
  // payments. Mounted at the module root rather than under a sub-path because the register
  // and the vendor ledger are top-level purchase concerns, not sub-resources of an entry.
  router.use('/', purchaseEntryRoutes());

  return router;
}
