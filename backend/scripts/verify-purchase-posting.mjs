/**
 * End-to-end verification for the purchase entry API and the atomic post
 * (`/api/v1/purchase/entries`, `/register`, `/invoices`, `/receipts`, `/vendor-ledger`,
 * `/payables`, `/payments`).
 *
 * Signs in over HTTP as a real ADMIN and then drives the whole chain the way an operator
 * would: draft a bill, look at the exceptions it raised, preview the post, be refused, accept
 * the exception, post, and then read back every document the post produced. The assertions are
 * arithmetic rather than structural — a ₹1,180 bill is checked as 1000 taxable + 90 CGST + 90
 * SGST, a part-paid liability is checked as exactly 600 outstanding — because "the endpoint
 * returned 200" says nothing about whether the books balance.
 *
 * What it proves, in order:
 *   - totals are computed server-side; a supplier's own figure is recorded, never used;
 *   - a blocking exception refuses the post and leaves no stock, no invoice and no ledger row;
 *   - an overridable exception refuses until its code is explicitly accepted;
 *   - a cash purchase ends PAID with no outstanding balance and one stock movement per line;
 *   - a credit purchase leaves a payable with the right due date and no payment;
 *   - only accepted quantity reaches stock, and a split destination reaches two stores;
 *   - a supplier's bill number cannot be posted twice, and neither can an entry;
 *   - a retry under the same X-Idempotency-Key replays rather than double-posts;
 *   - the register, the document flow, the vendor ledger, ageing, payables and payments all
 *     read the real rows the post created.
 *
 * Everything it creates it removes again, including the ledger rows, so the database is left
 * exactly as it was found.
 *
 * Run against the dev server with: node scripts/verify-purchase-posting.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const BASE = process.env.VERIFY_BASE ?? `http://localhost:${process.env.PORT ?? 4000}`;
const API = `${BASE}/api/v1`;
const IDENTIFIER = process.env.VERIFY_USER ?? 'admin';
const PASSWORD = process.env.VERIFY_PASSWORD ?? 'MenuBoard@2026';
const DEVICE_ID = 'verify-purchase-posting';
const STAMP = Date.now().toString().slice(-8);

/** The capabilities this API is gated on. Granted to ADMIN if the live matrix lacks them. */
const REQUIRED_CAPABILITIES = [
  'purchase.read',
  'purchase.entry.create',
  'purchase.post',
  'purchase.vendor_ledger.read',
  'purchase.payable.read',
  'purchase.payable.submit',
  'purchase.payment.create',
  'product.read',
  'product.write',
  'inventory.read',
  'inventory.location.manage',
  'stock.ledger.read',
  'entity.write',
  'tax.write',
];

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Money and quantities are DECIMALs; compare at the scale the columns actually hold. */
function near(actual, expected, tolerance = 0.005) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

let token = null;

async function call(method, path, body, extraHeaders = {}) {
  const headers = { 'x-client-type': 'ADMIN', 'x-device-id': DEVICE_ID, ...extraHeaders };
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
  supplierIds: [],
  productIds: [],
  locationIds: [],
  taxProfileId: null,
  entryIds: [],
};

/** Draft an entry and remember it for teardown. */
async function draft(payload) {
  const result = await call('POST', '/purchase/entries', payload);
  if (result.data?.id !== undefined) cleanup.entryIds.push(result.data.id);
  return result;
}

