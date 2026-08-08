import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

/**
 * Every repository method takes a `Db` rather than reaching for the pool itself. A service that
 * has opened a transaction passes its `PoolConnection`, so the repository's work joins that
 * transaction; otherwise it passes the pool and the query auto-commits.
 *
 * The union of mysql2's own types is used deliberately: an independent interface would drift from
 * the driver's real signatures.
 */
export type Db = Pool | PoolConnection;

export type { Pool, PoolConnection, RowDataPacket, ResultSetHeader };

/**
 * The driver's own parameter type. Derived from mysql2 rather than restated, so the one cast
 * below stays anchored to whatever the driver actually accepts.
 */
type DriverValues = Parameters<Pool['execute']>[1];

/**
 * Repositories build parameter arrays as `readonly unknown[]` — the safest shape for code that
 * assembles them from spreads. mysql2 wants a mutable, non-`unknown` array, so the conversion
 * happens exactly here instead of at every call site.
 */
function toDriverValues(values: readonly unknown[]): DriverValues {
  return values as DriverValues;
}

/** Convenience helpers that unwrap mysql2's `[rows, fields]` tuple. */
export async function selectRows<T extends RowDataPacket>(
  db: Db,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const [rows] = await db.execute<T[]>(sql, toDriverValues(values));
  return rows;
}

export async function selectOne<T extends RowDataPacket>(
  db: Db,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await selectRows<T>(db, sql, values);
  return rows.length > 0 ? (rows[0] as T) : null;
}

export async function mutate(
  db: Db,
  sql: string,
  values: readonly unknown[] = [],
): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, toDriverValues(values));
  return result;
}
