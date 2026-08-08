import {
  ALERT_DEFAULTS,
  AlertType,
  AttachmentKind,
  MEDIA,
  OPEN_ORDER_STATUSES,
  UserRole,
  type AlertSettingDto,
  type AlertSoundDto,
  type AlertSoundSlot,
  type PendingAlertDto,
  type UpdateAlertSettingRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapAlertSetting, mapAlertSound } from '../models/mappers';
import { alertRepository } from '../repositories/AlertRepository';
import { boardRepository } from '../repositories/BoardRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { NotFoundError, UnsupportedMediaTypeError, ValidationError } from '../utils/errors';
import {
  deleteStoredFile,
  extensionForMimeType,
  storeUploadedFile,
} from '../utils/mediaStorage';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

export interface AlertSoundUpload {
  tempPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

/** How far ahead the client asks for alarms to schedule. */
const DEFAULT_HORIZON_HOURS = 48;

/**
 * Alarms and buzzers.
 *
 * The three time-based alarms are *computed*, not stored: given an order's required time
 * and the configured lead minutes, the moment it should fire is arithmetic. So rather than
 * running a scheduler that has to survive restarts and re-fire missed jobs, the server hands
 * each device the list of upcoming alarms and the device schedules them locally. A phone
 * that goes offline after pulling still buzzes on time, which is the whole point of the
 * feature in a kitchen.
 *
 * NEW_INCOMING is not in that list — it fires on arrival through the ordinary push path.
 */
export class AlertService {
  async listSettings(): Promise<AlertSettingDto[]> {
    const rows = await alertRepository.listSettings(getPool());
    return rows.map(mapAlertSetting);
  }

  async listSounds(): Promise<AlertSoundDto[]> {
    const rows = await alertRepository.listSounds(getPool());
    return rows.map(mapAlertSound);
  }

  /**
   * Replaces the buzzer in one slot. Unlike an order photo or voice note, an alert sound has
   * no board or order to belong to, so it is never inserted into `attachments` — the file is
   * stored directly and only `alert_sounds.file_name` / `storage_path` describe it.
   */
  async setSound(
    slot: AlertSoundSlot,
    upload: AlertSoundUpload,
    actor: AuditActor,
  ): Promise<AlertSoundDto> {
    if (!(MEDIA.AUDIO_MIME_TYPES as readonly string[]).includes(upload.mimeType)) {
      await deleteStoredFile(upload.tempPath).catch(() => undefined);
      throw new UnsupportedMediaTypeError('Alert sounds must be an audio file');
    }
    if (upload.sizeBytes > MEDIA.AUDIO_MAX_BYTES) {
      await deleteStoredFile(upload.tempPath).catch(() => undefined);
      throw new ValidationError('The file is too large', [
        {
          path: 'file',
          message: `Alert sounds are limited to ${Math.floor(MEDIA.AUDIO_MAX_BYTES / (1024 * 1024))} MB`,
        },
      ]);
    }

    const before = await alertRepository.findSound(getPool(), slot);
    if (before === null) throw new NotFoundError('Alert sound slot', slot);

    const stored = await storeUploadedFile({
      attachmentId: newId(),
      tempPath: upload.tempPath,
      mimeType: upload.mimeType,
      kind: AttachmentKind.VOICE_NOTE,
    });

    await withTransaction(async (connection) => {
      await alertRepository.setSound(
        connection,
        slot,
        {
          attachmentId: null,
          fileName: sanitiseFileName(upload.originalName, upload.mimeType),
          storagePath: stored.storagePath,
        },
        actor.userId,
      );

      await auditService.record(connection, actor, {
        action: AuditAction.SETTING_UPDATED,
        entityType: 'alert_sound',
        entityId: slot,
        before: { fileName: before.file_name },
        after: { fileName: upload.originalName },
      });
    });

    if (before.storage_path !== null) {
      await deleteStoredFile(before.storage_path);
    }

    const row = await alertRepository.findSound(getPool(), slot);
    if (row === null) throw new NotFoundError('Alert sound slot', slot);
    return mapAlertSound(row);
  }

  async updateSetting(
    alertType: AlertType,
    input: UpdateAlertSettingRequest,
    actor: AuditActor,
  ): Promise<AlertSettingDto> {
    if (input.repeatEverySeconds !== undefined && input.repeatEverySeconds < 10) {
      throw new ValidationError('Repeat interval is too short', [
        {
          path: 'repeatEverySeconds',
          message: 'Repeat no more often than every 10 seconds',
        },
      ]);
    }

    await withTransaction(async (connection) => {
      const before = await alertRepository.findSetting(connection, alertType);
      if (before === null) throw new NotFoundError('Alert setting', alertType);

      await alertRepository.updateSetting(
        connection,
        alertType,
        {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.leadMinutes !== undefined ? { leadMinutes: input.leadMinutes } : {}),
          ...(input.sound !== undefined ? { sound: input.sound } : {}),
          ...(input.repeatUntilAck !== undefined
            ? { repeatUntilAck: input.repeatUntilAck }
            : {}),
          ...(input.repeatEverySeconds !== undefined
            ? { repeatEverySeconds: input.repeatEverySeconds }
            : {}),
          ...(input.targetRoles !== undefined ? { targetRoles: input.targetRoles } : {}),
        },
        actor.userId ?? null,
      );

      await auditService.record(connection, actor, {
        action: AuditAction.SETTING_UPDATED,
        entityType: 'alert_setting',
        entityId: alertType,
        before: {
          enabled: before.enabled === 1,
          leadMinutes: Number(before.lead_minutes),
          sound: before.sound,
        },
        after: { ...input },
      });
    });

