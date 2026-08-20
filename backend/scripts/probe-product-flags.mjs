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
          SUM(is_batch_tracked = 1) AS batch_tracked,
          SUM(is_expiry_tracked = 1) AS expiry_tracked,
          SUM(tax_profile_id IS NOT NULL) AS with_tax,
          SUM(default_location_id IS NOT NULL) AS with_default_location,
          SUM(stock_uom_id IS NOT NULL) AS with_stock_uom,
          SUM(purchase_uom_id IS NOT NULL) AS with_purchase_uom
     FROM products WHERE deleted_at IS NULL`,
);
console.log('products (not deleted):', counts.total);
console.log('  batch tracked          :', counts.batch_tracked);
console.log('  expiry tracked         :', counts.expiry_tracked);
console.log('  has tax profile        :', counts.with_tax);
console.log('  has default location   :', counts.with_default_location);
console.log('  has stock uom          :', counts.with_stock_uom);
console.log('  has purchase uom       :', counts.with_purchase_uom);

const [sample] = await c.query(
  `SELECT name, is_batch_tracked, is_expiry_tracked, tax_profile_id IS NOT NULL AS tax,
          default_location_id IS NOT NULL AS loc
     FROM products WHERE deleted_at IS NULL ORDER BY name LIMIT 6`,
);
console.log('\nsample:');
for (const p of sample) {
  console.log(
    `  ${String(p.name).padEnd(22)} batch=${p.is_batch_tracked} expiry=${p.is_expiry_tracked} tax=${p.tax} defaultLoc=${p.loc}`,
  );
}

const [tp] = await c.query(
  "SELECT COUNT(*) AS n FROM tax_profiles WHERE status = 'ACTIVE' AND deleted_at IS NULL",
);
console.log('\nactive tax profiles:', tp[0].n);

const [[dflt]] = await c.query(
  'SELECT COUNT(*) AS n FROM inventory_locations WHERE is_default_receiving = 1 AND deleted_at IS NULL',
);
console.log('default receiving locations:', dflt.n);

await c.end();
