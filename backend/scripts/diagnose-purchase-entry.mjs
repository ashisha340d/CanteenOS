/**
 * Walks the exact sequence of HTTP calls the Purchase Entry screen makes, in order, and prints
 * the real status and body of each. The point is to find where "it's not working" actually
 * breaks, rather than guessing from a 200 on the SPA shell.
 */
import 'dotenv/config';

const API = 'http://localhost:4000/api/v1';
const H = { 'x-client-type': 'ADMIN', 'x-device-id': 'diagnose' };

async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({
      identifier: 'admin',
      password: 'MenuBoard@2026',
      deviceId: 'diagnose',
      clientType: 'ADMIN',
    }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`login failed: ${JSON.stringify(j)}`);
  return j.data.tokens.accessToken;
}

const token = await login();
const auth = { ...H, Authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function call(label, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 200);
  }
  const okFlag = r.ok ? 'OK  ' : 'FAIL';
  let summary;
  if (r.ok && parsed?.success) {
    const d = parsed.data;
    summary = Array.isArray(d)
      ? `${d.length} rows (total ${parsed.meta?.total ?? '?'})`
      : typeof d === 'object' && d !== null
        ? Object.keys(d).slice(0, 6).join(',')
        : String(d);
  } else {
    summary = JSON.stringify(parsed?.error ?? parsed).slice(0, 300);
  }
  console.log(`${okFlag} ${r.status} ${method.padEnd(5)} ${path.padEnd(58)} ${summary}`);
  return { res: r, body: parsed };
}

console.log('--- what the screen loads on mount ---');
const vendors = await call('vendors', 'GET', '/purchase/vendors?page=1&pageSize=50');
const products = await call('products', 'GET', '/purchase/products?page=1&pageSize=50&purchasableOnly=true');
await call('locations', 'GET', '/purchase/locations?page=1&pageSize=50');
await call('register', 'GET', '/purchase/register?page=1&pageSize=10');
await call('register totals', 'GET', '/purchase/register/totals');
await call('entries list', 'GET', '/purchase/entries?page=1&pageSize=10');

const supplierId = vendors.body?.data?.[0]?.id;
const product = products.body?.data?.[0];
console.log(`\nsupplier=${supplierId ?? 'NONE'}  product=${product?.id ?? 'NONE'} (${product?.name ?? '-'})`);

if (!supplierId || !product) {
  console.log('\nCannot continue: no vendor and/or no purchasable product exists.');
  process.exit(1);
}

console.log('\n--- creating a draft the way the screen does ---');
const created = await call('create', 'POST', '/purchase/entries', {
  supplierId,
  paymentMethod: 'CASH',
  lines: [{ productId: product.id, quantity: 10, rate: 25 }],
});

const entryId = created.body?.data?.id;
if (!entryId) {
  console.log('\nDraft creation failed — this is the break.');
  process.exit(1);
}
console.log(`entryId=${entryId} number=${created.body.data.entryNumber} total=${created.body.data.totalAmount}`);

console.log('\n--- the rest of the flow ---');
await call('get', 'GET', `/purchase/entries/${entryId}`);
await call('patch', 'PATCH', `/purchase/entries/${entryId}`, {
  lines: [{ productId: product.id, quantity: 12, rate: 25 }],
});
await call('ready', 'POST', `/purchase/entries/${entryId}/ready`, {});
await call('preview', 'GET', `/purchase/entries/${entryId}/preview`);
await call('flow', 'GET', `/purchase/entries/${entryId}/flow`);
const posted = await call('post', 'POST', `/purchase/entries/${entryId}/post`, {});
if (posted.body?.success) {
  const d = posted.body.data;
  console.log(
    `   posted: grn=${d.goodsReceipt?.grnNumber ?? '-'} invoice=${d.invoice?.invoiceNumber ?? '-'} ` +
      `payable=${d.payable?.status ?? '-'} payment=${d.payment?.paymentNumber ?? '-'} ` +
      `movements=${d.stockMovements?.length ?? 0}`,
  );
}

console.log('\n--- vendor accounting reads ---');
await call('vendor ledger', 'GET', '/purchase/vendor-ledger?page=1&pageSize=10');
await call('statement', 'GET', `/purchase/vendor-ledger/${supplierId}/statement`);
await call('ageing', 'GET', '/purchase/vendor-ledger/ageing');
await call('payables', 'GET', '/purchase/payables?page=1&pageSize=10');
await call('payments', 'GET', '/purchase/payments?page=1&pageSize=10');
