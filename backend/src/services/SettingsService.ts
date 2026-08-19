import {
  KioskLanguageMode,
  KioskRecommendationMode,
  KioskSkin,
  type SettingDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapSetting } from '../models/mappers';
import { settingsRepository } from '../repositories/SettingsRepository';
import { NotFoundError, ValidationError } from '../utils/errors';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * Server-side configuration surfaced by the Admin Portal Settings page.
 *
 * The key set is closed. An open key/value store would let the Settings page become a
 * dumping ground for behaviour that belongs in code, and nothing would validate the values.
 */
export const SETTING_DEFINITIONS = {
  'orders.default_priority': {
    description: 'Priority applied to a new order when the client does not specify one',
    validate: (value: unknown): boolean =>
      typeof value === 'string' && ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(value),
    default: 'NORMAL',
  },
  'orders.require_acknowledgement': {
    description: 'Whether an order must be acknowledged before work can start',
    validate: (value: unknown): boolean => typeof value === 'boolean',
    default: false,
  },
  'notifications.push_enabled': {
    description: 'Master switch for push notification delivery',
    validate: (value: unknown): boolean => typeof value === 'boolean',
    default: true,
  },
  'sync.pull_limit': {
    description: 'Maximum rows returned in a single sync pull page',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 50 && value <= 2000,
    default: 500,
  },
  'media.orphan_sweep_hours': {
    description: 'Age at which an unbound attachment is reclaimed',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 720,
    default: 48,
  },
  'organisation.name': {
    description: 'Display name shown in the Admin Portal header',
    validate: (value: unknown): boolean =>
      typeof value === 'string' && value.trim().length > 0 && value.length <= 150,
    default: 'MenuBoard',
  },
  'pos.default_menu_code': {
    description: 'Code of the menu the POS prices against when the operator does not pick one',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 60,
    default: '',
  },
  'pos.home_state_code': {
    description:
      "Two-digit GST state code of this operation. A customer in another state is billed IGST; everyone else CGST+SGST. Blank means always CGST+SGST.",
    validate: (value: unknown): boolean =>
      typeof value === 'string' && (value === '' || /^\d{2}$/.test(value)),
    default: '',
  },
  'pos.round_off_enabled': {
    description: 'Round the POS bill total to the nearest whole rupee',
    validate: (value: unknown): boolean => typeof value === 'boolean',
    default: true,
  },
  'organisation.legal_name': {
    description:
      'Registered name of the seller as it must appear on a GST bill. Blank falls back to the organisation name.',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 150,
    default: '',
  },
  'organisation.address_line': {
    description: 'Address line printed on every bill',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 200,
    default: '',
  },
  'organisation.gstin': {
    description: 'GSTIN printed on every bill. Fifteen characters, or blank if unregistered.',
    validate: (value: unknown): boolean =>
      typeof value === 'string' && (value === '' || /^[0-9A-Z]{15}$/.test(value)),
    default: '',
  },

  /* --------------------------------------------------------------------- kiosk */

  'kiosk.skin': {
    description: 'Visual skin every self-service kiosk wears',
    validate: (value: unknown): boolean =>
      typeof value === 'string' && Object.values(KioskSkin).includes(value as KioskSkin),
    default: KioskSkin.SANDALWOOD,
  },
  'kiosk.language_mode': {
    description: 'Language the kiosk speaks to guests in: English, Hindi, or both at once',
    validate: (value: unknown): boolean =>
      typeof value === 'string' &&
      Object.values(KioskLanguageMode).includes(value as KioskLanguageMode),
    default: KioskLanguageMode.BOTH,
  },
  'kiosk.idle_prompt_seconds': {
    description: 'Stillness before an abandoned kiosk order is offered back to the next guest',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 20 && value <= 600,
    default: 75,
  },
  'kiosk.whatsapp_bill_enabled': {
    description:
      'Offer to send the GST bill to the guest’s WhatsApp. Has no effect until WhatsApp credentials are present in the backend environment.',
    validate: (value: unknown): boolean => typeof value === 'boolean',
    default: true,
  },
  'kiosk.recommendations': {
    description:
      'Whether a kiosk may suggest a drink or a sweet before payment. Each suggestion is one more tap between a guest and their food, so the choice is an operator’s.',
    validate: (value: unknown): boolean =>
      typeof value === 'string' &&
      Object.values(KioskRecommendationMode).includes(value as KioskRecommendationMode),
    default: KioskRecommendationMode.BOTH,
  },
  'kiosk.greeting': {
    description:
      'How the kiosk greets a guest, in Latin script. Shown while the menu loads and again over the token. Blank shows nothing.',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 40,
    default: 'Radhe Radhe',
  },
  'kiosk.greeting_hi': {
    description: 'The same greeting in Devanagari. Blank falls back to the Latin one.',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 40,
    default: 'राधे राधे',
  },
  'kiosk.receipt_columns': {
    description: 'Printable columns of the receipt roll — 32 for 58 mm paper, 48 for 80 mm',
    validate: (value: unknown): boolean => value === 32 || value === 42 || value === 48,
    default: 48,
  },
  'kiosk.receipt_footer': {
    description: 'Closing line printed under the token on every receipt',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 120,
    default: 'Thank you for your visit',
  },
  'pos.printer_host': {
    description:
      'Hostname or IP of the networked counter receipt printer (RAW/JetDirect). Blank disables server-side printing.',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 190,
    default: '',
  },
  'pos.printer_port': {
    description: 'TCP port of the networked receipt printer; 9100 on essentially every model',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535,
    default: 9100,
  },

  /* ----------------------------------------------------------------------- kds */

  'kds.default_prep_seconds': {
    description:
      'Prep deadline in seconds for a line whose menu item carries no prep_seconds of its own',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 30 && value <= 86400,
    default: 900,
  },
  'kds.due_soon_seconds': {
    description: 'A line is "due soon" this many seconds before its prep deadline',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7200,
    default: 300,
  },
  'kds.overdue_repeat_seconds': {
    description: 'How often the overdue alarm repeats while a line stays past its deadline',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 3600,
    default: 60,
  },
  'kds.revert_window': {
    description: 'How many of a counter\'s most recent serves the KDS offers for undo',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100,
    default: 10,
  },
  'kds.cds_bill_hold_seconds': {
    description:
      'How long a settled bill (and its pay QR) stays on the customer display after checkout',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 1800,
    default: 180,
  },
  'kds.alarm_volume': {
    description:
      'Loudness of every KDS board alarm, 0-100. Boards cannot change it; only this setting can',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100,
    default: 80,
  },

  /* ------------------------------------------------------------------ payments */

  'payments.upi_id': {
    description:
      'UPI virtual payment address (payee VPA) the customer display builds its payment QR for. Blank hides the QR.',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 120,
    default: '',
  },

  'equipment.assetIdPrefix': {
    description: 'Leading segment of every generated Asset ID, e.g. MTC in MTC-KIT-OVN-001',
    validate: (value: unknown): boolean =>
      typeof value === 'string' && /^[A-Za-z0-9]{1,8}$/.test(value),
    default: 'MTC',
  },
  'equipment.assetIdSequenceDigits': {
    description: 'Zero-padded width of the numeric segment of an Asset ID',
    validate: (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 6,
    default: 3,
  },

  /* --------------------------------------------------------------------- menu shifts */

  'menu.morning_shift_start': {
    description:
      'When the morning shift begins. At this moment every menu automatically un-hides whatever is scheduled for the MORNING shift today — see MenuShiftSchedulerService.',
    validate: (value: unknown): boolean =>
      typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    default: '06:00',
  },
  'menu.evening_shift_start': {
    description:
      'When the evening shift begins. At this moment every menu automatically un-hides everything on it — the full catalogue returning after the morning-only window.',
    validate: (value: unknown): boolean =>
      typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value),
    default: '17:00',
  },
  /**
   * Internal bookkeeping, not an operator-facing choice — but it has to be a stored setting
   * rather than in-process state, because the scheduler must not re-fire the same reset twice
   * after a restart lands moments after the shift boundary it already applied. `MORNING:2026-08-17`.
   */
  'menu.last_shift_reset': {
    description: 'Bookkeeping: the last shift-reset this server applied, so a restart never repeats it.',
    validate: (value: unknown): boolean => typeof value === 'string' && value.length <= 40,
    default: '',
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFINITIONS, key);
}

