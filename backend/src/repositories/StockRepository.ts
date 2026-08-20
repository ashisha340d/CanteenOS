import {
  StockSourceType,
  type BatchIssuePolicy,
  type StockMovementType,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db, type RowDataPacket } from '../db/types';
import { toDbDateTime } from '../utils/time';

/**
 * Data access for the inventory core: batches, the append-only ledger, and the balance cache.
 *
 * Row shapes are declared here rather than in models/rows.ts because nothing outside the
 * stock services consumes them — the wire-facing DTOs are assembled by StockLedgerService.
 *
 * Two rules this module exists to enforce, and which callers must not work around:
 *   - `insertLedgerRow` is the only way a row reaches `stock_ledger`, and there is deliberately
 *     no update or delete counterpart. History is corrected by posting the opposite movement.
 *   - `lockBalance` must be called before any balance is read for the purpose of changing it.
 *     Reading without the lock is how two concurrent receipts silently lose one of the two.
 */

export interface StockBatchRow extends RowDataPacket {
  id: string;
  product_id: string;
  batch_number: string | null;
  manufacturing_date: string | null;
  expiry_date: string | null;
  supplier_id: string | null;
  first_received_at: string;
  initial_quantity: string;
  unit_cost: string;
  source_type: string;
  source_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockBalanceRow extends RowDataPacket {
  id: string;
  product_id: string;
  location_id: string;
  batch_id: string | null;
  batch_key: string;
  quantity: string;
  reserved_quantity: string;
  average_cost: string;
  stock_value: string;
  last_movement_at: string | null;
  last_ledger_seq: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface StockLedgerRow extends RowDataPacket {
  id: string;
  ledger_seq: string;
  product_id: string;
  location_id: string;
  batch_id: string | null;
  movement_type: string;
  direction: 'IN' | 'OUT';
  quantity_in: string;
  quantity_out: string;
  unit_cost: string;
  movement_value: string;
  balance_quantity: string;
  balance_value: string;
  source_type: string;
  source_id: string;
  source_line_id: string | null;
  source_document_number: string | null;
  counterparty_location_id: string | null;
  occurred_at: string;
  business_date: string;
  actor_id: string | null;
  notes: string | null;
  created_at: string;
  product_name?: string;
  location_name?: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  actor_name?: string | null;
}

export interface InsertLedgerInput {
  id: string;
  productId: string;
  locationId: string;
  batchId: string | null;
  movementType: StockMovementType;
  direction: 'IN' | 'OUT';
  quantity: number;
  unitCost: number;
  movementValue: number;
  balanceQuantity: number;
  balanceValue: number;
  sourceType: StockSourceType;
  sourceId: string;
  sourceLineId: string | null;
  sourceDocumentNumber: string | null;
  counterpartyLocationId: string | null;
  occurredAt: string;
  businessDate: string;
  actorId: string | null;
  notes: string | null;
}

export interface LedgerListFilter {
  productId?: string;
  locationId?: string;
  batchId?: string;
  movementType?: StockMovementType[];
  sourceType?: StockSourceType;
  sourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

const LEDGER_SELECT = `
  SELECT sl.*, p.name AS product_name, il.name AS location_name,
         sb.batch_number, sb.expiry_date, u.name AS actor_name
    FROM stock_ledger sl
    JOIN products p ON p.id = sl.product_id
    JOIN inventory_locations il ON il.id = sl.location_id
    LEFT JOIN stock_batches sb ON sb.id = sl.batch_id
    LEFT JOIN users u ON u.id = sl.actor_id`;

export class StockRepository {
  /* ----------------------------------------------------------------------- balances */

  /**
   * Read a balance and hold a row lock on it for the rest of the transaction.
   *
   * Returns null when the product has never moved at this location, which the caller turns
   * into an opening row. The gap between "not found" and "inserted" is closed by the unique
   * index on (product, location, batch_key): two transactions that both miss will both try to
   * insert and exactly one will fail, which `upsertBalance` handles.
   */
  async lockBalance(
    db: Db,
    productId: string,
    locationId: string,
    batchId: string | null,
  ): Promise<StockBalanceRow | null> {
    return selectOne<StockBalanceRow>(
      db,
      `SELECT * FROM stock_balances
        WHERE product_id = ? AND location_id = ? AND batch_key = ?
        FOR UPDATE`,
      [productId, locationId, batchId ?? '-'],
    );
  }

  async findBalance(
    db: Db,
    productId: string,
    locationId: string,
    batchId: string | null,
  ): Promise<StockBalanceRow | null> {
    return selectOne<StockBalanceRow>(
      db,
      `SELECT * FROM stock_balances
        WHERE product_id = ? AND location_id = ? AND batch_key = ?`,
      [productId, locationId, batchId ?? '-'],
    );
  }

  /**
   * Create the balance row if it is missing, then lock and return it.
   *
   * The INSERT ... ON DUPLICATE KEY UPDATE is what makes this safe under a race: the loser of
   * two concurrent inserts updates a no-op instead of erroring, and the subsequent locked read
   * sees whichever row won.
   */
  async ensureBalance(
    db: Db,
    input: { id: string; productId: string; locationId: string; batchId: string | null },
  ): Promise<StockBalanceRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO stock_balances
         (id, product_id, location_id, batch_id, batch_key, quantity, reserved_quantity,
          average_cost, stock_value, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 1, ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
      [
        input.id,
        input.productId,
        input.locationId,
        input.batchId,
        input.batchId ?? '-',
        now,
        now,
      ],
    );
    const row = await this.lockBalance(db, input.productId, input.locationId, input.batchId);
    if (row === null) {
      throw new Error(
        `Stock balance for product ${input.productId} at location ${input.locationId} could not be read back`,
      );
    }
    return row;
  }

  /**
   * Apply a new balance, refusing the write if the row changed since it was read.
   *
   * Belt and braces alongside the row lock: the lock is what actually serialises concurrent
   * posts, and the version check is what catches a caller that computed a balance outside the
   * lock and tried to write it back.
   */
  async applyBalance(
    db: Db,
    input: {
      id: string;
      expectedVersion: number;
      quantity: number;
      averageCost: number;
      stockValue: number;
      lastLedgerSeq: number;
      lastMovementAt: string;
    },
  ): Promise<boolean> {
    const result = await mutate(
      db,
      `UPDATE stock_balances
          SET quantity = ?, average_cost = ?, stock_value = ?,
              last_ledger_seq = ?, last_movement_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?`,
      [
        input.quantity,
        input.averageCost,
        input.stockValue,
        input.lastLedgerSeq,
        input.lastMovementAt,
        toDbDateTime(),
        input.id,
        input.expectedVersion,
      ],
    );
    return result.affectedRows > 0;
  }

  async listBalances(
    db: Db,
    filter: { productId?: string; locationId?: string; nonZeroOnly?: boolean },
  ): Promise<StockBalanceRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.productId !== undefined) {
      conditions.push('sb.product_id = ?');
      params.push(filter.productId);
    }
    if (filter.locationId !== undefined) {
      conditions.push('sb.location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.nonZeroOnly === true) conditions.push('sb.quantity <> 0');
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return selectRows<StockBalanceRow>(
      db,
      `SELECT sb.* FROM stock_balances sb ${where} ORDER BY sb.product_id, sb.location_id`,
      params,
    );
  }

  /** Total on hand for a product across every location, ignoring batch. */
  async totalOnHand(db: Db, productId: string): Promise<number> {
    const row = await selectOne<RowDataPacket & { total: string | null }>(
      db,
      'SELECT COALESCE(SUM(quantity), 0) AS total FROM stock_balances WHERE product_id = ?',
      [productId],
    );
    return row === null || row.total === null ? 0 : Number(row.total);
  }

  /* ------------------------------------------------------------------------ batches */

  async findBatchById(db: Db, id: string): Promise<StockBatchRow | null> {
    return selectOne<StockBatchRow>(db, 'SELECT * FROM stock_batches WHERE id = ?', [id]);
  }

  async findBatchByNumber(
    db: Db,
    productId: string,
    batchNumber: string,
  ): Promise<StockBatchRow | null> {
    return selectOne<StockBatchRow>(
      db,
      'SELECT * FROM stock_batches WHERE product_id = ? AND batch_number = ?',
      [productId, batchNumber],
    );
  }

  async insertBatch(
    db: Db,
    input: {
      id: string;
      productId: string;
      batchNumber: string | null;
      manufacturingDate: string | null;
      expiryDate: string | null;
      supplierId: string | null;
      initialQuantity: number;
      unitCost: number;
      sourceType: StockSourceType;
      sourceId: string | null;
      createdBy: string | null;
    },
  ): Promise<StockBatchRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO stock_batches
         (id, product_id, batch_number, manufacturing_date, expiry_date, supplier_id,
          first_received_at, initial_quantity, unit_cost, source_type, source_id,
          status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.batchNumber,
        input.manufacturingDate,
        input.expiryDate,
        input.supplierId,
        now,
        input.initialQuantity,
        input.unitCost,
        input.sourceType,
        input.sourceId,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findBatchById(db, input.id);
    if (row === null) throw new Error('Inserted stock batch could not be read back');
    return row;
  }

  /**
   * Batches at a location that still hold stock, in the order they should be issued.
   *
   * FEFO orders by expiry so the tin that goes off first leaves first; FIFO orders by receipt.
   * Batches with no expiry sort last under FEFO — an undated item cannot be the most urgent.
   */
  async findIssuableBatches(
    db: Db,
    productId: string,
    locationId: string,
    policy: BatchIssuePolicy,
  ): Promise<(StockBatchRow & { available: string })[]> {
    const order =
      policy === 'FIFO'
        ? 'sb.first_received_at ASC, sb.created_at ASC'
        : 'CASE WHEN sb.expiry_date IS NULL THEN 1 ELSE 0 END ASC, sb.expiry_date ASC, sb.first_received_at ASC';
    return selectRows<StockBatchRow & { available: string }>(
      db,
      `SELECT sb.*, bal.quantity AS available
         FROM stock_batches sb
         JOIN stock_balances bal ON bal.batch_id = sb.id AND bal.location_id = ?
        WHERE sb.product_id = ? AND bal.quantity > 0 AND sb.status = 'ACTIVE'
        ORDER BY ${order}`,
      [locationId, productId],
    );
  }

  async markBatchStatus(db: Db, id: string, status: string): Promise<void> {
    await mutate(db, 'UPDATE stock_batches SET status = ?, updated_at = ? WHERE id = ?', [
      status,
      toDbDateTime(),
      id,
    ]);
  }

  /* ------------------------------------------------------------------------- ledger */

  /**
   * Append one movement. The only write path into `stock_ledger`.
   *
   * Returns the assigned `ledger_seq`, which the caller stores on the balance so the two can
   * be reconciled later.
   */
  async insertLedgerRow(db: Db, input: InsertLedgerInput): Promise<number> {
    const result = await mutate(
      db,
      `INSERT INTO stock_ledger
         (id, product_id, location_id, batch_id, movement_type, direction,
          quantity_in, quantity_out, unit_cost, movement_value,
          balance_quantity, balance_value, source_type, source_id, source_line_id,
          source_document_number, counterparty_location_id, occurred_at, business_date,
          actor_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.productId,
        input.locationId,
        input.batchId,
        input.movementType,
        input.direction,
        input.direction === 'IN' ? input.quantity : 0,
        input.direction === 'OUT' ? input.quantity : 0,
        input.unitCost,
        input.movementValue,
        input.balanceQuantity,
        input.balanceValue,
        input.sourceType,
        input.sourceId,
        input.sourceLineId,
        input.sourceDocumentNumber,
        input.counterpartyLocationId,
        input.occurredAt,
        input.businessDate,
        input.actorId,
        input.notes,
        toDbDateTime(),
      ],
    );
    return Number(result.insertId);
  }

  async listLedger(
    db: Db,
    filter: LedgerListFilter,
  ): Promise<{ rows: StockLedgerRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.productId !== undefined) {
      conditions.push('sl.product_id = ?');
      params.push(filter.productId);
    }
    if (filter.locationId !== undefined) {
      conditions.push('sl.location_id = ?');
      params.push(filter.locationId);
    }
    if (filter.batchId !== undefined) {
      conditions.push('sl.batch_id = ?');
      params.push(filter.batchId);
    }
    if (filter.movementType !== undefined && filter.movementType.length > 0) {
      conditions.push(`sl.movement_type IN (${filter.movementType.map(() => '?').join(', ')})`);
      params.push(...filter.movementType);
    }
    if (filter.sourceType !== undefined) {
      conditions.push('sl.source_type = ?');
      params.push(filter.sourceType);
    }
    if (filter.sourceId !== undefined) {
      conditions.push('sl.source_id = ?');
      params.push(filter.sourceId);
    }
    if (filter.dateFrom !== undefined) {
      conditions.push('sl.business_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo !== undefined) {
      conditions.push('sl.business_date <= ?');
      params.push(filter.dateTo);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await selectRows<StockLedgerRow>(
      db,
      `${LEDGER_SELECT} ${where} ORDER BY sl.ledger_seq DESC LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
    const countRow = await selectOne<RowDataPacket & { total: string }>(
      db,
      `SELECT COUNT(*) AS total FROM stock_ledger sl ${where}`,
      params,
    );
    return { rows, total: countRow === null ? 0 : Number(countRow.total) };
  }

  /** Every movement a given document produced. The basis of document traceability. */
  async findBySource(
    db: Db,
    sourceType: StockSourceType,
    sourceId: string,
  ): Promise<StockLedgerRow[]> {
    return selectRows<StockLedgerRow>(
      db,
      `${LEDGER_SELECT} WHERE sl.source_type = ? AND sl.source_id = ? ORDER BY sl.ledger_seq ASC`,
      [sourceType, sourceId],
    );
  }

  /**
   * Whether a document has already moved stock.
   *
   * The posting engine calls this before it writes anything, so a retried post cannot create a
   * second set of movements for the same receipt.
   */
  async hasPostedMovements(
    db: Db,
    sourceType: StockSourceType,
    sourceId: string,
  ): Promise<boolean> {
    const row = await selectOne<RowDataPacket & { total: string }>(
      db,
      'SELECT COUNT(*) AS total FROM stock_ledger WHERE source_type = ? AND source_id = ?',
      [sourceType, sourceId],
    );
    return row !== null && Number(row.total) > 0;
  }
}

export const stockRepository = new StockRepository();
