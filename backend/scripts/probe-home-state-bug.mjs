/**
 * Reproduces the reported `pos.home_state_code` decoding bug.
 *
 * `settings.value` is JSON-valid LONGTEXT. A state code stored as the JSON number `27` decodes
 * to a JS number, and every consumer casts it to `string` with an unchecked generic — so the
 * first `.trim()` throws at runtime. Read-only apart from a rolled-back probe row.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
});

const [rows] = await c.query(
  "SELECT setting_key, value FROM settings WHERE setting_key IN ('pos.home_state_code','pos.round_off_enabled','purchase.rate_variance_percent','purchase.allow_negative_stock')",
);
console.log('Stored settings as MySQL returns them:');
for (const r of rows) {
  console.log(`  ${r.setting_key.padEnd(34)} raw=${JSON.stringify(r.value)}  typeof=${typeof r.value}`);
}

// Mirror utils/json.ts parseJsonColumn exactly.
function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
}

console.log('\nWhat each candidate storage form decodes to:');
for (const stored of ['"27"', '27', '"09"', '09', '"MH"']) {
  let decoded;
  let note = '';
  try {
    decoded = parseJsonColumn(stored, '');
  } catch (e) {
    decoded = `THREW ${e.message}`;
  }
  // Now do what isInterStateSupply does.
  try {
    String(decoded).trim();
    if (typeof decoded !== 'string') note = '  <-- NOT a string: .trim() on it directly THROWS';
  } catch {
    note = '  <-- unusable';
  }
  const trimSafe = typeof decoded?.trim === 'function';
  console.log(
    `  stored ${String(stored).padEnd(6)} -> ${JSON.stringify(decoded)} (${typeof decoded})` +
      `  .trim() available: ${trimSafe}${note}`,
  );
}

await c.end();
