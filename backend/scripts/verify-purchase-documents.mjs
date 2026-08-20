/**
 * Adversarial verification for 007_purchase_documents.
 *
 * Same posture as the inventory core script: it tries to write rows the schema is meant to
 * refuse. The two that matter most are the duplicate supplier bill and the QC quantity
 * invariant — the first is how a business pays the same invoice twice, and the second is how
 * rejected goods quietly become sellable stock.
 *
 * Everything is rolled back. Run: node backend/scripts/verify-purchase-documents.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const c = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
});

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass, detail });
async function rejects(name, sql, params = []) {
  try {
    await c.execute(sql, params);
    ok(name, false, 'the database ACCEPTED it');
  } catch (e) {
    ok(name, true, e.code ?? String(e.message).slice(0, 50));
  }
}

const NOW = new Date().toISOString().slice(0, 23).replace('T', ' ');
const TODAY = NOW.slice(0, 10);

await c.beginTransaction();
try {
  const [[supplier]] = await c.query(
    "SELECT id FROM entities WHERE type = 'VENDOR' AND deleted_at IS NULL LIMIT 1",
  );
  const [[product]] = await c.query('SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1');
  const [[location]] = await c.query('SELECT id FROM inventory_locations LIMIT 1');
  const [[user]] = await c.query('SELECT id FROM users LIMIT 1');
  if (!supplier || !product || !location || !user) {
    throw new Error('needs a vendor, a product, a location and a user to exist');
  }

  const [tables] = await c.query(
    `SELECT TABLE_NAME t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
        ('purchase_entries','purchase_entry_lines','goods_receipts','goods_receipt_lines',
         'goods_receipt_line_destinations','purchase_invoices','purchase_invoice_lines',
         'vendor_ledger_entries','accounts_payable','vendor_payments',
         'vendor_payment_allocations','purchase_exceptions','purchase_price_history')`,
  );
  ok('all thirteen purchase document tables exist', tables.length === 13, `found=${tables.length}`);

  /* ---- the duplicate supplier bill guarantee ---------------------------------------- */
  const billNo = `VERIFY-BILL-${randomUUID().slice(0, 8)}`;
  const inv1 = randomUUID();
  await c.execute(
    `INSERT INTO purchase_invoices (id,invoice_number,daily_sequence,business_date,supplier_id,
       supplier_invoice_number,supplier_invoice_date,total_amount,outstanding_amount,
       created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [inv1, `PI-V-${inv1.slice(0, 6)}`, 9001, TODAY, supplier.id, billNo, TODAY, 100, 100, user.id, NOW, NOW],
  );
  ok('an invoice for a new supplier bill is accepted', true);

  await rejects(
    'rejects the SAME supplier bill number twice — no duplicate liability',
    `INSERT INTO purchase_invoices (id,invoice_number,daily_sequence,business_date,supplier_id,
       supplier_invoice_number,supplier_invoice_date,total_amount,outstanding_amount,
       created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), `PI-V2-${randomUUID().slice(0, 6)}`, 9002, TODAY, supplier.id, billNo, TODAY, 100, 100, user.id, NOW, NOW],
  );

  const [[otherSupplier]] = await c.query(
    "SELECT id FROM entities WHERE type = 'VENDOR' AND id <> ? AND deleted_at IS NULL LIMIT 1",
    [supplier.id],
  );
  if (otherSupplier) {
    await c.execute(
      `INSERT INTO purchase_invoices (id,invoice_number,daily_sequence,business_date,supplier_id,
         supplier_invoice_number,supplier_invoice_date,total_amount,outstanding_amount,
         created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), `PI-V3-${randomUUID().slice(0, 6)}`, 9003, TODAY, otherSupplier.id, billNo, TODAY, 100, 100, user.id, NOW, NOW],
    );
    ok('the same bill number IS allowed for a different supplier', true);
  }

  /* ---- QC quantity integrity --------------------------------------------------------- */
  const entryId = randomUUID();
  await c.execute(
    `INSERT INTO purchase_entries (id,entry_number,daily_sequence,business_date,supplier_id,
       created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [entryId, `PE-V-${entryId.slice(0, 6)}`, 9001, TODAY, supplier.id, user.id, NOW, NOW],
  );

  await c.execute(
    `INSERT INTO purchase_entry_lines (id,entry_id,product_id,quantity,received_quantity,
       accepted_quantity,rejected_quantity,created_at,updated_at)
     VALUES (?,?,?,100,100,90,10,?,?)`,
    [randomUUID(), entryId, product.id, NOW, NOW],
  );
  ok('a line where accepted + rejected equals received is accepted', true);

  await rejects(
    'rejects accepted + rejected EXCEEDING received — rejected goods cannot become stock',
    `INSERT INTO purchase_entry_lines (id,entry_id,product_id,quantity,received_quantity,
       accepted_quantity,rejected_quantity,created_at,updated_at)
     VALUES (?,?,?,100,100,95,10,?,?)`,
    [randomUUID(), entryId, product.id, NOW, NOW],
  );

  await rejects(
    'rejects a line that is neither a product nor a described expense',
    `INSERT INTO purchase_entry_lines (id,entry_id,product_id,description,quantity,created_at,updated_at)
     VALUES (?,?,NULL,NULL,1,?,?)`,
    [randomUUID(), entryId, NOW, NOW],
  );

  await c.execute(
    `INSERT INTO purchase_entry_lines (id,entry_id,product_id,description,quantity,rate,created_at,updated_at)
     VALUES (?,?,NULL,'Freight',1,500,?,?)`,
    [randomUUID(), entryId, NOW, NOW],
  );
  ok('an expense line with a description but no product is accepted', true);

  await rejects(
    'rejects a zero conversion factor, which would silently zero the stock quantity',
    `INSERT INTO purchase_entry_lines (id,entry_id,product_id,quantity,conversion_factor,created_at,updated_at)
     VALUES (?,?,?,1,0,?,?)`,
    [randomUUID(), entryId, product.id, NOW, NOW],
  );

  /* ---- split receiving destinations --------------------------------------------------- */
  const grnId = randomUUID();
  await c.execute(
    `INSERT INTO goods_receipts (id,grn_number,daily_sequence,business_date,receipt_date,
       supplier_id,location_id,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [grnId, `GRN-V-${grnId.slice(0, 6)}`, 9001, TODAY, TODAY, supplier.id, location.id, user.id, NOW, NOW],
  );
  const grnLineId = randomUUID();
  await c.execute(
    `INSERT INTO goods_receipt_lines (id,goods_receipt_id,product_id,received_quantity,
       accepted_quantity,rejected_quantity,created_at,updated_at)
     VALUES (?,?,?,100,100,0,?,?)`,
    [grnLineId, grnId, product.id, NOW, NOW],
  );

  const [[loc2]] = await c.query('SELECT id FROM inventory_locations WHERE id <> ? LIMIT 1', [
    location.id,
  ]);
  await c.execute(
    `INSERT INTO goods_receipt_line_destinations (id,goods_receipt_line_id,location_id,quantity,created_at,updated_at)
     VALUES (?,?,?,60,?,?)`,
    [randomUUID(), grnLineId, location.id, NOW, NOW],
  );
  if (loc2) {
    await c.execute(
      `INSERT INTO goods_receipt_line_destinations (id,goods_receipt_line_id,location_id,quantity,created_at,updated_at)
       VALUES (?,?,?,40,?,?)`,
      [randomUUID(), grnLineId, loc2.id, NOW, NOW],
    );
    ok('one received line splits across two destinations (60 / 40)', true);
  }

  await rejects(
    'rejects the same destination twice on one line',
    `INSERT INTO goods_receipt_line_destinations (id,goods_receipt_line_id,location_id,quantity,created_at,updated_at)
     VALUES (?,?,?,5,?,?)`,
    [randomUUID(), grnLineId, location.id, NOW, NOW],
  );

  await rejects(
    'rejects a zero-quantity destination',
    `INSERT INTO goods_receipt_line_destinations (id,goods_receipt_line_id,location_id,quantity,created_at,updated_at)
     VALUES (?,?,?,0,?,?)`,
    [randomUUID(), grnLineId, loc2?.id ?? location.id, NOW, NOW],
  );

  /* ---- vendor ledger ------------------------------------------------------------------ */
  await c.execute(
    `INSERT INTO vendor_ledger_entries (id,supplier_id,business_date,transaction_type,
       source_type,source_id,credit_amount,running_balance,occurred_at,created_at)
     VALUES (?,?,?,'PURCHASE_INVOICE','purchase_invoice',?,1000,1000,?,?)`,
    [randomUUID(), supplier.id, TODAY, inv1, NOW, NOW],
  );
  ok('a vendor ledger credit is accepted', true);

  await rejects(
    'rejects a ledger entry that is both a debit and a credit',
    `INSERT INTO vendor_ledger_entries (id,supplier_id,business_date,transaction_type,
       source_type,source_id,debit_amount,credit_amount,running_balance,occurred_at,created_at)
     VALUES (?,?,?,'PAYMENT','vendor_payment',?,500,500,0,?,?)`,
    [randomUUID(), supplier.id, TODAY, randomUUID(), NOW, NOW],
  );

  const [ledgerCols] = await c.query(
    `SELECT COLUMN_NAME n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_ledger_entries'
        AND COLUMN_NAME IN ('updated_at','deleted_at','revision')`,
  );
  ok(
    'the vendor ledger is append-only by shape (no updated_at/deleted_at/revision)',
    ledgerCols.length === 0,
    `mutable columns=${ledgerCols.length}`,
  );

  /* ---- accounts payable and allocation ------------------------------------------------ */
  const apId = randomUUID();
  await c.execute(
    `INSERT INTO accounts_payable (id,supplier_id,purchase_invoice_id,document_number,
       invoice_date,original_amount,outstanding_amount,created_at,updated_at)
     VALUES (?,?,?,?,?,1000,1000,?,?)`,
    [apId, supplier.id, inv1, `PI-V-${inv1.slice(0, 6)}`, TODAY, NOW, NOW],
  );
  ok('a payable is created for the invoice', true);

  await rejects(
    'rejects a second payable for the same invoice',
    `INSERT INTO accounts_payable (id,supplier_id,purchase_invoice_id,document_number,
       invoice_date,original_amount,outstanding_amount,created_at,updated_at)
     VALUES (?,?,?,?,?,1000,1000,?,?)`,
    [randomUUID(), supplier.id, inv1, 'DUP', TODAY, NOW, NOW],
  );

  const payId = randomUUID();
  await c.execute(
    `INSERT INTO vendor_payments (id,payment_number,daily_sequence,business_date,supplier_id,
       payment_date,amount,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,600,?,?,?)`,
    [payId, `PAY-V-${payId.slice(0, 6)}`, 9001, TODAY, supplier.id, TODAY, user.id, NOW, NOW],
  );
  await c.execute(
    `INSERT INTO vendor_payment_allocations (id,payment_id,accounts_payable_id,purchase_invoice_id,allocated_amount,created_at)
     VALUES (?,?,?,?,600,?)`,
    [randomUUID(), payId, apId, inv1, NOW],
  );
  ok('a partial payment allocates against the payable', true);

  await rejects(
    'rejects allocating the same payment to the same payable twice',
    `INSERT INTO vendor_payment_allocations (id,payment_id,accounts_payable_id,purchase_invoice_id,allocated_amount,created_at)
     VALUES (?,?,?,?,100,?)`,
    [randomUUID(), payId, apId, inv1, NOW],
  );

  await rejects(
    'rejects a zero-amount payment',
    `INSERT INTO vendor_payments (id,payment_number,daily_sequence,business_date,supplier_id,
       payment_date,amount,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,0,?,?,?)`,
    [randomUUID(), `PAY-Z-${randomUUID().slice(0, 6)}`, 9002, TODAY, supplier.id, TODAY, user.id, NOW, NOW],
  );
} finally {
  await c.rollback();
  await c.end();
}

let failed = 0;
for (const { name, pass, detail } of checks) {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
