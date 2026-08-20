import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

/**
 * Integration tests for the atomic purchase post, against a real database.
 *
 * These are deliberately not unit tests. The guarantees this feature makes — that stock, the
 * invoice, the vendor ledger, the payable and the payment either all exist or none of them
 * does; that only accepted quantity reaches a balance; that a supplier's bill number cannot be
 * posted twice — are properties of the database and of a single transaction spanning five
 * tables. A mocked repository would assert only that the code calls the functions its author
 * expected, which is exactly the thing that cannot go wrong here.
 *
 * Set SKIP_DB_TESTS=1 to skip the suite where there is no MySQL. Absent that opt-out an
 * unreachable database is a hard failure, never a silent pass.
 */

const SKIPPED = process.env.SKIP_DB_TESTS === '1';

const DB = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
};

/** Our own GSTIN state for the run. A supplier in 27 is intra-state; one in 29 is not. */
const HOME_STATE = '27';

let available = false;
let pool: mysql.Pool;
let purchaseEntryService: typeof import('../src/services/PurchaseEntryService').purchaseEntryService;
let purchasePostingService: typeof import('../src/services/PurchasePostingService').purchasePostingService;
let closePool: typeof import('../src/db/pool').closePool;

let actor: {
  userId: string;
  role: null;
  ip: null;
  userAgent: null;
  requestId: null;
};
let previousHomeState: string | null = null;
const suiteStartedAt = new Date().toISOString().slice(0, 23).replace('T', ' ');

/** Everything the suite creates, torn down in reverse order of dependency. */
const created = {
  suppliers: [] as string[],
  products: [] as string[],
  locations: [] as string[],
  taxProfiles: [] as string[],
  entries: [] as string[],
};

const stamp = Date.now().toString().slice(-9);
let sequence = 0;
function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${stamp}-${sequence}`;
}

/* --------------------------------------------------------------------------- fixtures */

async function makeSupplier(options: { stateCode?: string | null; gstin?: string | null } = {}) {
  const id = randomUUID();
  const stateCode = options.stateCode === undefined ? HOME_STATE : options.stateCode;
  await pool.execute(
    `INSERT INTO entities (id, code, type, name, state_code, gstin, credit_limit,
       account_balance, vendor_credit_days, vendor_is_approved, status, created_at, updated_at)
     VALUES (?, ?, 'VENDOR', ?, ?, ?, 0, 0, 0, 1, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      id,
      unique('VSUP'),
      `Verify Supplier ${id.slice(0, 8)}`,
      stateCode,
      options.gstin === undefined ? `${stateCode}AAAAA0000A1Z5` : options.gstin,
    ],
  );
  created.suppliers.push(id);
  return id;
}

async function makeTaxProfile(gstRate: number): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO tax_profiles (id, code, name, supply_type, gst_taxability, gst_rate, cgst_rate,
       sgst_rate, igst_rate, cess_rate, price_is_inclusive, status, created_at, updated_at)
     VALUES (?, ?, ?, 'GOODS', 'TAXABLE', ?, ?, ?, ?, 0, 0, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, unique('VTAX'), `Verify GST ${gstRate}`, gstRate, gstRate / 2, gstRate / 2, gstRate],
  );
  created.taxProfiles.push(id);
  return id;
}

async function makeLocation(): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO inventory_locations (id, code, name, kind, allows_negative_stock, status,
       created_at, updated_at)
     VALUES (?, ?, ?, 'WAREHOUSE', 0, 'ACTIVE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, unique('VLOC'), `Verify Store ${id.slice(0, 6)}`],
  );
  created.locations.push(id);
  return id;
}

async function makeProduct(
  options: {
    taxProfileId?: string | null;
    batchTracked?: boolean;
    expiryTracked?: boolean;
    conversionFactor?: number;
    lastPurchaseRate?: number | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO products (id, name, unit, kind, tax_profile_id, purchase_conversion_factor,
       is_batch_tracked, is_expiry_tracked, batch_issue_policy, valuation_method,
       last_purchase_rate, is_stocked, is_purchasable, status, created_at, updated_at)
     VALUES (?, ?, 'KG', 'STOCK', ?, ?, ?, ?, 'FEFO', 'MOVING_AVERAGE', ?, 1, 1, 'ACTIVE',
             UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      id,
      `Verify Purchase Item ${id.slice(0, 8)}`,
      options.taxProfileId ?? null,
      options.conversionFactor ?? 1,
      options.batchTracked === true ? 1 : 0,
      options.expiryTracked === true ? 1 : 0,
      options.lastPurchaseRate ?? null,
    ],
  );
  created.products.push(id);
  return id;
}

