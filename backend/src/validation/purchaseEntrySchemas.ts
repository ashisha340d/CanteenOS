import { z } from 'zod';
import {
  GoodsReceiptStatus,
  LIMITS,
  MatchStatus,
  PayableStatus,
  PurchaseEntryMode,
  PurchaseEntryStatus,
  PurchaseExceptionCode,
  PurchaseInvoiceStatus,
  PurchasePaymentMethod,
  PurchaseType,
  RejectionReason,
  VendorLedgerTxnType,
  VendorPaymentStatus,
} from '@menuboard/shared';
import { isoDate, optionalText, pageQuery, uuid } from './common';

/**
 * Request schemas for the purchase entry API.
 *
 * There is deliberately no schema for a line total, a tax amount or a document total. Every
 * one of those is computed server-side from the quantity, the rate and the resolved tax
 * profile; accepting one from a client would be accepting a number nobody can defend. The one
 * figure a client may state is `supplierTotalAmount` — what the supplier's own bill claims —
 * and it exists so the server can disagree with it.
 */

const enumOf = <T extends Record<string, string>>(source: T) =>
  z.enum(Object.values(source) as [string, ...string[]]);

/** `'false'` in a query string must not arrive as `true`. */
const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .optional();

const quantity = z.coerce.number().min(0).max(LIMITS.QUANTITY_MAX);
const positiveQuantity = z.coerce.number().gt(0).max(LIMITS.QUANTITY_MAX);
const unitRate = z.coerce.number().min(0).max(LIMITS.PRICE_MAX);
const amount = z.coerce.number().min(0).max(LIMITS.PRICE_MAX);
const percent = z.coerce.number().min(0).max(100);

/* ------------------------------------------------------------------------- params --- */

export const entryIdParam = z.object({ entryId: uuid }).strict();
export const invoiceIdParam = z.object({ invoiceId: uuid }).strict();
export const receiptIdParam = z.object({ receiptId: uuid }).strict();
export const payableIdParam = z.object({ payableId: uuid }).strict();
export const paymentIdParam = z.object({ paymentId: uuid }).strict();
export const supplierIdParam = z.object({ supplierId: uuid }).strict();

/* -------------------------------------------------------------------------- lines --- */

const lineSchema = z
  .object({
    id: uuid.optional(),
    productId: uuid.nullable().optional(),
    description: optionalText(200),
    supplierSku: optionalText(60),
    quantity: positiveQuantity,
    purchaseUomId: uuid.nullable().optional(),
    /** Omit to inherit the supplier mapping, then the product's own pack factor. */
    conversionFactor: z.coerce.number().gt(0).max(1_000_000).optional(),
    rate: unitRate,
    discountPercent: percent.optional(),
    /** Omit to inherit the product's tax profile — the normal case. */
    taxProfileId: uuid.nullable().optional(),
    batchNumber: optionalText(60),
    manufacturingDate: isoDate.nullable().optional(),
    expiryDate: isoDate.nullable().optional(),
    receivedQuantity: quantity.optional(),
    acceptedQuantity: quantity.optional(),
    rejectedQuantity: quantity.optional(),
    rejectionReason: enumOf(RejectionReason).nullable().optional(),
    destinationLocationId: uuid.nullable().optional(),
    notes: optionalText(LIMITS.PURCHASE_LINE_NOTES_MAX),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (line) => line.productId != null || (line.description != null && line.description !== ''),
    'A line must name either a product or a description',
  );

/* ------------------------------------------------------------------------ entries --- */

export const createPurchaseEntrySchema = z
  .object({
    id: uuid.optional(),
    supplierId: uuid,
    purchaseType: enumOf(PurchaseType).optional(),
    entryMode: enumOf(PurchaseEntryMode).optional(),
    businessDate: isoDate.optional(),
    supplierInvoiceNumber: optionalText(LIMITS.SUPPLIER_INVOICE_NUMBER_MAX),
    supplierInvoiceDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    creditDays: z.coerce.number().int().min(0).max(3650).optional(),
    paymentMethod: enumOf(PurchasePaymentMethod).optional(),
    paymentReference: optionalText(120),
    receivingLocationId: uuid.nullable().optional(),
    purchaseOrderId: uuid.nullable().optional(),
    reference: optionalText(LIMITS.PURCHASE_REFERENCE_MAX),
    notes: optionalText(LIMITS.PURCHASE_NOTES_MAX),
    attachmentId: uuid.nullable().optional(),
    billScanId: uuid.nullable().optional(),
    otherCharges: amount.optional(),
    supplierTotalAmount: amount.nullable().optional(),
    lines: z.array(lineSchema).min(1).max(LIMITS.PURCHASE_LINES_MAX),
  })
  .strict();

export const updatePurchaseEntrySchema = z
  .object({
    supplierId: uuid.optional(),
    purchaseType: enumOf(PurchaseType).optional(),
    entryMode: enumOf(PurchaseEntryMode).optional(),
    businessDate: isoDate.optional(),
    supplierInvoiceNumber: optionalText(LIMITS.SUPPLIER_INVOICE_NUMBER_MAX),
    supplierInvoiceDate: isoDate.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    creditDays: z.coerce.number().int().min(0).max(3650).optional(),
    paymentMethod: enumOf(PurchasePaymentMethod).optional(),
    paymentReference: optionalText(120),
    receivingLocationId: uuid.nullable().optional(),
    purchaseOrderId: uuid.nullable().optional(),
    reference: optionalText(LIMITS.PURCHASE_REFERENCE_MAX),
    notes: optionalText(LIMITS.PURCHASE_NOTES_MAX),
    attachmentId: uuid.nullable().optional(),
    billScanId: uuid.nullable().optional(),
    otherCharges: amount.optional(),
    supplierTotalAmount: amount.nullable().optional(),
    lines: z.array(lineSchema).min(1).max(LIMITS.PURCHASE_LINES_MAX).optional(),
    expectedRevision: z.coerce.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).filter((key) => key !== 'expectedRevision').length > 0,
    'No changes supplied',
  );

export const cancelPurchaseEntrySchema = z
  .object({ reason: optionalText(300) })
  .strict();

/**
 * `acceptedExceptionCodes` is what turns an OVERRIDABLE exception into a posted document. It
 * is a list of codes rather than a blanket "force" flag on purpose: waving through a rate
 * variance must not also wave through a suspected duplicate bill nobody looked at.
 */
export const postPurchaseEntrySchema = z
  .object({
    acceptedExceptionCodes: z.array(enumOf(PurchaseExceptionCode)).max(40).optional(),
    overrideNote: optionalText(500),
    paidAmount: amount.optional(),
    paymentReference: optionalText(120),
    lineDestinations: z
      .array(
        z
          .object({
            lineId: uuid,
            destinations: z
              .array(
                z
                  .object({
                    locationId: uuid,
                    quantity: positiveQuantity,
                    notes: optionalText(300),
                  })
                  .strict(),
              )
              .min(1)
              .max(LIMITS.RECEIPT_DESTINATION_SPLIT_MAX),
          })
          .strict(),
      )
      .max(LIMITS.PURCHASE_LINES_MAX)
      .optional(),
  })
  .strict();

export const purchaseEntryListQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    status: enumOf(PurchaseEntryStatus).optional(),
    purchaseType: enumOf(PurchaseType).optional(),
    paymentMethod: enumOf(PurchasePaymentMethod).optional(),
    locationId: uuid.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    withExceptionsOnly: boolQuery,
  })
  .strict();

