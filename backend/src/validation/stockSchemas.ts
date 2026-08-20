import { z } from 'zod';
import {
  LIMITS,
  StockAdjustmentReason,
  StockAdjustmentStatus,
  StockCountStatus,
  StockMovementType,
  StockSourceType,
} from '@menuboard/shared';
import { enumList, isoDate, optionalText, pageQuery, uuid } from './common';

/**
 * Request schemas for the inventory API — balances, the ledger, batches, adjustments, counts.
 *
 * There is deliberately no schema for creating a ledger entry. Movements exist because a
 * document posted them; the ledger has no write surface and never will.
 */

const enumOf = <T extends Record<string, string>>(source: T) =>
  z.enum(Object.values(source) as [string, ...string[]]);

/** Same reasoning as `purchaseSchemas.boolQuery`: `'false'` must not arrive as `true`. */
const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .optional();

/** DECIMAL(14,3). A movement quantity is always positive; direction carries the sign. */
const movementQuantity = z.coerce
  .number()
  .gt(0, 'A quantity must be greater than zero')
  .max(LIMITS.QUANTITY_MAX);

/** A counted quantity may legitimately be zero — that is what "the shelf is empty" means. */
const countedQuantity = z.coerce.number().min(0).max(LIMITS.QUANTITY_MAX).nullable();

const unitCost = z.coerce.number().min(0).max(LIMITS.PRICE_MAX).optional();

const withinDays = z.coerce.number().int().min(0).max(3650).optional();

const batchStatus = z.enum(['ACTIVE', 'EXHAUSTED', 'EXPIRED', 'QUARANTINED']);

/* ------------------------------------------------------------------------- params --- */

export const adjustmentIdParam = z.object({ adjustmentId: uuid }).strict();
export const countIdParam = z.object({ countId: uuid }).strict();

/* ------------------------------------------------------------- balances & summary --- */

export const stockBalanceListQuerySchema = pageQuery
  .extend({
    productId: uuid.optional(),
    locationId: uuid.optional(),
    categoryId: uuid.optional(),
    nonZeroOnly: boolQuery,
    belowReorderLevel: boolQuery,
    expiringWithinDays: withinDays,
    batchTrackedOnly: boolQuery,
  })
  .strict();

export const stockSummaryQuerySchema = z.object({ locationId: uuid.optional() }).strict();

/* ------------------------------------------------------------------------- ledger --- */

export const stockLedgerListQuerySchema = pageQuery
  .extend({
    productId: uuid.optional(),
    locationId: uuid.optional(),
    batchId: uuid.optional(),
    movementType: enumList(
      Object.values(StockMovementType) as [StockMovementType, ...StockMovementType[]],
    ),
    sourceType: enumOf(StockSourceType).optional(),
    sourceId: uuid.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

/* ------------------------------------------------------------------------ batches --- */

export const stockBatchListQuerySchema = pageQuery
  .extend({
    productId: uuid.optional(),
    locationId: uuid.optional(),
    status: batchStatus.optional(),
    expiringWithinDays: withinDays,
    onHandOnly: boolQuery,
  })
  .strict();

/* -------------------------------------------------------------------- adjustments --- */

/**
 * `unitCost` is accepted only because an IN line genuinely needs one. On an OUT line the
 * posting engine ignores whatever is sent and issues at the valuation the stock is held at,
 * so a supplied cost there is inert rather than refused — an edit form may round-trip it.
 */
const adjustmentLineSchema = z
  .object({
    id: uuid.optional(),
    productId: uuid,
    batchId: uuid.nullable().optional(),
    direction: z.enum(['IN', 'OUT']),
    quantity: movementQuantity,
    unitCost,
    reason: enumOf(StockAdjustmentReason).nullable().optional(),
    notes: optionalText(LIMITS.PURCHASE_LINE_NOTES_MAX),
  })
  .strict();

export const createStockAdjustmentSchema = z
  .object({
    id: uuid.optional(),
    locationId: uuid,
    reason: enumOf(StockAdjustmentReason),
    businessDate: isoDate.optional(),
    notes: optionalText(LIMITS.PURCHASE_NOTES_MAX),
    lines: z.array(adjustmentLineSchema).min(1).max(LIMITS.PURCHASE_LINES_MAX),
  })
  .strict();

export const updateStockAdjustmentSchema = z
  .object({
    locationId: uuid.optional(),
    reason: enumOf(StockAdjustmentReason).optional(),
    notes: optionalText(LIMITS.PURCHASE_NOTES_MAX),
    lines: z.array(adjustmentLineSchema).min(1).max(LIMITS.PURCHASE_LINES_MAX).optional(),
    expectedRevision: z.coerce.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).filter((key) => key !== 'expectedRevision').length > 0,
    'No changes supplied',
  );

export const stockAdjustmentListQuerySchema = pageQuery
  .extend({
    locationId: uuid.optional(),
    status: enumOf(StockAdjustmentStatus).optional(),
    reason: enumOf(StockAdjustmentReason).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();

/* ------------------------------------------------------------------------- counts --- */

export const createStockCountSchema = z
  .object({
    id: uuid.optional(),
    locationId: uuid,
    businessDate: isoDate.optional(),
    isFullCount: z.boolean().optional(),
    productIds: z.array(uuid).min(1).max(LIMITS.PURCHASE_LINES_MAX).optional(),
    categoryId: uuid.optional(),
    notes: optionalText(LIMITS.PURCHASE_NOTES_MAX),
  })
  .strict();

export const recordStockCountLinesSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            lineId: uuid,
            physicalQuantity: countedQuantity,
            reason: enumOf(StockAdjustmentReason).nullable().optional(),
            notes: optionalText(LIMITS.PURCHASE_LINE_NOTES_MAX),
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.PURCHASE_LINES_MAX),
    expectedRevision: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export const stockCountListQuerySchema = pageQuery
  .extend({
    locationId: uuid.optional(),
    status: enumOf(StockCountStatus).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
  })
  .strict();