/* ------------------------------------------------------------------------- assertions */

async function scalar(sql: string, params: readonly unknown[]): Promise<number> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(sql, params as unknown[]);
  return Number(rows[0]?.v ?? 0);
}

async function balanceOf(productId: string, locationId?: string): Promise<number> {
  return locationId === undefined
    ? scalar('SELECT COALESCE(SUM(quantity),0) AS v FROM stock_balances WHERE product_id = ?', [
      productId,
    ])
    : scalar(
      'SELECT COALESCE(SUM(quantity),0) AS v FROM stock_balances WHERE product_id = ? AND location_id = ?',
      [productId, locationId],
    );
}

async function payableOf(invoiceId: string): Promise<mysql.RowDataPacket | undefined> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT * FROM accounts_payable WHERE purchase_invoice_id = ?',
    [invoiceId],
  );
  return rows[0];
}

/**
 * A refused post carries its exception codes in `details`, not in the message — that is the
 * contract the UI reads to offer a resolution path. Assert against the codes.
 */
async function expectRefusedFor(work: Promise<unknown>, ...codes: string[]): Promise<void> {
  let thrown: unknown;
  try {
    await work;
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected the post to be refused').toBeDefined();
  const error = thrown as { code?: string; details?: { path: string; message: string }[] };
  expect(error.code).toBe('PURCHASE_EXCEPTIONS_UNRESOLVED');
  const paths = (error.details ?? []).map((detail) => detail.path);
  for (const code of codes) expect(paths).toContain(`exceptions.${code}`);
}

async function ledgerOf(supplierId: string): Promise<mysql.RowDataPacket[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    'SELECT * FROM vendor_ledger_entries WHERE supplier_id = ? ORDER BY entry_seq ASC',
    [supplierId],
  );
  return rows;
}

/* ------------------------------------------------------------------------- lifecycle */

interface DraftLine {
  productId: string;
  quantity: number;
  rate: number;
  receivedQuantity?: number;
  acceptedQuantity?: number;
  rejectedQuantity?: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  destinationLocationId?: string | null;
}

