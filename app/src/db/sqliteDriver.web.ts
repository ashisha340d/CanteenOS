import type * as SQLite from 'expo-sqlite';
import type { Database as SqlJsDatabase, SqlValue } from 'sql.js';
// The `-browser` build is the same wasm binary (identical checksum) with browser-only glue,
// so Metro never has to resolve Node built-ins. See src/types/sqljs-browser.d.ts.
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';

/**
 * Browser development driver — a real SQLite engine (sql.js, SQLite compiled to wasm) behind
 * the slice of the `expo-sqlite` API this app uses. See `sqliteDriver.ts` for why web needs a
 * driver of its own at all.
 *
 * Because it is genuine SQLite, the schema in `schema.ts` runs unmodified: foreign keys,
 * `ON CONFLICT` upserts, partial indexes and transactions all behave as they do on Android.
 * Two things differ, and both are acceptable for a development target:
 *
 *  - **Storage.** sql.js holds the database in wasm memory. The whole file is serialised to
 *    IndexedDB shortly after each write, so a page reload keeps your data, but it is not the
 *    incremental journalled write Android gets. WAL is meaningless here and is not set.
 *  - **Durability.** Up to `PERSIST_DEBOUNCE_MS` of writes can be lost if the tab is killed
 *    outright. A `pagehide` flush covers the normal close/reload path.
 */
export type SqliteDatabase = SQLite.SQLiteDatabase;

/** True when the active driver is the browser development shim rather than real expo-sqlite. */
export const IS_WEB_SQLITE_SHIM = true;

/** `public/sql-wasm.wasm`, served at the site root by Expo's static middleware in dev. */
const WASM_URL = '/sql-wasm.wasm';

const IDB_NAME = 'menuboard-sqlite-shim';
const IDB_STORE = 'databases';
const PERSIST_DEBOUNCE_MS = 200;

/* -------------------------------------------------------------------------- */
/* IndexedDB persistence                                                       */
/* -------------------------------------------------------------------------- */

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbRead(key: string): Promise<Uint8Array | null> {
  const idb = await openIdb();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const request = idb.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (value instanceof Uint8Array) resolve(value);
        else if (value instanceof ArrayBuffer) resolve(new Uint8Array(value));
        else resolve(null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    idb.close();
  }
}