    const row = await alertRepository.findSetting(getPool(), alertType);
    if (row === null) throw new NotFoundError('Alert setting', alertType);
    return mapAlertSetting(row);
  }

  /**
   * The alarms this user should have scheduled right now.
   *
   * Times are emitted as naive local ISO strings (`YYYY-MM-DDTHH:mm:ss`), matching how the
   * order's required date and time are stored: "12:30" means half past twelve in the
   * kitchen, not an instant in UTC that shifts when the device travels.
   */
  async listPendingForUser(
    userId: string,
    role: UserRole,
    options: { horizonHours?: number } = {},
  ): Promise<PendingAlertDto[]> {
    const pool = getPool();
    const settings = await this.listSettings();
    const byType = new Map(settings.map((setting) => [setting.alertType, setting]));

    const boardIds = await boardRepository.listBoardIdsForUser(pool, userId);
    if (boardIds.length === 0) return [];

    const horizonHours = options.horizonHours ?? DEFAULT_HORIZON_HOURS;
    const now = new Date();
    const horizon = new Date(now.getTime() + horizonHours * 3_600_000);

    const { rows } = await orderRepository.list(pool, {
      boardIds,
      status: OPEN_ORDER_STATUSES,
      dateFrom: localDatePart(now),
      dateTo: localDatePart(horizon),
      limit: 500,
      offset: 0,
    });

    const alerts: PendingAlertDto[] = [];

    for (const order of rows) {
      // A billed order is finished business; nothing about it is worth waking someone for.
      if (order.billed_at !== null) continue;

      const requiredAt = combineLocal(order.required_date, order.required_time);
      if (requiredAt === null) continue;

      for (const alertType of [
        AlertType.PREP_CALL,
        AlertType.DELIVERY_WARNING,
        AlertType.CRITICAL_ALERT,
      ]) {
        const setting = byType.get(alertType) ?? fallbackSetting(alertType);
        if (!setting.enabled) continue;
        if (!setting.targetRoles.includes(role)) continue;

        const fireAt = new Date(requiredAt.getTime() - setting.leadMinutes * 60_000);
        // Already passed, or beyond what the device asked to schedule.
        if (fireAt <= now || fireAt > horizon) continue;

        alerts.push({
          // Deterministic, so re-pulling replaces the scheduled alarm instead of duplicating it.
          id: `${order.id}:${alertType}`,
          alertType,
          orderId: order.id,
          boardId: order.board_id,
          title: alertTitle(alertType, order.order_number),
          body: `${order.venue} · ${order.pax} pax · ${formatClock(order.required_time)}`,
          fireAt: toNaiveIso(fireAt),
          sound: setting.sound,
          repeatUntilAck: setting.repeatUntilAck,
          repeatEverySeconds: setting.repeatEverySeconds,
        });
      }
    }

    return alerts.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
  }
}

/** Used when a settings row is somehow missing, so an alarm is never silently dropped. */
function fallbackSetting(alertType: AlertType): AlertSettingDto {
  const defaults = ALERT_DEFAULTS[alertType];
  return {
    id: alertType,
    alertType,
    enabled: true,
    leadMinutes: defaults.leadMinutes,
    sound: defaults.sound,
    repeatUntilAck: defaults.repeatUntilAck,
    repeatEverySeconds: 60,
    targetRoles: [UserRole.MANAGER, UserRole.USER, UserRole.EMPLOYEE],
    updatedBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    deletedAt: null,
    revision: 1,
    syncSeq: 0,
  };
}

function alertTitle(alertType: AlertType, orderNumber: string): string {
  switch (alertType) {
    case AlertType.PREP_CALL:
      return `Start prep for ${orderNumber}`;
    case AlertType.DELIVERY_WARNING:
      return `${orderNumber} is due soon`;
    case AlertType.CRITICAL_ALERT:
      return `${orderNumber} is critical`;
    default:
      return orderNumber;
  }
}

/**
 * Builds a Date from the DATE and TIME columns interpreted as wall-clock in the server's
 * own zone — the same zone the kitchen runs on.
 */
function combineLocal(date: string, time: string): Date | null {
  const day = date.slice(0, 10);
  const clock = time.length >= 8 ? time.slice(0, 8) : `${time}:00`;
  const parsed = new Date(`${day}T${clock}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDatePart(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toNaiveIso(value: Date): string {
  const hours = `${value.getHours()}`.padStart(2, '0');
  const minutes = `${value.getMinutes()}`.padStart(2, '0');
  const seconds = `${value.getSeconds()}`.padStart(2, '0');
  return `${localDatePart(value)}T${hours}:${minutes}:${seconds}`;
}

function formatClock(time: string): string {
  return time.slice(0, 5);
}

/** Keeps a display name without letting it influence anything on disk. */
function sanitiseFileName(name: string, mimeType: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'sound';
  const cleaned = base.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
  return cleaned.includes('.') ? cleaned : `${cleaned}${extensionForMimeType(mimeType)}`;
}

export const alertService = new AlertService();
