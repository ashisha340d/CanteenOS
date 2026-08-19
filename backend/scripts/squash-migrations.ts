/* eslint-disable no-console */
/**
 * One-shot tool: squash the existing forward-only migrations into a single baseline file.
 *
 * 1. Applies every current migration into a throwaway database (so no dev data can leak in).
 * 2. Dumps that database — DDL from SHOW CREATE TABLE plus the seed rows the migrations insert.
 * 3. Applies the dump alone into a second throwaway database and diffs both against each other.
 *
 * Run: npx tsx scripts/squash-migrations.ts [--keep]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config';

const SRC_DB = 'menuboard_squash_src';
const VERIFY_DB = 'menuboard_squash_verify';
const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations');
const OUT_FILE = path.resolve(__dirname, '../.tmp-schema.sql');

/**
 * Text-ish columns are read back verbatim. Without this mysql2 parses JSON columns into JS
 * values, and re-serialising those loses the stored form — a `"CLN"` setting would be written
 * back as `CLN`, which fails the `json_valid` CHECK.
 */
const RAW_STRING_TYPES = new Set([
  'JSON',
  'BLOB',
  'TINY_BLOB',
  'MEDIUM_BLOB',
  'LONG_BLOB',
  'STRING',
  'VAR_STRING',
  'VARCHAR',
]);

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
    typeCast: (field, next) => (RAW_STRING_TYPES.has(field.type) ? field.string() : next()),
  });
}

async function recreate(name: string): Promise<void> {
  const root = await connect();
  await root.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await root.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.end();
}

async function applyMigrations(database: string): Promise<string[]> {
  const names = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const connection = await connect(database);
  for (const name of names) {
    const sql = (await fs.readFile(path.join(MIGRATIONS_DIR, name), 'utf8')).replace(/\r\n/g, '\n');
    try {
      await connection.query(sql);
    } catch (error) {
      throw new Error(`${name}: ${(error as Error).message}`);
    }
  }
  await connection.end();
  return names;
}

async function tableNames(c: mysql.Connection, database: string): Promise<string[]> {
  const [rows] = await c.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
    [database],
  );
  return rows.map((r) => String(r.TABLE_NAME));
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`;
  if (typeof value === 'object') return mysql.escape(JSON.stringify(value));
  return mysql.escape(value);
}

async function dump(database: string): Promise<string> {
  const c = await connect(database);
  const tables = await tableNames(c, database);

  const [binary] = await c.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND DATA_TYPE IN ('blob','longblob','mediumblob','tinyblob','binary','varbinary')`,
    [database],
  );
  if (binary.length > 0) {
    throw new Error(
      `Binary columns present, dump would corrupt them: ${binary
        .map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`)
        .join(', ')}`,
    );
  }

  const ddl: string[] = [];
  const data: string[] = [];

  for (const table of tables) {
    const [created] = await c.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``);
    const statement = String(created[0]['Create Table'])
      .replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ')
      .replace(/ AUTO_INCREMENT=\d+/g, '');
    ddl.push(`${statement};`);

    // The ledger's own rows belong to whoever runs the migration, not to the baseline.
    if (table === 'schema_migrations') continue;

    // Generated columns are computed, never inserted into.
    const [columns] = await c.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%'
        ORDER BY ORDINAL_POSITION`,
      [database, table],
    );
    const insertable = columns.map((r) => String(r.COLUMN_NAME));

    const [rows] = await c.query<mysql.RowDataPacket[]>(
      `SELECT ${insertable.map((n) => `\`${n}\``).join(', ')} FROM \`${table}\``,
    );
    if (rows.length === 0) continue;

    const values = rows.map((row) => `  (${insertable.map((n) => literal(row[n])).join(', ')})`);
    data.push(
      `INSERT INTO \`${table}\` (${insertable.map((n) => `\`${n}\``).join(', ')}) VALUES\n` +
      `${values.join(',\n')};`,
    );
  }

  await c.end();

  const header = [
    '-- MenuBoard baseline schema.',
    '--',
    `-- Squashed from the 001..039 migration series on ${new Date().toISOString().slice(0, 10)}.`,
    '-- Generated from a clean database built by applying that series in order, so this file is',
    '-- exactly what those migrations produced: table definitions plus the reference rows they',
    '-- seeded. No development data is included.',
    '--',
    '-- This file is immutable, like any applied migration. Schema changes from here on are new',
    '-- numbered files (002_*.sql and up) — the runner checksums what it has applied and will',
    '-- refuse to start if this one is edited.',
    '',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
  ].join('\n');

  return `${header}${ddl.join('\n\n')}\n\n-- Seed data.\n\n${data.join('\n\n')}\n\nSET FOREIGN_KEY_CHECKS = 1;\n`;
}

interface Snapshot {
  columns: string[];
  indexes: string[];
  constraints: string[];
  rowCounts: string[];
}

async function snapshot(database: string): Promise<Snapshot> {
  const c = await connect(database);
  const tables = await tableNames(c, database);

  const [columns] = await c.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA,
            COLLATION_NAME, GENERATION_EXPRESSION
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    [database],
  );
  const [indexes] = await c.query<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE, SUB_PART
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database],
  );
  const [constraints] = await c.query<mysql.RowDataPacket[]>(
    `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
            k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = ?
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [database],
  );

  const rowCounts: string[] = [];
  for (const table of tables) {
    const [[count]] = await c.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM \`${table}\``,
    );
    rowCounts.push(`${table}=${count.n}`);
  }

  await c.end();
  const flatten = (rows: mysql.RowDataPacket[]): string[] =>
    rows.map((row) => JSON.stringify(row, (_key, value) => (value === null ? '~null' : value)));

  return {
    columns: flatten(columns),
    indexes: flatten(indexes),
    constraints: flatten(constraints),
    rowCounts,
  };
}

