import type { SettingDto } from '@menuboard/shared';
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
