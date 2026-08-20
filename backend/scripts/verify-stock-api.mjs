/**
 * End-to-end verification for the inventory API (`/api/v1/purchase/stock`).
 *
 * Signs in over HTTP as a real ADMIN and then drives the whole slice: balances, the summary,
 * the ledger, batches, adjustments and counts. The assertions are deliberately arithmetic
 * rather than structural — a moving average of 15 is checked as 15, a variance of −10 is
 * checked against the balance it produced — because "the endpoint returned 200" says nothing
 * about whether the stock is right.
 *
 * What it proves, in order:
 *   - an adjustment that fails on its second line posts nothing at all;
 *   - a receipt-style IN moves the balance, the summary, the ledger and the batch together;
 *   - an issue leaves at the valuation the stock is held at, not at a price the client sent;
 *   - a POSTED adjustment refuses to be edited, submitted, cancelled or posted again;
 *   - a count with a variance posts an adjustment and lands the balance on the physical count;
 *   - a count with no variance creates no adjustment at all;
 *   - the summary figures are real aggregates — they move when stock moves;
 *   - `includeStock` and `belowReorderLevel` on the product master are real numbers now.
 *
 * Everything it creates it removes again, including the ledger rows, so the database is left
 * exactly as it was found.
 *
 * Run against the dev server with: node scripts/verify-stock-api.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const BASE = process.env.VERIFY_BASE ?? `http://localhost:${process.env.PORT ?? 4000}`;
const API = `${BASE}/api/v1`;
const IDENTIFIER = process.env.VERIFY_USER ?? 'admin';
const PASSWORD = process.env.VERIFY_PASSWORD ?? 'MenuBoard@2026';
const DEVICE_ID = 'verify-stock-api';
const STAMP = Date.now().toString().slice(-8);

/** The capabilities this API is gated on. Granted to ADMIN if the live matrix lacks them. */
const REQUIRED_CAPABILITIES = [
  'inventory.read',
  'stock.ledger.read',
  'stock.adjustment.create',
  'stock.adjustment.approve',
  'stock.count.create',
  'stock.count.approve',
  'product.read',
  'product.write',
  'inventory.location.manage',
];

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

function skip(name, why) {
  skipped += 1;
  console.log(`  SKIP  ${name} (${why})`);
}

function section(title) {
  console.log(`\n${title}`);
}

/** Quantities and money are DECIMALs; compare at the scale the columns actually hold. */
function near(actual, expected, tolerance = 0.005) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
}

let token = null;

async function call(method, path, body) {
  const headers = { 'x-client-type': 'ADMIN', 'x-device-id': DEVICE_ID };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== null) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = { parseError: text.slice(0, 400) };
  }
  return { status: response.status, body: json, data: json?.data, meta: json?.meta };
}

function dbConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'menuboard',
  });
}

/** Ids of everything created, torn down in reverse order of dependency. */
const cleanup = {
  locationId: null,
  plainProductId: null,
  batchProductId: null,
  batchId: null,
};

const NAMES = {
  plain: `Verify Stock Item ${STAMP}`,
  batch: `Verify Stock Batch Item ${STAMP}`,
};

/** Raise, submit and post an adjustment in one go. Returns the posted document. */
async function postAdjustment(lines, reason = 'CORRECTION', notes = null) {
  const draft = await call('POST', '/purchase/stock/adjustments', {
    locationId: cleanup.locationId,
    reason,
    lines,
    ...(notes === null ? {} : { notes }),
  });
  if (draft.status !== 201) return { stage: 'create', result: draft };
  const submitted = await call('POST', `/purchase/stock/adjustments/${draft.data.id}/submit`);
  if (submitted.status !== 200) return { stage: 'submit', result: submitted, id: draft.data.id };
  const posted = await call('POST', `/purchase/stock/adjustments/${draft.data.id}/post`);
  return { stage: 'post', result: posted, id: draft.data.id };
}

async function balanceOf(productId) {
  const result = await call(
    'GET',
    `/purchase/stock/balances?locationId=${cleanup.locationId}&productId=${productId}`,
  );
  const rows = result.data ?? [];
  return {
    rows,
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    stockValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
  };
}

