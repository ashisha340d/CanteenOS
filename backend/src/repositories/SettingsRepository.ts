import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { SettingRow } from '../models/rows';
import { parseJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

/**
 * Server-side configuration for the Admin Portal Settings page. Values are JSON-encoded so
 * a setting can be a scalar, list or object without a schema change.
 */
export class SettingsRepository {
  async findAll(db: Db): Promise<SettingRow[]> {
    return selectRows<SettingRow>(
      db,
      `SELECT setting_key, value, description, updated_by, updated_at
         FROM settings ORDER BY setting_key ASC`,
    );
  }

  async find(db: Db, key: string): Promise<SettingRow | null> {
    return selectOne<SettingRow>(
      db,
      `SELECT setting_key, value, description, updated_by, updated_at
         FROM settings WHERE setting_key = ?`,
      [key],
    );
  }

  async getValue<T>(db: Db, key: string, fallback: T): Promise<T> {
    const row = await this.find(db, key);
    return row === null ? fallback : parseJsonColumn<T>(row.value, fallback);
  }

  async upsert(
    db: Db,
    key: string,
    value: unknown,
    options: { description?: string | null; updatedBy: string | null },
  ): Promise<SettingRow> {
    await mutate(
      db,
      `INSERT INTO settings (setting_key, value, description, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value       = VALUES(value),
         description = COALESCE(VALUES(description), settings.description),
         updated_by  = VALUES(updated_by),
         updated_at  = VALUES(updated_at)`,
      [
        key,
        JSON.stringify(value ?? null),
        options.description ?? null,
        options.updatedBy,
        toDbDateTime(),
      ],
    );

    const row = await this.find(db, key);
    if (row === null) throw new Error(`Upserted setting ${key} could not be read back`);
    return row;
  }

  async remove(db: Db, key: string): Promise<boolean> {
    const result = await mutate(db, 'DELETE FROM settings WHERE setting_key = ?', [key]);
    return result.affectedRows > 0;
  }
}

export const settingsRepository = new SettingsRepository();