async function draft(args: {
  supplierId: string;
  locationId?: string | null;
  paymentMethod?: 'CASH' | 'CREDIT';
  creditDays?: number;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string;
  supplierTotalAmount?: number | null;
  lines: DraftLine[];
}) {
  const entry = await purchaseEntryService.createEntry(
    {
      supplierId: args.supplierId,
      purchaseType: 'STOCK',
      paymentMethod: args.paymentMethod ?? 'CASH',
      ...(args.creditDays !== undefined ? { creditDays: args.creditDays } : {}),
      receivingLocationId: args.locationId ?? null,
      supplierInvoiceNumber: args.supplierInvoiceNumber ?? unique('BILL'),
      supplierInvoiceDate: today(),
      ...(args.supplierTotalAmount !== undefined
        ? { supplierTotalAmount: args.supplierTotalAmount }
        : {}),
      lines: args.lines,
    } as never,
    actor as never,
  );
  created.entries.push(entry.id);
  return entry;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  if (SKIPPED) return;
  try {
    pool = mysql.createPool({ ...DB, connectionLimit: 5, timezone: 'Z', dateStrings: true });
    await pool.query('SELECT 1');
    available = true;
  } catch (error) {
    throw new Error(
      `Purchase posting integration tests need a database at ${DB.user}@${DB.host}:${DB.port}/${DB.database} ` +
      `but could not reach one (${(error as Error).message}). ` +
      'Fix the connection, or set SKIP_DB_TESTS=1 to skip this suite deliberately.',
    );
  }

  ({ purchaseEntryService } = await import('../src/services/PurchaseEntryService'));
  ({ purchasePostingService } = await import('../src/services/PurchasePostingService'));
  ({ closePool } = await import('../src/db/pool'));

  const [users] = await pool.query<mysql.RowDataPacket[]>('SELECT id FROM users LIMIT 1');
  const userId = users[0]?.id as string | undefined;
  if (userId === undefined) {
    throw new Error('Purchase posting tests need at least one user row to act as the poster');
  }
  actor = { userId, role: null, ip: null, userAgent: null, requestId: null };

  // Pin our GSTIN state for the run so the inter/intra-state split is deterministic, and put
  // back whatever the database had afterwards.
  const [settings] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT value FROM settings WHERE setting_key = 'pos.home_state_code'",
  );
  previousHomeState = (settings[0]?.value as string | undefined) ?? null;
  await pool.execute(
    `INSERT INTO settings (setting_key, value, updated_at)
     VALUES ('pos.home_state_code', ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [JSON.stringify(HOME_STATE)],
  );
});

afterAll(async () => {
  if (!available) return;

  const suppliers = created.suppliers;
  const products = created.products;

  if (suppliers.length > 0) {
    const s = suppliers.map(() => '?').join(',');
    // Break the entry <-> generated-document cycle before deleting either side.
    await pool.execute(
      `UPDATE purchase_entries SET goods_receipt_id = NULL, purchase_invoice_id = NULL
        WHERE supplier_id IN (${s})`,
      suppliers,
    );
    await pool.execute(
      `DELETE a FROM vendor_payment_allocations a
         JOIN vendor_payments p ON p.id = a.payment_id
        WHERE p.supplier_id IN (${s})`,
      suppliers,
    );
    await pool.execute(`DELETE FROM vendor_payments WHERE supplier_id IN (${s})`, suppliers);
    await pool.execute(`DELETE FROM accounts_payable WHERE supplier_id IN (${s})`, suppliers);
    await pool.execute(`DELETE FROM vendor_ledger_entries WHERE supplier_id IN (${s})`, suppliers);
    await pool.execute(`DELETE FROM purchase_price_history WHERE supplier_id IN (${s})`, suppliers);
    await pool.execute(`DELETE FROM purchase_invoices WHERE supplier_id IN (${s})`, suppliers);
    await pool.execute(`DELETE FROM goods_receipts WHERE supplier_id IN (${s})`, suppliers);
    await pool.execute(`DELETE FROM supplier_products WHERE supplier_id IN (${s})`, suppliers);
  }
  if (created.entries.length > 0) {
    const e = created.entries.map(() => '?').join(',');
    await pool.execute(`DELETE FROM purchase_exceptions WHERE document_id IN (${e})`, created.entries);
  }
  if (suppliers.length > 0) {
    const s = suppliers.map(() => '?').join(',');
    await pool.execute(`DELETE FROM purchase_entries WHERE supplier_id IN (${s})`, suppliers);
  }

  for (const id of products) {
    await pool.execute('DELETE FROM stock_ledger WHERE product_id = ?', [id]);
    await pool.execute('DELETE FROM stock_balances WHERE product_id = ?', [id]);
    await pool.execute('DELETE FROM stock_batches WHERE product_id = ?', [id]);
    await pool.execute('DELETE FROM products WHERE id = ?', [id]);
  }
  for (const id of created.locations) {
    await pool.execute('DELETE FROM inventory_locations WHERE id = ?', [id]);
  }
  for (const id of suppliers) {
    await pool.execute('DELETE FROM entities WHERE id = ?', [id]);
  }
  for (const id of created.taxProfiles) {
    await pool.execute('DELETE FROM tax_profiles WHERE id = ?', [id]);
  }
  await pool.execute(
    `DELETE FROM audit_logs
      WHERE created_at >= ?
        AND entity_type IN ('purchase_entry','goods_receipt','purchase_invoice','vendor_payment')`,
    [suiteStartedAt],
  );
  await pool.execute("DELETE FROM posting_idempotency WHERE operation = 'purchase.post' AND created_at >= ?", [
    suiteStartedAt,
  ]);

  if (previousHomeState === null) {
    await pool.execute("DELETE FROM settings WHERE setting_key = 'pos.home_state_code'");
  } else {
    await pool.execute(
      "UPDATE settings SET value = ? WHERE setting_key = 'pos.home_state_code'",
      [previousHomeState],
    );
  }

  await closePool();
  await pool.end();
});

describe.skipIf(SKIPPED)('purchase posting', () => {
  it('settles a cash purchase completely: stock, invoice, ledger, payment and a PAID payable', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      paymentMethod: 'CASH',
      lines: [{ productId: product, quantity: 10, rate: 100 }],
    });
    expect(entry.totalAmount).toBe(1000);

    const result = await purchasePostingService.postEntry(entry.id, {}, actor as never);

    expect(result.entry.status).toBe('POSTED');
    expect(result.goodsReceipt?.status).toBe('POSTED');
    expect(result.invoice?.totalAmount).toBe(1000);
    expect(await balanceOf(product, location)).toBe(10);

    // Exactly two ledger entries: the invoice credit and the payment debit, netting to nothing.
    const ledger = await ledgerOf(supplier);
    expect(ledger).toHaveLength(2);
    expect(Number(ledger[0]?.credit_amount)).toBe(1000);
    expect(ledger[0]?.transaction_type).toBe('PURCHASE_INVOICE');
    expect(Number(ledger[1]?.debit_amount)).toBe(1000);
    expect(ledger[1]?.transaction_type).toBe('PAYMENT');
    expect(Number(ledger[1]?.running_balance)).toBe(0);

    const payable = await payableOf(result.invoice?.id as string);
    expect(payable?.status).toBe('PAID');
    expect(Number(payable?.outstanding_amount)).toBe(0);
    expect(Number(payable?.paid_amount)).toBe(1000);

    expect(result.payment?.amount).toBe(1000);
    expect(result.entry.outstandingAmount).toBe(0);
    expect(result.stockMovements).toHaveLength(1);
    expect(result.stockMovements[0]?.quantity).toBe(10);
    expect(result.stockMovements[0]?.unitCost).toBe(100);
    expect(result.stockMovements[0]?.locationName).toBeTruthy();
  });

  it('leaves a credit purchase UNPAID with the right due date and no payment', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      paymentMethod: 'CREDIT',
      creditDays: 15,
      lines: [{ productId: product, quantity: 5, rate: 200 }],
    });

    const result = await purchasePostingService.postEntry(entry.id, {}, actor as never);

    expect(result.payment).toBeNull();
    expect(result.invoice?.dueDate).toBe(addDays(15));
    expect(result.payable?.status).toBe('UNPAID');
    expect(result.payable?.outstandingAmount).toBe(1000);
    expect(result.entry.paidAmount).toBe(0);
    expect(result.entry.outstandingAmount).toBe(1000);

    const ledger = await ledgerOf(supplier);
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0]?.running_balance)).toBe(1000);

    const payments = await scalar(
      'SELECT COUNT(*) AS v FROM vendor_payments WHERE supplier_id = ?',
      [supplier],
    );
    expect(payments).toBe(0);
  });

  it('records a partial payment as PARTIALLY_PAID with the exact remainder, leaving the invoice alone', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      paymentMethod: 'CASH',
      lines: [{ productId: product, quantity: 10, rate: 100 }],
    });

    const result = await purchasePostingService.postEntry(
      entry.id,
      { paidAmount: 400 },
      actor as never,
    );

    expect(result.payment?.amount).toBe(400);
    expect(result.payable?.status).toBe('PARTIALLY_PAID');
    expect(result.payable?.outstandingAmount).toBe(600);
    // The liability moves; what the supplier billed does not.
    expect(result.payable?.originalAmount).toBe(1000);
    expect(result.invoice?.totalAmount).toBe(1000);
    expect(result.invoice?.paidAmount).toBe(400);
    expect(result.invoice?.outstandingAmount).toBe(600);
    expect(result.entry.outstandingAmount).toBe(600);

    const ledger = await ledgerOf(supplier);
    expect(Number(ledger[ledger.length - 1]?.running_balance)).toBe(600);
  });

  it('only lets accepted quantity reach stock', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [
        {
          productId: product,
          quantity: 100,
          rate: 10,
          receivedQuantity: 100,
          acceptedQuantity: 90,
          rejectedQuantity: 10,
        },
      ],
    });

    const result = await purchasePostingService.postEntry(entry.id, {}, actor as never);

    expect(await balanceOf(product, location)).toBe(90);
    expect(result.goodsReceipt?.lines?.[0]?.acceptedQuantity).toBe(90);
    expect(result.goodsReceipt?.lines?.[0]?.rejectedQuantity).toBe(10);
    expect(result.goodsReceipt?.lines?.[0]?.qcStatus).toBe('PARTIAL');
    // The supplier still billed for 100 — rejection is a stock fact, not a pricing one.
    expect(result.invoice?.lines?.[0]?.quantity).toBe(100);
    expect(result.invoice?.totalAmount).toBe(1000);
  });

  it('splits one accepted line across two locations as two movements summing to the accepted quantity', async () => {
    const supplier = await makeSupplier();
    const warehouse = await makeLocation();
    const dayStore = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: warehouse,
      lines: [
        {
          productId: product,
          quantity: 100,
          rate: 10,
          receivedQuantity: 100,
          acceptedQuantity: 90,
          rejectedQuantity: 10,
        },
      ],
    });
    const lineId = entry.lines?.[0]?.id as string;

    const result = await purchasePostingService.postEntry(
      entry.id,
      {
        lineDestinations: [
          {
            lineId,
            // 60 to the warehouse, 30 to the day store. The split must add up to the 90
            // accepted, not to the 100 that arrived.
            destinations: [
              { locationId: warehouse, quantity: 60 },
              { locationId: dayStore, quantity: 30 },
            ],
          },
        ],
      },
      actor as never,
    );

    expect(result.stockMovements).toHaveLength(2);
    const total = result.stockMovements.reduce((sum, m) => sum + m.quantity, 0);
    expect(total).toBe(90);
    expect(await balanceOf(product, warehouse)).toBe(60);
    expect(await balanceOf(product, dayStore)).toBe(30);
    expect(result.goodsReceipt?.lines?.[0]?.destinations).toHaveLength(2);
  });

  it('refuses a split whose quantities do not add up to what was accepted', async () => {
    const supplier = await makeSupplier();
    const warehouse = await makeLocation();
    const dayStore = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: warehouse,
      lines: [{ productId: product, quantity: 10, rate: 10 }],
    });
    const lineId = entry.lines?.[0]?.id as string;

    await expectRefusedFor(
      purchasePostingService.postEntry(
        entry.id,
        {
          lineDestinations: [
            {
              lineId,
              destinations: [
                { locationId: warehouse, quantity: 6 },
                { locationId: dayStore, quantity: 1 },
              ],
            },
          ],
        },
        actor as never,
      ),
      'DESTINATION_SPLIT_MISMATCH',
    );

    expect(await balanceOf(product)).toBe(0);
  });

  it('refuses a supplier bill number that has already been posted', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();
    const bill = unique('DUPBILL');

    const first = await draft({
      supplierId: supplier,
      locationId: location,
      supplierInvoiceNumber: bill,
      lines: [{ productId: product, quantity: 10, rate: 100 }],
    });
    await purchasePostingService.postEntry(first.id, {}, actor as never);

    const second = await draft({
      supplierId: supplier,
      locationId: location,
      supplierInvoiceNumber: bill,
      lines: [{ productId: product, quantity: 10, rate: 100 }],
    });

    await expectRefusedFor(
      purchasePostingService.postEntry(second.id, {}, actor as never),
      'DUPLICATE_INVOICE',
    );

    // The first delivery is all that reached stock.
    expect(await balanceOf(product, location)).toBe(10);
    expect(
      await scalar('SELECT COUNT(*) AS v FROM purchase_invoices WHERE supplier_id = ?', [supplier]),
    ).toBe(1);
  });

  it('refuses a blocking exception and leaves no stock, no invoice and no ledger entry', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct({ batchTracked: true, expiryTracked: true });

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [
        {
          productId: product,
          quantity: 10,
          rate: 100,
          batchNumber: 'EXPIRED-LOT',
          expiryDate: addDays(-1),
        },
      ],
    });

    await expectRefusedFor(
      purchasePostingService.postEntry(entry.id, {}, actor as never),
      'EXPIRED_GOODS',
    );
    // Accepting it explicitly changes nothing: BLOCKING never posts.
    await expectRefusedFor(
      purchasePostingService.postEntry(
        entry.id,
        { acceptedExceptionCodes: ['EXPIRED_GOODS'] },
        actor as never,
      ),
      'EXPIRED_GOODS',
    );

    expect(await balanceOf(product)).toBe(0);
    expect(
      await scalar('SELECT COUNT(*) AS v FROM stock_ledger WHERE product_id = ?', [product]),
    ).toBe(0);
    expect(
      await scalar('SELECT COUNT(*) AS v FROM purchase_invoices WHERE supplier_id = ?', [supplier]),
    ).toBe(0);
    expect((await ledgerOf(supplier)).length).toBe(0);
    expect(
      await scalar('SELECT COUNT(*) AS v FROM goods_receipts WHERE supplier_id = ?', [supplier]),
    ).toBe(0);
  });

  it('refuses an overridable exception until its code is explicitly accepted', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    // Last paid ₹100; this bill asks ₹200, which is 100% over the 10% tolerance.
    const product = await makeProduct({ lastPurchaseRate: 100 });

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [{ productId: product, quantity: 5, rate: 200 }],
    });

    await expectRefusedFor(
      purchasePostingService.postEntry(entry.id, {}, actor as never),
      'RATE_VARIANCE',
    );
    expect(await balanceOf(product)).toBe(0);

    const result = await purchasePostingService.postEntry(
      entry.id,
      { acceptedExceptionCodes: ['RATE_VARIANCE'], overrideNote: 'Confirmed with the supplier' },
      actor as never,
    );
    expect(result.entry.status).toBe('POSTED');
    expect(await balanceOf(product, location)).toBe(5);
  });

  it('refuses to post the same entry twice', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [{ productId: product, quantity: 4, rate: 25 }],
    });

    await purchasePostingService.postEntry(entry.id, {}, actor as never);
    await expect(purchasePostingService.postEntry(entry.id, {}, actor as never)).rejects.toThrow(
      /already been posted/i,
    );

    expect(await balanceOf(product, location)).toBe(4);
    expect(
      await scalar('SELECT COUNT(*) AS v FROM purchase_invoices WHERE supplier_id = ?', [supplier]),
    ).toBe(1);
  });

  it('keeps the vendor running balance correct across invoice, payment and invoice', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const first = await draft({
      supplierId: supplier,
      locationId: location,
      paymentMethod: 'CREDIT',
      creditDays: 30,
      lines: [{ productId: product, quantity: 10, rate: 100 }],
    });
    const firstResult = await purchasePostingService.postEntry(first.id, {}, actor as never);

    await purchaseEntryService.createPayment(
      {
        supplierId: supplier,
        method: 'BANK',
        amount: 400,
        allocations: [
          { accountsPayableId: firstResult.payable?.id as string, allocatedAmount: 400 },
        ],
      } as never,
      actor as never,
    );

    const second = await draft({
      supplierId: supplier,
      locationId: location,
      paymentMethod: 'CREDIT',
      creditDays: 30,
      lines: [{ productId: product, quantity: 5, rate: 100 }],
    });
    await purchasePostingService.postEntry(second.id, {}, actor as never);

    const ledger = await ledgerOf(supplier);
    expect(ledger.map((row) => Number(row.running_balance))).toEqual([1000, 600, 1100]);

    const [supplierRow] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT account_balance FROM entities WHERE id = ?',
      [supplier],
    );
    expect(Number(supplierRow[0]?.account_balance)).toBe(1100);
  });

  it('charges IGST across a state line and CGST+SGST within one, for the same line', async () => {
    const location = await makeLocation();
    const gst18 = await makeTaxProfile(18);
    const localProduct = await makeProduct({ taxProfileId: gst18 });
    const distantProduct = await makeProduct({ taxProfileId: gst18 });

    const local = await draft({
      supplierId: await makeSupplier({ stateCode: HOME_STATE }),
      locationId: location,
      lines: [{ productId: localProduct, quantity: 10, rate: 100 }],
    });
    const distant = await draft({
      supplierId: await makeSupplier({ stateCode: '29' }),
      locationId: location,
      lines: [{ productId: distantProduct, quantity: 10, rate: 100 }],
    });

    const localLine = local.lines?.[0];
    expect(local.isInterState).toBe(false);
    expect(localLine?.taxableAmount).toBe(1000);
    expect(localLine?.cgstAmount).toBe(90);
    expect(localLine?.sgstAmount).toBe(90);
    expect(localLine?.igstAmount).toBe(0);
    expect(local.totalAmount).toBe(1180);

    const distantLine = distant.lines?.[0];
    expect(distant.isInterState).toBe(true);
    expect(distantLine?.taxableAmount).toBe(1000);
    expect(distantLine?.igstAmount).toBe(180);
    expect(distantLine?.cgstAmount).toBe(0);
    expect(distantLine?.sgstAmount).toBe(0);
    expect(distant.totalAmount).toBe(1180);

    // And the split survives the post onto the invoice snapshot.
    const posted = await purchasePostingService.postEntry(distant.id, {}, actor as never);
    expect(posted.invoice?.isInterState).toBe(true);
    expect(posted.invoice?.igstAmount).toBe(180);
    expect(posted.invoice?.cgstAmount).toBe(0);
  });

  it('replays a retried post under the same idempotency key instead of posting twice', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();
    const key = unique('IDEM');

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [{ productId: product, quantity: 8, rate: 50 }],
    });

    const first = await purchasePostingService.postEntry(entry.id, {}, actor as never, {
      idempotencyKey: key,
    });
    const replay = await purchasePostingService.postEntry(entry.id, {}, actor as never, {
      idempotencyKey: key,
    });

    expect(replay.invoice?.id).toBe(first.invoice?.id);
    expect(await balanceOf(product, location)).toBe(8);
    expect(
      await scalar('SELECT COUNT(*) AS v FROM purchase_invoices WHERE supplier_id = ?', [supplier]),
    ).toBe(1);
  });

  it('previews what a post would do without doing any of it', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct({ lastPurchaseRate: 100 });

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [{ productId: product, quantity: 5, rate: 200 }],
    });

    const preview = await purchasePostingService.preview(entry.id);
    expect(preview.computedTotal).toBe(1000);
    expect(preview.willCreateInvoice).toBe(true);
    expect(preview.willCreatePayment).toBe(true);
    expect(preview.stockMovementCount).toBe(1);
    expect(preview.overridable.map((e) => e.code)).toContain('RATE_VARIANCE');
    expect(preview.blocking).toHaveLength(0);

    expect(await balanceOf(product)).toBe(0);
    expect(
      await scalar('SELECT COUNT(*) AS v FROM purchase_invoices WHERE supplier_id = ?', [supplier]),
    ).toBe(0);
  });

  it('recomputes the total server-side and disagrees with a supplier bill that does not add up', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      supplierTotalAmount: 1500,
      lines: [{ productId: product, quantity: 10, rate: 100 }],
    });

    expect(entry.totalAmount).toBe(1000);
    expect(entry.supplierTotalAmount).toBe(1500);
    expect(entry.exceptions?.map((e) => e.code)).toContain('TOTAL_MISMATCH');

    await expectRefusedFor(
      purchasePostingService.postEntry(entry.id, {}, actor as never),
      'TOTAL_MISMATCH',
    );

    const result = await purchasePostingService.postEntry(
      entry.id,
      { acceptedExceptionCodes: ['TOTAL_MISMATCH'] },
      actor as never,
    );
    // Ours is what posts. Theirs is only ever recorded.
    expect(result.invoice?.totalAmount).toBe(1000);
    expect(result.payable?.originalAmount).toBe(1000);
  });

  it('builds the document flow from the documents that actually exist', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [{ productId: product, quantity: 2, rate: 100 }],
    });

    const before = await purchaseEntryService.documentFlow(entry.id);
    expect(before.nodes.map((n) => n.documentType)).toEqual(['PURCHASE_ENTRY']);

    await purchasePostingService.postEntry(entry.id, {}, actor as never);
    const after = await purchaseEntryService.documentFlow(entry.id);
    const types = after.nodes.map((n) => n.documentType);
    expect(types).toContain('GOODS_RECEIPT');
    expect(types).toContain('PURCHASE_INVOICE');
    expect(types).toContain('VENDOR_LEDGER');
    expect(types).toContain('ACCOUNTS_PAYABLE');
    expect(types).toContain('VENDOR_PAYMENT');
    expect(after.nodes.every((n) => n.documentNumber !== '' && n.href !== null)).toBe(true);
  });

  it('shows the posted entry on the register with its generated document numbers', async () => {
    const supplier = await makeSupplier();
    const location = await makeLocation();
    const product = await makeProduct();

    const entry = await draft({
      supplierId: supplier,
      locationId: location,
      lines: [{ productId: product, quantity: 3, rate: 100 }],
    });
    const result = await purchasePostingService.postEntry(entry.id, {}, actor as never);

    const register = await purchaseEntryService.register({ supplierId: supplier } as never);
    expect(register.items).toHaveLength(1);
    const row = register.items[0];
    expect(row?.entryNumber).toBe(entry.entryNumber);
    expect(row?.grnNumber).toBe(result.goodsReceipt?.grnNumber);
    expect(row?.invoiceNumber).toBe(result.invoice?.invoiceNumber);
    expect(row?.paymentStatus).toBe('PAID');
    expect(row?.totalQuantity).toBe(3);

    const totals = await purchaseEntryService.registerTotals({ supplierId: supplier } as never);
    expect(totals.entryCount).toBe(1);
    expect(totals.totalAmount).toBe(300);
    expect(totals.paidAmount).toBe(300);
    expect(totals.outstandingAmount).toBe(0);
  });
});
