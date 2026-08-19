/* eslint-disable no-console */
/**
 * One-shot tool: point an already-migrated database at the squashed baseline.
 *
 * The 001..039 series was replaced by a single `001_schema.sql`, so an existing database has a
 * ledger full of names that no longer exist on disk and one pending file it must not run. This
 * proves the live schema really does match the baseline — by building a throwaway database from
 * it and diffing structure — and only then rewrites the ledger to a single baseline row.
 *
 * Run: npx tsx scripts/stamp-baseline.ts
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config';

const CHECK_DB = 'menuboard_stamp_check';
const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations');

async function connect(database?: string) {
  return mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: true,
  });
}

async function tableNames(c: mysql.Connection, database: string): Promise<Set<string>> {
  const [rows] = await c.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [database],
  );
  return new Set(rows.map((r) => String(r.TABLE_NAME)));
}

async function structure(database: string): Promise<string[]> {
  const c = await connect(database);
  const queries: [string, string][] = [
    [
      'column',
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,
              COLLATION_NAME, GENERATION_EXPRESSION
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, COLUMN_NAME`,
    ],
    [
      'index',
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE, SUB_PART
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    ],
    [
      'foreign key',
      `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
              k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.CONSTRAINT_SCHEMA = ?
        ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    ],
  ];

  const entries: string[] = [];
  for (const [label, sql] of queries) {
    const [rows] = await c.query<mysql.RowDataPacket[]>(sql, [database]);
    entries.push(...rows.map((row) => `${label} ${JSON.stringify(row)}`));
  }
  await c.end();
  return entries;
}

async function main(): Promise<void> {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length !== 1) {
    throw new Error(`Expected exactly one baseline migration, found: ${files.join(', ')}`);
  }
  const [name] = files;
  const sql = (await fs.readFile(path.join(MIGRATIONS_DIR, name), 'utf8')).replace(/\r\n/g, '\n');
  const checksum = createHash('sha256').update(sql).digest('hex');

  console.log(`Baseline: ${name} (${checksum.slice(0, 12)})`);

  const root = await connect();
  await root.query(`DROP DATABASE IF EXISTS \`${CHECK_DB}\``);
  await root.query(`CREATE DATABASE \`${CHECK_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.end();

  const fresh = await connect(CHECK_DB);
  await fresh.query(sql);
  await fresh.end();

  const [live, expected] = await Promise.all([structure(config.db.database), structure(CHECK_DB)]);

  // Tables the baseline knows nothing about are leftovers from migrations that were deleted
  // rather than reverted. They are not the baseline's business, so they are reported and
  // skipped — but anything the baseline does define has to match exactly.
  const liveConnection = await connect(config.db.database);
  const checkConnection = await connect(CHECK_DB);
  const baselineTables = await tableNames(checkConnection, CHECK_DB);
  const liveTables = await tableNames(liveConnection, config.db.database);
  await checkConnection.end();
  const orphanTables = [...liveTables].filter((table) => !baselineTables.has(table));
  const isOrphan = (entry: string): boolean =>
    orphanTables.some((table) => entry.includes(`"TABLE_NAME":"${table}"`));

  const missing = expected.filter((entry) => !live.includes(entry));
  const extra = live.filter((entry) => !expected.includes(entry) && !isOrphan(entry));

  if (orphanTables.length > 0) {
    console.log(`  ignoring ${orphanTables.length} table(s) unknown to the baseline: ${orphanTables.join(', ')}`);
  }

  if (missing.length > 0 || extra.length > 0) {
    console.error(
      `\nFAILED — ${config.db.database} does not match the baseline ` +
      `(${missing.length} missing, ${extra.length} unexpected). Ledger left untouched.`,
    );
    for (const entry of [...missing.map((e) => `missing: ${e}`), ...extra.map((e) => `extra:   ${e}`)].slice(0, 40)) {
      console.error(`  ${entry}`);
    }
    await liveConnection.end();
    process.exit(1);
  }

  const [before] = await liveConnection.query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM schema_migrations',
  );
  await liveConnection.query('DELETE FROM schema_migrations');
  await liveConnection.query(
    'INSERT INTO schema_migrations (name, checksum, applied_at, duration_ms) VALUES (?, ?, UTC_TIMESTAMP(3), 0)',
    [name, checksum],
  );
  await liveConnection.end();

  const root2 = await connect();
  await root2.query(`DROP DATABASE IF EXISTS \`${CHECK_DB}\``);
  await root2.end();

  console.log(
    `\nOK — ${config.db.database} matches the baseline. ` +
    `Ledger rewritten: ${before[0].n} rows -> 1 (${name}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
