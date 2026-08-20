/**
 * Confirms the live `role_capabilities` table agrees with shared/src/permissions for every
 * purchase capability — in both directions.
 *
 * A missing grant is a screen nobody can open. An extra one is a privilege nobody decided to
 * give, which is the more dangerous of the two and the reason this checks for surplus rows as
 * well as absent ones.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { Capability, ROLE_CAPABILITIES } from '@menuboard/shared';

const PURCHASE_PREFIXES = ['product.', 'inventory.', 'stock.', 'purchase.'];
const purchaseCapabilities = Object.values(Capability)
  .filter((c) => PURCHASE_PREFIXES.some((p) => c.startsWith(p)))
  .sort();

const c = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
});

const [rows] = await c.query(
  `SELECT role, capability FROM role_capabilities
    WHERE ${PURCHASE_PREFIXES.map(() => 'capability LIKE ?').join(' OR ')}`,
  PURCHASE_PREFIXES.map((p) => `${p}%`),
);
await c.end();

const live = new Map();
for (const r of rows) {
  if (!live.has(r.role)) live.set(r.role, new Set());
  live.get(r.role).add(r.capability);
}

let failed = 0;
const report = (pass, msg) => {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${msg}`);
};

console.log(`Checking ${purchaseCapabilities.length} purchase capabilities across 5 roles\n`);

for (const [role, granted] of Object.entries(ROLE_CAPABILITIES)) {
  const expected = new Set(purchaseCapabilities.filter((cap) => granted.includes(cap)));
  const actual = live.get(role) ?? new Set();

  const missing = [...expected].filter((cap) => !actual.has(cap));
  const surplus = [...actual].filter((cap) => !expected.has(cap));

  report(
    missing.length === 0,
    `${role.padEnd(12)} holds all ${expected.size} expected grants` +
      (missing.length > 0 ? ` — MISSING: ${missing.join(', ')}` : ''),
  );
  report(
    surplus.length === 0,
    `${role.padEnd(12)} holds no grant it was not given` +
      (surplus.length > 0 ? ` — SURPLUS: ${surplus.join(', ')}` : ''),
  );
}

// The two rules the split depends on, asserted directly rather than inferred from counts.
const admin = live.get('ADMIN') ?? new Set();
const manager = live.get('MANAGER') ?? new Set();
const user = live.get('USER') ?? new Set();

const adminOnly = [
  Capability.PURCHASE_ORDER_APPROVE,
  Capability.PURCHASE_INVOICE_APPROVE,
  Capability.PURCHASE_RETURN_APPROVE,
  Capability.DEBIT_MEMO_APPROVE,
  Capability.CREDIT_MEMO_APPROVE,
  Capability.VENDOR_PAYMENT_CREATE,
  Capability.STOCK_ADJUSTMENT_APPROVE,
];
report(
  adminOnly.every((cap) => admin.has(cap) && !manager.has(cap)),
  'the seven money/balance decisions are Admin-only, withheld from Manager',
);
report(
  manager.has(Capability.PURCHASE_POST) && manager.has(Capability.PURCHASE_ENTRY_CREATE),
  'a Manager can raise and post a purchase without waiting for an Admin',
);
report(
  user.has(Capability.PRODUCT_READ) &&
    user.has(Capability.STOCK_COUNT_CREATE) &&
    !user.has(Capability.PURCHASE_POST) &&
    !user.has(Capability.PRODUCT_WRITE),
  'a User can read the master and count stock, but cannot buy or edit products',
);
report(
  (live.get('EMPLOYEE') ?? new Set()).size === 0,
  'an Employee holds no purchase capability at all',
);

console.log(`\n${failed === 0 ? 'All checks passed' : `${failed} check(s) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
