import type { Db, RowDataPacket } from './types';
import { selectOne, mutate } from './types';

interface LastInsertIdRow extends RowDataPacket {
  value: number | string;
}

/**
 * Allocates the next value of the global sync cursor.
 *
 * `LAST_INSERT_ID(expr)` sets the connection's last-insert-id as a side effect of the
 * UPDATE, and the row lock held until commit serialises allocation. The value is therefore
 * unique, monotonic and — critically — read back on the *same connection*, so concurrent
 * requests cannot see each other's value.
 *
 * MariaDB SEQUENCE objects would be more direct but do not exist in MySQL; this form works
 * on both.
 *
 * Must be called with the same connection as the write it stamps, inside that write's
 * transaction. Otherwise a reader could observe a row whose sync_seq is above a cursor that
 * has not been committed yet, and skip it forever.
 */
export async function allocateSyncSeq(db: Db): Promise<number> {
  await mutate(db, 'UPDATE sync_counter SET value = LAST_INSERT_ID(value + 1) WHERE id = 1');
  const row = await selectOne<LastInsertIdRow>(db, 'SELECT LAST_INSERT_ID() AS value');
  if (row === null) {
    throw new Error('Failed to allocate sync sequence: sync_counter row is missing');
  }
  return Number(row.value);
}

/**
 * Allocates `count` consecutive values and returns the first. Used when one transaction
 * writes many rows (e.g. an order plus its items) so it takes a single round trip instead
 * of one per row.
 */
export async function allocateSyncSeqBlock(db: Db, count: number): Promise<number> {
  if (count < 1) throw new Error('count must be at least 1');
  await mutate(db, 'UPDATE sync_counter SET value = LAST_INSERT_ID(value + ?) WHERE id = 1', [
    count,
  ]);
  const row = await selectOne<LastInsertIdRow>(db, 'SELECT LAST_INSERT_ID() AS value');
  if (row === null) {
    throw new Error('Failed to allocate sync sequence block: sync_counter row is missing');
  }
  // LAST_INSERT_ID holds the post-increment value; the block is [end - count + 1, end].
  return Number(row.value) - count + 1;
}

/** Highest allocated cursor. Returned to clients as the point to resume pulling from. */
export async function currentSyncSeq(db: Db): Promise<number> {
  const row = await selectOne<LastInsertIdRow>(
    db,
    'SELECT value FROM sync_counter WHERE id = 1',
  );
  return row === null ? 0 : Number(row.value);
}
