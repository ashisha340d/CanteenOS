import type { AlertSoundSlot, AlertType } from '@menuboard/shared';
import { allocateSyncSeq } from '../db/syncSeq';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { AlertSettingRow, AlertSoundRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

const SETTING_COLUMNS = `
  id, alert_type, enabled, lead_minutes, sound, repeat_until_ack, repeat_every_seconds,
  target_roles, updated_by, created_at, updated_at, deleted_at, revision, sync_seq`;

/**
 * Alarm configuration. Exactly four setting rows and three sound slots exist, seeded by
 * migration 003, so there is no insert path here — only reads and updates.
 */
export class AlertRepository {
  async listSettings(db: Db): Promise<AlertSettingRow[]> {
    return selectRows<AlertSettingRow>(
      db,
      `SELECT ${SETTING_COLUMNS} FROM alert_settings WHERE deleted_at IS NULL
        ORDER BY alert_type ASC`,
    );
  }

  async findSetting(db: Db, alertType: AlertType): Promise<AlertSettingRow | null> {
    return selectOne<AlertSettingRow>(
      db,
      `SELECT ${SETTING_COLUMNS} FROM alert_settings WHERE alert_type = ? AND deleted_at IS NULL`,
      [alertType],
    );
  }

  async updateSetting(
    db: Db,
    alertType: AlertType,
    input: {
      enabled?: boolean;
      leadMinutes?: number;
      sound?: AlertSoundSlot;
      repeatUntilAck?: boolean;
      repeatEverySeconds?: number;
      targetRoles?: string[];
    },
    updatedBy: string | null,
  ): Promise<void> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (input.enabled !== undefined) {
      assignments.push('enabled = ?');
      params.push(input.enabled ? 1 : 0);
    }
    if (input.leadMinutes !== undefined) {
      assignments.push('lead_minutes = ?');
      params.push(input.leadMinutes);
    }
    if (input.sound !== undefined) {
      assignments.push('sound = ?');
      params.push(input.sound);
    }
    if (input.repeatUntilAck !== undefined) {
      assignments.push('repeat_until_ack = ?');
      params.push(input.repeatUntilAck ? 1 : 0);
    }
    if (input.repeatEverySeconds !== undefined) {
      assignments.push('repeat_every_seconds = ?');
      params.push(input.repeatEverySeconds);
    }
    if (input.targetRoles !== undefined) {
      assignments.push('target_roles = ?');
      params.push(toJsonColumn(input.targetRoles));
    }
    if (assignments.length === 0) return;

    const syncSeq = await allocateSyncSeq(db);
    await mutate(
      db,
      `UPDATE alert_settings
          SET ${assignments.join(', ')}, updated_by = ?, updated_at = ?,
              revision = revision + 1, sync_seq = ?
        WHERE alert_type = ?`,
      [...params, updatedBy, toDbDateTime(), syncSeq, alertType],
    );
  }

  async settingsChangedSince(
    db: Db,
    cursor: number,
    limit: number,
  ): Promise<AlertSettingRow[]> {
    return selectRows<AlertSettingRow>(
      db,
      `SELECT ${SETTING_COLUMNS} FROM alert_settings
        WHERE sync_seq > ? ORDER BY sync_seq ASC LIMIT ?`,
      [cursor, limit],
    );
  }

  /* ---------------------------------------------------------------- sounds */

  async listSounds(db: Db): Promise<AlertSoundRow[]> {
    return selectRows<AlertSoundRow>(db, 'SELECT * FROM alert_sounds ORDER BY slot ASC');
  }

  async findSound(db: Db, slot: AlertSoundSlot): Promise<AlertSoundRow | null> {
    return selectOne<AlertSoundRow>(db, 'SELECT * FROM alert_sounds WHERE slot = ?', [slot]);
  }

  async setSound(
    db: Db,
    slot: AlertSoundSlot,
    input: { attachmentId: string | null; fileName: string | null; storagePath: string | null },
    updatedBy: string | null,
  ): Promise<void> {
    const syncSeq = await allocateSyncSeq(db);
    await mutate(
      db,
      `UPDATE alert_sounds
          SET attachment_id = ?, file_name = ?, storage_path = ?, updated_by = ?,
              updated_at = ?, revision = revision + 1, sync_seq = ?
        WHERE slot = ?`,
      [
        input.attachmentId,
        input.fileName,
        input.storagePath,
        updatedBy,
        toDbDateTime(),
        syncSeq,
        slot,
      ],
    );
  }
}

export const alertRepository = new AlertRepository();