async function idbWrite(key: string, bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Parameter binding                                                           */
/* -------------------------------------------------------------------------- */

/**
 * expo-sqlite accepts booleans, `undefined` and `Date`s and coerces them; sql.js throws on
 * anything outside `string | number | Uint8Array | null`, so normalise here to keep the
 * repositories identical across platforms.
 */
function toBindValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Repositories call `runAsync(sql, [a, b])`, but expo-sqlite also permits the variadic
 * `runAsync(sql, a, b)` form. Accept both so nothing has to change to run on web.
 */
function normalizeParams(params: unknown[]): SqlValue[] {
  const source = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return source.map(toBindValue);
}

/* -------------------------------------------------------------------------- */
/* Driver                                                                      */
/* -------------------------------------------------------------------------- */

let sqlDb: SqlJsDatabase | null = null;
let persistKey = '';
let dirty = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Serialises every database operation. sql.js is synchronous, but `withTransactionAsync`
 * awaits caller code between `BEGIN` and `COMMIT` — without this queue a concurrent write
 * from the sync engine could land inside somebody else's open transaction.
 */
let opChain: Promise<unknown> = Promise.resolve();
/** >0 while the queue lock is held, so operations nested inside a locked section don't deadlock. */
let lockDepth = 0;
/** >0 while a SQL transaction is open. Guards both nesting and mid-transaction snapshots. */
let txDepth = 0;

function withLock<T>(operation: () => Promise<T>): Promise<T> {
  if (lockDepth > 0) return operation();

  const run = async (): Promise<T> => {
    lockDepth++;
    try {
      return await operation();
    } finally {
      lockDepth--;
    }
  };

  const result = opChain.then(run, run);
  opChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function schedulePersist(): void {
  dirty = true;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void flushPersist(), PERSIST_DEBOUNCE_MS);
}

async function flushPersist(): Promise<void> {
  persistTimer = null;
  if (!dirty || !sqlDb) return;
  // Never serialise while a transaction is open — that snapshot would contain uncommitted
  // rows. The timer can only fire in an `await` gap inside the transaction body.
  if (txDepth > 0) {
    schedulePersist();
    return;
  }
  dirty = false;
  try {
    await idbWrite(persistKey, sqlDb.export());
  } catch (error) {
    dirty = true;
    console.warn('[sqlite-web] failed to persist database to IndexedDB', error);
  }
}

function query(sql: string, params: SqlValue[]): Record<string, SqlValue>[] {
  if (!sqlDb) throw new Error('Database is not open');
  const statement = sqlDb.prepare(sql);
  try {
    if (params.length > 0) statement.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function createDatabase(): SQLite.SQLiteDatabase {
  const shim = {
    async execAsync(source: string): Promise<void> {
      return withLock(async () => {
        if (!sqlDb) throw new Error('Database is not open');
        sqlDb.run(source);
        schedulePersist();
      });
    },

    async runAsync(source: string, ...params: unknown[]): Promise<SQLite.SQLiteRunResult> {
      return withLock(async () => {
        if (!sqlDb) throw new Error('Database is not open');
        sqlDb.run(source, normalizeParams(params));
        schedulePersist();
        const [row] = query('SELECT last_insert_rowid() AS id', []);
        return {
          lastInsertRowId: Number(row?.id ?? 0),
          changes: sqlDb.getRowsModified(),
        };
      });
    },

    async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
      return withLock(async () => {
        const rows = query(source, normalizeParams(params));
        return (rows[0] as T | undefined) ?? null;
      });
    },

    async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
      return withLock(async () => query(source, normalizeParams(params)) as T[]);
    },

    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      return withLock(async () => {
        if (!sqlDb) throw new Error('Database is not open');
        // SQLite rejects a nested BEGIN. expo-sqlite has the same constraint, so this only
        // fires if calling code nests by accident — join the outer transaction rather than
        // failing in a way that would not reproduce on Android.
        if (txDepth > 0) {
          await task();
          return;
        }
        txDepth++;
        sqlDb.run('BEGIN');
        try {
          await task();
          sqlDb.run('COMMIT');
          schedulePersist();
        } catch (error) {
          try {
            sqlDb.run('ROLLBACK');
          } catch {
            /* the transaction was already unwound by SQLite */
          }
          throw error;
        } finally {
          txDepth--;
        }
      });
    },

    async closeAsync(): Promise<void> {
      await flushPersist();
      sqlDb?.close();
      sqlDb = null;
    },
  };

  // The shim implements the five methods this app uses, not all ~30 of `SQLiteDatabase`.
  // Repositories are typed against the real interface, so assert at this single boundary
  // rather than weakening every repository signature.
  return shim as unknown as SQLite.SQLiteDatabase;
}

export async function openDatabase(name: string): Promise<SqliteDatabase> {
  const SQL = await initSqlJs({ locateFile: () => WASM_URL });

  persistKey = name;
  const saved = await idbRead(name);
  sqlDb = saved ? new SQL.Database(saved) : new SQL.Database();

  // No WAL: sql.js runs the database in memory and persists it whole (see the file comment).
  sqlDb.run('PRAGMA foreign_keys = ON;');

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => void flushPersist());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushPersist();
    });
  }

  return createDatabase();
}

/**
 * Development helper: wipes the browser-persisted database so the next reload starts from a
 * fresh schema. Call it from the devtools console via `window.__resetMenuBoardDb()`.
 */
export async function resetPersistedDatabase(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  dirty = false;
  sqlDb?.close();
  sqlDb = null;
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__resetMenuBoardDb = resetPersistedDatabase;
}
