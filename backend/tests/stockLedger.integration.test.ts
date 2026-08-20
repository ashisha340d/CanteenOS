import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StockMovementType, StockSourceType } from '@menuboard/shared';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

/**
 * Integration tests for the stock ledger, against a real database.
 *
 * The rest of the backend suite mocks its repositories, which is right for validation and
 * pricing logic. It is the wrong tool here: the guarantees this module makes — that a balance
 * cannot be lost to a concurrent post, that history is append-only, that an issue cannot
 * invent stock — are properties of the database and its constraints, and a mock would assert
 * only that the code calls the functions the author expected it to call.
 *
 * Set SKIP_DB_TESTS=1 to skip the suite in an environment with no MySQL. Absent that opt-out
 * an unreachable database is a hard failure, never a silent pass: a suite that goes green
 * because it quietly did nothing is worse than one that is simply absent.
 */

const SKIPPED = process.env.SKIP_DB_TESTS === '1';

const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
};

let available = false;
let pool: mysql.Pool;
let stockLedgerService: typeof import('../src/services/StockLedgerService').stockLedgerService;
let stockRepository: typeof import('../src/repositories/StockRepository').stockRepository;
let withTransaction: typeof import('../src/db/transaction').withTransaction;

/** Fixtures created by this suite, torn down in reverse. */
const created = { products: [] as string[], locations: [] as string[] };

async function makeLocation(allowsNegative: boolean): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO inventory_locations (id, code, name, kind, allows_negative_stock, created_at, updated_at)
     VALUES (?, ?, ?, 'WAREHOUSE', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, `T-${id.slice(0, 8)}`, `Test Location ${id.slice(0, 6)}`, allowsNegative ? 1 : 0],
  );
  created.locations.push(id);
  return id;
}

async function makeProduct(options: {
  batchTracked?: boolean;
  expiryTracked?: boolean;
  policy?: 'FEFO' | 'FIFO';
} = {}): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO products (id, name, unit, is_batch_tracked, is_expiry_tracked, batch_issue_policy,
       valuation_method, is_stocked, is_purchasable, created_at, updated_at)
     VALUES (?, ?, 'KG', ?, ?, ?, 'MOVING_AVERAGE', 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      id,
      `Test Product ${id.slice(0, 8)}`,
      options.batchTracked ? 1 : 0,
      options.expiryTracked ? 1 : 0,
      options.policy ?? 'FEFO',
    ],
  );
  created.products.push(id);
  return id;
}

async function balanceOf(productId: string, locationId: string): Promise<number> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT COALESCE(SUM(quantity),0) AS q FROM stock_balances WHERE product_id = ? AND location_id = ?',
    [productId, locationId],
  );
  return Number(rows[0]?.q ?? 0);
}

async function ledgerCount(sourceId: string): Promise<number> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM stock_ledger WHERE source_id = ?',
    [sourceId],
  );
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  if (SKIPPED) return;
  try {
    pool = mysql.createPool({ ...DB, connectionLimit: 5, timezone: 'Z', dateStrings: true });
    await pool.query('SELECT 1');
    available = true;
  } catch (error) {
    throw new Error(
      `Stock ledger integration tests need a database at ${DB.user}@${DB.host}:${DB.port}/${DB.database} ` +
      `but could not reach one (${(error as Error).message}). ` +
      'Fix the connection, or set SKIP_DB_TESTS=1 to skip this suite deliberately.',
    );
  }
  ({ stockLedgerService } = await import('../src/services/StockLedgerService'));
  ({ stockRepository } = await import('../src/repositories/StockRepository'));
  ({ withTransaction } = await import('../src/db/transaction'));
});

afterAll(async () => {
  if (!available) return;
  for (const id of created.products) {
    await pool.execute('DELETE FROM stock_ledger WHERE product_id = ?', [id]);
    await pool.execute('DELETE FROM stock_balances WHERE product_id = ?', [id]);
    await pool.execute('DELETE FROM stock_batches WHERE product_id = ?', [id]);
    await pool.execute('DELETE FROM products WHERE id = ?', [id]);
  }
  for (const id of created.locations) {
    await pool.execute('DELETE FROM inventory_locations WHERE id = ?', [id]);
  }
  await pool.end();
});

