/**
 * Post-migration verification for 005_inventory_core.
 *
 * The point of this script is adversarial: it tries to write rows the schema is supposed to
 * make impossible. A constraint that exists but does not bite is worse than no constraint,
 * because it buys false confidence. Every "rejects ..." check below passes only if the
 * database actually refuses the write.
 *
 * Everything it creates is rolled back. Run: node backend/scripts/verify-inventory-core.mjs
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

/** Passes when the write is refused. */
async function rejects(name, sql, params = []) {
  try {
    await c.execute(sql, params);
    ok(name, false, 'the database ACCEPTED it');
  } catch (e) {
    ok(name, true, e.code ?? e.message.slice(0, 60));
  }
}

const NOW = new Date().toISOString().slice(0, 23).replace('T', ' ');
const TODAY = NOW.slice(0, 10);

await c.beginTransaction();
try {
  const [[product]] = await c.query('SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1');
  const [[location]] = await c.query('SELECT id FROM inventory_locations LIMIT 1');
  const [[loc2]] = await c.query('SELECT id FROM inventory_locations WHERE id <> ? LIMIT 1', [
    location.id,
  ]);
  if (!product || !location) throw new Error('needs at least one product and location');

  // ---- tables and columns exist -------------------------------------------------------
  const [tables] = await c.query(
    `SELECT TABLE_NAME t FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('stock_batches','stock_ledger','stock_balances','stock_adjustments',
                           'stock_adjustment_lines','stock_counts','stock_count_lines',
                           'posting_idempotency')`,
  );
  ok('all eight inventory tables exist', tables.length === 8, `found=${tables.length}`);

  // ---- the ledger accepts a well-formed movement --------------------------------------
  const batchId = randomUUID();
  await c.execute(
    `INSERT INTO stock_batches (id,product_id,batch_number,expiry_date,first_received_at,
       initial_quantity,unit_cost,source_type,source_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'GOODS_RECEIPT',?,?,?)`,
    [batchId, product.id, `VERIFY-${batchId.slice(0, 8)}`, '2030-01-01', NOW, 100, 12.5, randomUUID(), NOW, NOW],
  );
  ok('batch insert accepted', true);

  const ledgerId = randomUUID();
  const sourceId = randomUUID();
  await c.execute(
    `INSERT INTO stock_ledger (id,product_id,location_id,batch_id,movement_type,direction,
       quantity_in,quantity_out,unit_cost,movement_value,balance_quantity,balance_value,
       source_type,source_id,occurred_at,business_date,created_at)
     VALUES (?,?,?,?,'PURCHASE_RECEIPT','IN',?,0,?,?,?,?,'GOODS_RECEIPT',?,?,?,?)`,
    [ledgerId, product.id, location.id, batchId, 100, 12.5, 1250, 100, 1250, sourceId, NOW, TODAY, NOW],
  );
  ok('ledger accepts a well-formed IN movement', true);

  const [[seq]] = await c.query('SELECT ledger_seq FROM stock_ledger WHERE id = ?', [ledgerId]);
  ok('ledger_seq auto-assigns a total order', Number(seq.ledger_seq) > 0, `seq=${seq.ledger_seq}`);

  // ---- the ledger refuses malformed movements -----------------------------------------
  await rejects(
    'rejects a movement that is both IN and OUT',
    `INSERT INTO stock_ledger (id,product_id,location_id,movement_type,direction,quantity_in,
       quantity_out,unit_cost,movement_value,balance_quantity,balance_value,source_type,
       source_id,occurred_at,business_date,created_at)
     VALUES (?,?,?,'PURCHASE_RECEIPT','IN',5,5,1,1,1,1,'GOODS_RECEIPT',?,?,?,?)`,
    [randomUUID(), product.id, location.id, randomUUID(), NOW, TODAY, NOW],
  );

  await rejects(
    'rejects an IN movement carrying zero quantity',
    `INSERT INTO stock_ledger (id,product_id,location_id,movement_type,direction,quantity_in,
       quantity_out,unit_cost,movement_value,balance_quantity,balance_value,source_type,
       source_id,occurred_at,business_date,created_at)
     VALUES (?,?,?,'PURCHASE_RECEIPT','IN',0,0,1,1,1,1,'GOODS_RECEIPT',?,?,?,?)`,
    [randomUUID(), product.id, location.id, randomUUID(), NOW, TODAY, NOW],
  );

  await rejects(
    'rejects a direction/quantity contradiction (OUT carrying quantity_in)',
    `INSERT INTO stock_ledger (id,product_id,location_id,movement_type,direction,quantity_in,
       quantity_out,unit_cost,movement_value,balance_quantity,balance_value,source_type,
       source_id,occurred_at,business_date,created_at)
     VALUES (?,?,?,'POS_SALE','OUT',7,0,1,1,1,1,'POS_ORDER',?,?,?,?)`,
    [randomUUID(), product.id, location.id, randomUUID(), NOW, TODAY, NOW],
  );

  await rejects(
    'rejects a movement with no source document',
    `INSERT INTO stock_ledger (id,product_id,location_id,movement_type,direction,quantity_in,
       quantity_out,unit_cost,movement_value,balance_quantity,balance_value,source_type,
       source_id,occurred_at,business_date,created_at)
     VALUES (?,?,?,'PURCHASE_RECEIPT','IN',5,0,1,1,1,1,'GOODS_RECEIPT',NULL,?,?,?)`,
    [randomUUID(), product.id, location.id, NOW, TODAY, NOW],
  );

  await rejects(
    'rejects a movement at a location that does not exist',
    `INSERT INTO stock_ledger (id,product_id,location_id,movement_type,direction,quantity_in,
       quantity_out,unit_cost,movement_value,balance_quantity,balance_value,source_type,
       source_id,occurred_at,business_date,created_at)
     VALUES (?,?,?,'PURCHASE_RECEIPT','IN',5,0,1,1,1,1,'GOODS_RECEIPT',?,?,?,?)`,
    [randomUUID(), product.id, randomUUID(), randomUUID(), NOW, TODAY, NOW],
  );

  // ---- balances: the batch_key invariant ----------------------------------------------
  const balA = randomUUID();
  await c.execute(
    `INSERT INTO stock_balances (id,product_id,location_id,batch_id,batch_key,quantity,
       average_cost,stock_value,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [balA, product.id, location.id, batchId, batchId, 100, 12.5, 1250, NOW, NOW],
  );
  ok('balance accepted for a batch-tracked row', true);

  await rejects(
    'rejects a batch_key that disagrees with batch_id',
    `INSERT INTO stock_balances (id,product_id,location_id,batch_id,batch_key,quantity,created_at,updated_at)
     VALUES (?,?,?,?,'-',1,?,?)`,
    [randomUUID(), product.id, loc2?.id ?? location.id, batchId, NOW, NOW],
  );

  await rejects(
    "rejects an untracked balance whose batch_key is not '-'",
    `INSERT INTO stock_balances (id,product_id,location_id,batch_id,batch_key,quantity,created_at,updated_at)
     VALUES (?,?,?,NULL,'something',1,?,?)`,
    [randomUUID(), product.id, loc2?.id ?? location.id, NOW, NOW],
  );

  await rejects(
    'rejects a duplicate balance for the same product/location/batch',
    `INSERT INTO stock_balances (id,product_id,location_id,batch_id,batch_key,quantity,created_at,updated_at)
     VALUES (?,?,?,?,?,5,?,?)`,
    [randomUUID(), product.id, location.id, batchId, batchId, NOW, NOW],
  );

  // The NULL-batch case is the one a plain nullable UNIQUE would silently allow twice.
  const untrackedLoc = loc2?.id ?? location.id;
  await c.execute(
    `INSERT INTO stock_balances (id,product_id,location_id,batch_id,batch_key,quantity,created_at,updated_at)
     VALUES (?,?,?,NULL,'-',5,?,?)`,
    [randomUUID(), product.id, untrackedLoc, NOW, NOW],
  );
  await rejects(
    'rejects a duplicate untracked balance (the NULL-collision trap)',
    `INSERT INTO stock_balances (id,product_id,location_id,batch_id,batch_key,quantity,created_at,updated_at)
     VALUES (?,?,?,NULL,'-',9,?,?)`,
    [randomUUID(), product.id, untrackedLoc, NOW, NOW],
  );

  await rejects(
    'rejects negative reserved quantity',
    `INSERT INTO stock_balances (id,product_id,location_id,batch_id,batch_key,quantity,reserved_quantity,created_at,updated_at)
     VALUES (?,?,?,NULL,'-',5,-1,?,?)`,
    [randomUUID(), product.id, randomUUID(), NOW, NOW],
  );

  // ---- batch identity ------------------------------------------------------------------
  await rejects(
    'rejects a duplicate batch number for the same product',
    `INSERT INTO stock_batches (id,product_id,batch_number,first_received_at,source_type,created_at,updated_at)
     VALUES (?,?,?,?,'GOODS_RECEIPT',?,?)`,
    [randomUUID(), product.id, `VERIFY-${batchId.slice(0, 8)}`, NOW, NOW, NOW],
  );

  await rejects(
    'rejects an expiry that precedes manufacture',
    `INSERT INTO stock_batches (id,product_id,batch_number,manufacturing_date,expiry_date,
       first_received_at,source_type,created_at,updated_at)
     VALUES (?,?,?,'2030-06-01','2030-01-01',?,'GOODS_RECEIPT',?,?)`,
    [randomUUID(), product.id, `VERIFY2-${randomUUID().slice(0, 8)}`, NOW, NOW, NOW],
  );

  // ---- idempotency ----------------------------------------------------------------------
  const key = `verify-${randomUUID()}`;
  await c.execute(
    `INSERT INTO posting_idempotency (id,idempotency_key,operation,request_hash,created_at)
     VALUES (?,?,'purchase.post',?,?)`,
    [randomUUID(), key, 'a'.repeat(64), NOW],
  );
  await rejects(
    'rejects a replayed idempotency key for the same operation',
    `INSERT INTO posting_idempotency (id,idempotency_key,operation,request_hash,created_at)
     VALUES (?,?,'purchase.post',?,?)`,
    [randomUUID(), key, 'b'.repeat(64), NOW],
  );
  await c.execute(
    `INSERT INTO posting_idempotency (id,idempotency_key,operation,request_hash,created_at)
     VALUES (?,?,'stock.transfer.post',?,?)`,
    [randomUUID(), key, 'c'.repeat(64), NOW],
  );
  ok('the same key is allowed for a different operation', true);

  // ---- immutability is a property of the code, so assert the shape that enables it -----
  const [cols] = await c.query(
    `SELECT COLUMN_NAME n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_ledger'
        AND COLUMN_NAME IN ('updated_at','deleted_at','revision')`,
  );
  ok(
    'the ledger has no updated_at/deleted_at/revision — it is append-only by shape',
    cols.length === 0,
    `mutable columns found=${cols.length}`,
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
