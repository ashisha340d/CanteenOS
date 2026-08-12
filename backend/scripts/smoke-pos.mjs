/**
 * End-to-end smoke test for the Entity master and the POS, against a running server.
 *
 * Exercises what the counter actually does: register a customer and an employee, price a
 * ticket from the Menu Master, park it as a draft, schedule one, name one, settle one with
 * split tender, charge one to an employee account, and void a settled sale. Also asserts the
 * guards that stop a till from being wrong — anonymous quick sales, exact tender, and the
 * refusal to edit a closed bill.
 *
 * Run with: node scripts/smoke-pos.mjs
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: new URL('../.env', import.meta.url).pathname.replace(/^\//, '') });
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4000';
const API = `${BASE}/api/v1`;

/**
 * Signs a session for an existing ADMIN account rather than logging in.
 *
 * The smoke test must run against whatever database it is pointed at, and seeded passwords
 * are environment-specific. Minting the same token `AuthService` would issue exercises every
 * layer below it — `authenticate` still re-reads the user, and RBAC still resolves
 * capabilities from `role_capabilities` — without hard-coding a credential.
 */
function dbConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'menuboard',
  });
}

/**
 * A sellable configuration to ring up.
 *
 * Prefers a priced variant, because that is where the Menu Master actually puts a price; a
 * food item's `base_price` is the fallback and is frequently null in a real catalogue.
 */
async function findSellable() {
  const conn = await dbConnection();
  const [variants] = await conn.query(
    `SELECT v.id AS variantId, v.food_item_id AS menuItemId, v.price
       FROM menu_item_variants v
       JOIN menu_items mi ON mi.id = v.food_item_id AND mi.deleted_at IS NULL
      WHERE v.deleted_at IS NULL AND v.status = 'ACTIVE' AND v.price > 0
      LIMIT 1`,
  );
  if (variants.length > 0) {
    await conn.end();
    return { ...variants[0], price: Number(variants[0].price) };
  }
  const [items] = await conn.query(
    `SELECT id AS menuItemId, base_price AS price FROM menu_items
      WHERE deleted_at IS NULL AND base_price > 0 LIMIT 1`,
  );
  await conn.end();
  return items.length === 0
    ? null
    : { menuItemId: items[0].menuItemId, variantId: null, price: Number(items[0].price) };
}

async function mintAdminToken() {
  const conn = await dbConnection();
  const [rows] = await conn.query(
    "SELECT id, role FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1",
  );
  await conn.end();
  if (rows.length === 0) throw new Error('No active ADMIN user to smoke-test with');

  const deviceId = 'smoke-pos';
  return jwt.sign(
    { sub: rows[0].id, role: rows[0].role, ct: 'ADMIN', did: deviceId, jti: randomUUID() },
    process.env.JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: process.env.JWT_ISSUER ?? 'menuboard',
      audience: process.env.JWT_AUDIENCE ?? 'menuboard-clients',
    },
  );
}

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

async function call(method, path, { token, body } = {}) {
  const headers = { 'X-Client-Type': 'ADMIN' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;

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
    json = { parseError: text.slice(0, 300) };
  }
  return { status: response.status, body: json };
}

