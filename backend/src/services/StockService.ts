import {
  PURCHASE_TOLERANCE,
  StockAdjustmentReason,
  StockAdjustmentStatus,
  StockCountStatus,
  StockMovementType,
  StockSourceType,
  type CreateStockAdjustmentRequest,
  type CreateStockCountRequest,
  type RecordStockCountLinesRequest,
  type StockAdjustmentDto,
  type StockAdjustmentLineDto,
  type StockAdjustmentListQuery,
  type StockBalanceDto,
  type StockBalanceListQuery,
  type StockBatchDto,
  type StockBatchListQuery,
  type StockCountApprovalResultDto,
  type StockCountDto,
  type StockCountLineDto,
  type StockCountListQuery,
  type StockLedgerEntryDto,
  type StockLedgerListQuery,
  type StockSummaryDto,
  type UpdateStockAdjustmentRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import { inventoryLocationRepository } from '../repositories/InventoryLocationRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import {
  stockDocumentRepository,
  type StockAdjustmentLineRow,
  type StockAdjustmentRow,
  type StockBalanceViewRow,
  type StockBatchViewRow,
  type StockCountLineRow,
  type StockCountRow,
} from '../repositories/StockDocumentRepository';
import { stockRepository, type StockLedgerRow } from '../repositories/StockRepository';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { fromDbDate, fromDbDateTime, fromDbDateTimeRequired, toDbDateTime, todayIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { documentNumberService } from './DocumentNumberService';
import { money } from './posPricing';
import { stockLedgerService, type PostedMovement, type StockMovementRequest } from './StockLedgerService';

/**
 * The inventory API: what is on hand, how it got there, and the two documents that may change
 * it without a supplier behind them — adjustments and counts.
 *
 * Two rules run through everything here:
 *
 *   - Stock only ever moves through `stockLedgerService.post()`. This service decides *what*
 *     to post and refuses to post twice; it never writes `stock_ledger` or `stock_balances`.
 *   - A posted document is history. It cannot be edited, re-submitted, cancelled or posted
 *     again; a mistake is corrected by raising the opposite adjustment. That is the only
 *     reason the numbers on a stock card can be trusted a month later.
 */

/** DECIMAL(14,3) for quantities, matching the posting core. */
function qty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** DECIMAL(14,4) for unit costs. */
function cost(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/** Below this a quantity is zero: the columns hold three decimals. */
const QUANTITY_EPSILON = 0.0005;

const POSTED_IS_IMMUTABLE =
  'A posted stock adjustment is history and cannot be changed. Raise a reversing adjustment instead.';

const POSTED_COUNT_IS_IMMUTABLE =
  'This count has already been posted. Raise a stock adjustment to correct the balance instead.';

function pagingFor(query: { page?: number; pageSize?: number }): {
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
} {
  const { page, pageSize, offset } = resolvePaging(query);
  return { limit: pageSize, offset, page, pageSize };
}

/**
 * Which movement type an adjustment line produces.
 *
 * IN is always ADJUSTMENT_IN. OUT distinguishes wastage and expiry from a plain correction,
 * because the ledger is what the wastage report reads and "we threw it away" and "the count
 * was wrong" are not the same event.
 */
function movementTypeFor(
  direction: 'IN' | 'OUT',
  reason: StockAdjustmentReason,
): StockMovementType {
  if (direction === 'IN') return StockMovementType.ADJUSTMENT_IN;
  if (reason === StockAdjustmentReason.WASTAGE) return StockMovementType.WASTAGE;
  if (reason === StockAdjustmentReason.EXPIRY) return StockMovementType.EXPIRY;
  return StockMovementType.ADJUSTMENT_OUT;
}

/* ---------------------------------------------------------------------------- mappers --- */

function mapBalance(row: StockBalanceViewRow): StockBalanceDto {
  const quantity = Number(row.quantity);
  const reserved = Number(row.reserved_quantity);
  const reorderLevel = row.reorder_level === null ? null : Number(row.reorder_level);
  const onHandHere = Number(row.location_on_hand);
  return {
    id: row.id,
    productId: row.product_id,
    locationId: row.location_id,
    batchId: row.batch_id,
    quantity,
    reservedQuantity: reserved,
    availableQuantity: qty(quantity - reserved),
    averageCost: Number(row.average_cost),
    stockValue: Number(row.stock_value),
    lastMovementAt: fromDbDateTime(row.last_movement_at),
    productName: row.product_name,
    productCode: row.product_code,
    productUnit: row.product_unit,
    locationName: row.location_name,
    locationKind: row.location_kind,
    batchNumber: row.batch_number,
    expiryDate: fromDbDate(row.expiry_date),
    daysToExpiry: row.days_to_expiry === null ? null : Number(row.days_to_expiry),
    reorderLevel,
    isBelowReorderLevel:
      reorderLevel !== null && reorderLevel > 0 && onHandHere < reorderLevel,
  };
}

function mapLedgerEntry(row: StockLedgerRow): StockLedgerEntryDto {
  return {
    id: row.id,
    ledgerSeq: Number(row.ledger_seq),
    productId: row.product_id,
    locationId: row.location_id,
    batchId: row.batch_id,
    movementType: row.movement_type as StockLedgerEntryDto['movementType'],
    direction: row.direction,
    quantityIn: Number(row.quantity_in),
    quantityOut: Number(row.quantity_out),
    unitCost: Number(row.unit_cost),
    movementValue: Number(row.movement_value),
    balanceQuantity: Number(row.balance_quantity),
    balanceValue: Number(row.balance_value),
    sourceType: row.source_type as StockLedgerEntryDto['sourceType'],
    sourceId: row.source_id,
    sourceLineId: row.source_line_id,
    sourceDocumentNumber: row.source_document_number,
    counterpartyLocationId: row.counterparty_location_id,
    occurredAt: fromDbDateTimeRequired(row.occurred_at),
    businessDate: row.business_date.slice(0, 10),
    actorId: row.actor_id,
    notes: row.notes,
    createdAt: fromDbDateTimeRequired(row.created_at),
    ...(row.product_name !== undefined ? { productName: row.product_name } : {}),
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    ...(row.batch_number !== undefined ? { batchNumber: row.batch_number } : {}),
    ...(row.expiry_date !== undefined ? { expiryDate: fromDbDate(row.expiry_date ?? null) } : {}),
    ...(row.actor_name !== undefined ? { actorName: row.actor_name } : {}),
  };
}

function mapBatch(row: StockBatchViewRow): StockBatchDto {
  return {
    id: row.id,
    productId: row.product_id,
    batchNumber: row.batch_number,
    manufacturingDate: fromDbDate(row.manufacturing_date),
    expiryDate: fromDbDate(row.expiry_date),
    supplierId: row.supplier_id,
    firstReceivedAt: fromDbDateTimeRequired(row.first_received_at),
    initialQuantity: Number(row.initial_quantity),
    unitCost: Number(row.unit_cost),
    sourceType: row.source_type as StockBatchDto['sourceType'],
    sourceId: row.source_id,
    status: row.status as StockBatchDto['status'],
    notes: row.notes,
    createdAt: fromDbDateTimeRequired(row.created_at),
    productName: row.product_name,
    supplierName: row.supplier_name,
    quantityOnHand: Number(row.quantity_on_hand),
    daysToExpiry: row.days_to_expiry === null ? null : Number(row.days_to_expiry),
  };
}

function mapAdjustmentLine(row: StockAdjustmentLineRow): StockAdjustmentLineDto {
  return {
    id: row.id,
    adjustmentId: row.adjustment_id,
    productId: row.product_id,
    batchId: row.batch_id,
    direction: row.direction,
    quantity: Number(row.quantity),
    unitCost: Number(row.unit_cost),
    lineValue: Number(row.line_value),
    systemQuantity: row.system_quantity === null ? null : Number(row.system_quantity),
    reason: row.reason,
    notes: row.notes,
    sortOrder: Number(row.sort_order),
    ...(row.product_name !== undefined ? { productName: row.product_name } : {}),
    ...(row.product_unit !== undefined ? { productUnit: row.product_unit } : {}),
    ...(row.batch_number !== undefined ? { batchNumber: row.batch_number } : {}),
  };
}

function mapAdjustment(
  row: StockAdjustmentRow,
  lines?: StockAdjustmentLineRow[],
): StockAdjustmentDto {
  return {
    id: row.id,
    adjustmentNumber: row.adjustment_number,
    businessDate: row.business_date.slice(0, 10),
    locationId: row.location_id,
    reason: row.reason,
    status: row.status,
    stockCountId: row.stock_count_id,
    notes: row.notes,
    totalInValue: Number(row.total_in_value),
    totalOutValue: Number(row.total_out_value),
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
    submittedAt: fromDbDateTime(row.submitted_at),
    approvedBy: row.approved_by,
    approvedAt: fromDbDateTime(row.approved_at),
    postedBy: row.posted_by,
    postedAt: fromDbDateTime(row.posted_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: fromDbDateTime(row.cancelled_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    revision: Number(row.revision),
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    ...(row.created_by_name !== undefined ? { createdByName: row.created_by_name } : {}),
    ...(row.posted_by_name !== undefined ? { postedByName: row.posted_by_name } : {}),
    ...(row.line_count !== undefined ? { lineCount: Number(row.line_count) } : {}),
    ...(lines !== undefined ? { lines: lines.map(mapAdjustmentLine) } : {}),
  };
}

function mapCountLine(row: StockCountLineRow): StockCountLineDto {
  const variance = Number(row.variance_quantity);
  return {
    id: row.id,
    stockCountId: row.stock_count_id,
    productId: row.product_id,
    batchId: row.batch_id,
    systemQuantity: Number(row.system_quantity),
    physicalQuantity: row.physical_quantity === null ? null : Number(row.physical_quantity),
    varianceQuantity: variance,
    unitCost: Number(row.unit_cost),
    varianceValue: money(variance * Number(row.unit_cost)),
    reason: row.reason,
    notes: row.notes,
    isCounted: row.is_counted === 1,
    sortOrder: Number(row.sort_order),
    ...(row.product_name !== undefined ? { productName: row.product_name } : {}),
    ...(row.product_code !== undefined ? { productCode: row.product_code } : {}),
    ...(row.product_unit !== undefined ? { productUnit: row.product_unit } : {}),
    ...(row.batch_number !== undefined ? { batchNumber: row.batch_number } : {}),
  };
}

function mapCount(row: StockCountRow, lines?: StockCountLineRow[]): StockCountDto {
  return {
    id: row.id,
    countNumber: row.count_number,
    businessDate: row.business_date.slice(0, 10),
    locationId: row.location_id,
    status: row.status,
    isFullCount: row.is_full_count === 1,
    notes: row.notes,
    adjustmentId: row.adjustment_id,
    countedBy: row.counted_by,
    countedAt: fromDbDateTime(row.counted_at),
    createdBy: row.created_by,
    submittedBy: row.submitted_by,
    submittedAt: fromDbDateTime(row.submitted_at),
    approvedBy: row.approved_by,
    approvedAt: fromDbDateTime(row.approved_at),
    postedAt: fromDbDateTime(row.posted_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: fromDbDateTime(row.cancelled_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
    updatedAt: fromDbDateTimeRequired(row.updated_at),
    revision: Number(row.revision),
    ...(row.location_name !== undefined ? { locationName: row.location_name } : {}),
    ...(row.created_by_name !== undefined ? { createdByName: row.created_by_name } : {}),
    ...(row.adjustment_number !== undefined ? { adjustmentNumber: row.adjustment_number } : {}),
    ...(row.line_count !== undefined ? { lineCount: Number(row.line_count) } : {}),
    ...(row.counted_line_count !== undefined
      ? { countedLineCount: Number(row.counted_line_count) }
      : {}),
    ...(row.variance_line_count !== undefined
      ? { varianceLineCount: Number(row.variance_line_count) }
      : {}),
    ...(row.total_variance_value !== undefined
      ? { totalVarianceValue: money(Number(row.total_variance_value)) }
      : {}),
    ...(lines !== undefined ? { lines: lines.map(mapCountLine) } : {}),
  };
}

/* ---------------------------------------------------------------------------- service --- */

export class StockService {
  /* --------------------------------------------------------------- read side */

  async listBalances(query: StockBalanceListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await stockDocumentRepository.listBalanceView(getPool(), {
      ...(query.productId !== undefined ? { productId: query.productId } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      ...(query.nonZeroOnly !== undefined ? { nonZeroOnly: query.nonZeroOnly } : {}),
      ...(query.belowReorderLevel !== undefined
        ? { belowReorderLevel: query.belowReorderLevel }
        : {}),
      ...(query.expiringWithinDays !== undefined
        ? { expiringWithinDays: query.expiringWithinDays }
        : {}),
      ...(query.batchTrackedOnly !== undefined
        ? { batchTrackedOnly: query.batchTrackedOnly }
        : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(rows.map(mapBalance), total, paging.page, paging.pageSize);
  }

  /**
   * Headline figures for a location, or for the whole operation when none is named.
   *
   * Every figure is an aggregate of `stock_balances`; none of them is a placeholder. "Expiring
   * soon" uses the `purchase.near_expiry_days` setting so the same window drives the receipt
   * warning and this panel.
   */
  async summary(query: { locationId?: string }): Promise<StockSummaryDto> {
    const pool = getPool();
    let locationName: string | null = null;
    if (query.locationId !== undefined) {
      locationName = await stockDocumentRepository.findLocationName(pool, query.locationId);
      if (locationName === null) throw new NotFoundError('Inventory location', query.locationId);
    }

    const nearExpiryDays = await this.nearExpiryDays(pool);
    const row = await stockDocumentRepository.summarise(pool, {
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      nearExpiryDays,
    });
    const belowReorderCount = await stockDocumentRepository.countBelowReorderLevel(
      pool,
      query.locationId,
    );

    return {
      locationId: query.locationId ?? null,
      locationName,
      distinctProducts: Number(row.distinct_products),
      totalStockValue: money(Number(row.total_stock_value ?? 0)),
      belowReorderCount,
      expiringSoonCount: Number(row.expiring_soon_count),
      expiredCount: Number(row.expired_count),
      negativeBalanceCount: Number(row.negative_balance_count),
    };
  }

  /** The stock ledger. Read-only: there is no create, update or delete counterpart. */
  async listLedger(query: StockLedgerListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await stockRepository.listLedger(getPool(), {
      ...(query.productId !== undefined ? { productId: query.productId } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.batchId !== undefined ? { batchId: query.batchId } : {}),
      ...(query.movementType !== undefined ? { movementType: query.movementType } : {}),
      ...(query.sourceType !== undefined ? { sourceType: query.sourceType } : {}),
      ...(query.sourceId !== undefined ? { sourceId: query.sourceId } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(rows.map(mapLedgerEntry), total, paging.page, paging.pageSize);
  }

  async listBatches(query: StockBatchListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await stockDocumentRepository.listBatchView(getPool(), {
      ...(query.productId !== undefined ? { productId: query.productId } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.expiringWithinDays !== undefined
        ? { expiringWithinDays: query.expiringWithinDays }
        : {}),
      ...(query.onHandOnly !== undefined ? { onHandOnly: query.onHandOnly } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(rows.map(mapBatch), total, paging.page, paging.pageSize);
  }

  private async nearExpiryDays(db: Db): Promise<number> {
    const raw = await settingsRepository.getValue<unknown>(
      db,
      'purchase.near_expiry_days',
      PURCHASE_TOLERANCE.NEAR_EXPIRY_DAYS,
    );
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value >= 0
      ? Math.trunc(value)
      : PURCHASE_TOLERANCE.NEAR_EXPIRY_DAYS;
  }

  /* ------------------------------------------------------------- adjustments */

  async listAdjustments(query: StockAdjustmentListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await stockDocumentRepository.listAdjustments(getPool(), {
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.reason !== undefined ? { reason: query.reason } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(
      rows.map((row) => mapAdjustment(row)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  async getAdjustment(id: string): Promise<StockAdjustmentDto> {
    const pool = getPool();
    const row = await stockDocumentRepository.findAdjustment(pool, id);
    if (row === null) throw new NotFoundError('Stock adjustment', id);
    const lines = await stockDocumentRepository.listAdjustmentLines(pool, id);
    return mapAdjustment(row, lines);
  }

  async createAdjustment(
    input: CreateStockAdjustmentRequest,
    actor: AuditActor,
  ): Promise<StockAdjustmentDto> {
    return withTransaction(async (cx) => {
      const businessDate = input.businessDate ?? todayIsoDate();
      await this.assertLocation(cx, input.locationId);
      await this.assertProducts(cx, input.lines.map((line) => line.productId));

      const { documentNumber, dailySequence } = await documentNumberService.next(
        cx,
        'STOCK_ADJUSTMENT',
        businessDate,
      );

      const id = input.id ?? newId();
      await stockDocumentRepository.insertAdjustment(cx, {
        id,
        adjustmentNumber: documentNumber,
        dailySequence,
        businessDate,
        locationId: input.locationId,
        reason: input.reason,
        status: StockAdjustmentStatus.DRAFT,
        stockCountId: null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      });
      await this.writeAdjustmentLines(cx, id, input.lines);

      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_ADJUSTMENT_CREATED,
        entityType: 'stock_adjustment',
        entityId: id,
        after: {
          adjustmentNumber: documentNumber,
          locationId: input.locationId,
          reason: input.reason,
          lineCount: input.lines.length,
        },
      });

      return this.readAdjustment(cx, id);
    });
  }

  async updateAdjustment(
    id: string,
    input: UpdateStockAdjustmentRequest,
    actor: AuditActor,
  ): Promise<StockAdjustmentDto> {
    return withTransaction(async (cx) => {
      const before = await stockDocumentRepository.lockAdjustment(cx, id);
      if (before === null) throw new NotFoundError('Stock adjustment', id);
      this.assertAdjustmentEditable(before);

      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== Number(before.revision)
      ) {
        throw new StaleWriteError(Number(before.revision));
      }

      if (input.locationId !== undefined) await this.assertLocation(cx, input.locationId);
      if (input.lines !== undefined) {
        await this.assertProducts(cx, input.lines.map((line) => line.productId));
      }

      await stockDocumentRepository.updateAdjustmentHeader(cx, id, {
        ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      });

      if (input.lines !== undefined) {
        await stockDocumentRepository.deleteAdjustmentLines(cx, id);
        await this.writeAdjustmentLines(cx, id, input.lines);
      }

      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_ADJUSTMENT_UPDATED,
        entityType: 'stock_adjustment',
        entityId: id,
        before: {
          locationId: before.location_id,
          reason: before.reason,
          status: before.status,
        },
        after: {
          locationId: input.locationId ?? before.location_id,
          reason: input.reason ?? before.reason,
          ...(input.lines !== undefined ? { lineCount: input.lines.length } : {}),
        },
      });

      return this.readAdjustment(cx, id);
    });
  }

  async submitAdjustment(id: string, actor: AuditActor): Promise<StockAdjustmentDto> {
    return withTransaction(async (cx) => {
      const row = await stockDocumentRepository.lockAdjustment(cx, id);
      if (row === null) throw new NotFoundError('Stock adjustment', id);
      if (row.status === StockAdjustmentStatus.POSTED) throw new ConflictError(POSTED_IS_IMMUTABLE);
      if (row.status !== StockAdjustmentStatus.DRAFT) {
        throw new ConflictError(`A ${row.status} adjustment cannot be submitted`);
      }

      const lines = await stockDocumentRepository.listAdjustmentLines(cx, id);
      if (lines.length === 0) {
        throw new ValidationError('An adjustment must have at least one line to be submitted');
      }

      await stockDocumentRepository.setAdjustmentStatus(cx, id, {
        status: StockAdjustmentStatus.SUBMITTED,
        submittedBy: actor.userId,
        submittedAt: toDbDateTime(),
      });
      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_ADJUSTMENT_SUBMITTED,
        entityType: 'stock_adjustment',
        entityId: id,
        before: { status: row.status },
        after: { status: StockAdjustmentStatus.SUBMITTED },
      });
      return this.readAdjustment(cx, id);
    });
  }

  /**
   * Post an adjustment: the one call in this service that moves stock.
   *
   * `allowNegative` is set deliberately. The route is gated on STOCK_ADJUSTMENT_APPROVE, and a
   * correction has to be able to write down a balance that is already wrong — refusing it
   * would leave the wrong number standing, which is worse than a visible negative.
   */
  async postAdjustment(id: string, actor: AuditActor): Promise<StockAdjustmentDto> {
    return withTransaction((cx) => this.postAdjustmentWithin(cx, id, actor));
  }

  async cancelAdjustment(id: string, actor: AuditActor): Promise<StockAdjustmentDto> {
    return withTransaction(async (cx) => {
      const row = await stockDocumentRepository.lockAdjustment(cx, id);
      if (row === null) throw new NotFoundError('Stock adjustment', id);
      if (row.status === StockAdjustmentStatus.POSTED) throw new ConflictError(POSTED_IS_IMMUTABLE);
      if (
        row.status !== StockAdjustmentStatus.DRAFT &&
        row.status !== StockAdjustmentStatus.SUBMITTED
      ) {
        throw new ConflictError(`A ${row.status} adjustment cannot be cancelled`);
      }

      await stockDocumentRepository.setAdjustmentStatus(cx, id, {
        status: StockAdjustmentStatus.CANCELLED,
        cancelledBy: actor.userId,
        cancelledAt: toDbDateTime(),
      });
      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_ADJUSTMENT_CANCELLED,
        entityType: 'stock_adjustment',
        entityId: id,
        before: { status: row.status },
        after: { status: StockAdjustmentStatus.CANCELLED },
      });
      return this.readAdjustment(cx, id);
    });
  }

  /* ------------------------------------------------------------------ counts */

  async listCounts(query: StockCountListQuery) {
    const paging = pagingFor(query);
    const { rows, total } = await stockDocumentRepository.listCounts(getPool(), {
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      limit: paging.limit,
      offset: paging.offset,
    });
    return buildPage(
      rows.map((row) => mapCount(row)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  async getCount(id: string): Promise<StockCountDto> {
    const pool = getPool();
    const row = await stockDocumentRepository.findCount(pool, id);
    if (row === null) throw new NotFoundError('Stock count', id);
    const lines = await stockDocumentRepository.listCountLines(pool, id);
    return mapCount(row, lines);
  }

  /**
   * Raise a count sheet, snapshotting what the system believes the location holds.
   *
   * The snapshot is the whole point: the variance is measured against what was believed when
   * the sheet was raised, not against a balance that moved while people were counting.
   */
  async createCount(input: CreateStockCountRequest, actor: AuditActor): Promise<StockCountDto> {
    return withTransaction(async (cx) => {
      const businessDate = input.businessDate ?? todayIsoDate();
      await this.assertLocation(cx, input.locationId);

      const narrowed = input.productIds !== undefined || input.categoryId !== undefined;
      const isFullCount = input.isFullCount ?? !narrowed;
      if (!isFullCount && !narrowed) {
        throw new ValidationError('A partial count must say what to count', [
          { path: 'productIds', message: 'Supply productIds or a categoryId, or make it a full count' },
        ]);
      }

      const requested = isFullCount ? undefined : input.productIds;
      if (requested !== undefined) await this.assertProducts(cx, requested);

      const holdings = await stockDocumentRepository.snapshotHoldings(cx, {
        locationId: input.locationId,
        ...(requested !== undefined ? { productIds: requested } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      });

      const { documentNumber, dailySequence } = await documentNumberService.next(
        cx,
        'STOCK_COUNT',
        businessDate,
      );

      const id = input.id ?? newId();
      await stockDocumentRepository.insertCount(cx, {
        id,
        countNumber: documentNumber,
        dailySequence,
        businessDate,
        locationId: input.locationId,
        isFullCount,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      });

      let sortOrder = 0;
      const held = new Set<string>();
      for (const holding of holdings) {
        held.add(holding.product_id);
        await stockDocumentRepository.insertCountLine(cx, {
          id: newId(),
          stockCountId: id,
          productId: holding.product_id,
          batchId: holding.batch_id,
          systemQuantity: qty(Number(holding.quantity)),
          unitCost: cost(Number(holding.average_cost)),
          sortOrder,
        });
        sortOrder += 1;
      }

      // A product explicitly asked for but holding nothing still belongs on the sheet: finding
      // stock the system does not know about is exactly what a count is for.
      if (requested !== undefined) {
        const missing = requested.filter((productId) => !held.has(productId));
        const products = await stockDocumentRepository.findStockedProducts(cx, missing);
        for (const product of products) {
          await stockDocumentRepository.insertCountLine(cx, {
            id: newId(),
            stockCountId: id,
            productId: product.id,
            batchId: null,
            systemQuantity: 0,
            unitCost: cost(Number(product.moving_average_cost)),
            sortOrder,
          });
          sortOrder += 1;
        }
      }

      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_COUNT_CREATED,
        entityType: 'stock_count',
        entityId: id,
        after: {
          countNumber: documentNumber,
          locationId: input.locationId,
          isFullCount,
          lineCount: sortOrder,
        },
      });

      return this.readCount(cx, id);
    });
  }

  /**
   * Record what was physically found.
   *
   * `variance_quantity` is computed and stored here. It is a plain column rather than a
   * generated one — MariaDB 10.6 rejected the generated form — so this method is the only
   * thing keeping it honest.
   */
  async recordCountLines(
    id: string,
    input: RecordStockCountLinesRequest,
    actor: AuditActor,
  ): Promise<StockCountDto> {
    return withTransaction(async (cx) => {
      const count = await stockDocumentRepository.lockCount(cx, id);
      if (count === null) throw new NotFoundError('Stock count', id);
      if (count.status === StockCountStatus.POSTED) {
        throw new ConflictError(POSTED_COUNT_IS_IMMUTABLE);
      }
      if (
        count.status !== StockCountStatus.DRAFT &&
        count.status !== StockCountStatus.COUNTING
      ) {
        throw new ConflictError(`A ${count.status} count can no longer be recorded against`);
      }
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== Number(count.revision)
      ) {
        throw new StaleWriteError(Number(count.revision));
      }

      let counted = 0;
      for (const entry of input.lines) {
        const line = await stockDocumentRepository.findCountLine(cx, id, entry.lineId);
        if (line === null) throw new NotFoundError('Stock count line', entry.lineId);

        const system = Number(line.system_quantity);
        const physical = entry.physicalQuantity;
        await stockDocumentRepository.recordCountLine(cx, line.id, {
          physicalQuantity: physical === null ? null : qty(physical),
          varianceQuantity: physical === null ? 0 : qty(physical - system),
          isCounted: physical !== null,
          ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
          ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
        });
        if (physical !== null) counted += 1;
      }

      await stockDocumentRepository.setCountStatus(cx, id, {
        ...(count.status === StockCountStatus.DRAFT
          ? { status: StockCountStatus.COUNTING }
          : {}),
        countedBy: actor.userId,
        countedAt: toDbDateTime(),
      });

      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_COUNT_RECORDED,
        entityType: 'stock_count',
        entityId: id,
        before: { status: count.status },
        after: { recordedLines: input.lines.length, countedLines: counted },
      });

      return this.readCount(cx, id);
    });
  }

  async submitCount(id: string, actor: AuditActor): Promise<StockCountDto> {
    return withTransaction(async (cx) => {
      const count = await stockDocumentRepository.lockCount(cx, id);
      if (count === null) throw new NotFoundError('Stock count', id);
      if (count.status === StockCountStatus.POSTED) {
        throw new ConflictError(POSTED_COUNT_IS_IMMUTABLE);
      }
      if (
        count.status !== StockCountStatus.DRAFT &&
        count.status !== StockCountStatus.COUNTING
      ) {
        throw new ConflictError(`A ${count.status} count cannot be submitted`);
      }

      const lines = await stockDocumentRepository.listCountLines(cx, id);
      if (!lines.some((line) => line.is_counted === 1)) {
        throw new ValidationError('Record at least one physical quantity before submitting');
      }

      await stockDocumentRepository.setCountStatus(cx, id, {
        status: StockCountStatus.SUBMITTED,
        submittedBy: actor.userId,
        submittedAt: toDbDateTime(),
      });
      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_COUNT_SUBMITTED,
        entityType: 'stock_count',
        entityId: id,
        before: { status: count.status },
        after: { status: StockCountStatus.SUBMITTED },
      });
      return this.readCount(cx, id);
    });
  }

  /**
   * Approve a submitted count and turn its variance into a posted adjustment.
   *
   * One transaction: the adjustment is raised, posted through the same path a hand-raised one
   * takes, and the count is marked off against it. If every line matched there is nothing to
   * adjust and no adjustment is created — an empty document would only be noise in the
   * register.
   */
  async approveCount(id: string, actor: AuditActor): Promise<StockCountApprovalResultDto> {
    return withTransaction(async (cx) => {
      const count = await stockDocumentRepository.lockCount(cx, id);
      if (count === null) throw new NotFoundError('Stock count', id);
      if (count.status === StockCountStatus.POSTED) {
        throw new ConflictError(POSTED_COUNT_IS_IMMUTABLE);
      }
      if (count.status !== StockCountStatus.SUBMITTED) {
        throw new ConflictError(`Only a SUBMITTED count can be approved; this one is ${count.status}`);
      }

      const now = toDbDateTime();
      const lines = await stockDocumentRepository.listCountLines(cx, id);
      const variances = lines.filter(
        (line) =>
          line.is_counted === 1 && Math.abs(Number(line.variance_quantity)) > QUANTITY_EPSILON,
      );

      await stockDocumentRepository.setCountStatus(cx, id, {
        status: StockCountStatus.APPROVED,
        approvedBy: actor.userId,
        approvedAt: now,
      });

      if (variances.length === 0) {
        await stockDocumentRepository.setCountStatus(cx, id, {
          status: StockCountStatus.POSTED,
          postedAt: now,
        });
        await auditService.record(cx, actor, {
          action: AuditAction.STOCK_COUNT_APPROVED,
          entityType: 'stock_count',
          entityId: id,
          before: { status: count.status },
          after: { status: StockCountStatus.POSTED, varianceLines: 0, adjustmentId: null },
        });
        return { count: await this.readCount(cx, id), adjustment: null };
      }

      const businessDate = count.business_date.slice(0, 10);
      const { documentNumber, dailySequence } = await documentNumberService.next(
        cx,
        'STOCK_ADJUSTMENT',
        businessDate,
      );
      const adjustmentId = newId();
      await stockDocumentRepository.insertAdjustment(cx, {
        id: adjustmentId,
        adjustmentNumber: documentNumber,
        dailySequence,
        businessDate,
        locationId: count.location_id,
        reason: StockAdjustmentReason.COUNT_VARIANCE,
        status: StockAdjustmentStatus.SUBMITTED,
        stockCountId: id,
        notes: `Variance from stock count ${count.count_number}`,
        createdBy: actor.userId,
        submittedBy: actor.userId,
        submittedAt: now,
        approvedBy: actor.userId,
        approvedAt: now,
      });

      let sortOrder = 0;
      for (const line of variances) {
        const variance = Number(line.variance_quantity);
        const unitCost = cost(Number(line.unit_cost));
        const quantity = qty(Math.abs(variance));
        const direction: 'IN' | 'OUT' = variance > 0 ? 'IN' : 'OUT';
        await stockDocumentRepository.insertAdjustmentLine(cx, {
          id: newId(),
          adjustmentId,
          productId: line.product_id,
          batchId: line.batch_id,
          direction,
          quantity,
          unitCost: direction === 'IN' ? unitCost : 0,
          lineValue: direction === 'IN' ? money(quantity * unitCost) : 0,
          systemQuantity: qty(Number(line.system_quantity)),
          reason: line.reason ?? StockAdjustmentReason.COUNT_VARIANCE,
          notes: line.notes,
          sortOrder,
        });
        sortOrder += 1;
      }

      const adjustment = await this.postAdjustmentWithin(cx, adjustmentId, actor);

      await stockDocumentRepository.setCountStatus(cx, id, {
        status: StockCountStatus.POSTED,
        postedAt: now,
        adjustmentId,
      });

      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_COUNT_APPROVED,
        entityType: 'stock_count',
        entityId: id,
        before: { status: count.status },
        after: {
          status: StockCountStatus.POSTED,
          varianceLines: variances.length,
          adjustmentId,
          adjustmentNumber: documentNumber,
        },
      });

      return { count: await this.readCount(cx, id), adjustment };
    });
  }

  async cancelCount(id: string, actor: AuditActor): Promise<StockCountDto> {
    return withTransaction(async (cx) => {
      const count = await stockDocumentRepository.lockCount(cx, id);
      if (count === null) throw new NotFoundError('Stock count', id);
      if (count.status === StockCountStatus.POSTED) {
        throw new ConflictError(POSTED_COUNT_IS_IMMUTABLE);
      }
      if (
        count.status !== StockCountStatus.DRAFT &&
        count.status !== StockCountStatus.COUNTING &&
        count.status !== StockCountStatus.SUBMITTED
      ) {
        throw new ConflictError(`A ${count.status} count cannot be cancelled`);
      }

      await stockDocumentRepository.setCountStatus(cx, id, {
        status: StockCountStatus.CANCELLED,
        cancelledBy: actor.userId,
        cancelledAt: toDbDateTime(),
      });
      await auditService.record(cx, actor, {
        action: AuditAction.STOCK_COUNT_CANCELLED,
        entityType: 'stock_count',
        entityId: id,
        before: { status: count.status },
        after: { status: StockCountStatus.CANCELLED },
      });
      return this.readCount(cx, id);
    });
  }

  /* ------------------------------------------------------------- internals */

  /**
   * The single posting path, shared by `POST /adjustments/:id/post` and count approval.
   *
   * Runs inside the caller's transaction and in a fixed order: lock, refuse a replay, build
   * the movements, post them, recompute the totals from what actually posted, then mark the
   * document. A failure anywhere — including on the last of two hundred lines — takes the
   * whole thing down with it, because the caller owns the transaction.
   */
  private async postAdjustmentWithin(
    cx: PoolConnection,
    id: string,
    actor: AuditActor,
  ): Promise<StockAdjustmentDto> {
    const adjustment = await stockDocumentRepository.lockAdjustment(cx, id);
    if (adjustment === null) throw new NotFoundError('Stock adjustment', id);

    if (adjustment.status === StockAdjustmentStatus.POSTED) {
      throw new ConflictError(POSTED_IS_IMMUTABLE);
    }
    if (
      adjustment.status !== StockAdjustmentStatus.SUBMITTED &&
      adjustment.status !== StockAdjustmentStatus.APPROVED
    ) {
      throw new ConflictError(
        `A ${adjustment.status} adjustment cannot be posted; submit it first`,
      );
    }

    await stockLedgerService.assertNotAlreadyPosted(
      cx,
      StockSourceType.STOCK_ADJUSTMENT,
      id,
    );

    const lines = await stockDocumentRepository.listAdjustmentLines(cx, id);
    if (lines.length === 0) {
      throw new ValidationError('An adjustment with no lines cannot be posted');
    }

    const businessDate = adjustment.business_date.slice(0, 10);
    const movements: StockMovementRequest[] = lines.map((line) => ({
      productId: line.product_id,
      locationId: adjustment.location_id,
      batchId: line.batch_id,
      movementType: movementTypeFor(line.direction, line.reason ?? adjustment.reason),
      quantity: Number(line.quantity),
      // Only an IN line carries a cost. Stock leaves at the valuation it is held at, never at
      // a price somebody typed on the document.
      ...(line.direction === 'IN' ? { unitCost: Number(line.unit_cost) } : {}),
      sourceLineId: line.id,
      notes: line.notes,
    }));

    const posted = await stockLedgerService.post(cx, movements, {
      sourceType: StockSourceType.STOCK_ADJUSTMENT,
      sourceId: id,
      sourceDocumentNumber: adjustment.adjustment_number,
      actorId: actor.userId,
      businessDate,
      // The route holds STOCK_ADJUSTMENT_APPROVE. A correction must be able to write down a
      // balance that is already wrong; refusing would leave the wrong number standing.
      allowNegative: true,
    });

    const totals = this.totalsOf(posted);
    const now = toDbDateTime();
    await stockDocumentRepository.setAdjustmentStatus(cx, id, {
      status: StockAdjustmentStatus.POSTED,
      postedBy: actor.userId,
      postedAt: now,
      totalInValue: totals.totalInValue,
      totalOutValue: totals.totalOutValue,
    });
    await this.refreshLineValues(cx, id);

    await auditService.record(cx, actor, {
      action: AuditAction.STOCK_ADJUSTMENT_POSTED,
      entityType: 'stock_adjustment',
      entityId: id,
      before: { status: adjustment.status },
      after: {
        status: StockAdjustmentStatus.POSTED,
        adjustmentNumber: adjustment.adjustment_number,
        movements: posted.length,
        totalInValue: totals.totalInValue,
        totalOutValue: totals.totalOutValue,
      },
    });

    return this.readAdjustment(cx, id);
  }

  /** Document totals are what the ledger actually recorded, never what the client sent. */
  private totalsOf(posted: readonly PostedMovement[]): {
    totalInValue: number;
    totalOutValue: number;
  } {
    let totalIn = 0;
    let totalOut = 0;
    for (const movement of posted) {
      if (movement.direction === 'IN') totalIn += movement.movementValue;
      else totalOut += movement.movementValue;
    }
    return { totalInValue: money(totalIn), totalOutValue: money(totalOut) };
  }

  /**
   * Write back what each line actually cost.
   *
   * The ledger rows are read rather than the returned movements, because one line can become
   * several movements (a FEFO draw across two batches) and only the ledger carries the line id
   * that ties them back together.
   */
  private async refreshLineValues(cx: PoolConnection, adjustmentId: string): Promise<void> {
    const ledgerRows = await stockRepository.findBySource(
      cx,
      StockSourceType.STOCK_ADJUSTMENT,
      adjustmentId,
    );
    const perLine = new Map<string, { quantity: number; value: number }>();
    for (const row of ledgerRows) {
      if (row.source_line_id === null) continue;
      const current = perLine.get(row.source_line_id) ?? { quantity: 0, value: 0 };
      perLine.set(row.source_line_id, {
        quantity: current.quantity + Number(row.quantity_in) + Number(row.quantity_out),
        value: current.value + Number(row.movement_value),
      });
    }
    for (const [lineId, totals] of perLine) {
      await stockDocumentRepository.setAdjustmentLineValue(cx, lineId, {
        unitCost: totals.quantity > QUANTITY_EPSILON ? cost(totals.value / totals.quantity) : 0,
        lineValue: money(totals.value),
      });
    }
  }

  private assertAdjustmentEditable(row: StockAdjustmentRow): void {
    if (row.status === StockAdjustmentStatus.POSTED) throw new ConflictError(POSTED_IS_IMMUTABLE);
    if (
      row.status !== StockAdjustmentStatus.DRAFT &&
      row.status !== StockAdjustmentStatus.SUBMITTED
    ) {
      throw new ConflictError(`A ${row.status} adjustment can no longer be edited`);
    }
  }

  private async writeAdjustmentLines(
    cx: PoolConnection,
    adjustmentId: string,
    lines: CreateStockAdjustmentRequest['lines'],
  ): Promise<void> {
    let sortOrder = 0;
    for (const line of lines) {
      const quantity = qty(line.quantity);
      // An OUT line's cost is not knowable until it posts, so it is left at zero rather than
      // filled with a number the ledger will overrule.
      const unitCost = line.direction === 'IN' ? cost(line.unitCost ?? 0) : 0;
      await stockDocumentRepository.insertAdjustmentLine(cx, {
        id: line.id ?? newId(),
        adjustmentId,
        productId: line.productId,
        batchId: line.batchId ?? null,
        direction: line.direction,
        quantity,
        unitCost,
        lineValue: money(quantity * unitCost),
        systemQuantity: null,
        reason: line.reason ?? null,
        notes: line.notes ?? null,
        sortOrder,
      });
      sortOrder += 1;
    }
  }

  private async readAdjustment(db: Db, id: string): Promise<StockAdjustmentDto> {
    const row = await stockDocumentRepository.findAdjustment(db, id);
    if (row === null) throw new NotFoundError('Stock adjustment', id);
    const lines = await stockDocumentRepository.listAdjustmentLines(db, id);
    return mapAdjustment(row, lines);
  }

  private async readCount(db: Db, id: string): Promise<StockCountDto> {
    const row = await stockDocumentRepository.findCount(db, id);
    if (row === null) throw new NotFoundError('Stock count', id);
    const lines = await stockDocumentRepository.listCountLines(db, id);
    return mapCount(row, lines);
  }

  private async assertLocation(db: Db, locationId: string): Promise<void> {
    const location = await inventoryLocationRepository.findById(db, locationId);
    if (location === null) throw new NotFoundError('Inventory location', locationId);
  }

  /** Refuse an unknown or non-stocked product at entry rather than at posting time. */
  private async assertProducts(db: Db, productIds: readonly string[]): Promise<void> {
    const unique = [...new Set(productIds)];
    if (unique.length === 0) return;
    const found = await stockDocumentRepository.findStockedProducts(db, unique);
    const known = new Set(found.map((row) => row.id));
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new ValidationError('One or more products cannot hold stock', [
        {
          path: 'lines',
          message: `Unknown or non-stocked product(s): ${missing.join(', ')}`,
        },
      ]);
    }
  }
}

export const stockService = new StockService();
