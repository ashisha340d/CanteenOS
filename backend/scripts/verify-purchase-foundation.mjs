/**
 * Post-migration verification for 004_purchase_foundation.
 *
 * Confirms the product master really did take over from the ingredient master without
 * dropping anything on the floor: every ingredient carried across keeping its id, every
 * recipe line still resolves, and the new foreign keys point where they are supposed to.
 *
 * Read-only. Run with: node backend/scripts/verify-purchase-foundation.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
});

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
}

async function one(sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows[0];
}

try {
  const ing = await one('SELECT COUNT(*) AS n FROM ingredients');
  const prod = await one('SELECT COUNT(*) AS n FROM products');
  check(
    'every ingredient carried across',
    Number(prod.n) >= Number(ing.n),
    `ingredients=${ing.n} products=${prod.n}`,
  );

  const orphanIds = await one(
    `SELECT COUNT(*) AS n FROM ingredients i
      WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = i.id)`,
  );
  check('no ingredient lost its id', Number(orphanIds.n) === 0, `missing=${orphanIds.n}`);

  const drift = await one(
    `SELECT COUNT(*) AS n FROM ingredients i
       JOIN products p ON p.id = i.id
      WHERE i.name <> p.name OR i.unit <> p.unit
         OR NOT (i.category_id <=> p.category_id)
         OR NOT (i.deleted_at <=> p.deleted_at)`,
  );
  check('carried rows match field for field', Number(drift.n) === 0, `drifted=${drift.n}`);

  const unresolved = await one(
    `SELECT COUNT(*) AS n FROM recipe_ingredients ri
      WHERE ri.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = ri.ingredient_id)`,
  );
  check('every live recipe line resolves to a product', Number(unresolved.n) === 0, `broken=${unresolved.n}`);

  const fk = await one(
    `SELECT REFERENCED_TABLE_NAME AS t FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_ingredients'
        AND CONSTRAINT_NAME = 'fk_recipe_ingredients_product'`,
  );
  check('recipe_ingredients FK now targets products', fk?.t === 'products', `target=${fk?.t}`);

  const uom = await one("SELECT COUNT(*) AS n FROM uoms WHERE status = 'ACTIVE'");
  check('unit master seeded', Number(uom.n) >= 13, `units=${uom.n}`);

  const linked = await one('SELECT COUNT(*) AS n FROM products WHERE stock_uom_id IS NOT NULL');
  check('products resolved to the unit master', Number(linked.n) > 0 || Number(prod.n) === 0,
    `linked=${linked.n}/${prod.n}`);

  const loc = await one("SELECT COUNT(*) AS n FROM inventory_locations WHERE status = 'ACTIVE'");
  check('inventory locations seeded', Number(loc.n) >= 2, `locations=${loc.n}`);

  const dflt = await one('SELECT COUNT(*) AS n FROM inventory_locations WHERE is_default_receiving = 1');
  check('exactly one default receiving location', Number(dflt.n) === 1, `defaults=${dflt.n}`);

  const vendorCols = await one(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entities'
        AND COLUMN_NAME LIKE 'vendor_%'`,
  );
  check('entities gained the vendor columns', Number(vendorCols.n) === 8, `columns=${vendorCols.n}`);

  const settings = await one(
    "SELECT COUNT(*) AS n FROM settings WHERE setting_key LIKE 'purchase.%'",
  );
  check('purchase tolerances seeded', Number(settings.n) >= 7, `settings=${settings.n}`);
} finally {
  await connection.end();
}

let failed = 0;
for (const { name, pass, detail } of checks) {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