function diff(label: string, left: string[], right: string[]): string[] {
  const missing = left.filter((entry) => !right.includes(entry));
  const extra = right.filter((entry) => !left.includes(entry));
  return [
    ...missing.map((entry) => `${label} missing from baseline: ${entry}`),
    ...extra.map((entry) => `${label} unexpected in baseline: ${entry}`),
  ];
}

async function main(): Promise<void> {
  console.log('Building reference database from current migrations...');
  await recreate(SRC_DB);
  const applied = await applyMigrations(SRC_DB);
  console.log(`  applied ${applied.length} migrations into ${SRC_DB}`);

  console.log('Dumping baseline...');
  const baseline = await dump(SRC_DB);
  await fs.writeFile(OUT_FILE, baseline, 'utf8');
  console.log(`  wrote ${OUT_FILE} (${(baseline.length / 1024).toFixed(1)} KiB)`);

  console.log('Verifying baseline reproduces the same database...');
  await recreate(VERIFY_DB);
  const c = await connect(VERIFY_DB);
  await c.query(baseline);
  await c.end();

  const [reference, rebuilt] = await Promise.all([snapshot(SRC_DB), snapshot(VERIFY_DB)]);
  const problems = [
    ...diff('column', reference.columns, rebuilt.columns),
    ...diff('index', reference.indexes, rebuilt.indexes),
    ...diff('foreign key', reference.constraints, rebuilt.constraints),
    ...diff('row count', reference.rowCounts, rebuilt.rowCounts),
  ];

  if (problems.length > 0) {
    console.error(`\nFAILED — ${problems.length} difference(s):`);
    for (const problem of problems.slice(0, 40)) console.error(`  ${problem}`);
    process.exit(1);
  }

  // Strongest check: dumping the rebuilt database must reproduce the baseline byte for byte.
  const roundTrip = await dump(VERIFY_DB);
  if (roundTrip !== baseline) {
    const left = baseline.split('\n');
    const right = roundTrip.split('\n');
    const at = left.findIndex((line, index) => line !== right[index]);
    console.error(`\nFAILED — round-trip dump differs at line ${at + 1}:`);
    console.error(`  baseline: ${left[at]}`);
    console.error(`  rebuilt : ${right[at]}`);
    process.exit(1);
  }

  console.log(`\nOK — identical schema and seed rows (${reference.rowCounts.length} tables).`);

  if (!process.argv.includes('--keep')) {
    const root = await connect();
    await root.query(`DROP DATABASE IF EXISTS \`${SRC_DB}\``);
    await root.query(`DROP DATABASE IF EXISTS \`${VERIFY_DB}\``);
    await root.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
