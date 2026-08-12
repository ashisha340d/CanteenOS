import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type { SettingRow } from '../models';
import { nowIso } from '../../utils/date';

/**
 * Device-local key/value store — session metadata, the sync cursor and device preferences
 * only (never system configuration; docs/sqlite-schema.sql comment on `settings`).
 */
export const settingsRepository = {
  async get<T>(key: string): Promise<T | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<SettingRow>(
      'SELECT * FROM settings WHERE setting_key = ?',
      [key],
    );
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  },

  async set<T>(key: string, value: T, tx?: SQLite.SQLiteDatabase): Promise<void> {
    const db = tx ?? (await getDb());
    await db.runAsync(
      `INSERT INTO settings (setting_key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), nowIso()],
    );
  },

  async remove(key: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM settings WHERE setting_key = ?', [key]);
  },
};

export const SETTINGS_KEYS = {
  DB_SCHEMA_VERSION: 'db_schema_version',
  SYNC_CURSOR: 'sync_cursor',
  LAST_SYNC_AT: 'last_sync_at',
  CURRENT_USER_ID: 'current_user_id',
  REMEMBER_LOGIN: 'remember_login',
  DEVICE_ID: 'device_id',
  /** Device-level preferences only (ARCHITECTURE.md §3 "Settings / configuration: Device prefs only"). */
  THEME_PREFERENCE: 'pref_theme',
  NOTIFICATION_SOUND_ENABLED: 'pref_notification_sound_enabled',
  /** Interface language, `'en' | 'hi'` — see `src/state/languageStore.ts`. */
  LANGUAGE: 'pref_language',
  PIN_ENABLED: 'pref_pin_enabled',
  PIN_IDENTIFIER: 'pref_pin_identifier',
} as const;
