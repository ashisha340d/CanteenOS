import * as SQLite from 'expo-sqlite';

/**
 * Storage driver for the local database — the one place the app talks to a SQLite engine.
 *
 * This file is the Android/native driver and is expo-sqlite verbatim. Metro resolves
 * `sqliteDriver.web.ts` instead when bundling for web, because expo-sqlite 14.x (SDK 51) has
 * **no** web implementation: `expo-sqlite/build/ExpoSQLiteNext.js` is a stub whose
 * `NativeDatabase` is a plain object method rather than a class, so `openDatabaseAsync` fails
 * with "NativeDatabase is not a constructor" the moment it is called in a browser. Real
 * wasm-backed web support only lands in expo-sqlite 15 / SDK 52.
 *
 * Android remains the shipping target (docs/MENUBOARD_SPEC.md §"The Android exclusion is
 * structural"); the web driver exists so screens and repositories can be developed in Chrome
 * or Edge without an emulator round-trip.
 */
export type SqliteDatabase = SQLite.SQLiteDatabase;

/** True when the active driver is the browser development shim rather than real expo-sqlite. */
export const IS_WEB_SQLITE_SHIM = false;

/**
 * Opens the database and applies the connection-level pragmas. These are storage-engine
 * concerns, which is exactly what differs between the two drivers, so they live here rather
 * than in `client.ts`.
 */
export async function openDatabase(name: string): Promise<SqliteDatabase> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('PRAGMA synchronous = NORMAL;');
  return db;
}