async function main() {
  section('Authentication');
  const token = await mintAdminToken();
  const auth = { token };
  const whoami = await call('GET', '/users?pageSize=1', auth);
  check('an ADMIN session reaches the API', whoami.status === 200, whoami.body);
  if (whoami.status !== 200) return;

  /* --------------------------------------------------------------- entities */

  section('Entity master');
  const stamp = Date.now();

  const customer = await call('POST', '/entities', {
    ...auth,
    body: {
      type: 'CUSTOMER',
      name: `Smoke Customer ${stamp}`,
      phone: `9${String(stamp).slice(-9)}`,
      discountPercent: 10,
    },
  });
  check('creates a CUSTOMER', customer.status === 201, customer.body);
  check(
    'allocates a CUS- code automatically',
    customer.body?.data?.code?.startsWith('CUS-') === true,
    customer.body?.data?.code,
  );
  const customerId = customer.body?.data?.id;

  const employee = await call('POST', '/entities', {
    ...auth,
    body: {
      type: 'EMPLOYEE',
      name: `Smoke Employee ${stamp}`,
      department: 'Kitchen',
      creditLimit: 5000,
    },
  });
  check('creates an EMPLOYEE', employee.status === 201, employee.body);
  check(
    'allocates an EMP- code automatically',
    employee.body?.data?.code?.startsWith('EMP-') === true,
    employee.body?.data?.code,
  );
  const employeeId = employee.body?.data?.id;

  const vendor = await call('POST', '/entities', {
    ...auth,
    body: { type: 'VENDOR', name: `Smoke Vendor ${stamp}`, gstin: '27AAPFU0939F1ZV' },
  });
  check('creates a VENDOR with a GSTIN', vendor.status === 201, vendor.body);

  const badGstin = await call('POST', '/entities', {
    ...auth,
    body: { type: 'VENDOR', name: 'Bad GSTIN', gstin: 'NOPE' },
  });
  check('rejects a malformed GSTIN', badGstin.status === 400, badGstin.body);

  const lookup = await call(
    'GET',
    `/entities/lookup?phone=${encodeURIComponent(customer.body.data.phone)}`,
    auth,
  );
  check('looks an entity up by phone', lookup.body?.data?.id === customerId, lookup.body);

  const byType = await call('GET', '/entities?type=EMPLOYEE&pageSize=5', auth);
  check('filters the master by type', byType.status === 200, byType.body);

  /* ------------------------------------------------------- menu for pricing */

  section('Menu resolution');
  const sellable = await findSellable();
  check('found a priced sellable configuration', sellable !== null, sellable);
  if (sellable === null) {
    console.log('\n  Cannot continue: the Menu Master has nothing priced. Add a variant price first.');
    return;
  }
  const line = (quantity, extra = {}) => ({
    menuItemId: sellable.menuItemId,
    ...(sellable.variantId !== null ? { variantId: sellable.variantId } : {}),
    quantity,
    ...extra,
  });

  /* ------------------------------------------------------------- POS orders */

  section('POS — draft');
  const draft = await call('POST', '/pos/orders', {
    ...auth,
    body: {
      orderType: 'TAKEAWAY',
      status: 'DRAFT',
      items: [line(2)],
    },
  });
  check('parks a ticket as DRAFT', draft.status === 201, draft.body);
  check('DRAFT gets a POS- bill number', /^POS-\d{8}-\d{4}$/.test(draft.body?.data?.orderNumber ?? ''), draft.body?.data?.orderNumber);
  check('prices the line from the catalogue', draft.body?.data?.items?.[0]?.unitPrice > 0, draft.body?.data?.items?.[0]);
  check('computes a bill total', draft.body?.data?.totalAmount > 0, draft.body?.data?.totalAmount);

  const emptyDraft = await call('POST', '/pos/orders', {
    ...auth,
    body: { orderType: 'TAKEAWAY', status: 'DRAFT', items: [] },
  });
  check('an empty DRAFT is allowed', emptyDraft.status === 201, emptyDraft.body);

  const emptyOpen = await call('POST', '/pos/orders', {
    ...auth,
    body: { orderType: 'TAKEAWAY', status: 'OPEN', items: [] },
  });
  check('an empty OPEN ticket is refused', emptyOpen.status === 400, emptyOpen.body);

  section('POS — scheduled');
  const scheduledFor = new Date(Date.now() + 4 * 3600_000).toISOString();
  const scheduled = await call('POST', '/pos/orders', {
    ...auth,
    body: {
      orderType: 'DELIVERY',
      status: 'SCHEDULED',
      scheduledFor,
      entityId: customerId,
      items: [line(5)],
    },
  });
  check('schedules an order for later', scheduled.status === 201, scheduled.body);
  check('snapshots the entity name onto the ticket', scheduled.body?.data?.entityName?.startsWith('Smoke Customer') === true, scheduled.body?.data?.entityName);
  check(
    "applies the entity's standing 10% discount",
    scheduled.body?.data?.discountAmount > 0,
    scheduled.body?.data?.discountAmount,
  );

  const scheduledNoTime = await call('POST', '/pos/orders', {
    ...auth,
    body: { orderType: 'TAKEAWAY', status: 'SCHEDULED', items: [line(1)] },
  });
  check('SCHEDULED without a time is refused', scheduledNoTime.status === 400, scheduledNoTime.body);

  section('POS — named vs quick sale');
  const named = await call('POST', '/pos/orders', {
    ...auth,
    body: {
      orderType: 'DINE_IN',
      entityName: 'Walk-in Ramesh',
      entityPhone: '9998887770',
      tableLabel: 'T4',
      pax: 3,
      items: [line(1)],
    },
  });
  check('names an order without registering an entity', named.status === 201, named.body);

  const namedQuick = await call('POST', '/pos/orders', {
    ...auth,
    body: {
      orderType: 'QUICK_SALE',
      entityName: 'Should Be Refused',
      items: [line(1)],
    },
  });
  check('a named QUICK_SALE is refused', namedQuick.status === 400, namedQuick.body);

  const quick = await call('POST', '/pos/orders', {
    ...auth,
    body: { orderType: 'QUICK_SALE', items: [line(1)] },
  });
  check('an anonymous QUICK_SALE is accepted', quick.status === 201, quick.body);

  section('POS — ad-hoc line');
  const adHoc = await call('POST', '/pos/orders', {
    ...auth,
    body: {
      orderType: 'TAKEAWAY',
      items: [{ customItemName: 'Special Thali', unitPrice: 120, quantity: 2 }],
    },
  });
  check('accepts a line typed on the spot', adHoc.status === 201, adHoc.body);
  check('ad-hoc line totals 240', adHoc.body?.data?.subtotalAmount === 240, adHoc.body?.data);

  const adHocNoPrice = await call('POST', '/pos/orders', {
    ...auth,
    body: { orderType: 'TAKEAWAY', items: [{ customItemName: 'No Price', quantity: 1 }] },
  });
  check('an ad-hoc line without a price is refused', adHocNoPrice.status === 400, adHocNoPrice.body);

  /* -------------------------------------------------------------- lifecycle */

  section('POS — status transitions');
  const draftId = draft.body.data.id;
  const opened = await call('POST', `/pos/orders/${draftId}/status`, {
    ...auth,
    body: { status: 'OPEN' },
  });
  check('DRAFT can be opened', opened.status === 200 && opened.body?.data?.status === 'OPEN', opened.body);

  const completeByStatus = await call('POST', `/pos/orders/${draftId}/status`, {
    ...auth,
    body: { status: 'COMPLETED' },
  });
  check('COMPLETED cannot be set by hand', completeByStatus.status === 409, completeByStatus.body);

  /* --------------------------------------------------------------- checkout */

  section('POS — checkout');
  const total = opened.body.data.totalAmount;

  const shortPay = await call('POST', `/pos/orders/${draftId}/checkout`, {
    ...auth,
    body: { payments: [{ method: 'CASH', amount: Math.max(total - 1, 0) }] },
  });
  check('under-tender is refused', shortPay.status === 400, shortPay.body);

  const settled = await call('POST', `/pos/orders/${draftId}/checkout`, {
    ...auth,
    body: [total / 2, total - total / 2].length
      ? {
        payments: [
          { method: 'CASH', amount: Math.round((total / 2) * 100) / 100, tenderedAmount: 500 },
          { method: 'UPI', amount: Math.round((total - Math.round((total / 2) * 100) / 100) * 100) / 100, reference: 'UPI-SMOKE' },
        ],
      }
      : {},
  });
  check('split tender settles the bill', settled.status === 200, settled.body);
  check('order becomes COMPLETED / PAID', settled.body?.data?.status === 'COMPLETED' && settled.body?.data?.paymentStatus === 'PAID', settled.body?.data);
  check('change is computed on the cash leg', settled.body?.data?.payments?.some((p) => p.changeAmount > 0), settled.body?.data?.payments);

  const editSettled = await call('PATCH', `/pos/orders/${draftId}`, {
    ...auth,
    body: { notes: 'should be refused' },
  });
  check('a settled bill cannot be edited', editSettled.status === 403, editSettled.body);

  section('POS — account settlement');
  const staffMeal = await call('POST', '/pos/orders', {
    ...auth,
    body: {
      orderType: 'DINE_IN',
      entityId: employeeId,
      items: [line(1)],
    },
  });
  check('raises a ticket for an employee', staffMeal.status === 201, staffMeal.body);
  const staffTotal = staffMeal.body.data.totalAmount;

  const onAccount = await call('POST', `/pos/orders/${staffMeal.body.data.id}/checkout`, {
    ...auth,
    body: { payments: [{ method: 'ACCOUNT', amount: staffTotal }] },
  });
  check('charges the meal to the employee account', onAccount.status === 200, onAccount.body);

  const afterCharge = await call('GET', `/entities/${employeeId}`, auth);
  check(
    'employee account balance moved by the bill',
    Math.abs(afterCharge.body?.data?.accountBalance - staffTotal) < 0.01,
    { balance: afterCharge.body?.data?.accountBalance, staffTotal },
  );

  section('POS — void');
  const voided = await call('POST', `/pos/orders/${staffMeal.body.data.id}/void`, {
    ...auth,
    body: { reason: 'Smoke test reversal' },
  });
  check('voids a settled sale', voided.status === 200, voided.body);
  check('void marks the ticket CANCELLED / VOIDED', voided.body?.data?.status === 'CANCELLED' && voided.body?.data?.paymentStatus === 'VOIDED', voided.body?.data);
  check(
    'void writes an offsetting payment rather than deleting one',
    voided.body?.data?.payments?.length === 2 &&
    voided.body?.data?.payments?.some((p) => p.isReversal && p.amount < 0),
    voided.body?.data?.payments,
  );

  const afterVoid = await call('GET', `/entities/${employeeId}`, auth);
  check(
    'employee account balance restored to zero',
    Math.abs(afterVoid.body?.data?.accountBalance) < 0.01,
    afterVoid.body?.data?.accountBalance,
  );

  const deleteCharged = await call('DELETE', `/entities/${employeeId}`, auth);
  check('an entity with POS history cannot be deleted', deleteCharged.status === 409, deleteCharged.body);

  /* -------------------------------------------------------------- dashboard */

  section('POS — dashboard');
  const dashboard = await call('GET', '/pos/dashboard', auth);
  check('dashboard responds', dashboard.status === 200, dashboard.body);
  const summary = dashboard.body?.data?.summary;
  // One of the two drafts raised above was opened, so exactly one is expected to remain.
  check('counts drafts', summary?.draftCount >= 1, summary);
  check('counts scheduled', summary?.scheduledCount >= 1, summary);
  check('counts takeaway', summary?.takeawayCount >= 1, summary);
  check('counts named', summary?.namedCount >= 1, summary);
  check('reports sales taken today', summary?.salesToday > 0, summary);
  check('returns the draft bucket', Array.isArray(dashboard.body?.data?.drafts), dashboard.body?.data);
  check('returns the scheduled bucket', Array.isArray(dashboard.body?.data?.scheduled), dashboard.body?.data);
  check('returns the named bucket', Array.isArray(dashboard.body?.data?.named), dashboard.body?.data);

  const listNamed = await call('GET', '/pos/orders?named=true&pageSize=5', auth);
  check('lists named orders only', listNamed.status === 200 && listNamed.body.data.every((o) => o.entityId !== null || o.entityName !== null), listNamed.body?.data?.length);

  const listDrafts = await call('GET', '/pos/orders?status=DRAFT&pageSize=5', auth);
  check('lists drafts only', listDrafts.status === 200 && listDrafts.body.data.every((o) => o.status === 'DRAFT'), listDrafts.body?.data?.length);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