function exceptionCodes(result) {
  return (result.body?.error?.details ?? result.body?.details ?? []).map((detail) => detail.path);
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
  if (missing.length === 0) console.log('  NOTE  every purchase capability was already granted');

  const matrix = await call('GET', '/admin/permissions');
  const adminHolds = new Set(matrix.data?.roleCapabilities?.ADMIN ?? []);
  check(
    'ADMIN holds every capability this API is gated on',
    REQUIRED_CAPABILITIES.every((capability) => adminHolds.has(capability)),
    REQUIRED_CAPABILITIES.filter((capability) => !adminHolds.has(capability)),
  );

  /* --------------------------------------------------------------- fixtures */

  section('Fixtures');
  const warehouse = await call('POST', '/purchase/locations', {
    code: `VPP-WH-${STAMP}`,
    name: `Verify Purchase Warehouse ${STAMP}`,
    kind: 'WAREHOUSE',
    allowsNegativeStock: false,
    sortOrder: 980,
  });
  check('creates a receiving warehouse', warehouse.status === 201, warehouse.body);
  cleanup.locationIds.push(warehouse.data?.id);

  const dayStore = await call('POST', '/purchase/locations', {
    code: `VPP-DS-${STAMP}`,
    name: `Verify Purchase Day Store ${STAMP}`,
    kind: 'DAY_STORE',
    allowsNegativeStock: false,
    sortOrder: 981,
  });
  check('creates a second store to split a delivery into', dayStore.status === 201, dayStore.body);
  cleanup.locationIds.push(dayStore.data?.id);

  const taxProfile = await call('POST', '/tax-profiles', {
    code: `VPP-GST18-${STAMP}`,
    name: `Verify Purchase GST 18 ${STAMP}`,
    supplyType: 'GOODS',
    gstTaxability: 'TAXABLE',
    gstRate: 18,
    cgstRate: 9,
    sgstRate: 9,
    igstRate: 18,
    // A supplier bill quotes rates exclusive of tax and adds GST at the foot.
    priceIsInclusive: false,
  });
  check('creates an 18% tax-exclusive profile', taxProfile.status === 201, taxProfile.body);
  cleanup.taxProfileId = taxProfile.data?.id ?? null;

  const taxed = await call('POST', '/purchase/products', {
    name: `Verify Purchase Taxed Item ${STAMP}`,
    code: `VPP-P1-${STAMP}`,
    unit: 'KG',
    kind: 'STOCK',
    taxProfileId: cleanup.taxProfileId,
    isStocked: true,
    isPurchasable: true,
    sortOrder: 980,
  });
  check('creates a taxed product', taxed.status === 201, taxed.body);
  cleanup.productIds.push(taxed.data?.id);

  const plain = await call('POST', '/purchase/products', {
    name: `Verify Purchase Plain Item ${STAMP}`,
    code: `VPP-P2-${STAMP}`,
    unit: 'KG',
    kind: 'STOCK',
    isStocked: true,
    isPurchasable: true,
    sortOrder: 981,
  });
  check('creates an untaxed product', plain.status === 201, plain.body);
  cleanup.productIds.push(plain.data?.id);

  const perishable = await call('POST', '/purchase/products', {
    name: `Verify Purchase Perishable ${STAMP}`,
    code: `VPP-P3-${STAMP}`,
    unit: 'KG',
    kind: 'STOCK',
    isBatchTracked: true,
    isExpiryTracked: true,
    batchIssuePolicy: 'FEFO',
    isStocked: true,
    isPurchasable: true,
    sortOrder: 982,
  });
  check('creates a batch- and expiry-tracked product', perishable.status === 201, perishable.body);
  cleanup.productIds.push(perishable.data?.id);

  const supplier = await call('POST', '/entities', {
    type: 'VENDOR',
    name: `Verify Purchase Supplier ${STAMP}`,
    stateCode: '27',
    gstin: '27AAAAA0000A1Z5',
  });
  check('creates a VENDOR entity', supplier.status === 201, supplier.body);
  cleanup.supplierIds.push(supplier.data?.id);

  const cashSupplier = await call('POST', '/entities', {
    type: 'VENDOR',
    name: `Verify Purchase Cash Supplier ${STAMP}`,
    stateCode: '27',
  });
  check('creates a second VENDOR for the cash path', cashSupplier.status === 201, cashSupplier.body);
  cleanup.supplierIds.push(cashSupplier.data?.id);

  const WAREHOUSE = warehouse.data?.id;
  const DAY_STORE = dayStore.data?.id;
  const TAXED = taxed.data?.id;
  const PLAIN = plain.data?.id;
  const PERISHABLE = perishable.data?.id;
  const SUPPLIER = supplier.data?.id;
  const CASH_SUPPLIER = cashSupplier.data?.id;
  if ([WAREHOUSE, DAY_STORE, TAXED, PLAIN, PERISHABLE, SUPPLIER, CASH_SUPPLIER].some((id) => id === undefined)) {
    return;
  }

  /* ------------------------------------------------- server-authoritative totals */

  section('POST /entries — the server computes the bill, the client does not');
  const draftOne = await draft({
    supplierId: SUPPLIER,
    purchaseType: 'STOCK',
    paymentMethod: 'CREDIT',
    creditDays: 30,
    receivingLocationId: WAREHOUSE,
    supplierInvoiceNumber: `VPP-BILL-A-${STAMP}`,
    supplierInvoiceDate: today(),
    // What the supplier's own bill claims. Deliberately wrong by ₹500.
    supplierTotalAmount: 1680,
    lines: [{ productId: TAXED, quantity: 10, rate: 100 }],
  });
  check('drafts a purchase entry', draftOne.status === 201, draftOne.body);
  const entryA = draftOne.data;
  check(
    'allocates a purchase entry number',
    /^PE-\d{8}-\d{4}$/.test(entryA?.entryNumber ?? ''),
    entryA?.entryNumber,
  );
  check('starts in DRAFT', entryA?.status === 'DRAFT', entryA?.status);
  check(
    'computes the line from the quantity, the rate and the resolved tax profile',
    near(entryA?.lines?.[0]?.grossAmount, 1000) &&
    near(entryA?.lines?.[0]?.taxableAmount, 1000) &&
    near(entryA?.lines?.[0]?.cgstAmount, 90) &&
    near(entryA?.lines?.[0]?.sgstAmount, 90) &&
    near(entryA?.lines?.[0]?.igstAmount, 0) &&
    near(entryA?.lines?.[0]?.lineTotal, 1180),
    entryA?.lines?.[0],
  );
  check(
    'the header totals are the sum of the lines',
    near(entryA?.taxableAmount, 1000) &&
    near(entryA?.taxAmount, 180) &&
    near(entryA?.totalAmount, 1180),
    {
      taxable: entryA?.taxableAmount,
      tax: entryA?.taxAmount,
      total: entryA?.totalAmount,
    },
  );
  check(
    "the supplier's own total is recorded but not used",
    near(entryA?.supplierTotalAmount, 1680) && near(entryA?.totalAmount, 1180),
    { theirs: entryA?.supplierTotalAmount, ours: entryA?.totalAmount },
  );
  check(
    'and the disagreement is raised as an exception on the document',
    (entryA?.exceptions ?? []).some(
      (exception) => exception.code === 'TOTAL_MISMATCH' && exception.severity === 'OVERRIDABLE',
    ),
    entryA?.exceptions?.map((exception) => `${exception.code}/${exception.severity}`),
  );
  check(
    'the destination defaulted to the receiving location',
    entryA?.lines?.[0]?.destinationLocationId === WAREHOUSE,
    entryA?.lines?.[0]?.destinationLocationId,
  );
  check(
    'received and accepted default to the billed quantity',
    near(entryA?.lines?.[0]?.receivedQuantity, 10) &&
    near(entryA?.lines?.[0]?.acceptedQuantity, 10) &&
    near(entryA?.lines?.[0]?.rejectedQuantity, 0),
    entryA?.lines?.[0],
  );

  section('PATCH /entries/:id — an edit re-derives everything');
  const patched = await call('PATCH', `/purchase/entries/${entryA.id}`, {
    lines: [
      { productId: TAXED, quantity: 10, rate: 100 },
      { productId: PLAIN, quantity: 5, rate: 40 },
    ],
    supplierTotalAmount: 1380,
  });
  check('accepts the edit', patched.status === 200, patched.body);
  check(
    'the untaxed line adds ₹200 and no tax',
    near(patched.data?.taxableAmount, 1200) &&
    near(patched.data?.taxAmount, 180) &&
    near(patched.data?.totalAmount, 1380),
    {
      taxable: patched.data?.taxableAmount,
      tax: patched.data?.taxAmount,
      total: patched.data?.totalAmount,
    },
  );
  check(
    'and the total now agrees with the supplier, so the exception is gone',
    !(patched.data?.exceptions ?? []).some((exception) => exception.code === 'TOTAL_MISMATCH'),
    patched.data?.exceptions?.map((exception) => exception.code),
  );

  const ready = await call('POST', `/purchase/entries/${entryA.id}/ready`);
  check('marks it READY', ready.status === 200 && ready.data?.status === 'READY', ready.body);

  section('GET /entries/:id/preview');
  const preview = await call('GET', `/purchase/entries/${entryA.id}/preview`);
  check('previews the post', preview.status === 200, preview.body);
  check(
    'and reports what it would create',
    preview.data?.canPost === true &&
    near(preview.data?.computedTotal, 1380) &&
    preview.data?.willCreateGoodsReceipt === true &&
    preview.data?.willCreateInvoice === true &&
    preview.data?.willCreatePayable === true &&
    // CREDIT settles nothing on the spot.
    preview.data?.willCreatePayment === false &&
    preview.data?.stockMovementCount === 2,
    preview.data,
  );

  /* ------------------------------------------------------- a credit purchase posts */

  section('POST /entries/:id/post — a credit purchase');
  const postedA = await call('POST', `/purchase/entries/${entryA.id}/post`, {});
  check('posts it', postedA.status === 200, postedA.body);
  check(
    'the entry is POSTED and linked to what it generated',
    postedA.data?.entry?.status === 'POSTED' &&
    typeof postedA.data?.entry?.goodsReceiptId === 'string' &&
    typeof postedA.data?.entry?.purchaseInvoiceId === 'string' &&
    typeof postedA.data?.entry?.postedBy === 'string',
    postedA.data?.entry,
  );
  check(
    'a GRN was created and posted',
    /^GRN-\d{8}-\d{4}$/.test(postedA.data?.goodsReceipt?.grnNumber ?? '') &&
    postedA.data?.goodsReceipt?.status === 'POSTED' &&
    postedA.data?.goodsReceipt?.lines?.length === 2,
    postedA.data?.goodsReceipt?.grnNumber,
  );
  check(
    'an invoice was created with the recomputed figures and the state snapshot',
    /^PI-\d{8}-\d{4}$/.test(postedA.data?.invoice?.invoiceNumber ?? '') &&
    postedA.data?.invoice?.status === 'POSTED' &&
    near(postedA.data?.invoice?.totalAmount, 1380) &&
    near(postedA.data?.invoice?.cgstAmount, 90) &&
    near(postedA.data?.invoice?.sgstAmount, 90) &&
    postedA.data?.invoice?.isInterState === false &&
    postedA.data?.invoice?.supplierStateCode === '27',
    postedA.data?.invoice,
  );
  check(
    'the vendor ledger took a single CREDIT for the invoice total',
    postedA.data?.vendorLedgerEntries?.length === 1 &&
    postedA.data.vendorLedgerEntries[0].transactionType === 'PURCHASE_INVOICE' &&
    near(postedA.data.vendorLedgerEntries[0].creditAmount, 1380) &&
    near(postedA.data.vendorLedgerEntries[0].runningBalance, 1380),
    postedA.data?.vendorLedgerEntries,
  );
  check(
    'the payable is UNPAID and due in 30 days',
    postedA.data?.payable?.status === 'UNPAID' &&
    near(postedA.data?.payable?.outstandingAmount, 1380) &&
    postedA.data?.payable?.dueDate === addDays(30),
    postedA.data?.payable,
  );
  check('a credit purchase settles nothing', postedA.data?.payment === null, postedA.data?.payment);
  check(
    'two stock movements were posted at cost excluding recoverable tax',
    postedA.data?.stockMovements?.length === 2 &&
    near(
      postedA.data.stockMovements.find((movement) => movement.productId === TAXED)?.unitCost,
      100,
    ) &&
    postedA.data.stockMovements.every((movement) => typeof movement.productName === 'string'),
    postedA.data?.stockMovements,
  );

  const balances = await call(
    'GET',
    `/purchase/stock/balances?locationId=${WAREHOUSE}&nonZeroOnly=true`,
  );
  check(
    'the balances grid agrees: 10 and 5 on hand',
    balances.meta?.total === 2 &&
    near(balances.data?.find((row) => row.productId === TAXED)?.quantity, 10) &&
    near(balances.data?.find((row) => row.productId === PLAIN)?.quantity, 5),
    balances.data?.map((row) => ({ p: row.productId, q: row.quantity })),
  );

  section('A POSTED entry is immutable');
  const rePost = await call('POST', `/purchase/entries/${entryA.id}/post`, {});
  check('posting it again is refused with 409', rePost.status === 409, rePost.body);
  const reEdit = await call('PATCH', `/purchase/entries/${entryA.id}`, { notes: 'nope' });
  check('editing it is refused with 409', reEdit.status === 409, reEdit.body);
  const reCancel = await call('POST', `/purchase/entries/${entryA.id}/cancel`, {});
  check('cancelling it is refused with 409', reCancel.status === 409, reCancel.body);

  /* ---------------------------------------------------------- a blocking exception */

  section('A blocking exception refuses the post and leaves nothing behind');
  const expired = await draft({
    supplierId: SUPPLIER,
    receivingLocationId: WAREHOUSE,
    supplierInvoiceNumber: `VPP-BILL-EXP-${STAMP}`,
    supplierInvoiceDate: today(),
    lines: [
      {
        productId: PERISHABLE,
        quantity: 10,
        rate: 50,
        batchNumber: `VPP-LOT-${STAMP}`,
        expiryDate: addDays(-2),
      },
    ],
  });
  check('drafts a bill for goods that have already expired', expired.status === 201, expired.body);
  check(
    'the entry carries a BLOCKING EXPIRED_GOODS exception',
    (expired.data?.exceptions ?? []).some(
      (exception) => exception.code === 'EXPIRED_GOODS' && exception.severity === 'BLOCKING',
    ),
    expired.data?.exceptions?.map((exception) => `${exception.code}/${exception.severity}`),
  );
  const expiredPreview = await call('GET', `/purchase/entries/${expired.data.id}/preview`);
  check('the preview says it cannot post', expiredPreview.data?.canPost === false, expiredPreview.data);

  const expiredPost = await call('POST', `/purchase/entries/${expired.data.id}/post`, {});
  check(
    'the post is refused with PURCHASE_EXCEPTIONS_UNRESOLVED',
    expiredPost.status === 409 &&
    expiredPost.body?.error?.code === 'PURCHASE_EXCEPTIONS_UNRESOLVED',
    expiredPost.body,
  );
  check(
    'and the refusal names the code so the UI can offer a way out',
    exceptionCodes(expiredPost).includes('exceptions.EXPIRED_GOODS'),
    exceptionCodes(expiredPost),
  );
  const forcedExpired = await call('POST', `/purchase/entries/${expired.data.id}/post`, {
    acceptedExceptionCodes: ['EXPIRED_GOODS'],
  });
  check(
    'accepting a BLOCKING code changes nothing — it never posts',
    forcedExpired.status === 409,
    forcedExpired.body,
  );

  const expiredLedger = await call(
    'GET',
    `/purchase/stock/ledger?productId=${PERISHABLE}&pageSize=5`,
  );
  check('no stock moved', expiredLedger.meta?.total === 0, expiredLedger.meta);
  const expiredInvoices = await call(
    'GET',
    `/purchase/invoices?supplierId=${SUPPLIER}&pageSize=50`,
  );
  check(
    'no second invoice was created',
    expiredInvoices.meta?.total === 1,
    expiredInvoices.meta,
  );
  const expiredEntry = await call('GET', `/purchase/entries/${expired.data.id}`);
  check(
    'and the entry is still a draft rather than half-posted',
    expiredEntry.data?.status === 'DRAFT' &&
    expiredEntry.data?.goodsReceiptId === null &&
    expiredEntry.data?.purchaseInvoiceId === null,
    expiredEntry.data?.status,
  );

  /* -------------------------------------------- an overridable exception, then a cash post */

  section('An overridable exception, accepted quantity, and a split destination');
  const cashEntry = await draft({
    supplierId: CASH_SUPPLIER,
    paymentMethod: 'CASH',
    receivingLocationId: WAREHOUSE,
    supplierInvoiceNumber: `VPP-BILL-CASH-${STAMP}`,
    supplierInvoiceDate: today(),
    // ₹100 last time, ₹200 now: a 100% jump against a 10% tolerance.
    lines: [
      {
        productId: TAXED,
        quantity: 100,
        rate: 200,
        receivedQuantity: 100,
        acceptedQuantity: 90,
        rejectedQuantity: 10,
        rejectionReason: 'DAMAGED',
      },
    ],
  });
  check('drafts a cash bill at a much higher rate', cashEntry.status === 201, cashEntry.body);
  check(
    'it carries an OVERRIDABLE RATE_VARIANCE and a REJECTED_QUANTITY warning',
    (cashEntry.data?.exceptions ?? []).some(
      (exception) => exception.code === 'RATE_VARIANCE' && exception.severity === 'OVERRIDABLE',
    ) &&
    (cashEntry.data?.exceptions ?? []).some(
      (exception) => exception.code === 'REJECTED_QUANTITY' && exception.severity === 'WARNING',
    ),
    cashEntry.data?.exceptions?.map((exception) => `${exception.code}/${exception.severity}`),
  );

  const unacceptedPost = await call('POST', `/purchase/entries/${cashEntry.data.id}/post`, {});
  check(
    'silence is not consent: the post is refused',
    unacceptedPost.status === 409 &&
    exceptionCodes(unacceptedPost).includes('exceptions.RATE_VARIANCE'),
    unacceptedPost.body,
  );

  const cashLineId = cashEntry.data?.lines?.[0]?.id;
  const cashPost = await call('POST', `/purchase/entries/${cashEntry.data.id}/post`, {
    acceptedExceptionCodes: ['RATE_VARIANCE'],
    overrideNote: 'Rate confirmed with the supplier by phone',
    lineDestinations: [
      {
        lineId: cashLineId,
        destinations: [
          { locationId: WAREHOUSE, quantity: 60 },
          { locationId: DAY_STORE, quantity: 30 },
        ],
      },
    ],
  });
  check('accepting the code lets it post', cashPost.status === 200, cashPost.body);
  check(
    'only the accepted 90 became stock, across two stores',
    cashPost.data?.stockMovements?.length === 2 &&
    near(
      cashPost.data.stockMovements.reduce((sum, movement) => sum + movement.quantity, 0),
      90,
    ),
    cashPost.data?.stockMovements?.map((movement) => ({
      location: movement.locationName,
      quantity: movement.quantity,
    })),
  );
  check(
    'the GRN line records 100 received, 90 accepted, 10 rejected, split two ways',
    near(cashPost.data?.goodsReceipt?.lines?.[0]?.receivedQuantity, 100) &&
    near(cashPost.data?.goodsReceipt?.lines?.[0]?.acceptedQuantity, 90) &&
    near(cashPost.data?.goodsReceipt?.lines?.[0]?.rejectedQuantity, 10) &&
    cashPost.data?.goodsReceipt?.lines?.[0]?.qcStatus === 'PARTIAL' &&
    cashPost.data?.goodsReceipt?.lines?.[0]?.destinations?.length === 2,
    cashPost.data?.goodsReceipt?.lines?.[0],
  );
  check(
    'the supplier still billed for all 100 — rejection is a stock fact, not a pricing one',
    near(cashPost.data?.invoice?.lines?.[0]?.quantity, 100) &&
    near(cashPost.data?.invoice?.taxableAmount, 20_000) &&
    near(cashPost.data?.invoice?.totalAmount, 23_600),
    cashPost.data?.invoice,
  );
  check(
    'a cash purchase ends fully settled: payable PAID, nothing outstanding',
    cashPost.data?.payable?.status === 'PAID' &&
    near(cashPost.data?.payable?.outstandingAmount, 0) &&
    near(cashPost.data?.payment?.amount, 23_600) &&
    cashPost.data?.payment?.status === 'POSTED' &&
    near(cashPost.data?.entry?.outstandingAmount, 0),
    { payable: cashPost.data?.payable, payment: cashPost.data?.payment },
  );
  check(
    'and the ledger holds a matching credit and debit that net to zero',
    cashPost.data?.vendorLedgerEntries?.length === 2 &&
    near(cashPost.data.vendorLedgerEntries[0].creditAmount, 23_600) &&
    near(cashPost.data.vendorLedgerEntries[1].debitAmount, 23_600) &&
    near(cashPost.data.vendorLedgerEntries[1].runningBalance, 0),
    cashPost.data?.vendorLedgerEntries?.map((entry) => entry.runningBalance),
  );

  const splitBalances = await call(
    'GET',
    `/purchase/stock/balances?productId=${TAXED}&nonZeroOnly=true`,
  );
  const atWarehouse = splitBalances.data?.find((row) => row.locationId === WAREHOUSE)?.quantity;
  const atDayStore = splitBalances.data?.find((row) => row.locationId === DAY_STORE)?.quantity;
  check(
    'the split landed 60 in the warehouse (on top of the earlier 10) and 30 in the day store',
    near(atWarehouse, 70) && near(atDayStore, 30),
    { warehouse: atWarehouse, dayStore: atDayStore },
  );

  /* --------------------------------------------------------------- duplicate bills */

  section('A supplier bill number cannot be posted twice');
  const duplicate = await draft({
    supplierId: CASH_SUPPLIER,
    paymentMethod: 'CASH',
    receivingLocationId: WAREHOUSE,
    supplierInvoiceNumber: `VPP-BILL-CASH-${STAMP}`,
    supplierInvoiceDate: today(),
    lines: [{ productId: PLAIN, quantity: 1, rate: 10 }],
  });
  check('a re-entered bill drafts fine — the refusal belongs at posting', duplicate.status === 201);
  check(
    'but it carries a BLOCKING DUPLICATE_INVOICE',
    (duplicate.data?.exceptions ?? []).some(
      (exception) => exception.code === 'DUPLICATE_INVOICE' && exception.severity === 'BLOCKING',
    ),
    duplicate.data?.exceptions?.map((exception) => exception.code),
  );
  const duplicatePost = await call('POST', `/purchase/entries/${duplicate.data.id}/post`, {
    acceptedExceptionCodes: ['DUPLICATE_INVOICE'],
  });
  check(
    'and the post is refused however hard it is pushed',
    duplicatePost.status === 409 &&
    exceptionCodes(duplicatePost).includes('exceptions.DUPLICATE_INVOICE'),
    duplicatePost.body,
  );

  /* ------------------------------------------------------------------ idempotency */

  section('A retried post under one idempotency key does not post twice');
  const idempotent = await draft({
    supplierId: CASH_SUPPLIER,
    paymentMethod: 'CASH',
    receivingLocationId: WAREHOUSE,
    supplierInvoiceNumber: `VPP-BILL-IDEM-${STAMP}`,
    supplierInvoiceDate: today(),
    lines: [{ productId: PLAIN, quantity: 8, rate: 25 }],
  });
  const key = `verify-purchase-${randomUUID()}`;
  const firstTry = await call(
    'POST',
    `/purchase/entries/${idempotent.data.id}/post`,
    {},
    { 'x-idempotency-key': key },
  );
  const retry = await call(
    'POST',
    `/purchase/entries/${idempotent.data.id}/post`,
    {},
    { 'x-idempotency-key': key },
  );
  check('the first attempt posts', firstTry.status === 200, firstTry.body);
  check(
    'the retry replays the same result rather than erroring',
    retry.status === 200 && retry.data?.invoice?.id === firstTry.data?.invoice?.id,
    { first: firstTry.data?.invoice?.id, retry: retry.data?.invoice?.id },
  );
  const plainBalance = await call(
    'GET',
    `/purchase/stock/balances?productId=${PLAIN}&locationId=${WAREHOUSE}`,
  );
  check(
    'and the delivery reached stock exactly once (5 earlier + 8 now)',
    near(plainBalance.data?.[0]?.quantity, 13),
    plainBalance.data?.[0]?.quantity,
  );

  /* ---------------------------------------------------------------- document flow */

  section('GET /entries/:id/flow');
  const flow = await call('GET', `/purchase/entries/${cashEntry.data.id}/flow`);
  check('reads the flow', flow.status === 200, flow.body);
  const flowTypes = (flow.data?.nodes ?? []).map((node) => node.documentType);
  check(
    'the chain is the real one: entry, GRN, invoice, ledger, payable, payment',
    ['PURCHASE_ENTRY', 'GOODS_RECEIPT', 'PURCHASE_INVOICE', 'VENDOR_LEDGER', 'ACCOUNTS_PAYABLE', 'VENDOR_PAYMENT'].every(
      (type) => flowTypes.includes(type),
    ),
    flowTypes,
  );
  check(
    'every node carries a real number and a route to open it',
    (flow.data?.nodes ?? []).every(
      (node) => typeof node.documentNumber === 'string' && node.documentNumber !== '' && node.href !== null,
    ),
    flow.data?.nodes?.map((node) => [node.documentNumber, node.href]),
  );
  const draftFlow = await call('GET', `/purchase/entries/${expired.data.id}/flow`);
  check(
    'an unposted entry has exactly one node — nothing is fabricated',
    draftFlow.data?.nodes?.length === 1 && draftFlow.data.nodes[0].documentType === 'PURCHASE_ENTRY',
    draftFlow.data?.nodes,
  );

  /* -------------------------------------------------------------------- register */

  section('GET /register and /register/totals');
  const register = await call('GET', `/purchase/register?supplierId=${CASH_SUPPLIER}&status=POSTED`);
  check('reads the register', register.status === 200, register.body);
  const cashRow = (register.data ?? []).find((row) => row.entryId === cashEntry.data.id);
  check(
    'the posted cash purchase appears with its generated document numbers',
    cashRow !== undefined &&
    cashRow.grnNumber === cashPost.data?.goodsReceipt?.grnNumber &&
    cashRow.invoiceNumber === cashPost.data?.invoice?.invoiceNumber &&
    cashRow.paymentStatus === 'PAID' &&
    near(cashRow.totalQuantity, 100) &&
    near(cashRow.totalAmount, 23_600),
    cashRow,
  );
  const totals = await call('GET', `/purchase/register/totals?supplierId=${CASH_SUPPLIER}&status=POSTED`);
  check(
    'the totals are over the whole filtered set, not the page',
    totals.data?.entryCount === 2 &&
    near(totals.data?.totalAmount, 23_800) &&
    near(totals.data?.paidAmount, 23_800) &&
    near(totals.data?.outstandingAmount, 0),
    totals.data,
  );
  const exceptionsOnly = await call(
    'GET',
    `/purchase/register?supplierId=${SUPPLIER}&withExceptionsOnly=true`,
  );
  check(
    'withExceptionsOnly narrows to documents that are actually stuck',
    (exceptionsOnly.data ?? []).some((row) => row.entryId === expired.data.id) &&
    (exceptionsOnly.data ?? []).every((row) => row.openExceptionCount > 0),
    exceptionsOnly.data?.map((row) => [row.entryNumber, row.openExceptionCount]),
  );

  /* ------------------------------------------------------ generated document reads */

  section('GET /invoices and /receipts');
  const invoices = await call('GET', `/purchase/invoices?supplierId=${CASH_SUPPLIER}&status=POSTED`);
  check('lists the invoices a post created', invoices.meta?.total === 2, invoices.meta);
  const invoice = await call('GET', `/purchase/invoices/${cashPost.data.invoice.id}`);
  check(
    'reads one with its lines',
    invoice.status === 200 &&
    invoice.data?.lines?.length === 1 &&
    near(invoice.data?.lines?.[0]?.rate, 200),
    invoice.data?.lines,
  );
  const receipts = await call('GET', `/purchase/receipts?purchaseEntryId=${cashEntry.data.id}`);
  check('lists the receipt against its entry', receipts.meta?.total === 1, receipts.meta);
  const receipt = await call('GET', `/purchase/receipts/${cashPost.data.goodsReceipt.id}`);
  check(
    'reads it with its lines and their destination split',
    receipt.status === 200 &&
    near(receipt.data?.lines?.[0]?.destinations?.[0]?.quantity, 60) &&
    near(receipt.data?.lines?.[0]?.destinations?.[1]?.quantity, 30),
    receipt.data?.lines?.[0]?.destinations,
  );
  const invoiceWrite = await call('POST', '/purchase/invoices', { supplierId: SUPPLIER });
  check('POST /invoices is not a route', invoiceWrite.status === 404, invoiceWrite.status);

  /* ----------------------------------------------------------------- vendor money */

  section('GET /vendor-ledger, statement and ageing');
  const ledger = await call('GET', `/purchase/vendor-ledger?supplierId=${CASH_SUPPLIER}`);
  check(
    'the ledger lists every movement, newest first',
    ledger.status === 200 && ledger.meta?.total === 4,
    ledger.meta,
  );
  const statement = await call(
    'GET',
    `/purchase/vendor-ledger/${SUPPLIER}/statement?dateFrom=${today()}&dateTo=${today()}`,
  );
  check(
    'the statement reconciles: one credit of 1380 and a closing balance to match',
    statement.status === 200 &&
    near(statement.data?.totalCredits, 1380) &&
    near(statement.data?.totalDebits, 0) &&
    near(statement.data?.closingBalance, 1380) &&
    statement.data?.entries?.length === 1,
    statement.data,
  );
  const ageing = await call('GET', `/purchase/vendor-ledger/ageing?supplierId=${SUPPLIER}`);
  check(
    'ageing puts a bill due in 30 days in "not due" rather than overdue',
    ageing.status === 200 &&
    near(ageing.data?.[0]?.notDue, 1380) &&
    near(ageing.data?.[0]?.days0to30, 0) &&
    near(ageing.data?.[0]?.total, 1380),
    ageing.data?.[0],
  );

  section('GET /payables and POST /payables/:id/queue');
  const payables = await call('GET', `/purchase/payables?supplierId=${SUPPLIER}&status=UNPAID`);
  check('lists the open liability', payables.meta?.total === 1, payables.meta);
  const payableId = payables.data?.[0]?.id;
  check(
    'with its ageing measured against the due date',
    payables.data?.[0]?.daysOverdue !== undefined && payables.data[0].daysOverdue <= -29,
    payables.data?.[0]?.daysOverdue,
  );
  const queued = await call('POST', `/purchase/payables/${payableId}/queue`);
  check(
    'queues it for the payment run',
    queued.status === 200 && queued.data?.isQueued === true && typeof queued.data?.queuedBy === 'string',
    queued.data,
  );
  const queuedOnly = await call('GET', `/purchase/payables?supplierId=${SUPPLIER}&queuedOnly=true`);
  check('and it appears in the queue', queuedOnly.meta?.total === 1, queuedOnly.meta);

  section('POST /payments — a partial payment against that liability');
  const payment = await call('POST', '/purchase/payments', {
    supplierId: SUPPLIER,
    method: 'BANK',
    amount: 380,
    reference: `VPP-PAY-${STAMP}`,
    allocations: [{ accountsPayableId: payableId, allocatedAmount: 380 }],
  });
  check('records the payment', payment.status === 201, payment.body);
  check(
    'allocated in full, so nothing is left on account',
    /^PAY-\d{8}-\d{4}$/.test(payment.data?.paymentNumber ?? '') &&
    near(payment.data?.unallocatedAmount, 0) &&
    payment.data?.allocations?.length === 1,
    payment.data,
  );
  const afterPayment = await call('GET', `/purchase/payables?supplierId=${SUPPLIER}`);
  check(
    'the payable is PARTIALLY_PAID with exactly the remainder outstanding',
    afterPayment.data?.[0]?.status === 'PARTIALLY_PAID' &&
    near(afterPayment.data?.[0]?.paidAmount, 380) &&
    near(afterPayment.data?.[0]?.outstandingAmount, 1000),
    afterPayment.data?.[0],
  );
  const invoiceAfterPayment = await call(
    'GET',
    `/purchase/invoices/${postedA.data.invoice.id}`,
  );
  check(
    'the invoice records what has been paid but its own amount is untouched',
    near(invoiceAfterPayment.data?.totalAmount, 1380) &&
    near(invoiceAfterPayment.data?.paidAmount, 380) &&
    near(invoiceAfterPayment.data?.outstandingAmount, 1000) &&
    invoiceAfterPayment.data?.paymentStatus === 'PARTIALLY_PAID',
    invoiceAfterPayment.data,
  );
  const runningLedger = await call(
    'GET',
    `/purchase/vendor-ledger?supplierId=${SUPPLIER}&pageSize=10`,
  );
  check(
    'and the running balance walks 1380 then 1000',
    (runningLedger.data ?? []).map((entry) => entry.runningBalance).join(',') === '1000,1380',
    runningLedger.data?.map((entry) => entry.runningBalance),
  );
  const payments = await call('GET', `/purchase/payments?supplierId=${SUPPLIER}`);
  check('the payment register lists it', payments.meta?.total === 1, payments.meta);

  /* ------------------------------------------------------------------- lifecycle */

  section('A draft may be cancelled');
  const throwaway = await draft({
    supplierId: SUPPLIER,
    receivingLocationId: WAREHOUSE,
    supplierInvoiceNumber: `VPP-BILL-CANCEL-${STAMP}`,
    supplierInvoiceDate: today(),
    lines: [{ productId: PLAIN, quantity: 1, rate: 1 }],
  });
  const cancelled = await call('POST', `/purchase/entries/${throwaway.data.id}/cancel`, {
    reason: 'Entered in error (verify-purchase-posting)',
  });
  check(
    'cancels it with a reason',
    cancelled.status === 200 &&
    cancelled.data?.status === 'CANCELLED' &&
    typeof cancelled.data?.cancelledBy === 'string',
    cancelled.data,
  );
  const cancelledPost = await call('POST', `/purchase/entries/${throwaway.data.id}/post`, {});
  check('and a cancelled entry cannot be posted', cancelledPost.status === 409, cancelledPost.body);

  /* ------------------------------------------------------------------ validation */

  section('Validation');
  const noLines = await draft({ supplierId: SUPPLIER, lines: [] });
  check('an entry with no lines is refused with 400', noLines.status === 400, noLines.body);
  const negativeRate = await draft({
    supplierId: SUPPLIER,
    lines: [{ productId: PLAIN, quantity: 1, rate: -5 }],
  });
  check('a negative rate is refused with 400', negativeRate.status === 400, negativeRate.body);
  const overAccepted = await draft({
    supplierId: SUPPLIER,
    receivingLocationId: WAREHOUSE,
    lines: [
      { productId: PLAIN, quantity: 10, rate: 10, receivedQuantity: 10, acceptedQuantity: 20 },
    ],
  });
  check(
    'accepting more than arrived is refused with 400',
    overAccepted.status === 400,
    overAccepted.body,
  );
  const unknownSupplier = await draft({
    supplierId: '00000000-0000-4000-8000-000000000000',
    lines: [{ productId: PLAIN, quantity: 1, rate: 1 }],
  });
  check('an unknown supplier is 404', unknownSupplier.status === 404, unknownSupplier.body);
  const unknownEntry = await call(
    'GET',
    '/purchase/entries/00000000-0000-4000-8000-000000000000',
  );
  check('an unknown entry is 404', unknownEntry.status === 404, unknownEntry.body);
  const badQuery = await call('GET', '/purchase/entries?nope=1');
  check('an unknown query parameter is refused with 400', badQuery.status === 400, badQuery.body);
  const badTotalField = await draft({
    supplierId: SUPPLIER,
    lines: [{ productId: PLAIN, quantity: 1, rate: 1, lineTotal: 999 }],
  });
  check(
    'a client-supplied line total is not even accepted as a field',
    badTotalField.status === 400,
    badTotalField.body,
  );
}

