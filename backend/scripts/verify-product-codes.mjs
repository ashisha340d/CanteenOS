import 'dotenv/config';
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
});

const checks = [];
const ok = (name, pass, detail = '') => checks.push({ name, pass, detail });

const [[counts]] = await c.query(
  `SELECT COUNT(*) AS total, SUM(code IS NULL OR code = '') AS blank
     FROM products WHERE deleted_at IS NULL`,
);
ok('every active product has a code', Number(counts.blank) === 0, `blank=${counts.blank}/${counts.total}`);

const [notSixDigits] = await c.query(
  "SELECT name, code FROM products WHERE deleted_at IS NULL AND code NOT REGEXP '^[0-9]{6}$'",
);
ok('every active product code is exactly six digits', notSixDigits.length === 0,
  notSixDigits.map((r) => `${r.name}=${r.code}`).join(', '));

const [dupes] = await c.query(
  `SELECT code, COUNT(*) AS n FROM products WHERE code IS NOT NULL GROUP BY code HAVING n > 1`,
);
ok('no code is shared by two rows (active or deleted)', dupes.length === 0,
  dupes.map((d) => `${d.code} x${d.n}`).join(', '));

// MariaDB's REGEXP is case-insensitive under this table's collation, so the lowercase check has
// to happen in JS rather than in SQL, or every uppercase word matches `[a-z]` too.
const [allNames] = await c.query('SELECT name FROM products WHERE deleted_at IS NULL');
const notProper = allNames
  .map((r) => r.name)
  .filter((name) => name.split(' ').some((word) => word.length > 0 && /[a-z]/.test(word[0]) === true));
ok('no active product name starts a word with a lowercase letter', notProper.length === 0,
  notProper.join(', '));

const [sample] = await c.query(
  'SELECT name, code FROM products WHERE deleted_at IS NULL ORDER BY RAND() LIMIT 8',
);
console.log('sample:');
for (const r of sample) console.log(`  ${r.name.padEnd(24)} ${r.code}`);

await c.end();

let failed = 0;
console.log('');
for (const { name, pass, detail } of checks) {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
