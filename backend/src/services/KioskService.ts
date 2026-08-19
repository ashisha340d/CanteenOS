import { randomUUID } from 'node:crypto';
import {
  KioskLanguageMode,
  KioskRecommendationMode,
  KioskSkin,
  MasterStatus,
  ReceiptTransport,
  type CreateKioskDeviceRequest,
  type KioskDeviceDto,
  type KioskDeviceSummaryDto,
  type KioskProfileDto,
  type UpdateKioskDeviceRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { mapKioskDevice, mapKioskDeviceSummary } from '../models/kioskMappers';
import { mapSetting } from '../models/mappers';
import { kioskDeviceRepository } from '../repositories/KioskDeviceRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { receiptService } from './ReceiptService';
import { settingsService } from './SettingsService';
import { whatsAppService } from './WhatsAppService';

/**
 * What a self-service kiosk is told about itself.
 *
 * Two layers, and the seam between them is the whole design. How the *organisation* presents
 * itself — skin, language, greeting, billing identity, whether a bill may be sent to a phone —
 * is decided once in the Admin Portal and obeyed by every stand in the hall. What is true of
 * *one stand* — its menu, its station, its payee, its printer, the order it shows categories in
 * — is a row in `kiosk_devices`, also edited in the Admin Portal, and the tablet holds nothing
 * but the code that names it.
 *
 * The two capability flags are computed, never stored. A kiosk that is told WhatsApp is
 * available and then fails at the last step of a queue is worse than one that never offered.
 */
export class KioskService {
  /**
   * @param deviceCode what the tablet says it is, or null when it has not been told yet.
   *                   An unknown code resolves to a null `device` rather than an error: a
   *                   stand whose row was deleted must still be able to load, show that it is
   *                   unprovisioned, and let a member of staff pick again.
   */
  async profile(deviceCode: string | null): Promise<KioskProfileDto> {
    const [
      skin,
      languageMode,
      organisationName,
      legalName,
      addressLine,
      gstin,
      receiptFooter,
      receiptColumns,
      idlePromptSeconds,
      recommendations,
      greeting,
      greetingHi,
      whatsappBillEnabled,
      networkPrinterConfigured,
      device,
    ] = await Promise.all([
      settingsService.get<KioskSkin>('kiosk.skin'),
      settingsService.get<KioskLanguageMode>('kiosk.language_mode'),
      settingsService.get<string>('organisation.name'),
      settingsService.get<string>('organisation.legal_name'),
      settingsService.get<string>('organisation.address_line'),
      settingsService.get<string>('organisation.gstin'),
      settingsService.get<string>('kiosk.receipt_footer'),
      settingsService.get<number>('kiosk.receipt_columns'),
      settingsService.get<number>('kiosk.idle_prompt_seconds'),
      settingsService.get<KioskRecommendationMode>('kiosk.recommendations'),
      settingsService.get<string>('kiosk.greeting'),
      settingsService.get<string>('kiosk.greeting_hi'),
      whatsAppService.billDeliveryAvailable(),
      receiptService.networkPrinterConfigured(),
      this.resolveDevice(deviceCode),
    ]);

    return {
      skin,
      languageMode,
      organisationName,
      legalName: legalName.trim() === '' ? organisationName : legalName,
      addressLine,
      gstin,
      receiptFooter,
      whatsappBillEnabled,
      networkPrinterConfigured,
      receiptColumns,
      idlePromptSeconds,
      recommendations,
      greeting,
      greetingHi: greetingHi.trim() === '' ? greeting : greetingHi,
      device,
      updatedAt: await this.lastChangedAt(),
    };
  }

  /**
   * Resolves the stand and marks it seen. The heartbeat is deliberately fire-and-forget: a
   * kiosk polling its profile every minute must not have a guest's menu blocked on a bookkeeping
   * write, and a lost heartbeat costs a stale timestamp in a list, nothing more.
   */
  private async resolveDevice(code: string | null): Promise<KioskDeviceDto | null> {
    if (code === null || code.trim() === '') return null;
    const row = await kioskDeviceRepository.findByCode(getPool(), code.trim());
    if (row === null || row.status !== MasterStatus.ACTIVE) return null;

    void kioskDeviceRepository.touch(getPool(), row.id).catch((error: unknown) => {
      logger.warn('Kiosk heartbeat could not be recorded', { deviceId: row.id }, error);
    });

    return mapKioskDevice(row);
  }

  /**
   * When any kiosk-facing setting last moved. The kiosk polls this profile and re-skins
   * itself when the stamp changes, so an operator's choice reaches the hall without anyone
   * walking over to reload a tablet.
   */
  private async lastChangedAt(): Promise<string> {
    const rows = await settingsRepository.findAll(getPool());
    const stamps = rows
      .filter(
        (row) =>
          row.setting_key.startsWith('kiosk.') || row.setting_key.startsWith('organisation.'),
      )
      // Through the mapper rather than `new Date(row.updated_at)`: the column is a MariaDB
      // DATETIME holding UTC, which the Date constructor would read as local time.
      .map((row) => Date.parse(mapSetting(row).updatedAt));

    if (stamps.length === 0) return new Date(0).toISOString();
    return new Date(Math.max(...stamps)).toISOString();
  }

  /* ------------------------------------------------------------------ the registry */

  async listDevices(): Promise<KioskDeviceDto[]> {
    const rows = await kioskDeviceRepository.list(getPool());
    return rows.map(mapKioskDevice);
  }

  /** What a tablet may read while it is deciding which stand it is standing at. */
  async listDeviceSummaries(): Promise<KioskDeviceSummaryDto[]> {
    const rows = await kioskDeviceRepository.list(getPool(), { activeOnly: true });
    return rows.map(mapKioskDeviceSummary);
  }

  async createDevice(input: CreateKioskDeviceRequest, actor: AuditActor): Promise<KioskDeviceDto> {
    const code = normaliseCode(input.code);
    await this.assertCodeFree(code, null);

    const outletName = input.outletName.trim();
    const payee = (input.upiPayeeName ?? '').trim();
    const row = await kioskDeviceRepository.insert(getPool(), {
      id: randomUUID(),
      code,
      label: input.label.trim(),
      menuCode: input.menuCode.trim(),
      stationId: input.stationId ?? null,
      outletName,
      outletNameHi: blankToNull(input.outletNameHi),
      upiVpa: (input.upiVpa ?? '').trim(),
      // A payee name nobody supplied is the stand's own name rather than an empty string: a
      // UPI app showing a blank payee is what a guest is told to treat as a scam.
      upiPayeeName: payee === '' ? outletName : payee,
      receiptTransport: input.receiptTransport ?? ReceiptTransport.USB,
      categoryOrder: input.categoryOrder ?? [],
      status: input.status ?? MasterStatus.ACTIVE,
      createdBy: actor.userId,
    });

    const device = mapKioskDevice(row);
    await auditService.record(getPool(), actor, {
      action: AuditAction.KIOSK_DEVICE_CREATED,
      entityType: 'kiosk_device',
      entityId: device.id,
      after: auditShape(device),
    });
    return device;
  }

  async updateDevice(
    id: string,
    input: UpdateKioskDeviceRequest,
    actor: AuditActor,
  ): Promise<KioskDeviceDto> {
    const existing = await kioskDeviceRepository.findById(getPool(), id);
    if (existing === null) throw new NotFoundError('Kiosk device not found');
    const before = mapKioskDevice(existing);

    if (input.code !== undefined) await this.assertCodeFree(normaliseCode(input.code), id);

    const row = await kioskDeviceRepository.update(getPool(), id, {
      ...(input.code !== undefined ? { code: normaliseCode(input.code) } : {}),
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.menuCode !== undefined ? { menuCode: input.menuCode.trim() } : {}),
      ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
      ...(input.outletName !== undefined ? { outletName: input.outletName.trim() } : {}),
      ...(input.outletNameHi !== undefined ? { outletNameHi: blankToNull(input.outletNameHi) } : {}),
      ...(input.upiVpa !== undefined ? { upiVpa: input.upiVpa.trim() } : {}),
      ...(input.upiPayeeName !== undefined ? { upiPayeeName: input.upiPayeeName.trim() } : {}),
      ...(input.receiptTransport !== undefined
        ? { receiptTransport: input.receiptTransport }
        : {}),
      ...(input.categoryOrder !== undefined ? { categoryOrder: input.categoryOrder } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    if (row === null) throw new NotFoundError('Kiosk device not found');

    const device = mapKioskDevice(row);
    await auditService.record(getPool(), actor, {
      action: AuditAction.KIOSK_DEVICE_UPDATED,
      entityType: 'kiosk_device',
      entityId: device.id,
      before: auditShape(before),
      after: auditShape(device),
    });
    return device;
  }

  async deleteDevice(id: string, actor: AuditActor): Promise<void> {
    const existing = await kioskDeviceRepository.findById(getPool(), id);
    if (existing === null) throw new NotFoundError('Kiosk device not found');

    const removed = await kioskDeviceRepository.softDelete(getPool(), id);
    if (!removed) throw new NotFoundError('Kiosk device not found');

    await auditService.record(getPool(), actor, {
      action: AuditAction.KIOSK_DEVICE_DELETED,
      entityType: 'kiosk_device',
      entityId: id,
      before: auditShape(mapKioskDevice(existing)),
    });
  }

  private async assertCodeFree(code: string, excludeId: string | null): Promise<void> {
    const taken = await kioskDeviceRepository.countByCode(getPool(), code, excludeId);
    if (taken > 0) {
      throw new ConflictError(`A kiosk with the code ${code} already exists`);
    }
  }
}

/**
 * What the audit trail keeps of a stand.
 *
 * Not the whole row. The fields below are the ones whose change has a consequence somebody
 * might later have to account for — where the money goes, what is being sold, and whether the
 * stand is live. The category order and the last-seen stamp move constantly and would bury
 * those under noise.
 */
function auditShape(device: KioskDeviceDto): Record<string, unknown> {
  return {
    code: device.code,
    label: device.label,
    menuCode: device.menuCode,
    stationId: device.stationId,
    outletName: device.outletName,
    upiVpa: device.upiVpa,
    upiPayeeName: device.upiPayeeName,
    receiptTransport: device.receiptTransport,
    status: device.status,
  };
}

/**
 * Codes are upper-cased and stripped of interior whitespace, because they are typed by a
 * member of staff standing at a tablet, sometimes from a label printed on the stand. A code
 * that only matches when the shift key was held is a support call.
 */
function normaliseCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '-');
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.trim() === '' ? null : value.trim();
}

export const kioskService = new KioskService();