/* ----------------------------------------------------------------------- register --- */

export const purchaseRegisterQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    status: enumOf(PurchaseEntryStatus).optional(),
    purchaseType: enumOf(PurchaseType).optional(),
    paymentMethod: enumOf(PurchasePaymentMethod).optional(),
    paymentStatus: enumOf(PayableStatus).optional(),
    locationId: uuid.optional(),
    productId: uuid.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    amountMin: amount.optional(),
    amountMax: amount.optional(),
    withExceptionsOnly: boolQuery,
  })
  .strict();

/* --------------------------------------------------------- generated documents --- */

export const goodsReceiptListQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    status: enumOf(GoodsReceiptStatus).optional(),
    locationId: uuid.optional(),
    purchaseEntryId: uuid.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

export const purchaseInvoiceListQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    status: enumOf(PurchaseInvoiceStatus).optional(),
    paymentStatus: enumOf(PayableStatus).optional(),
    matchStatus: enumOf(MatchStatus).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    overdueOnly: boolQuery,
  })
  .strict();

/* ------------------------------------------------------------------ vendor money --- */

export const vendorLedgerListQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    transactionType: enumOf(VendorLedgerTxnType).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

export const vendorStatementQuerySchema = pageQuery
  .extend({ dateFrom: isoDate.optional(), dateTo: isoDate.optional() })
  .strict();

export const vendorAgeingQuerySchema = z.object({ supplierId: uuid.optional() }).strict();

export const payableListQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    status: enumOf(PayableStatus).optional(),
    queuedOnly: boolQuery,
    overdueOnly: boolQuery,
    dueBefore: isoDate.optional(),
  })
  .strict();

export const vendorPaymentListQuerySchema = pageQuery
  .extend({
    supplierId: uuid.optional(),
    status: enumOf(VendorPaymentStatus).optional(),
    method: enumOf(PurchasePaymentMethod).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

export const createVendorPaymentSchema = z
  .object({
    id: uuid.optional(),
    supplierId: uuid,
    paymentDate: isoDate.optional(),
    businessDate: isoDate.optional(),
    method: enumOf(PurchasePaymentMethod),
    amount: z.coerce.number().gt(0).max(LIMITS.PRICE_MAX),
    reference: optionalText(120),
    instrumentNumber: optionalText(60),
    instrumentDate: isoDate.nullable().optional(),
    bankName: optionalText(120),
    notes: optionalText(LIMITS.PURCHASE_LINE_NOTES_MAX),
    /** Omit entirely to record an advance: money on account, allocated later. */
    allocations: z
      .array(
        z
          .object({
            accountsPayableId: uuid,
            allocatedAmount: z.coerce.number().gt(0).max(LIMITS.PRICE_MAX),
          })
          .strict(),
      )
      .max(LIMITS.PAYMENT_ALLOCATIONS_MAX)
      .optional(),
  })
  .strict();