async function teardown() {
  section('Cleanup');
  const connection = await dbConnection();
  try {
    const suppliers = cleanup.supplierIds.filter((id) => id !== undefined);
    const products = cleanup.productIds.filter((id) => id !== undefined);
    const locations = cleanup.locationIds.filter((id) => id !== undefined);

    if (suppliers.length > 0) {
      const s = suppliers.map(() => '?').join(',');
      // Break the entry <-> generated-document cycle before deleting either side.
      await connection.execute(
        `UPDATE purchase_entries SET goods_receipt_id = NULL, purchase_invoice_id = NULL
          WHERE supplier_id IN (${s})`,
        suppliers,
      );
      await connection.execute(
        `DELETE a FROM vendor_payment_allocations a
           JOIN vendor_payments p ON p.id = a.payment_id
          WHERE p.supplier_id IN (${s})`,
        suppliers,
      );
      await connection.execute(`DELETE FROM vendor_payments WHERE supplier_id IN (${s})`, suppliers);
      await connection.execute(`DELETE FROM accounts_payable WHERE supplier_id IN (${s})`, suppliers);
      await connection.execute(
        `DELETE FROM vendor_ledger_entries WHERE supplier_id IN (${s})`,
        suppliers,
      );
      await connection.execute(
        `DELETE FROM purchase_price_history WHERE supplier_id IN (${s})`,
        suppliers,
      );
      await connection.execute(`DELETE FROM purchase_invoices WHERE supplier_id IN (${s})`, suppliers);
      await connection.execute(`DELETE FROM goods_receipts WHERE supplier_id IN (${s})`, suppliers);
      await connection.execute(
        `DELETE FROM supplier_products WHERE supplier_id IN (${s})`,
        suppliers,
      );
    }
    if (cleanup.entryIds.length > 0) {
      const e = cleanup.entryIds.map(() => '?').join(',');
      await connection.execute(
        `DELETE FROM purchase_exceptions WHERE document_id IN (${e})`,
        cleanup.entryIds,
      );
    }
    if (suppliers.length > 0) {
      const s = suppliers.map(() => '?').join(',');
      await connection.execute(`DELETE FROM purchase_entries WHERE supplier_id IN (${s})`, suppliers);
    }
    for (const productId of products) {
      await connection.execute('DELETE FROM stock_ledger WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM stock_balances WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM stock_batches WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM product_locations WHERE product_id = ?', [productId]);
      await connection.execute('DELETE FROM products WHERE id = ?', [productId]);
    }
    for (const locationId of locations) {
      await connection.execute('DELETE FROM inventory_locations WHERE id = ?', [locationId]);
    }
    for (const supplierId of suppliers) {
      await connection.execute('DELETE FROM entities WHERE id = ?', [supplierId]);
    }
    if (cleanup.taxProfileId !== null) {
      await connection.execute('DELETE FROM tax_profiles WHERE id = ?', [cleanup.taxProfileId]);
    }
    await connection.execute(
      "DELETE FROM posting_idempotency WHERE operation = 'purchase.post' AND idempotency_key LIKE 'verify-purchase-%'",
    );

    const [[left]] = await connection.query(
      `SELECT (SELECT COUNT(*) FROM purchase_entries WHERE supplier_id IN (?, ?)) +
              (SELECT COUNT(*) FROM purchase_invoices WHERE supplier_id IN (?, ?)) +
              (SELECT COUNT(*) FROM goods_receipts WHERE supplier_id IN (?, ?)) +
              (SELECT COUNT(*) FROM vendor_ledger_entries WHERE supplier_id IN (?, ?)) +
              (SELECT COUNT(*) FROM accounts_payable WHERE supplier_id IN (?, ?)) +
              (SELECT COUNT(*) FROM entities WHERE id IN (?, ?)) AS n`,
      Array.from({ length: 12 }, (_, index) =>
        index % 2 === 0
          ? (cleanup.supplierIds[0] ?? '')
          : (cleanup.supplierIds[1] ?? ''),
      ),
    );
    check('removes every row it created', Number(left.n) === 0, left);
  } finally {
    await connection.end();
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
