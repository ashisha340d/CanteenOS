import 'dotenv/config';
import mysql from 'mysql2/promise';

const c = await mysql.createConnection({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'menuboard',
  multipleStatements: true,
});

const [v] = await c.query('SELECT VERSION() AS v');
console.log('VERSION:', v[0].v);

const [t] = await c.query(
  `SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('stock_batches','stock_ledger','stock_balances',
                         'stock_adjustments','stock_adjustment_lines',
                         'stock_counts','stock_count_lines','posting_idempotency')`,
);
console.log('ALREADY CREATED:', t.map((r) => r.TABLE_NAME).join(', ') || '(none)');

// Probe which form of the batch_key guard this server will accept.
const probes = {
  'generated STORED ifnull': "`k` char(36) AS (IFNULL(`b`,'-')) STORED",
  'generated VIRTUAL ifnull': "`k` char(36) AS (IFNULL(`b`,'-')) VIRTUAL",
  'generated STORED coalesce': "`k` char(36) AS (COALESCE(`b`,'-')) STORED",
  'generated STORED case': "`k` char(36) AS (CASE WHEN `b` IS NULL THEN '-' ELSE `b` END) STORED",
};
for (const [label, decl] of Object.entries(probes)) {
  try {
    await c.query('DROP TABLE IF EXISTS `__probe_gen`');
    await c.query(`CREATE TABLE \`__probe_gen\` (\`id\` char(36) NOT NULL, \`b\` char(36) DEFAULT NULL, ${decl}, PRIMARY KEY(\`id\`), UNIQUE KEY \`uq\` (\`id\`,\`k\`)) ENGINE=InnoDB`);
    console.log(`  OK    ${label}`);
  } catch (e) {
    console.log(`  FAIL  ${label} -> ${e.message}`);
  }
}

// And the function-free CHECK form, against a real FK without cascade.
try {
  await c.query('DROP TABLE IF EXISTS `__probe_chk`');
  await c.query(
    "CREATE TABLE `__probe_chk` (`id` char(36) NOT NULL, `batch_id` char(36) DEFAULT NULL, `batch_key` char(36) NOT NULL DEFAULT '-', PRIMARY KEY(`id`), UNIQUE KEY `uq` (`id`,`batch_key`), CONSTRAINT `fk_p` FOREIGN KEY (`batch_id`) REFERENCES `stock_batches`(`id`), CONSTRAINT `ck_p` CHECK ((`batch_id` IS NULL AND `batch_key` = '-') OR (`batch_id` IS NOT NULL AND `batch_key` = `batch_id`))) ENGINE=InnoDB",
  );
  console.log('  OK    function-free CHECK with non-cascading FK');
} catch (e) {
  console.log(`  FAIL  function-free CHECK -> ${e.message}`);
}

await c.query('DROP TABLE IF EXISTS `__probe_gen`');
await c.query('DROP TABLE IF EXISTS `__probe_chk`');
await c.end();
