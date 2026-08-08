import type * as SQLite from 'expo-sqlite';
import type { AlertSettingDto, AlertSoundSlot, AlertType, UserRole } from '@menuboard/shared';
import { getDb } from '../client';
import { toJsonArray, parseJsonArray } from '../../utils/jsonArray';

/**
 * Alarm configuration, mirrored to the device.
 *
 * Organisation-wide and four rows long, but it has to be local: the alarm runtime schedules
 * notifications on the device, and a phone in a basement kitchen still needs to know how long
 * before delivery to warn, whether to keep repeating, and whether to vibrate. Admin-authored
 * on the server; strictly read-only here.
 */

interface AlertSettingRow {
  id: string;
  alert_type: string;
  enabled: number;
  lead_minutes: number;
  sound: string;
  repeat_until_ack: number;
  repeat_every_seconds: number;
  target_roles: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
  server_sync_seq: number;
}

function toDto(row: AlertSettingRow): AlertSettingDto {
  return {
    id: row.id,
    alertType: row.alert_type as AlertType,
    enabled: row.enabled === 1,
    leadMinutes: row.lead_minutes,
    sound: row.sound as AlertSoundSlot,
    repeatUntilAck: row.repeat_until_ack === 1,
    repeatEverySeconds: row.repeat_every_seconds,
    targetRoles: parseJsonArray(row.target_roles) as UserRole[],
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    syncSeq: row.server_sync_seq,
  };
}

export const alertSettingsRepository = {
  async upsertMany(rows: AlertSettingDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    const work = async (): Promise<void> => {
      for (const setting of rows) {
        await db.runAsync(
          `INSERT INTO alert_settings (id, alert_type, enabled, lead_minutes, sound,
             repeat_until_ack, repeat_every_seconds, target_roles, updated_by,
             created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             alert_type = excluded.alert_type, enabled = excluded.enabled,
             lead_minutes = excluded.lead_minutes, sound = excluded.sound,
             repeat_until_ack = excluded.repeat_until_ack,
             repeat_every_seconds = excluded.repeat_every_seconds,
             target_roles = excluded.target_roles, updated_by = excluded.updated_by,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq`,
          [
            setting.id, setting.alertType, setting.enabled ? 1 : 0, setting.leadMinutes,
            setting.sound, setting.repeatUntilAck ? 1 : 0, setting.repeatEverySeconds,
            toJsonArray(setting.targetRoles), setting.updatedBy, setting.createdAt,
            setting.updatedAt, setting.deletedAt, setting.revision, setting.syncSeq,
          ],
        );
      }
    };
    await (tx ? work() : db.withTransactionAsync(work));
  },

  async list(): Promise<AlertSettingDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<AlertSettingRow>(
      'SELECT * FROM alert_settings WHERE deleted_at IS NULL ORDER BY alert_type ASC',
    );
    return rows.map(toDto);
  },

  async findByType(alertType: AlertType): Promise<AlertSettingDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<AlertSettingRow>(
      'SELECT * FROM alert_settings WHERE alert_type = ? AND deleted_at IS NULL',
      [alertType],
    );
    return row === null ? null : toDto(row);
  },

  /** Keyed by type, for the alarm runtime's per-alarm lookups. */
  async map(): Promise<Map<AlertType, AlertSettingDto>> {
    const settings = await this.list();
    return new Map(settings.map((setting) => [setting.alertType, setting]));
  },
};
