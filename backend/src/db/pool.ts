import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Single shared connection pool. Created lazily so CLI tools that only need the DB name
 * (e.g. the bootstrap step that CREATEs the database) can import this module safely.
 */

let pool: Pool | null = null;

function baseOptions() {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    connectionLimit: config.db.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
    // The application is the single authority on time. Forcing UTC on the session removes
    // any dependence on the server's local timezone.
    timezone: 'Z',
    // Keep DATE / DATETIME / TIME as strings. mysql2's automatic Date conversion would
    // reinterpret them in the process timezone and silently shift required_date by a day.
    dateStrings: true as const,
    // DECIMAL and BIGINT arrive as strings by default; mapped explicitly in repositories.
    supportBigNumbers: true,
    multipleStatements: false,
    namedPlaceholders: false,
  };
}

export function getPool(): Pool {
  if (pool === null) {
    pool = mysql.createPool({ ...baseOptions(), database: config.db.database });
    logger.debug('Database pool created', {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      connectionLimit: config.db.connectionLimit,
    });
  }
  return pool;
}

/**
 * Server-level connection with no database selected. Used only by the bootstrap CLI to
 * create the schema before the pool can connect to it.
 */
export async function createServerConnection() {
  return mysql.createConnection({ ...baseOptions(), multipleStatements: true });
}

export async function verifyConnection(): Promise<void> {
  const connection = await getPool().getConnection();
  try {
    await connection.query('SELECT 1');
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

export type { Pool, PoolConnection };
