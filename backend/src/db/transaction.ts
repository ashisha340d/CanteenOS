import { getPool, type PoolConnection } from './pool';
import { logger } from '../utils/logger';
import { isAppError } from '../utils/errors';

/**
 * Runs `work` inside a transaction, committing on return and rolling back on throw.
 *
 * Nesting is handled by passing an existing connection: `withTransaction(fn, existing)`
 * reuses it and does NOT open a nested transaction, so a service method can be called both
 * standalone and as part of a larger unit of work without either caller knowing.
 */
export async function withTransaction<T>(
  work: (connection: PoolConnection) => Promise<T>,
  existing?: PoolConnection,
): Promise<T> {
  if (existing) {
    return work(existing);
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      // A failed rollback means the connection is unusable; log and let it be destroyed.
      logger.error('Transaction rollback failed', undefined, rollbackError);
    }
    if (!isAppError(error)) {
      logger.error('Transaction rolled back after unexpected error', undefined, error);
    }
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Retries a transaction on deadlock or lock-wait timeout. Used for the few paths that
 * contend on the same rows — notably sync push, where several devices may touch one order.
 */
export async function withRetryingTransaction<T>(
  work: (connection: PoolConnection) => Promise<T>,
  options: { attempts?: number } = {},
): Promise<T> {
  return retryOnLockContention(() => withTransaction(work), options);
}

/**
 * Retries `work` on deadlock or lock-wait timeout without opening a transaction of its own.
 *
 * Used where the work already manages its own transaction internally. Wrapping such work in an
 * outer transaction would be worse than useless: the inner transaction runs on a different pooled
 * connection, so it would block waiting for locks the outer one is still holding — a self-deadlock
 * that only resolves when innodb_lock_wait_timeout expires.
 */
export async function retryOnLockContention<T>(
  work: () => Promise<T>,
  options: { attempts?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      const retryable = code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT';
      if (!retryable || attempt === attempts) throw error;

      const backoffMs = 25 * 2 ** (attempt - 1);
      logger.warn('Retrying after lock contention', { attempt, code, backoffMs });
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}
