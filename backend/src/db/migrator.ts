import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Forward-only migration runner.
 *
 * Files are applied in filename order and recorded in `schema_migrations` with a SHA-256
 * checksum. If an already-applied file's checksum has changed the run aborts: silently
 * diverging from what production actually has is worse than a hard stop.
 *
 * Migrations run on a dedicated connection with `multipleStatements` enabled so each file
 * executes as a single unit; the request-serving pool keeps that flag off.
 */

/**
 * Migration files live beside this module. A compiled build has them copied into dist by
 * scripts/copy-assets.mjs; the src fallback keeps `tsx` dev runs working if that step was skipped,
 * so the two modes never disagree about which migrations exist.
 */
function migrationsDir(): string {
  const beside = path.resolve(__dirname, 'migrations');
  if (existsSync(beside)) return beside;
  return path.resolve(config.packageRoot, 'src/db/migrations');
}

export interface MigrationRecord {
  name: string;
  checksum: string;
  appliedAt: string | null;
  status: 'APPLIED' | 'PENDING' | 'CHECKSUM_MISMATCH';
}

interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

async function migrationConnection() {
  return mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: true,
  });
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const directory = migrationsDir();
  const entries = await fs.readdir(directory);
  const sqlFiles = entries.filter((entry) => entry.endsWith('.sql')).sort();

  const files: MigrationFile[] = [];
  for (const name of sqlFiles) {
    const sql = await fs.readFile(path.join(directory, name), 'utf8');
    // Normalise line endings before hashing so a Windows checkout and a Linux deploy
    // produce the same checksum for identical content.
    const normalised = sql.replace(/\r\n/g, '\n');
    files.push({
      name,
      sql: normalised,
      checksum: createHash('sha256').update(normalised).digest('hex'),
    });
  }
  return files;
}

/** The ledger has to exist before it can be consulted, so it is created out of band. */
const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(190) NOT NULL,
  checksum    CHAR(64)     NOT NULL,
  applied_at  DATETIME(3)  NOT NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migrations_name (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`;

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  const connection = await migrationConnection();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await connection.query(LEDGER_DDL);

    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const alreadyApplied = new Map<string, string>(
      rows.map((row) => [String(row.name), String(row.checksum)]),
    );

    for (const file of await loadMigrationFiles()) {
      const existingChecksum = alreadyApplied.get(file.name);

      if (existingChecksum !== undefined) {
        if (existingChecksum !== file.checksum) {
          throw new Error(
            `Migration ${file.name} has changed since it was applied ` +
              `(recorded ${existingChecksum.slice(0, 12)}, found ${file.checksum.slice(0, 12)}). ` +
              'Migrations are immutable — add a new migration instead of editing this one.',
          );
        }
        skipped.push(file.name);
        continue;
      }

      logger.info('Applying migration', { migration: file.name });
      const startedAt = Date.now();
      await connection.query(file.sql);
      const durationMs = Date.now() - startedAt;

      await connection.query(
        'INSERT INTO schema_migrations (name, checksum, applied_at, duration_ms) VALUES (?, ?, UTC_TIMESTAMP(3), ?)',
        [file.name, file.checksum, durationMs],
      );
      applied.push(file.name);
      logger.info('Migration applied', { migration: file.name, durationMs });
    }

    return { applied, skipped };
  } finally {
    await connection.end();
  }
}

export async function migrationStatus(): Promise<MigrationRecord[]> {
  const connection = await migrationConnection();
  try {
    await connection.query(LEDGER_DDL);
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT name, checksum, applied_at FROM schema_migrations',
    );
    const recorded = new Map(rows.map((row) => [String(row.name), row]));

    return (await loadMigrationFiles()).map((file) => {
      const row = recorded.get(file.name);
      if (row === undefined) {
        return { name: file.name, checksum: file.checksum, appliedAt: null, status: 'PENDING' };
      }
      return {
        name: file.name,
        checksum: file.checksum,
        appliedAt: String(row.applied_at),
        status: String(row.checksum) === file.checksum ? 'APPLIED' : 'CHECKSUM_MISMATCH',
      };
    });
  } finally {
    await connection.end();
  }
}

/**
 * Creates the configured database if it does not exist. Connects with no database selected,
 * which is why it cannot use the shared pool.
 */
export async function ensureDatabase(): Promise<boolean> {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
  });

  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [config.db.database],
    );
    if (rows.length > 0) return false;

    // Identifier, not a value — parameter binding does not apply. The name comes from
    // trusted configuration, and is escaped defensively.
    await connection.query(
      `CREATE DATABASE \`${config.db.database.replace(/`/g, '')}\` ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
    logger.info('Database created', { database: config.db.database });
    return true;
  } finally {
    await connection.end();
  }
}
