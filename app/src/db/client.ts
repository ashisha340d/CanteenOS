import type * as SQLite from 'expo-sqlite';
import { CREATE_SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';
import { openDatabase } from './sqliteDriver';

const DB_NAME = 'menuboard.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let openPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens (once) and migrates the local database. Every repository goes through this
 * accessor — there is exactly one connection for the app's lifetime, matching
 * expo-sqlite's recommended usage with WAL mode.
 */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  if (!openPromise) {
    openPromise = openAndMigrate();
  }
  dbInstance = await openPromise;
  return dbInstance;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  // `openDatabase` is platform-resolved: expo-sqlite on Android, a sql.js-backed shim in the
  // browser. It returns a connection with its pragmas already applied, since which pragmas
  // are meaningful (WAL in particular) is a property of the storage engine. See sqliteDriver.ts.
  const db = await openDatabase(DB_NAME);

  await runMigrations(db);
  return db;
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  type: string,
): Promise<void> {
  const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
  const exists = info.some((row) => row.name === column);
  if (!exists) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
  }
}

/**
 * Versioned migration runner. The current version lives in `settings.db_schema_version`
 * (per docs/sqlite-schema.sql). Future phases append further version steps here rather than
 * editing the statements already applied.
 */
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS settings (
    setting_key  TEXT PRIMARY KEY NOT NULL,
    value        TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );`);

  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE setting_key = ?',
    ['db_schema_version'],
  );
  const currentVersion = row ? (JSON.parse(row.value) as number) : 0;

  if (currentVersion < SCHEMA_VERSION) {
    await db.withTransactionAsync(async () => {
      // v2 widened thread_messages into the board feed (board_id added, order_id made
      // nullable). `CREATE TABLE IF NOT EXISTS` cannot alter an existing table, so the old
      // one is dropped and the sync cursor rewound — every row here is a cache of
      // server-authoritative data, and unpushed local writes live in sync_queue with their
      // own payload, so nothing is lost by refetching.
      if (currentVersion > 0 && currentVersion < 2) {
        await db.execAsync('DROP TABLE IF EXISTS thread_messages;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v3 added billing/shopping/done stamps to orders and cancel/replace to order_items,
      // and brought recipes, shopping lists and alert settings down to the device. Same
      // reasoning as v2: these tables are a cache, and anything not yet pushed is held in
      // sync_queue with its own payload, so dropping and refetching loses nothing.
      if (currentVersion > 0 && currentVersion < 3) {
        await db.execAsync('DROP TABLE IF EXISTS order_items;');
        await db.execAsync('DROP TABLE IF EXISTS orders;');
        await db.execAsync('DROP TABLE IF EXISTS thread_messages;');
        await db.execAsync('DROP TABLE IF EXISTS acknowledgements;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v4 added Hindi names to the menu catalogue. Master data is a pure read-only cache,
      // so dropping the two tables and letting the next pull refill them is the whole
      // migration — no local writes can be lost here.
      if (currentVersion > 0 && currentVersion < 4) {
        await db.execAsync('DROP TABLE IF EXISTS menu_items;');
        await db.execAsync('DROP TABLE IF EXISTS menu_categories;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v5 ported the recipe data model: menu items may now have multiple recipe variants
      // (is_default flag), recipes gained prep/cook time, team size, difficulty, descriptions
      // and structured steps in place of a single instructions field, and recipe_ingredients
      // now references a new ingredients master by id instead of a free-text name. All four
      // tables are pure read-only synced caches, so — same reasoning as v2/v3/v4 — dropping
      // the ones whose shape changed and letting the next pull refill everything (including
      // the brand-new ingredients/recipe_steps tables via CREATE_SCHEMA_STATEMENTS below) loses
      // nothing.
      if (currentVersion > 0 && currentVersion < 5) {
        await db.execAsync('DROP TABLE IF EXISTS recipe_ingredients;');
        await db.execAsync('DROP TABLE IF EXISTS recipe_steps;');
        await db.execAsync('DROP TABLE IF EXISTS recipes;');
        await db.execAsync('DROP TABLE IF EXISTS ingredients;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v6 added admin-configurable appearance (color, photo_path) to boards. Boards are a
      // read-only synced cache, so — same reasoning as v2-v5 — dropping and refetching loses
      // nothing.
      if (currentVersion > 0 && currentVersion < 6) {
        await db.execAsync('DROP TABLE IF EXISTS boards;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v7 added a deleted_at tombstone to notifications so a user-initiated delete removes
      // the row everywhere it has synced. Same reasoning as the others: a read-only cache, so
      // dropping and refetching loses nothing.
      if (currentVersion > 0 && currentVersion < 7) {
        await db.execAsync('DROP TABLE IF EXISTS notifications;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v8 introduced Location -> Board -> Station: boards carried a required location_id,
      // and locations arrived as a new synced master table.
      if (currentVersion > 0 && currentVersion < 8) {
        await db.execAsync('DROP TABLE IF EXISTS boards;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v9 replaces that with Station -> Board: `locations` becomes `stations` (the
      // organisation's real-world site), the old board-scoped `stations` master is gone, and
      // `boards.location_id` becomes `boards.station_id`. Orders no longer carry a station_id
      // either. Same reasoning as v2-v8: these are read-only synced caches, so dropping and
      // refetching loses nothing beyond an offline write already queued in sync_queue.
      if (currentVersion > 0 && currentVersion < 9) {
        await db.execAsync('DROP TABLE IF EXISTS orders;');
        await db.execAsync('DROP TABLE IF EXISTS boards;');
        await db.execAsync('DROP TABLE IF EXISTS locations;');
        await db.execAsync('DROP TABLE IF EXISTS stations;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v10 lets an order line name its dish as free text: `order_items.menu_item_id` becomes
      // nullable and `custom_item_name` is added, so a kitchen can order something that has no
      // master record yet. SQLite cannot relax a NOT NULL in place, so the table is recreated.
      // Unlike v2-v9 this table can hold a *local* write that has not been pushed yet, but that
      // write also lives in sync_queue with its full payload, so the drain replays it after the
      // pull refills the cache.
      if (currentVersion > 0 && currentVersion < 10) {
        await db.execAsync('DROP TABLE IF EXISTS order_items;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v11 added assigned_to/assigned_at to orders — who owns getting the order done, as
      // distinct from who raised it. Adding a nullable column is the one shape change SQLite
      // does support in place, so this migration keeps the rows and only rewinds the cursor,
      // letting the next pull fill the new columns from the server.
      if (currentVersion > 0 && currentVersion < 11) {
        await db.execAsync('ALTER TABLE orders ADD COLUMN assigned_to TEXT;');
        await db.execAsync('ALTER TABLE orders ADD COLUMN assigned_at TEXT;');
        await db.runAsync('DELETE FROM settings WHERE setting_key = ?', ['sync_cursor']);
      }

      // v12 adds sync_error to tables that gained it after their initial creation. Earlier
      // migrations kept rows but did not add the column, so pushes that update sync_state fail.
      if (currentVersion > 0 && currentVersion < 12) {
        await addColumnIfMissing(db, 'orders', 'sync_error', 'TEXT');
        await addColumnIfMissing(db, 'boards', 'sync_error', 'TEXT');
        await addColumnIfMissing(db, 'thread_messages', 'sync_error', 'TEXT');
        await addColumnIfMissing(db, 'attachments', 'sync_error', 'TEXT');
      }

      for (const statement of CREATE_SCHEMA_STATEMENTS) {
        await db.execAsync(statement);
      }
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO settings (setting_key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ['db_schema_version', JSON.stringify(SCHEMA_VERSION), now],
      );
    });
  }
}

/** Test/dev helper: drops the cached connection so the next `getDb()` reopens it. */
export function resetDbConnectionForTesting(): void {
  dbInstance = null;
  openPromise = null;
}
