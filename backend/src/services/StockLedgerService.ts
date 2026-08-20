import {
  BatchIssuePolicy,
  STOCK_IN_MOVEMENT_TYPES,
  StockMovementType,
  StockSourceType,
  ValuationMethod,
  type IsoDate,
} from '@menuboard/shared';
import type { Db, PoolConnection } from '../db/types';
import { selectOne, type RowDataPacket } from '../db/types';
import { stockRepository, type StockBatchRow } from '../repositories/StockRepository';
import { ConflictError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { toDbDateTime, todayIsoDate } from '../utils/time';
import { money } from './posPricing';

/**
 * The inventory posting core.
 *
 * Everything that moves stock — a goods receipt, a transfer, an adjustment, a return — comes
 * through `post()`. Nothing else writes to `stock_ledger` or `stock_balances`, which is what
 * makes it possible to state a few things without qualification:
 *
 *   - every movement has a source document, because `post()` will not accept one without;
 *   - the ledger and the balance always move together, because they move in one statement pair
 *     inside the caller's transaction;
 *   - two concurrent posts against the same product and location serialise, because the
 *     balance row is locked before it is read.
 *
 * `post()` deliberately takes an open `PoolConnection` rather than opening its own transaction.
 * A goods receipt has to write stock, an invoice, a vendor ledger entry and a payment as one
 * unit; if this opened its own transaction the stock half could commit while the money half
 * rolled back, which is the single worst failure this system could have.
 */

/** Quantities below this are treated as zero — the ledger stores DECIMAL(14,3). */
const QUANTITY_EPSILON = 0.0005;

/** DECIMAL(14,3) for quantities. Costs get four places; see `cost()`. */
function quantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** DECIMAL(14,4) for unit costs — a spice priced per gram is genuinely ₹0.0125. */
function cost(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export interface StockMovementRequest {
  productId: string;
  locationId: string;
  /** Omit to let the engine resolve or create one from `batch`. */
  batchId?: string | null;
  /** Batch identity for a receipt. Ignored when `batchId` is given. */
  batch?: {
    batchNumber: string | null;
    manufacturingDate: IsoDate | null;
    expiryDate: IsoDate | null;
    supplierId?: string | null;
  } | null;
  movementType: StockMovementType;
  /** Always positive. Direction comes from `movementType`. */
  quantity: number;
  /**
   * Cost per stock unit. Required on the way in; on the way out it is ignored and the
   * location's own valuation is used, because stock cannot leave at a price somebody typed.
   */
  unitCost?: number;
  sourceLineId?: string | null;
  notes?: string | null;
  /** The other end of a transfer, recorded on both halves. */
  counterpartyLocationId?: string | null;
}

export interface StockPostingContext {
  sourceType: StockSourceType;
  sourceId: string;
  sourceDocumentNumber?: string | null;
  occurredAt?: string;
  businessDate?: IsoDate;
  actorId: string | null;
  /**
   * Allow a location's balance to go negative even when its own policy forbids it. Reserved
   * for corrections posted by someone holding the adjustment-approval capability; the caller
   * is responsible for having checked that.
   */
  allowNegative?: boolean;
}

export interface PostedMovement {
  ledgerId: string;
  ledgerSeq: number;
  productId: string;
  locationId: string;
  batchId: string | null;
  direction: 'IN' | 'OUT';
  quantity: number;
  unitCost: number;
  movementValue: number;
  balanceAfter: number;
}

interface ProductValuationRow extends RowDataPacket {
  id: string;
  name: string;
  is_batch_tracked: number;
  is_expiry_tracked: number;
  batch_issue_policy: BatchIssuePolicy;
  valuation_method: ValuationMethod;
  standard_cost: string | null;
  moving_average_cost: string;
  is_stocked: number;
}

interface LocationPolicyRow extends RowDataPacket {
  id: string;
  name: string;
  kind: string;
  allows_negative_stock: number;
  status: string;
}

export class StockLedgerService {
  /**
   * Apply a set of movements atomically within the caller's transaction.
   *
   * Movements are applied in the order given. A failure anywhere throws, and because the
   * caller owns the transaction, nothing that came before it survives.
   */
  async post(
    connection: PoolConnection,
    movements: readonly StockMovementRequest[],
    context: StockPostingContext,
  ): Promise<PostedMovement[]> {
    if (movements.length === 0) return [];
    if (context.sourceId.trim() === '') {
      throw new ValidationError('A stock movement must name the document that caused it');
    }

    const occurredAt = context.occurredAt ?? toDbDateTime();
    const businessDate = context.businessDate ?? todayIsoDate();
    const posted: PostedMovement[] = [];

    for (const movement of movements) {
      posted.push(
        ...(await this.applyOne(connection, movement, context, occurredAt, businessDate)),
      );
    }
    return posted;
  }

  /**
   * A single requested movement may become several ledger rows: issuing 10 kg of a
   * batch-tracked product whose oldest batch holds only 6 kg draws from two batches, and each
   * draw is its own movement with its own cost.
   */
  private async applyOne(
    db: PoolConnection,
    movement: StockMovementRequest,
    context: StockPostingContext,
    occurredAt: string,
    businessDate: IsoDate,
  ): Promise<PostedMovement[]> {
    const qty = quantity(movement.quantity);
    if (qty <= QUANTITY_EPSILON) {
      throw new ValidationError(
        `Movement quantity must be greater than zero (product ${movement.productId})`,
      );
    }

    const product = await this.loadProduct(db, movement.productId);
    const location = await this.loadLocation(db, movement.locationId);
    const isIn = STOCK_IN_MOVEMENT_TYPES.includes(movement.movementType);

    if (product.is_stocked !== 1) {
      throw new ValidationError(
        `${product.name} is not a stocked product and cannot have a stock movement`,
      );
    }
    if (location.status !== 'ACTIVE') {
      throw new ValidationError(`${location.name} is not an active location`);
    }

    if (isIn) {
      const batchId = await this.resolveBatchForReceipt(db, product, movement, context, qty);
      return [
        await this.writeMovement(db, {
          movement,
          product,
          location,
          batchId,
          direction: 'IN',
          qty,
          unitCost: cost(movement.unitCost ?? 0),
          context,
          occurredAt,
          businessDate,
        }),
      ];
    }

    return this.issue(db, movement, product, location, qty, context, occurredAt, businessDate);
  }

  /**
   * Take stock out, drawing from batches in the product's issue order when it is tracked.
   *
   * The caller does not choose the cost. For a tracked product the cost is whatever the batch
   * was received at; for an untracked one it is the location's moving average. That is the
   * whole point of holding a valuation — an issue cannot be priced by whoever is typing.
   */
  private async issue(
    db: PoolConnection,
    movement: StockMovementRequest,
    product: ProductValuationRow,
    location: LocationPolicyRow,
    qty: number,
    context: StockPostingContext,
    occurredAt: string,
    businessDate: IsoDate,
  ): Promise<PostedMovement[]> {
    const tracked = product.is_batch_tracked === 1;
    const pinnedBatch = movement.batchId ?? null;

    if (!tracked || pinnedBatch !== null) {
      return [
        await this.writeMovement(db, {
          movement,
          product,
          location,
          batchId: pinnedBatch,
          direction: 'OUT',
          qty,
          unitCost: null,
          context,
          occurredAt,
          businessDate,
        }),
      ];
    }

    const policy = product.batch_issue_policy;
    const batches = await stockRepository.findIssuableBatches(
      db,
      product.id,
      location.id,
      policy,
    );

    const posted: PostedMovement[] = [];
    let remaining = qty;
    for (const batch of batches) {
      if (remaining <= QUANTITY_EPSILON) break;
      const available = quantity(Number(batch.available));
      if (available <= QUANTITY_EPSILON) continue;
      const draw = quantity(Math.min(available, remaining));
      posted.push(
        await this.writeMovement(db, {
          movement,
          product,
          location,
          batchId: batch.id,
          direction: 'OUT',
          qty: draw,
          unitCost: null,
          context,
          occurredAt,
          businessDate,
        }),
      );
      remaining = quantity(remaining - draw);
    }

    if (remaining > QUANTITY_EPSILON) {
      // Nothing left to draw from. Either refuse, or book the shortfall against no batch so
      // the location genuinely goes negative and the discrepancy is visible rather than lost.
      const allowNegative =
        context.allowNegative === true || location.allows_negative_stock === 1;
      if (!allowNegative) {
        throw new ConflictError(
          `${product.name} has only ${quantity(qty - remaining)} available at ${location.name}, ` +
            `but ${qty} was issued`,
        );
      }
      posted.push(
        await this.writeMovement(db, {
          movement,
          product,
          location,
          batchId: null,
          direction: 'OUT',
          qty: remaining,
          unitCost: null,
          context,
          occurredAt,
          businessDate,
        }),
      );
    }

    return posted;
  }

  /**
   * Write one ledger row and move the balance it belongs to, under a row lock.
   *
   * This is the only place in the system where a balance changes.
   */
  private async writeMovement(
    db: PoolConnection,
    args: {
      movement: StockMovementRequest;
      product: ProductValuationRow;
      location: LocationPolicyRow;
      batchId: string | null;
      direction: 'IN' | 'OUT';
      qty: number;
      /** null on an issue: the engine derives it from the balance being drawn down. */
      unitCost: number | null;
      context: StockPostingContext;
      occurredAt: string;
      businessDate: IsoDate;
    },
  ): Promise<PostedMovement> {
    const { product, location, batchId, direction, qty, context } = args;

    const balance = await stockRepository.ensureBalance(db, {
      id: newId(),
      productId: product.id,
      locationId: location.id,
      batchId,
    });

    const openingQty = quantity(Number(balance.quantity));
    const openingValue = money(Number(balance.stock_value));
    const openingAvg = cost(Number(balance.average_cost));

    let unitCost: number;
    let closingQty: number;
    let closingValue: number;
    let closingAvg: number;

    if (direction === 'IN') {
      unitCost = args.unitCost ?? 0;
      closingQty = quantity(openingQty + qty);
      closingValue = money(openingValue + qty * unitCost);
      // Weighted moving average. A standard-cost product keeps its fixed cost and the
      // difference is a purchase price variance the receipt records rather than capitalises.
      closingAvg =
        product.valuation_method === ValuationMethod.STANDARD
          ? cost(Number(product.standard_cost ?? openingAvg))
          : closingQty > QUANTITY_EPSILON
            ? cost(closingValue / closingQty)
            : cost(unitCost);
    } else {
      // Issue at what the stock is actually held at, falling back to the product's average
      // when this particular balance has never been valued (a negative issue, typically).
      unitCost =
        openingAvg > 0
          ? openingAvg
          : product.valuation_method === ValuationMethod.STANDARD
            ? cost(Number(product.standard_cost ?? 0))
            : cost(Number(product.moving_average_cost));
      closingQty = quantity(openingQty - qty);
      closingValue = money(openingValue - qty * unitCost);
      closingAvg = closingQty > QUANTITY_EPSILON ? openingAvg : 0;

      const allowNegative =
        context.allowNegative === true || location.allows_negative_stock === 1;
      if (closingQty < -QUANTITY_EPSILON && !allowNegative) {
        throw new ConflictError(
          `${product.name} has ${openingQty} available at ${location.name}; issuing ${qty} ` +
            'would take it negative',
        );
      }
      // A balance driven to zero should hold no residual value from rounding.
      if (Math.abs(closingQty) <= QUANTITY_EPSILON) closingValue = 0;
    }

    const movementValue = money(qty * unitCost);

    const ledgerId = newId();
    const ledgerSeq = await stockRepository.insertLedgerRow(db, {
      id: ledgerId,
      productId: product.id,
      locationId: location.id,
      batchId,
      movementType: args.movement.movementType,
      direction,
      quantity: qty,
      unitCost,
      movementValue,
      balanceQuantity: closingQty,
      balanceValue: closingValue,
      sourceType: context.sourceType,
      sourceId: context.sourceId,
      sourceLineId: args.movement.sourceLineId ?? null,
      sourceDocumentNumber: context.sourceDocumentNumber ?? null,
      counterpartyLocationId: args.movement.counterpartyLocationId ?? null,
      occurredAt: args.occurredAt,
      businessDate: args.businessDate,
      actorId: context.actorId,
      notes: args.movement.notes ?? null,
    });

    const applied = await stockRepository.applyBalance(db, {
      id: balance.id,
      expectedVersion: balance.version,
      quantity: closingQty,
      averageCost: closingAvg,
      stockValue: closingValue,
      lastLedgerSeq: ledgerSeq,
      lastMovementAt: args.occurredAt,
    });
    if (!applied) {
      // The row lock should make this unreachable. If it ever fires, something wrote a balance
      // outside this service and the whole transaction must fail rather than half-apply.
      throw new ConflictError(
        `Stock balance for ${product.name} at ${location.name} changed during posting; retry`,
      );
    }

    if (batchId !== null && Math.abs(closingQty) <= QUANTITY_EPSILON && direction === 'OUT') {
      await stockRepository.markBatchStatus(db, batchId, 'EXHAUSTED');
    }

    return {
      ledgerId,
      ledgerSeq,
      productId: product.id,
      locationId: location.id,
      batchId,
      direction,
      quantity: qty,
      unitCost,
      movementValue,
      balanceAfter: closingQty,
    };
  }

  /**
   * Find or create the batch a receipt belongs to.
   *
   * A repeat delivery quoting a batch number we already hold tops that batch up rather than
   * fragmenting it, which is what keeps FEFO meaningful over time.
   */
  private async resolveBatchForReceipt(
    db: PoolConnection,
    product: ProductValuationRow,
    movement: StockMovementRequest,
    context: StockPostingContext,
    qty: number,
  ): Promise<string | null> {
    if (movement.batchId != null) return movement.batchId;
    if (product.is_batch_tracked !== 1) return null;

    const batch = movement.batch ?? null;
    if (batch === null || (batch.batchNumber === null && batch.expiryDate === null)) {
      throw new ValidationError(
        `${product.name} is batch tracked, so a batch number or expiry date is required`,
      );
    }
    if (product.is_expiry_tracked === 1 && batch.expiryDate === null) {
      throw new ValidationError(`${product.name} requires an expiry date`);
    }

    if (batch.batchNumber !== null) {
      const existing: StockBatchRow | null = await stockRepository.findBatchByNumber(
        db,
        product.id,
        batch.batchNumber,
      );
      if (existing !== null) return existing.id;
    }

    const created = await stockRepository.insertBatch(db, {
      id: newId(),
      productId: product.id,
      batchNumber: batch.batchNumber,
      manufacturingDate: batch.manufacturingDate,
      expiryDate: batch.expiryDate,
      supplierId: batch.supplierId ?? null,
      initialQuantity: qty,
      unitCost: cost(movement.unitCost ?? 0),
      sourceType: context.sourceType,
      sourceId: context.sourceId,
      createdBy: context.actorId,
    });
    return created.id;
  }

  private async loadProduct(db: Db, productId: string): Promise<ProductValuationRow> {
    const row = await selectOne<ProductValuationRow>(
      db,
      `SELECT id, name, is_batch_tracked, is_expiry_tracked, batch_issue_policy,
              valuation_method, standard_cost, moving_average_cost, is_stocked
         FROM products WHERE id = ? AND deleted_at IS NULL`,
      [productId],
    );
    if (row === null) throw new ValidationError(`Unknown product ${productId}`);
    return row;
  }

  private async loadLocation(db: Db, locationId: string): Promise<LocationPolicyRow> {
    const row = await selectOne<LocationPolicyRow>(
      db,
      `SELECT id, name, kind, allows_negative_stock, status
         FROM inventory_locations WHERE id = ? AND deleted_at IS NULL`,
      [locationId],
    );
    if (row === null) throw new ValidationError(`Unknown inventory location ${locationId}`);
    return row;
  }

  /**
   * Refuse to post a document twice.
   *
   * Called by every posting service before it writes. Cheap, and the difference between a
   * double-clicked Post button being harmless and it duplicating a delivery.
   */
  async assertNotAlreadyPosted(
    db: Db,
    sourceType: StockSourceType,
    sourceId: string,
  ): Promise<void> {
    if (await stockRepository.hasPostedMovements(db, sourceType, sourceId)) {
      throw new ConflictError(
        'This document has already moved stock. Reverse it rather than posting it again.',
      );
    }
  }

  /** Roll the product-level moving average forward after a receipt, for reorder pricing. */
  async refreshProductCost(db: Db, productId: string): Promise<void> {
    await db.execute(
      `UPDATE products p
          SET p.moving_average_cost = COALESCE((
                SELECT CASE WHEN SUM(b.quantity) > 0
                            THEN SUM(b.stock_value) / SUM(b.quantity)
                            ELSE p.moving_average_cost END
                  FROM stock_balances b WHERE b.product_id = p.id
              ), p.moving_average_cost),
              p.updated_at = ?
        WHERE p.id = ?`,
      [toDbDateTime(), productId],
    );
  }
}

export const stockLedgerService = new StockLedgerService();