export class SettingsService {
  /** Every known setting, with stored values overlaid on the defaults. */
  async list(): Promise<SettingDto[]> {
    const rows = await settingsRepository.findAll(getPool());
    const stored = new Map(rows.map((row) => [row.setting_key, mapSetting(row)]));

    return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
      const definition = SETTING_DEFINITIONS[key];
      const existing = stored.get(key);
      if (existing !== undefined) {
        return { ...existing, description: definition.description };
      }
      return {
        key,
        value: definition.default,
        description: definition.description,
        updatedBy: null,
        updatedAt: new Date(0).toISOString(),
      };
    });
  }

  async get<T>(key: SettingKey): Promise<T> {
    const definition = SETTING_DEFINITIONS[key];
    return settingsRepository.getValue<T>(getPool(), key, definition.default as unknown as T);
  }

  async set(key: string, value: unknown, actor: AuditActor): Promise<SettingDto> {
    if (!isSettingKey(key)) {
      throw new NotFoundError('Setting', key);
    }

    const definition = SETTING_DEFINITIONS[key];
    if (!definition.validate(value)) {
      throw new ValidationError(`The value for ${key} is not valid`, [
        { path: 'value', message: definition.description },
      ]);
    }

    return withTransaction(async (connection) => {
      const before = await settingsRepository.find(connection, key);

      const row = await settingsRepository.upsert(connection, key, value, {
        description: definition.description,
        updatedBy: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.SETTING_UPDATED,
        entityType: 'setting',
        entityId: key,
        before: before === null ? null : { value: before.value },
        after: { value },
      });

      return mapSetting(row);
    });
  }
}

export const settingsService = new SettingsService();
