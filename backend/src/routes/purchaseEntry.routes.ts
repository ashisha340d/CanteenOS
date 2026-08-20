import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { PurchaseEntryController } from '../controllers/PurchaseEntryController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  cancelPurchaseEntrySchema,
  createPurchaseEntrySchema,
  createVendorPaymentSchema,
  entryIdParam,
  goodsReceiptListQuerySchema,
  invoiceIdParam,
  payableIdParam,
  paymentIdParam,
  payableListQuerySchema,
  postPurchaseEntrySchema,
  purchaseEntryListQuerySchema,
  purchaseInvoiceListQuerySchema,
  purchaseRegisterQuerySchema,
  receiptIdParam,
  supplierIdParam,
  updatePurchaseEntrySchema,
  vendorAgeingQuerySchema,
  vendorLedgerListQuerySchema,
  vendorPaymentListQuerySchema,
  vendorStatementQuerySchema,
} from '../validation/purchaseEntrySchemas';

/**
 * The purchase entry chain, mounted at `/purchase`.
 *
 * The capability split is the point of this file, and it follows the money rather than the
 * screen. Drafting a bill is PURCHASE_ENTRY_CREATE and reaches a Manager; *posting* it is
 * PURCHASE_POST and is deliberately a separate grant, because posting is the single moment
 * stock, a supplier liability and possibly a payment all come into existence at once. Reading
 * the vendor ledger is its own grant again (VENDOR_LEDGER_READ) because it exposes what the
 * business owes, and paying a supplier (VENDOR_PAYMENT_CREATE) is Admin alone: money leaves.
 *
 * There is no write surface for `/invoices`, `/receipts` or `/vendor-ledger`. Those documents
 * exist because a post created them, and there is no other way for one to come into being.
 */
export function purchaseEntryRoutes(): Router {
  const router = Router();

  const purchaseRead = requireCapability(Capability.PURCHASE_READ);
  const entryCreate = requireCapability(Capability.PURCHASE_ENTRY_CREATE);
  const purchasePost = requireCapability(Capability.PURCHASE_POST);
  const ledgerRead = requireCapability(Capability.VENDOR_LEDGER_READ);
  const payableRead = requireCapability(Capability.PAYABLE_READ);
  const payableSubmit = requireCapability(Capability.PAYABLE_SUBMIT);
  const paymentCreate = requireCapability(Capability.VENDOR_PAYMENT_CREATE);

  /* ------------------------------------------------------------------ entries */

  router.get(
    '/entries',
    purchaseRead,
    validate({ query: purchaseEntryListQuerySchema }),
    asyncHandler(PurchaseEntryController.listEntries),
  );
  router.post(
    '/entries',
    entryCreate,
    validate({ body: createPurchaseEntrySchema }),
    asyncHandler(PurchaseEntryController.createEntry),
  );
  router.get(
    '/entries/:entryId',
    purchaseRead,
    validate({ params: entryIdParam }),
    asyncHandler(PurchaseEntryController.getEntry),
  );
  router.patch(
    '/entries/:entryId',
    entryCreate,
    validate({ params: entryIdParam, body: updatePurchaseEntrySchema }),
    asyncHandler(PurchaseEntryController.updateEntry),
  );
  router.post(
    '/entries/:entryId/ready',
    entryCreate,
    validate({ params: entryIdParam }),
    asyncHandler(PurchaseEntryController.markReady),
  );
  router.get(
    '/entries/:entryId/preview',
    purchaseRead,
    validate({ params: entryIdParam }),
    asyncHandler(PurchaseEntryController.preview),
  );
  // The one route that moves stock and money. Its own capability, and its own audit trail.
  router.post(
    '/entries/:entryId/post',
    purchasePost,
    validate({ params: entryIdParam, body: postPurchaseEntrySchema }),
    asyncHandler(PurchaseEntryController.post),
  );
  router.post(
    '/entries/:entryId/cancel',
    entryCreate,
    validate({ params: entryIdParam, body: cancelPurchaseEntrySchema }),
    asyncHandler(PurchaseEntryController.cancelEntry),
  );
  router.get(
    '/entries/:entryId/flow',
    purchaseRead,
    validate({ params: entryIdParam }),
    asyncHandler(PurchaseEntryController.flow),
  );

  /* ----------------------------------------------------------------- register */

  router.get(
    '/register',
    purchaseRead,
    validate({ query: purchaseRegisterQuerySchema }),
    asyncHandler(PurchaseEntryController.register),
  );
  router.get(
    '/register/totals',
    purchaseRead,
    validate({ query: purchaseRegisterQuerySchema }),
    asyncHandler(PurchaseEntryController.registerTotals),
  );

  /* -------------------------------------------------------- generated documents */

  router.get(
    '/invoices',
    purchaseRead,
    validate({ query: purchaseInvoiceListQuerySchema }),
    asyncHandler(PurchaseEntryController.listInvoices),
  );
  router.get(
    '/invoices/:invoiceId',
    purchaseRead,
    validate({ params: invoiceIdParam }),
    asyncHandler(PurchaseEntryController.getInvoice),
  );
  router.get(
    '/receipts',
    purchaseRead,
    validate({ query: goodsReceiptListQuerySchema }),
    asyncHandler(PurchaseEntryController.listReceipts),
  );
  router.get(
    '/receipts/:receiptId',
    purchaseRead,
    validate({ params: receiptIdParam }),
    asyncHandler(PurchaseEntryController.getReceipt),
  );

  /* -------------------------------------------------------------- vendor ledger */

  router.get(
    '/vendor-ledger',
    ledgerRead,
    validate({ query: vendorLedgerListQuerySchema }),
    asyncHandler(PurchaseEntryController.listVendorLedger),
  );
  // Declared before `/:supplierId/statement` only for readability; Express matches full paths.
  router.get(
    '/vendor-ledger/ageing',
    ledgerRead,
    validate({ query: vendorAgeingQuerySchema }),
    asyncHandler(PurchaseEntryController.vendorAgeing),
  );
  router.get(
    '/vendor-ledger/:supplierId/statement',
    ledgerRead,
    validate({ params: supplierIdParam, query: vendorStatementQuerySchema }),
    asyncHandler(PurchaseEntryController.vendorStatement),
  );

  /* ---------------------------------------------------------- payables & payments */

  router.get(
    '/payables',
    payableRead,
    validate({ query: payableListQuerySchema }),
    asyncHandler(PurchaseEntryController.listPayables),
  );
  router.post(
    '/payables/:payableId/queue',
    payableSubmit,
    validate({ params: payableIdParam }),
    asyncHandler(PurchaseEntryController.queuePayable),
  );
  router.get(
    '/payments',
    payableRead,
    validate({ query: vendorPaymentListQuerySchema }),
    asyncHandler(PurchaseEntryController.listPayments),
  );
  // The list deliberately omits allocations — it would be an N+1 across the page. Reading one
  // payment carries them, which is what answers "which bills did this settle, and by how much".
  router.get(
    '/payments/:paymentId',
    payableRead,
    validate({ params: paymentIdParam }),
    asyncHandler(PurchaseEntryController.getPayment),
  );
  // Money leaves the business here. Admin alone.
  router.post(
    '/payments',
    paymentCreate,
    validate({ body: createVendorPaymentSchema }),
    asyncHandler(PurchaseEntryController.createPayment),
  );

  return router;
}
