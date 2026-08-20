import 'dotenv/config';
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
});

const [[counts]] = await c.query(
  `SELECT COUNT(*) AS total,
          SUM(code IS NULL OR code = '') AS blank,
          SUM(code IS NOT NULL AND code <> '') AS has_code
     FROM products`,
);
console.log('products total:', counts.total, ' blank code:', counts.blank, ' has code:', counts.has_code);

const [withCode] = await c.query(
  "SELECT id, name, code, deleted_at IS NOT NULL AS deleted FROM products WHERE code IS NOT NULL AND code <> ''",
);
console.log('\nrows that already have a code:');
for (const r of withCode) console.log(`  ${r.name.padEnd(22)} code=${r.code} deleted=${r.deleted}`);

const [names] = await c.query(
  "SELECT name FROM products WHERE deleted_at IS NULL ORDER BY name",
);
const notProper = names.filter((r) => {
  const words = r.name.split(/\s+/);
  return words.some((w) => w.length > 0 && (w[0] !== w[0].toUpperCase() || (w.length > 1 && w !== w[0] + w.slice(1).toLowerCase() && !/[0-9]/.test(w))));
});
console.log('\ntotal active product names:', names.length);
console.log('names NOT in simple proper case:', notProper.length);
for (const r of notProper.slice(0, 20)) console.log('  ', JSON.stringify(r.name));

await c.end();