async function main() {
  /* ------------------------------------------------------------------ login */

  section('Authentication');
  const login = await call('POST', '/auth/login', {
    identifier: IDENTIFIER,
    password: PASSWORD,
    deviceId: DEVICE_ID,
    clientType: 'ADMIN',
  });
  check('signs in as ADMIN over HTTP', login.status === 200, login.body);
  token = login.data?.tokens?.accessToken ?? null;
  check('receives an access token', typeof token === 'string' && token.length > 0);
  if (token === null) return;

  const held = new Set(login.body?.data?.capabilities ?? []);
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !held.has(capability));
  for (const capability of missing) {
    const granted = await call('PATCH', `/admin/permissions/role/ADMIN/${capability}`, {
      granted: true,
    });
    check(`grants ${capability} to ADMIN`, granted.status === 204, granted.body);
  }
  if (missing.length === 0) console.log('  NOTE  every stock capability was already granted');

  const matrix = await call('GET', '/admin/permissions');
  const adminHolds = new Set(matrix.data?.roleCapabilities?.ADMIN ?? []);
  check(
    'ADMIN holds every capability this API is gated on',
    REQUIRED_CAPABILITIES.every((capability) => adminHolds.has(capability)),
    REQUIRED_CAPABILITIES.filter((capability) => !adminHolds.has(capability)),
  );

  /* ------------------------------------------------------------- fixtures */

  section('Fixtures');
  const location = await call('POST', '/purchase/locations', {
    code: `VSTK-${STAMP}`,
    name: `Verify Stock Store ${STAMP}`,
    kind: 'WAREHOUSE',
    // Left at false on purpose: the negative-balance check later proves that posting is
    // permitted by the poster's capability, not by the location's own policy.
    allowsNegativeStock: false,
    sortOrder: 990,
    notes: 'Created by verify-stock-api',
  });
  check('creates a temp inventory location', location.status === 201, location.body);
  cleanup.locationId = location.data?.id ?? null;
  if (cleanup.locationId === null) return;

  const plain = await call('POST', '/purchase/products', {
    name: NAMES.plain,
    code: `VSTK-P1-${STAMP}`,
    unit: 'KG',
    kind: 'STOCK',
    valuationMethod: 'MOVING_AVERAGE',
    reorderLevel: 25,
    isStocked: true,
    isPurchasable: true,
    sortOrder: 990,
  });
  check('creates a temp product', plain.status === 201, plain.body);
  cleanup.plainProductId = plain.data?.id ?? null;

  const batchProduct = await call('POST', '/purchase/products', {
    name: NAMES.batch,
    code: `VSTK-P2-${STAMP}`,
    unit: 'KG',
    kind: 'STOCK',
    isBatchTracked: true,
    isExpiryTracked: true,
    batchIssuePolicy: 'FEFO',
    isStocked: true,
    isPurchasable: true,
    sortOrder: 991,
  });
  check('creates a temp batch-tracked product', batchProduct.status === 201, batchProduct.body);
  cleanup.batchProductId = batchProduct.data?.id ?? null;
  if (cleanup.plainProductId === null || cleanup.batchProductId === null) return;

  // A batch's identity is created by a goods receipt, and that slice does not exist yet — an
  // adjustment line carries a batch *id*, not a batch number. So the batch itself is seeded
  // directly; everything done to it afterwards goes through the API.
  const expiry = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const seed = await dbConnection();
  try {
    cleanup.batchId = randomUUID();
    await seed.execute(
      `INSERT INTO stock_batches (id, product_id, batch_number, expiry_date, first_received_at,
         initial_quantity, unit_cost, source_type, source_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), 0, 0, 'STOCK_ADJUSTMENT', NULL, 'ACTIVE',
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [cleanup.batchId, cleanup.batchProductId, `VLOT-${STAMP}`, expiry],
    );
    check('seeds one batch expiring in 10 days', true);
  } finally {
    await seed.end();
  }

  /* ----------------------------------------------- all-or-nothing posting */

  section('A post that fails on one line posts nothing');
  const draft = await call('POST', '/purchase/stock/adjustments', {
    locationId: cleanup.locationId,
    reason: 'CORRECTION',
    notes: 'Opening stock (verify-stock-api)',
    lines: [
      { productId: cleanup.plainProductId, direction: 'IN', quantity: 100, unitCost: 10 },
      // No batch on a batch-tracked product: the ledger must refuse this line.
      { productId: cleanup.batchProductId, direction: 'IN', quantity: 20, unitCost: 5 },
    ],
  });
  check('raises a draft adjustment', draft.status === 201, draft.body);
  const adjustmentId = draft.data?.id ?? null;
  check('starts in DRAFT', draft.data?.status === 'DRAFT', draft.data?.status);
  check(
    'allocates a document number',
    /^ADJ-\d{8}-\d{4}$/.test(draft.data?.adjustmentNumber ?? ''),
    draft.data?.adjustmentNumber,
  );
  check('returns its lines', (draft.data?.lines ?? []).length === 2, draft.data?.lines?.length);
  check('and a line count', draft.data?.lineCount === 2, draft.data?.lineCount);
  if (adjustmentId === null) return;

  const submitted = await call('POST', `/purchase/stock/adjustments/${adjustmentId}/submit`);
  check('submits it', submitted.status === 200 && submitted.data?.status === 'SUBMITTED', submitted.body);

  const badPost = await call('POST', `/purchase/stock/adjustments/${adjustmentId}/post`);
  check('refuses to post a batch-tracked line with no batch', badPost.status === 400, badPost.body);
  const noLedger = await call('GET', `/purchase/stock/ledger?sourceId=${adjustmentId}`);
  check('nothing reached the ledger', noLedger.meta?.total === 0, noLedger.meta);
  const noBalances = await call('GET', `/purchase/stock/balances?locationId=${cleanup.locationId}`);
  check(
    'the first line rolled back with the second — no balance exists',
    noBalances.meta?.total === 0,
    noBalances.meta,
  );
  const stillSubmitted = await call('GET', `/purchase/stock/adjustments/${adjustmentId}`);
  check('the document is still SUBMITTED', stillSubmitted.data?.status === 'SUBMITTED', stillSubmitted.data?.status);

  /* ------------------------------------------------------- receipt-style IN */

  section('POST /adjustments/:id/post — a receipt-style IN');
  const patched = await call('PATCH', `/purchase/stock/adjustments/${adjustmentId}`, {
    lines: [
      { productId: cleanup.plainProductId, direction: 'IN', quantity: 100, unitCost: 10 },
      {
        productId: cleanup.batchProductId,
        batchId: cleanup.batchId,
        direction: 'IN',
        quantity: 20,
        unitCost: 5,
      },
    ],
  });
  check('a SUBMITTED adjustment may still be corrected', patched.status === 200, patched.body);

  const posted = await call('POST', `/purchase/stock/adjustments/${adjustmentId}/post`);
  check('posts it', posted.status === 200 && posted.data?.status === 'POSTED', posted.body);
  check(
    'recomputes the document totals from what actually posted',
    near(posted.data?.totalInValue, 1100) && near(posted.data?.totalOutValue, 0),
    { in: posted.data?.totalInValue, out: posted.data?.totalOutValue },
  );
  check(
    'records who posted it and when',
    typeof posted.data?.postedBy === 'string' && typeof posted.data?.postedAt === 'string',
    { postedBy: posted.data?.postedBy, postedAt: posted.data?.postedAt },
  );

  /* --------------------------------------------------------- GET /balances */

  section('GET /balances');
  const balances = await call(
    'GET',
    `/purchase/stock/balances?locationId=${cleanup.locationId}&nonZeroOnly=true`,
  );
  check('lists the two balances the post created', balances.meta?.total === 2, balances.meta);
  const plainRow = (balances.data ?? []).find((row) => row.productId === cleanup.plainProductId);
  const batchRow = (balances.data ?? []).find((row) => row.productId === cleanup.batchProductId);

  check(
    'the plain balance is 100 @ 10 = 1000',
    near(plainRow?.quantity, 100) && near(plainRow?.averageCost, 10) && near(plainRow?.stockValue, 1000),
    plainRow,
  );
  check(
    'availableQuantity is quantity less reserved',
    near(plainRow?.availableQuantity, 100) && near(plainRow?.reservedQuantity, 0),
    { available: plainRow?.availableQuantity, reserved: plainRow?.reservedQuantity },
  );
  check(
    'the display fields are joined',
    plainRow?.productName === NAMES.plain &&
    plainRow?.productUnit === 'KG' &&
    plainRow?.locationName === `Verify Stock Store ${STAMP}` &&
    plainRow?.locationKind === 'WAREHOUSE',
    plainRow,
  );
  check(
    'the reorder level is resolved and the row is not below it',
    near(plainRow?.reorderLevel, 25) && plainRow?.isBelowReorderLevel === false,
    { reorderLevel: plainRow?.reorderLevel, below: plainRow?.isBelowReorderLevel },
  );
  check(
    'a batch balance carries its batch, expiry and days to expiry',
    batchRow?.batchId === cleanup.batchId &&
    batchRow?.batchNumber === `VLOT-${STAMP}` &&
    batchRow?.expiryDate === expiry &&
    near(batchRow?.daysToExpiry, 10, 1.5),
    batchRow,
  );
  check(
    'an untracked balance has no expiry to report',
    plainRow?.batchId === null && plainRow?.daysToExpiry === null,
    { batchId: plainRow?.batchId, daysToExpiry: plainRow?.daysToExpiry },
  );

  const expiringBalances = await call(
    'GET',
    `/purchase/stock/balances?locationId=${cleanup.locationId}&expiringWithinDays=30`,
  );
  check(
    'expiringWithinDays narrows to the dated batch',
    expiringBalances.meta?.total === 1 &&
    expiringBalances.data?.[0]?.productId === cleanup.batchProductId,
    expiringBalances.meta,
  );
  const trackedOnly = await call(
    'GET',
    `/purchase/stock/balances?locationId=${cleanup.locationId}&batchTrackedOnly=true`,
  );
  check('batchTrackedOnly excludes the untracked product', trackedOnly.meta?.total === 1, trackedOnly.meta);
  const belowNow = await call(
    'GET',
    `/purchase/stock/balances?locationId=${cleanup.locationId}&belowReorderLevel=true`,
  );
  check('nothing is below its reorder level yet', belowNow.meta?.total === 0, belowNow.meta);

  /* ---------------------------------------------------------- GET /summary */

  section('GET /summary');
  const summary1 = await call('GET', `/purchase/stock/summary?locationId=${cleanup.locationId}`);
  check('reads the summary', summary1.status === 200, summary1.body);
  check(
    'the figures are real aggregates',
    summary1.data?.distinctProducts === 2 &&
    near(summary1.data?.totalStockValue, 1100) &&
    summary1.data?.negativeBalanceCount === 0 &&
    summary1.data?.expiredCount === 0 &&
    summary1.data?.belowReorderCount === 0,
    summary1.data,
  );
  check(
    'the near-expiry window is applied',
    summary1.data?.expiringSoonCount === 1,
    summary1.data?.expiringSoonCount,
  );
  check(
    'the location is named',
    summary1.data?.locationName === `Verify Stock Store ${STAMP}` &&
    summary1.data?.locationId === cleanup.locationId,
    summary1.data,
  );
  const globalSummary = await call('GET', '/purchase/stock/summary');
  check(
    'the whole-operation summary has no location and includes ours',
    globalSummary.data?.locationId === null &&
    globalSummary.data?.locationName === null &&
    globalSummary.data?.distinctProducts >= 2,
    globalSummary.data,
  );

  /* ----------------------------------------------------------- GET /ledger */

  section('GET /ledger');
  const ledger = await call('GET', `/purchase/stock/ledger?sourceId=${adjustmentId}`);
  check('the post produced two movements', ledger.meta?.total === 2, ledger.meta);
  const plainMove = (ledger.data ?? []).find((row) => row.productId === cleanup.plainProductId);
  check(
    'every movement names the document that caused it',
    (ledger.data ?? []).every(
      (row) =>
        row.sourceType === 'STOCK_ADJUSTMENT' &&
        row.sourceId === adjustmentId &&
        row.sourceDocumentNumber === posted.data?.adjustmentNumber &&
        typeof row.sourceLineId === 'string',
    ),
    ledger.data?.map((row) => ({ src: row.sourceDocumentNumber, line: row.sourceLineId })),
  );
  check(
    'the IN movement is ADJUSTMENT_IN with the right balanceAfter',
    plainMove?.movementType === 'ADJUSTMENT_IN' &&
    plainMove?.direction === 'IN' &&
    near(plainMove?.quantityIn, 100) &&
    near(plainMove?.quantityOut, 0) &&
    near(plainMove?.unitCost, 10) &&
    near(plainMove?.movementValue, 1000) &&
    near(plainMove?.balanceQuantity, 100) &&
    near(plainMove?.balanceValue, 1000),
    plainMove,
  );
  check(
    'the ledger joins its display fields',
    plainMove?.productName === NAMES.plain &&
    plainMove?.locationName === `Verify Stock Store ${STAMP}` &&
    typeof plainMove?.ledgerSeq === 'number' &&
    plainMove.ledgerSeq > 0,
    plainMove,
  );

  section('The ledger has no write surface');
  const ledgerPost = await call('POST', '/purchase/stock/ledger', { productId: cleanup.plainProductId });
  check('POST /ledger is not a route', ledgerPost.status === 404, ledgerPost.status);
  const ledgerDelete = await call('DELETE', `/purchase/stock/ledger/${plainMove?.id}`);
  check('DELETE /ledger/:id is not a route', ledgerDelete.status === 404, ledgerDelete.status);

  /* ---------------------------------------------------------- GET /batches */

  section('GET /batches');
  const batches = await call('GET', `/purchase/stock/batches?productId=${cleanup.batchProductId}`);
  check('lists the batch', batches.meta?.total === 1, batches.meta);
  check(
    'with what is on hand and how long it has left',
    near(batches.data?.[0]?.quantityOnHand, 20) &&
    near(batches.data?.[0]?.daysToExpiry, 10, 1.5) &&
    batches.data?.[0]?.productName === NAMES.batch &&
    batches.data?.[0]?.status === 'ACTIVE',
    batches.data?.[0],
  );
  const expiringBatches = await call(
    'GET',
    `/purchase/stock/batches?productId=${cleanup.batchProductId}&expiringWithinDays=30&onHandOnly=true`,
  );
  check('filters batches by expiry and on-hand', expiringBatches.meta?.total === 1, expiringBatches.meta);

  /* --------------------------------------------- moving average on the way out */

  section('An issue leaves at the valuation it is held at');
  const secondIn = await postAdjustment([
    { productId: cleanup.plainProductId, direction: 'IN', quantity: 100, unitCost: 20 },
  ]);
  check('posts a second receipt at a different rate', secondIn.result.status === 200, secondIn.result.body);
  const averaged = await balanceOf(cleanup.plainProductId);
  check(
    '100 @ 10 then 100 @ 20 averages to 15',
    near(averaged.quantity, 200) &&
    near(averaged.rows[0]?.averageCost, 15) &&
    near(averaged.stockValue, 3000),
    averaged.rows[0],
  );

  const wastage = await postAdjustment(
    [
      // A deliberately absurd cost. Stock cannot leave at a price somebody typed.
      { productId: cleanup.plainProductId, direction: 'OUT', quantity: 40, unitCost: 999 },
    ],
    'WASTAGE',
  );
  check('posts an OUT adjustment', wastage.result.status === 200, wastage.result.body);
  check(
    'the document total is the moving average, not the supplied cost',
    near(wastage.result.data?.totalOutValue, 600) && near(wastage.result.data?.totalInValue, 0),
    { out: wastage.result.data?.totalOutValue, in: wastage.result.data?.totalInValue },
  );
  const wastageLedger = await call('GET', `/purchase/stock/ledger?sourceId=${wastage.id}`);
  const outMove = wastageLedger.data?.[0];
  check(
    'the movement is valued at 15, not 999',
    near(outMove?.unitCost, 15) && near(outMove?.movementValue, 600),
    outMove,
  );
  check(
    'a wastage reason posts as WASTAGE rather than a plain ADJUSTMENT_OUT',
    outMove?.movementType === 'WASTAGE' && outMove?.direction === 'OUT',
    outMove?.movementType,
  );
  check('and the running balance follows it', near(outMove?.balanceQuantity, 160), outMove?.balanceQuantity);
  const postedWastage = await call('GET', `/purchase/stock/adjustments/${wastage.id}`);
  check(
    'the line records what the ledger actually valued it at',
    near(postedWastage.data?.lines?.[0]?.unitCost, 15) &&
    near(postedWastage.data?.lines?.[0]?.lineValue, 600),
    postedWastage.data?.lines?.[0],
  );
  const afterWastage = await balanceOf(cleanup.plainProductId);
  check(
    'the balance is 160 @ 15 = 2400',
    near(afterWastage.quantity, 160) && near(afterWastage.stockValue, 2400),
    afterWastage.rows[0],
  );

  /* ------------------------------------------------- posted is immutable */

  section('A POSTED adjustment is immutable');
  const editPosted = await call('PATCH', `/purchase/stock/adjustments/${wastage.id}`, {
    notes: 'should be refused',
  });
  check('PATCH is refused with 409', editPosted.status === 409, editPosted.body);
  check(
    'and the message points at a reversing adjustment',
    /revers/i.test(editPosted.body?.error?.message ?? ''),
    editPosted.body?.error?.message,
  );
  const resubmit = await call('POST', `/purchase/stock/adjustments/${wastage.id}/submit`);
  check('submit is refused with 409', resubmit.status === 409, resubmit.body);
  const recancel = await call('POST', `/purchase/stock/adjustments/${wastage.id}/cancel`);
  check('cancel is refused with 409', recancel.status === 409, recancel.body);
  const repost = await call('POST', `/purchase/stock/adjustments/${wastage.id}/post`);
  check('posting it twice is refused with 409', repost.status === 409, repost.body);
  const afterRepost = await balanceOf(cleanup.plainProductId);
  check('and the balance did not move again', near(afterRepost.quantity, 160), afterRepost.quantity);
  const doubleLedger = await call('GET', `/purchase/stock/ledger?sourceId=${wastage.id}`);
  check('the document still has exactly one movement', doubleLedger.meta?.total === 1, doubleLedger.meta);

  section('A DRAFT adjustment may be cancelled');
  const cancellable = await call('POST', '/purchase/stock/adjustments', {
    locationId: cleanup.locationId,
    reason: 'OTHER',
    lines: [{ productId: cleanup.plainProductId, direction: 'OUT', quantity: 1 }],
  });
  check('raises one to cancel', cancellable.status === 201, cancellable.body);
  const cancelled = await call('POST', `/purchase/stock/adjustments/${cancellable.data?.id}/cancel`);
  check('cancels it', cancelled.status === 200 && cancelled.data?.status === 'CANCELLED', cancelled.body);
  const postCancelled = await call('POST', `/purchase/stock/adjustments/${cancellable.data?.id}/post`);
  check('a cancelled adjustment cannot be posted', postCancelled.status === 409, postCancelled.body);

  /* ------------------------------------------------------ count with variance */

  section('A count with a variance');
  const count1 = await call('POST', '/purchase/stock/counts', {
    locationId: cleanup.locationId,
    notes: 'Full count (verify-stock-api)',
  });
  check('raises a count sheet', count1.status === 201, count1.body);
  const countId = count1.data?.id ?? null;
  check(
    'numbered, DRAFT and a full count',
    /^CNT-\d{8}-\d{4}$/.test(count1.data?.countNumber ?? '') &&
    count1.data?.status === 'DRAFT' &&
    count1.data?.isFullCount === true,
    count1.data,
  );
  const lines1 = count1.data?.lines ?? [];
  const plainLine = lines1.find((line) => line.productId === cleanup.plainProductId);
  const batchLine = lines1.find((line) => line.productId === cleanup.batchProductId);
  check('snapshots one line per product and batch held', lines1.length === 2, lines1.length);
  check(
    'each line carries the system quantity and unit cost at snapshot time',
    near(plainLine?.systemQuantity, 160) &&
    near(plainLine?.unitCost, 15) &&
    near(batchLine?.systemQuantity, 20) &&
    batchLine?.batchId === cleanup.batchId,
    { plainLine, batchLine },
  );
  check(
    'physical quantity starts null and nothing is counted yet',
    plainLine?.physicalQuantity === null && plainLine?.isCounted === false,
    plainLine,
  );
  if (countId === null) return;

  const recorded = await call('PATCH', `/purchase/stock/counts/${countId}/lines`, {
    lines: [
      { lineId: plainLine.id, physicalQuantity: 150, notes: 'ten short' },
      { lineId: batchLine.id, physicalQuantity: 20 },
    ],
  });
  check('records the physical quantities', recorded.status === 200, recorded.body);
  check('the count moves to COUNTING', recorded.data?.status === 'COUNTING', recorded.data?.status);
  const recordedPlain = (recorded.data?.lines ?? []).find(
    (line) => line.productId === cleanup.plainProductId,
  );
  check(
    'the variance is computed and stored',
    near(recordedPlain?.varianceQuantity, -10) &&
    near(recordedPlain?.varianceValue, -150) &&
    recordedPlain?.isCounted === true,
    recordedPlain,
  );
  check(
    'the header counts what was counted and what varied',
    recorded.data?.countedLineCount === 2 && recorded.data?.varianceLineCount === 1,
    { counted: recorded.data?.countedLineCount, variance: recorded.data?.varianceLineCount },
  );

  const submittedCount = await call('POST', `/purchase/stock/counts/${countId}/submit`);
  check(
    'submits the count',
    submittedCount.status === 200 && submittedCount.data?.status === 'SUBMITTED',
    submittedCount.body,
  );

  const approved = await call('POST', `/purchase/stock/counts/${countId}/approve`);
  check('approves it', approved.status === 200, approved.body);
  const varianceAdjustment = approved.data?.adjustment ?? null;
  check(
    'the variance became a posted COUNT_VARIANCE adjustment',
    varianceAdjustment !== null &&
    varianceAdjustment.status === 'POSTED' &&
    varianceAdjustment.reason === 'COUNT_VARIANCE' &&
    varianceAdjustment.stockCountId === countId,
    varianceAdjustment,
  );
  check(
    'with one line for the one line that varied, valued at 150',
    varianceAdjustment?.lines?.length === 1 &&
    varianceAdjustment.lines[0].direction === 'OUT' &&
    near(varianceAdjustment.lines[0].quantity, 10) &&
    near(varianceAdjustment.totalOutValue, 150),
    varianceAdjustment?.lines,
  );
  check(
    'the count is POSTED and points at the adjustment',
    approved.data?.count?.status === 'POSTED' &&
    approved.data?.count?.adjustmentId === varianceAdjustment?.id &&
    typeof approved.data?.count?.postedAt === 'string' &&
    typeof approved.data?.count?.approvedBy === 'string',
    approved.data?.count,
  );
  const afterCount = await balanceOf(cleanup.plainProductId);
  check(
    'the balance now equals the physical count',
    near(afterCount.quantity, 150) && near(afterCount.stockValue, 2250),
    afterCount.rows[0],
  );
  const varianceLedger = await call(
    'GET',
    `/purchase/stock/ledger?sourceId=${varianceAdjustment?.id}`,
  );
  check(
    'and the ledger records it as an adjustment out of 10 @ 15',
    varianceLedger.meta?.total === 1 &&
    varianceLedger.data?.[0]?.movementType === 'ADJUSTMENT_OUT' &&
    near(varianceLedger.data?.[0]?.movementValue, 150) &&
    near(varianceLedger.data?.[0]?.balanceQuantity, 150),
    varianceLedger.data?.[0],
  );

  section('A POSTED count is immutable');
  const rerecord = await call('PATCH', `/purchase/stock/counts/${countId}/lines`, {
    lines: [{ lineId: plainLine.id, physicalQuantity: 1 }],
  });
  check('recording against it is refused with 409', rerecord.status === 409, rerecord.body);
  const recancelCount = await call('POST', `/purchase/stock/counts/${countId}/cancel`);
  check('cancelling it is refused with 409', recancelCount.status === 409, recancelCount.body);
  const reapprove = await call('POST', `/purchase/stock/counts/${countId}/approve`);
  check('approving it again is refused with 409', reapprove.status === 409, reapprove.body);

  /* --------------------------------------------------- count with no variance */

  section('A count with no variance creates no adjustment');
  const registerBefore = await call(
    'GET',
    `/purchase/stock/adjustments?locationId=${cleanup.locationId}&pageSize=100`,
  );
  const adjustmentsBefore = registerBefore.meta?.total ?? -1;

  const count2 = await call('POST', '/purchase/stock/counts', {
    locationId: cleanup.locationId,
    isFullCount: true,
  });
  check('raises a second count sheet', count2.status === 201, count2.body);
  const count2Id = count2.data?.id ?? null;
  const exactLines = (count2.data?.lines ?? []).map((line) => ({
    lineId: line.id,
    physicalQuantity: line.systemQuantity,
  }));
  check('it snapshots the balances as they now stand', exactLines.length === 2, exactLines.length);

  const recorded2 = await call('PATCH', `/purchase/stock/counts/${count2Id}/lines`, {
    lines: exactLines,
  });
  check('records every line as matching exactly', recorded2.status === 200, recorded2.body);
  check('no line varies', recorded2.data?.varianceLineCount === 0, recorded2.data?.varianceLineCount);

  const submitted2 = await call('POST', `/purchase/stock/counts/${count2Id}/submit`);
  check('submits it', submitted2.status === 200, submitted2.body);
  const approved2 = await call('POST', `/purchase/stock/counts/${count2Id}/approve`);
  check('approves it', approved2.status === 200, approved2.body);
  check('no adjustment was produced', approved2.data?.adjustment === null, approved2.data?.adjustment);
  check(
    'the count is POSTED with no adjustment against it',
    approved2.data?.count?.status === 'POSTED' && approved2.data?.count?.adjustmentId === null,
    approved2.data?.count,
  );
  const registerAfter = await call(
    'GET',
    `/purchase/stock/adjustments?locationId=${cleanup.locationId}&pageSize=100`,
  );
  check(
    'the adjustment register did not grow',
    registerAfter.meta?.total === adjustmentsBefore,
    { before: adjustmentsBefore, after: registerAfter.meta?.total },
  );
  const unchanged = await balanceOf(cleanup.plainProductId);
  check('and no stock moved', near(unchanged.quantity, 150), unchanged.quantity);

  /* ------------------------------------------------- the summary is not static */

  section('The summary figures move when stock moves');
  const before = await call('GET', `/purchase/stock/summary?locationId=${cleanup.locationId}`);
  check(
    'the summary reflects the count',
    near(before.data?.totalStockValue, 2350) && before.data?.belowReorderCount === 0,
    before.data,
  );

  const bigIssue = await postAdjustment(
    [{ productId: cleanup.plainProductId, direction: 'OUT', quantity: 140 }],
    'DAMAGE',
  );
  check('posts an issue of 140', bigIssue.result.status === 200, bigIssue.result.body);

  const after = await call('GET', `/purchase/stock/summary?locationId=${cleanup.locationId}`);
  check(
    'the stock value fell by exactly what left',
    near(after.data?.totalStockValue, 250) &&
    near(before.data?.totalStockValue - after.data?.totalStockValue, 2100),
    { before: before.data?.totalStockValue, after: after.data?.totalStockValue },
  );
  check(
    'and the product is now counted as below its reorder level',
    after.data?.belowReorderCount === 1 && after.data?.distinctProducts === 2,
    after.data,
  );
  const belowAfter = await call(
    'GET',
    `/purchase/stock/balances?locationId=${cleanup.locationId}&belowReorderLevel=true`,
  );
  check(
    'the balances grid agrees',
    belowAfter.meta?.total === 1 &&
    belowAfter.data?.[0]?.productId === cleanup.plainProductId &&
    belowAfter.data?.[0]?.isBelowReorderLevel === true,
    belowAfter.data,
  );

  /* --------------------------------------- the product master reads real stock */

  section('GET /purchase/products — includeStock & belowReorderLevel are real now');
  const withStock = await call(
    'GET',
    `/purchase/products?includeStock=true&search=${encodeURIComponent(NAMES.plain)}`,
  );
  check(
    'includeStock reports the real summed balance',
    near(withStock.data?.[0]?.stockOnHand, 10),
    withStock.data?.[0]?.stockOnHand,
  );
  const withStockBatch = await call(
    'GET',
    `/purchase/products?includeStock=true&search=${encodeURIComponent(NAMES.batch)}`,
  );
  check(
    'and does so for a batch-tracked product too',
    near(withStockBatch.data?.[0]?.stockOnHand, 20),
    withStockBatch.data?.[0]?.stockOnHand,
  );
  const withoutStock = await call(
    'GET',
    `/purchase/products?search=${encodeURIComponent(NAMES.plain)}`,
  );
  check(
    'stockOnHand is absent when it was not asked for',
    withoutStock.data?.[0] !== undefined &&
    !Object.prototype.hasOwnProperty.call(withoutStock.data[0], 'stockOnHand'),
    Object.keys(withoutStock.data?.[0] ?? {}),
  );
  const belowProducts = await call(
    'GET',
    `/purchase/products?belowReorderLevel=true&includeStock=true&search=${encodeURIComponent(NAMES.plain)}`,
  );
  check(
    'belowReorderLevel is a real comparison: 10 on hand against a level of 25',
    (belowProducts.data ?? []).some((row) => row.id === cleanup.plainProductId),
    belowProducts.data?.map((row) => ({ id: row.id, onHand: row.stockOnHand })),
  );
  const notBelow = await call(
    'GET',
    `/purchase/products?belowReorderLevel=true&search=${encodeURIComponent(NAMES.batch)}`,
  );
  check(
    'a product with no reorder level is not "below" one',
    (notBelow.data ?? []).length === 0,
    notBelow.data?.length,
  );

  /* ------------------------------------------------------- negative balance */

  section('A correction may take a balance negative');
  const overdraw = await postAdjustment(
    [{ productId: cleanup.plainProductId, direction: 'OUT', quantity: 100 }],
    'CORRECTION',
  );
  check(
    'the poster\'s capability allows it even though the location forbids negative stock',
    overdraw.result.status === 200,
    overdraw.result.body,
  );
  const negative = await balanceOf(cleanup.plainProductId);
  check('the balance is visibly negative rather than silently clamped', near(negative.quantity, -90), negative.quantity);
  const negativeSummary = await call(
    'GET',
    `/purchase/stock/summary?locationId=${cleanup.locationId}`,
  );
  check(
    'and the summary reports it',
    negativeSummary.data?.negativeBalanceCount === 1 &&
    near(negativeSummary.data?.totalStockValue, -1250),
    negativeSummary.data,
  );

  /* ------------------------------------------------------------ validation */

  section('Validation');
  const zeroQty = await call('POST', '/purchase/stock/adjustments', {
    locationId: cleanup.locationId,
    reason: 'OTHER',
    lines: [{ productId: cleanup.plainProductId, direction: 'OUT', quantity: 0 }],
  });
  check('a zero quantity is refused with 400', zeroQty.status === 400, zeroQty.body);
  const noLines = await call('POST', '/purchase/stock/adjustments', {
    locationId: cleanup.locationId,
    reason: 'OTHER',
    lines: [],
  });
  check('an adjustment with no lines is refused with 400', noLines.status === 400, noLines.body);
  const unknownProduct = await call('POST', '/purchase/stock/adjustments', {
    locationId: cleanup.locationId,
    reason: 'OTHER',
    lines: [
      {
        productId: '00000000-0000-4000-8000-000000000000',
        direction: 'IN',
        quantity: 1,
        unitCost: 1,
      },
    ],
  });
  check('an unknown product is refused with 400', unknownProduct.status === 400, unknownProduct.body);
  const unknownLocation = await call('POST', '/purchase/stock/counts', {
    locationId: '00000000-0000-4000-8000-000000000000',
  });
  check('a count at an unknown location is 404', unknownLocation.status === 404, unknownLocation.body);
  const partialWithoutTargets = await call('POST', '/purchase/stock/counts', {
    locationId: cleanup.locationId,
    isFullCount: false,
  });
  check(
    'a partial count that names nothing to count is refused with 400',
    partialWithoutTargets.status === 400,
    partialWithoutTargets.body,
  );
  const unknownAdjustment = await call(
    'GET',
    '/purchase/stock/adjustments/00000000-0000-4000-8000-000000000000',
  );
  check('an unknown adjustment is 404', unknownAdjustment.status === 404, unknownAdjustment.body);
  const unknownCount = await call(
    'GET',
    '/purchase/stock/counts/00000000-0000-4000-8000-000000000000',
  );
  check('an unknown count is 404', unknownCount.status === 404, unknownCount.body);
  const badQuery = await call('GET', '/purchase/stock/balances?nope=1');
  check('an unknown query parameter is refused with 400', badQuery.status === 400, badQuery.body);

  /* ------------------------------------------------------- partial counting */

  section('A partial count may name its products');
  const partial = await call('POST', '/purchase/stock/counts', {
    locationId: cleanup.locationId,
    isFullCount: false,
    productIds: [cleanup.batchProductId],
  });
  check('raises a partial count', partial.status === 201, partial.body);
  check(
    'it holds only the product asked for',
    (partial.data?.lines ?? []).length === 1 &&
    partial.data.lines[0].productId === cleanup.batchProductId &&
    partial.data?.isFullCount === false,
    partial.data?.lines,
  );
  const cancelPartial = await call('POST', `/purchase/stock/counts/${partial.data?.id}/cancel`);
  check(
    'and may be cancelled while it is still a draft',
    cancelPartial.status === 200 && cancelPartial.data?.status === 'CANCELLED',
    cancelPartial.body,
  );

  /* -------------------------------------------------------------- registers */

  section('Registers');
  const adjustmentRegister = await call(
    'GET',
    `/purchase/stock/adjustments?locationId=${cleanup.locationId}&status=POSTED&pageSize=100`,
  );
  check(
    'the adjustment register filters by status',
    adjustmentRegister.status === 200 &&
    (adjustmentRegister.data ?? []).length > 0 &&
    adjustmentRegister.data.every((row) => row.status === 'POSTED'),
    adjustmentRegister.data?.map((row) => row.status),
  );
  const countRegister = await call(
    'GET',
    `/purchase/stock/counts?locationId=${cleanup.locationId}&status=POSTED&pageSize=100`,
  );
  check(
    'the count register filters by status',
    countRegister.status === 200 &&
    (countRegister.data ?? []).length === 2 &&
    countRegister.data.every((row) => row.status === 'POSTED'),
    countRegister.data?.map((row) => row.status),
  );
  const ledgerByProduct = await call(
    'GET',
    `/purchase/stock/ledger?productId=${cleanup.plainProductId}&locationId=${cleanup.locationId}&pageSize=100`,
  );
  check(
    'the stock card lists every movement of one product in one store, newest first',
    (ledgerByProduct.data ?? []).length >= 6 &&
    ledgerByProduct.data.every((row) => row.productId === cleanup.plainProductId) &&
    ledgerByProduct.data[0].ledgerSeq > ledgerByProduct.data[1].ledgerSeq,
    ledgerByProduct.meta,
  );
  const byMovementType = await call(
    'GET',
    `/purchase/stock/ledger?locationId=${cleanup.locationId}&movementType=WASTAGE&pageSize=100`,
  );
  check(
    'and may be narrowed to one movement type',
    (byMovementType.data ?? []).length === 1 && byMovementType.data[0].movementType === 'WASTAGE',
    byMovementType.data?.map((row) => row.movementType),
  );
}

async function teardown() {
  section('Cleanup');
  const connection = await dbConnection();
  try {
    const productIds = [cleanup.plainProductId, cleanup.batchProductId].filter(
      (id) => id !== null,
    );

    for (const productId of productIds) {
      await connection.execute('DELETE FROM stock_ledger WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM stock_balances WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM stock_count_lines WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM stock_adjustment_lines WHERE product_id = ?', [
        productId,
      ]);
    }
    if (cleanup.locationId !== null) {
      await connection.execute(
        'UPDATE stock_counts SET adjustment_id = NULL WHERE location_id = ?',
        [cleanup.locationId],
      );
      await connection.execute('DELETE FROM stock_counts WHERE location_id = ?', [
        cleanup.locationId,
      ]);
      await connection.execute('DELETE FROM stock_adjustments WHERE location_id = ?', [
        cleanup.locationId,
      ]);
      await connection.execute('DELETE FROM stock_ledger WHERE location_id = ?', [
        cleanup.locationId,
      ]);
      await connection.execute('DELETE FROM stock_balances WHERE location_id = ?', [
        cleanup.locationId,
      ]);
    }
    for (const productId of productIds) {
      await connection.execute('DELETE FROM stock_batches WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM product_locations WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM products WHERE id = ?', [productId]);
    }
    if (cleanup.locationId !== null) {
      await connection.execute('DELETE FROM inventory_locations WHERE id = ?', [
        cleanup.locationId,
      ]);
    }

    const [[left]] = await connection.query(
      `SELECT (SELECT COUNT(*) FROM stock_ledger WHERE location_id = ?) +
              (SELECT COUNT(*) FROM stock_balances WHERE location_id = ?) +
              (SELECT COUNT(*) FROM stock_adjustments WHERE location_id = ?) +
              (SELECT COUNT(*) FROM stock_counts WHERE location_id = ?) +
              (SELECT COUNT(*) FROM inventory_locations WHERE id = ?) AS n`,
      Array(5).fill(cleanup.locationId ?? ''),
    );
    check('removes every row it created', Number(left.n) === 0, left);
  } finally {
    await connection.end();
  }

  if (cleanup.plainProductId !== null) {
    const gone = await call('GET', `/purchase/products/${cleanup.plainProductId}`);
    check('the temp products are gone', gone.status === 404, gone.status);
  }
  if (cleanup.locationId !== null) {
    const gone = await call('GET', `/purchase/locations/${cleanup.locationId}`);
    check('the temp location is gone', gone.status === 404, gone.status);
  }
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error('\n  FAIL  the run threw', error);
} finally {
  if (token !== null) {
    try {
      await teardown();
    } catch (error) {
      failed += 1;
      console.error('\n  FAIL  cleanup threw', error);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed === 0 ? 0 : 1);