describe.skipIf(SKIPPED)('stock ledger posting', () => {
  it('books a receipt and moves the balance', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);
    const sourceId = randomUUID();

    const posted = await withTransaction((cx) =>
      stockLedgerService.post(
        cx,
        [
          {
            productId: product,
            locationId: location,
            movementType: StockMovementType.PURCHASE_RECEIPT,
            quantity: 100,
            unitCost: 12.5,
          },
        ],
        { sourceType: StockSourceType.GOODS_RECEIPT, sourceId, actorId: null },
      ),
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]?.balanceAfter).toBe(100);
    expect(posted[0]?.movementValue).toBe(1250);
    expect(await balanceOf(product, location)).toBe(100);
  });

  it('values a second receipt at a weighted moving average', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);

    // 100 @ 10 then 100 @ 20 must average to 15, not 20 and not 30.
    for (const [qty, rate] of [
      [100, 10],
      [100, 20],
    ] as const) {
      await withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              quantity: qty,
              unitCost: rate,
            },
          ],
          { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: randomUUID(), actorId: null },
        ),
      );
    }

    const balance = await stockRepository.findBalance(pool, product, location, null);
    expect(Number(balance?.quantity)).toBe(200);
    expect(Number(balance?.average_cost)).toBe(15);
    expect(Number(balance?.stock_value)).toBe(3000);
  });

  it('issues at the held valuation, not at a price the caller supplies', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);

    await withTransaction((cx) =>
      stockLedgerService.post(
        cx,
        [
          {
            productId: product,
            locationId: location,
            movementType: StockMovementType.PURCHASE_RECEIPT,
            quantity: 10,
            unitCost: 30,
          },
        ],
        { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: randomUUID(), actorId: null },
      ),
    );

    const [issued] = await withTransaction((cx) =>
      stockLedgerService.post(
        cx,
        [
          {
            productId: product,
            locationId: location,
            movementType: StockMovementType.WASTAGE,
            quantity: 4,
            // Deliberately absurd. It must be ignored.
            unitCost: 999,
          },
        ],
        { sourceType: StockSourceType.STOCK_ADJUSTMENT, sourceId: randomUUID(), actorId: null },
      ),
    );

    expect(issued?.unitCost).toBe(30);
    expect(issued?.movementValue).toBe(120);
    expect(await balanceOf(product, location)).toBe(6);
  });

  it('refuses to issue more than a location holds', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);

    await withTransaction((cx) =>
      stockLedgerService.post(
        cx,
        [
          {
            productId: product,
            locationId: location,
            movementType: StockMovementType.PURCHASE_RECEIPT,
            quantity: 5,
            unitCost: 10,
          },
        ],
        { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: randomUUID(), actorId: null },
      ),
    );

    await expect(
      withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.POS_SALE,
              quantity: 50,
            },
          ],
          { sourceType: StockSourceType.POS_ORDER, sourceId: randomUUID(), actorId: null },
        ),
      ),
    ).rejects.toThrow(/would take it negative|available at/i);

    expect(await balanceOf(product, location)).toBe(5);
  });

  it('allows negative stock where the location explicitly permits it', async () => {
    const product = await makeProduct();
    const kitchen = await makeLocation(true);

    const [issued] = await withTransaction((cx) =>
      stockLedgerService.post(
        cx,
        [
          {
            productId: product,
            locationId: kitchen,
            movementType: StockMovementType.PRODUCTION_CONSUMPTION,
            quantity: 3,
          },
        ],
        { sourceType: StockSourceType.PRODUCTION_ORDER, sourceId: randomUUID(), actorId: null },
      ),
    );

    expect(issued?.balanceAfter).toBe(-3);
  });

  it('draws batches in expiry order under FEFO', async () => {
    const product = await makeProduct({ batchTracked: true, expiryTracked: true, policy: 'FEFO' });
    const location = await makeLocation(false);

    // Received oldest-last on purpose: FEFO must follow expiry, not arrival.
    for (const [batchNumber, expiry, qty, rate] of [
      ['LATE', '2031-12-31', 10, 10],
      ['SOON', '2030-01-31', 10, 20],
    ] as const) {
      await withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              quantity: qty,
              unitCost: rate,
              batch: { batchNumber, manufacturingDate: null, expiryDate: expiry },
            },
          ],
          { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: randomUUID(), actorId: null },
        ),
      );
    }

    const posted = await withTransaction((cx) =>
      stockLedgerService.post(
        cx,
        [
          {
            productId: product,
            locationId: location,
            movementType: StockMovementType.POS_SALE,
            quantity: 15,
          },
        ],
        { sourceType: StockSourceType.POS_ORDER, sourceId: randomUUID(), actorId: null },
      ),
    );

    // 10 from SOON (expires first, cost 20) then 5 from LATE (cost 10).
    expect(posted).toHaveLength(2);
    expect(posted[0]?.quantity).toBe(10);
    expect(posted[0]?.unitCost).toBe(20);
    expect(posted[1]?.quantity).toBe(5);
    expect(posted[1]?.unitCost).toBe(10);
    expect(await balanceOf(product, location)).toBe(5);
  });

  it('tops up an existing batch rather than fragmenting it', async () => {
    const product = await makeProduct({ batchTracked: true, expiryTracked: true });
    const location = await makeLocation(false);

    for (let i = 0; i < 2; i += 1) {
      await withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              quantity: 10,
              unitCost: 10,
              batch: { batchNumber: 'SAME-LOT', manufacturingDate: null, expiryDate: '2031-01-01' },
            },
          ],
          { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: randomUUID(), actorId: null },
        ),
      );
    }

    const [batches] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM stock_batches WHERE product_id = ?',
      [product],
    );
    expect(Number(batches[0]?.n)).toBe(1);
    expect(await balanceOf(product, location)).toBe(20);
  });

  it('requires a batch on a batch-tracked product', async () => {
    const product = await makeProduct({ batchTracked: true, expiryTracked: true });
    const location = await makeLocation(false);

    await expect(
      withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              quantity: 5,
              unitCost: 1,
            },
          ],
          { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: randomUUID(), actorId: null },
        ),
      ),
    ).rejects.toThrow(/batch/i);
  });

  it('refuses a movement with no source document', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);

    await expect(
      withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              quantity: 1,
              unitCost: 1,
            },
          ],
          { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: '   ', actorId: null },
        ),
      ),
    ).rejects.toThrow(/document/i);
  });

  it('rolls the whole post back when any movement in it fails', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);
    const sourceId = randomUUID();

    // The first movement is valid; the second overdraws. Neither may survive.
    await expect(
      withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              quantity: 10,
              unitCost: 5,
            },
            {
              productId: product,
              locationId: location,
              movementType: StockMovementType.POS_SALE,
              quantity: 999,
            },
          ],
          { sourceType: StockSourceType.GOODS_RECEIPT, sourceId, actorId: null },
        ),
      ),
    ).rejects.toThrow();

    expect(await ledgerCount(sourceId)).toBe(0);
    expect(await balanceOf(product, location)).toBe(0);
  });

  it('detects a document that has already moved stock', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);
    const sourceId = randomUUID();

    await withTransaction((cx) =>
      stockLedgerService.post(
        cx,
        [
          {
            productId: product,
            locationId: location,
            movementType: StockMovementType.PURCHASE_RECEIPT,
            quantity: 1,
            unitCost: 1,
          },
        ],
        { sourceType: StockSourceType.GOODS_RECEIPT, sourceId, actorId: null },
      ),
    );

    await expect(
      stockLedgerService.assertNotAlreadyPosted(pool, StockSourceType.GOODS_RECEIPT, sourceId),
    ).rejects.toThrow(/already moved stock/i);
  });

  it('keeps the running balance on each ledger row consistent with the movements', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);

    for (const [type, qty, rate] of [
      [StockMovementType.PURCHASE_RECEIPT, 50, 4],
      [StockMovementType.PURCHASE_RECEIPT, 25, 4],
      [StockMovementType.WASTAGE, 30, 0],
      [StockMovementType.PURCHASE_RECEIPT, 5, 4],
    ] as const) {
      await withTransaction((cx) =>
        stockLedgerService.post(
          cx,
          [{ productId: product, locationId: location, movementType: type, quantity: qty, unitCost: rate }],
          {
            sourceType: StockSourceType.GOODS_RECEIPT,
            sourceId: randomUUID(),
            actorId: null,
          },
        ),
      );
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT quantity_in, quantity_out, balance_quantity FROM stock_ledger
        WHERE product_id = ? AND location_id = ? ORDER BY ledger_seq ASC`,
      [product, location],
    );

    let running = 0;
    for (const row of rows) {
      running = Math.round((running + Number(row.quantity_in) - Number(row.quantity_out)) * 1000) / 1000;
      expect(Number(row.balance_quantity)).toBe(running);
    }
    expect(running).toBe(50);
    expect(await balanceOf(product, location)).toBe(50);
  });

  it('serialises concurrent receipts instead of losing one', async () => {
    const product = await makeProduct();
    const location = await makeLocation(false);

    // Ten simultaneous receipts of 10. Without the row lock this loses several of them to a
    // read-modify-write race and lands well short of 100.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        withTransaction((cx) =>
          stockLedgerService.post(
            cx,
            [
              {
                productId: product,
                locationId: location,
                movementType: StockMovementType.PURCHASE_RECEIPT,
                quantity: 10,
                unitCost: 2,
              },
            ],
            { sourceType: StockSourceType.GOODS_RECEIPT, sourceId: randomUUID(), actorId: null },
          ),
        ),
      ),
    );

    expect(await balanceOf(product, location)).toBe(100);

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT balance_quantity FROM stock_ledger
        WHERE product_id = ? AND location_id = ? ORDER BY ledger_seq ASC`,
      [product, location],
    );
    // Each row must record a distinct, strictly increasing balance: 10, 20, ... 100.
    const balances = rows.map((r) => Number(r.balance_quantity));
    expect(balances).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });
});
