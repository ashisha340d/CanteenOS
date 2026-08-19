import path from 'node:path';
import {
  AttachmentKind,
  CaptureSource,
  EquipmentDocumentType,
  EquipmentStatus,
  EquipmentSupplierRole,
  LIMITS,
  MaintenanceActivityType,
  MasterStatus,
  MediaType,
  maintenanceIntervalDays,
  type DocumentExtractionDto,
  type EquipmentAreaDto,
  type EquipmentCategoryDto,
  type EquipmentCategoryWriteRequest,
  type EquipmentCreateRequest,
  type EquipmentDashboardDto,
  type EquipmentDocumentDto,
  type EquipmentDto,
  type EquipmentFloorDto,
  type EquipmentListQuery,
  type EquipmentLocationDto,
  type EquipmentLocationHistoryDto,
  type EquipmentMoveRequest,
  type EquipmentStatusChangeRequest,
  type EquipmentStatusHistoryDto,
  type EquipmentSupplierLinkDto,
  type EquipmentUpdateRequest,
  type EquipmentWarrantyDto,
  type LocationTreeDto,
  type MaintenanceActivityDto,
  type MaintenanceFrequency,
  type MediaAssetDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import {
  locationPathOf,
  mapEquipment,
  mapEquipmentArea,
  mapEquipmentCategory,
  mapEquipmentDocument,
  mapEquipmentLocation,
  mapEquipmentLocationHistory,
  mapEquipmentFloor,
  mapEquipmentStatusHistory,
  mapEquipmentSupplierLink,
  mapEquipmentWarranty,
  mapFloorPlanPosition,
  mapMaintenanceActivity,
  mapMaintenanceSchedule,
  mapMaintenanceTicket,
  mapMediaAsset,
} from '../models/mappers';
import type { EquipmentAreaRow, EquipmentLocationRow, EquipmentRow } from '../models/rows';
import {
  EquipmentCategoryRepository,
  EquipmentLocationRepository,
  EquipmentRepository,
  type EquipmentListFilter,
} from '../repositories/EquipmentRepository';
import { FloorPlanRepository } from '../repositories/FloorPlanRepository';
import { MaintenanceRepository } from '../repositories/MaintenanceRepository';
import { mediaAssetRepository } from '../repositories/MediaRepository';
import { settingsRepository } from '../repositories/SettingsRepository';
import { ConflictError, NotFoundError, UnsupportedMediaTypeError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { toJsonColumn } from '../utils/json';
import {
  maxBytesForKind,
  storageKindForMimeType,
  storeUploadedFile,
  type StorageKind,
} from '../utils/mediaStorage';
import { addDays, toDbDateTime, todayIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { maintenanceActivityService } from './MaintenanceActivityService';

/**
 * Equipment registration and the asset record itself: the location/category masters it hangs
 * off, its documents, warranties and supplier links, and every state change written to
 * history.
 *
 * Two rules run through the whole file:
 *
 *  - **Only `equipmentId` is ever required of the caller.** The asset id, the location path
 *    recorded in history, the status timestamp and every counter are derived here.
 *  - **Derived columns are recomputed, never incremented.** `refreshTicketCounters`,
 *    `refreshMaintenanceDates` and `refreshWarrantyExpiry` run inside the transaction that
 *    changed their source, so a missed code path self-heals on the next write instead of
 *    leaving a counter permanently wrong.
 */

/** Fallback asset-id segment for an asset with no area or no category. */
const GENERIC_SEGMENT = 'GEN';

const DEFAULT_ASSET_PREFIX = 'MTC';
const DEFAULT_SEQUENCE_DIGITS = 3;

/** Matches the column default; a schedule may override it per asset. */
const DEFAULT_REMINDER_DAYS = 7;

/** What a stored file *is*, for `media_assets.media_type`. AUDIO exists as of 029. */
const MEDIA_TYPE_BY_STORAGE_KIND: Readonly<Record<StorageKind, MediaType>> = {
  [AttachmentKind.IMAGE]: MediaType.IMAGE,
  [AttachmentKind.VOICE_NOTE]: MediaType.AUDIO,
  [AttachmentKind.DOCUMENT]: MediaType.DOCUMENT,
  VIDEO: MediaType.VIDEO,
};

const HISTORY_LIMIT = 100;
const ACTIVITY_LIMIT = 200;
const DASHBOARD_LIST_LIMIT = 10;
const DASHBOARD_UPCOMING_DAYS = 30;

/** Only these three describe an asset that is working; the rest imply someone must act. */
const HEALTHY_STATUSES: readonly EquipmentStatus[] = [
  EquipmentStatus.OPERATIONAL,
  EquipmentStatus.RUNNING,
  EquipmentStatus.IDLE,
];

/** Whether the maintenance workflow may take the asset's status over. */
export function isHealthyStatus(status: EquipmentStatus): boolean {
  return HEALTHY_STATUSES.includes(status);
}

function segmentFrom(value: string | null | undefined): string {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned === '' ? GENERIC_SEGMENT : cleaned.slice(0, LIMITS.ASSET_SEGMENT_MAX);
}

/**
 * How much of an asset a caller may see. `REPORTER` is the narrow read granted by
 * `equipment.report_problem` alone; `FULL` is the monitoring read granted by `equipment.view`.
 */
export type DetailScope = 'FULL' | 'REPORTER';

/** The first preventive schedule, from the wizard or the category's recommendation. */
interface ScheduleSeed {
  frequency: MaintenanceFrequency;
  intervalDays: number | null;
  anchorDate: string | null;
}

export class EquipmentService {
  /* ------------------------------------------------------------------ masters */

  async listFloors(includeInactive: boolean): Promise<EquipmentFloorDto[]> {
    const rows = await EquipmentLocationRepository.listFloors(getPool(), includeInactive);
    return rows.map(mapEquipmentFloor);
  }

  async createFloor(
    input: { code: string; name: string; levelIndex?: number },
    actor: AuditActor,
  ): Promise<EquipmentFloorDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      await EquipmentLocationRepository.insertFloor(connection, {
        id,
        code: input.code,
        name: input.name,
        levelIndex: input.levelIndex ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'equipment_floor',
        entityId: id,
        after: { code: input.code, name: input.name },
      });
      const row = await EquipmentLocationRepository.findFloorById(connection, id);
      if (row === null) throw new NotFoundError('Floor', id);
      return mapEquipmentFloor(row);
    });
  }

  async updateFloor(
    id: string,
    input: { code?: string; name?: string; levelIndex?: number; status?: MasterStatus },
    actor: AuditActor,
  ): Promise<EquipmentFloorDto> {
    return withTransaction(async (connection) => {
      const before = await EquipmentLocationRepository.findFloorById(connection, id);
      if (before === null) throw new NotFoundError('Floor', id);

      const { assignments, params } = buildAssignments([
        ['code', input.code],
        ['name', input.name],
        ['level_index', input.levelIndex],
        ['status', input.status],
      ]);
      await EquipmentLocationRepository.updateFloor(connection, id, assignments, params);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'equipment_floor',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: input.name ?? before.name, status: input.status ?? before.status },
      });
      const row = await EquipmentLocationRepository.findFloorById(connection, id);
      if (row === null) throw new NotFoundError('Floor', id);
      return mapEquipmentFloor(row);
    });
  }

  async listAreas(floorId: string | undefined, includeInactive: boolean): Promise<EquipmentAreaDto[]> {
    const rows = await EquipmentLocationRepository.listAreas(getPool(), floorId, includeInactive);
    return rows.map(mapEquipmentArea);
  }

  async createArea(
    input: { floorId: string; code: string; name: string; assetSegment: string; sortOrder?: number },
    actor: AuditActor,
  ): Promise<EquipmentAreaDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      const floor = await EquipmentLocationRepository.findFloorById(connection, input.floorId);
      if (floor === null) throw new NotFoundError('Floor', input.floorId);

      await EquipmentLocationRepository.insertArea(connection, {
        id,
        floorId: input.floorId,
        code: input.code,
        name: input.name,
        assetSegment: segmentFrom(input.assetSegment),
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'equipment_area',
        entityId: id,
        after: { code: input.code, name: input.name, floorId: input.floorId },
      });
      const row = await EquipmentLocationRepository.findAreaById(connection, id);
      if (row === null) throw new NotFoundError('Area', id);
      return mapEquipmentArea(row);
    });
  }

  async updateArea(
    id: string,
    input: {
      floorId?: string;
      code?: string;
      name?: string;
      assetSegment?: string;
      sortOrder?: number;
      status?: MasterStatus;
    },
    actor: AuditActor,
  ): Promise<EquipmentAreaDto> {
    return withTransaction(async (connection) => {
      const before = await EquipmentLocationRepository.findAreaById(connection, id);
      if (before === null) throw new NotFoundError('Area', id);

      const { assignments, params } = buildAssignments([
        ['floor_id', input.floorId],
        ['code', input.code],
        ['name', input.name],
        ['asset_segment', input.assetSegment === undefined ? undefined : segmentFrom(input.assetSegment)],
        ['sort_order', input.sortOrder],
        ['status', input.status],
      ]);
      await EquipmentLocationRepository.updateArea(connection, id, assignments, params);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'equipment_area',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: input.name ?? before.name, status: input.status ?? before.status },
      });
      const row = await EquipmentLocationRepository.findAreaById(connection, id);
      if (row === null) throw new NotFoundError('Area', id);
      return mapEquipmentArea(row);
    });
  }

  async listLocations(filter: {
    areaId?: string;
    floorId?: string;
    includeInactive: boolean;
  }): Promise<EquipmentLocationDto[]> {
    const rows = await EquipmentLocationRepository.listLocations(getPool(), filter);
    return rows.map(mapEquipmentLocation);
  }

  async createLocation(
    input: {
      areaId: string;
      name: string;
      room?: string | null;
      section?: string | null;
      position?: string | null;
      sortOrder?: number;
    },
    actor: AuditActor,
  ): Promise<EquipmentLocationDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      const area = await EquipmentLocationRepository.findAreaById(connection, input.areaId);
      if (area === null) throw new NotFoundError('Area', input.areaId);

      await EquipmentLocationRepository.insertLocation(connection, {
        id,
        areaId: input.areaId,
        name: input.name,
        room: input.room ?? null,
        section: input.section ?? null,
        position: input.position ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'equipment_location',
        entityId: id,
        after: { name: input.name, areaId: input.areaId },
      });
      const row = await EquipmentLocationRepository.findLocationById(connection, id);
      if (row === null) throw new NotFoundError('Location', id);
      return mapEquipmentLocation(row);
    });
  }

  async updateLocation(
    id: string,
    input: {
      areaId?: string;
      name?: string;
      room?: string | null;
      section?: string | null;
      position?: string | null;
      sortOrder?: number;
      status?: MasterStatus;
    },
    actor: AuditActor,
  ): Promise<EquipmentLocationDto> {
    return withTransaction(async (connection) => {
      const before = await EquipmentLocationRepository.findLocationById(connection, id);
      if (before === null) throw new NotFoundError('Location', id);

      const { assignments, params } = buildAssignments([
        ['area_id', input.areaId],
        ['name', input.name],
        ['room', input.room],
        ['section', input.section],
        ['position', input.position],
        ['sort_order', input.sortOrder],
        ['status', input.status],
      ]);
      await EquipmentLocationRepository.updateLocation(connection, id, assignments, params);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'equipment_location',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: input.name ?? before.name, status: input.status ?? before.status },
      });
      const row = await EquipmentLocationRepository.findLocationById(connection, id);
      if (row === null) throw new NotFoundError('Location', id);
      return mapEquipmentLocation(row);
    });
  }

  /** Floor -> Area -> Location in one payload: every picker on both clients needs all three. */
  async locationTree(includeInactive: boolean): Promise<LocationTreeDto> {
    const pool = getPool();
    const [floors, areas, locations] = await Promise.all([
      EquipmentLocationRepository.listFloors(pool, includeInactive),
      EquipmentLocationRepository.listAreas(pool, undefined, includeInactive),
      EquipmentLocationRepository.listLocations(pool, { includeInactive }),
    ]);

    const locationsByArea = new Map<string, EquipmentLocationRow[]>();
    for (const location of locations) {
      const bucket = locationsByArea.get(location.area_id);
      if (bucket === undefined) locationsByArea.set(location.area_id, [location]);
      else bucket.push(location);
    }

    const areasByFloor = new Map<string, EquipmentAreaRow[]>();
    for (const area of areas) {
      const bucket = areasByFloor.get(area.floor_id);
      if (bucket === undefined) areasByFloor.set(area.floor_id, [area]);
      else bucket.push(area);
    }

    return {
      floors: floors.map((floor) => ({
        ...mapEquipmentFloor(floor),
        areas: (areasByFloor.get(floor.id) ?? []).map((area) => ({
          ...mapEquipmentArea(area),
          locations: (locationsByArea.get(area.id) ?? []).map(mapEquipmentLocation),
        })),
      })),
    };
  }

  /* --------------------------------------------------------------- categories */

  async listCategories(includeInactive: boolean): Promise<EquipmentCategoryDto[]> {
    const rows = await EquipmentCategoryRepository.list(getPool(), includeInactive);
    return rows.map(mapEquipmentCategory);
  }

  async createCategory(
    input: EquipmentCategoryWriteRequest,
    actor: AuditActor,
  ): Promise<EquipmentCategoryDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      await EquipmentCategoryRepository.insert(connection, {
        id,
        code: input.code,
        name: input.name,
        assetSegment: segmentFrom(input.assetSegment),
        description: input.description ?? null,
        defaultFrequency: input.defaultFrequency ?? null,
        defaultIntervalDays: input.defaultIntervalDays ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'equipment_category',
        entityId: id,
        after: { code: input.code, name: input.name },
      });
      const row = await EquipmentCategoryRepository.findById(connection, id);
      if (row === null) throw new NotFoundError('Equipment category', id);
      return mapEquipmentCategory(row);
    });
  }

  async updateCategory(
    id: string,
    input: Partial<EquipmentCategoryWriteRequest>,
    actor: AuditActor,
  ): Promise<EquipmentCategoryDto> {
    return withTransaction(async (connection) => {
      const before = await EquipmentCategoryRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Equipment category', id);

      const { assignments, params } = buildAssignments([
        ['code', input.code],
        ['name', input.name],
        ['asset_segment', input.assetSegment === undefined ? undefined : segmentFrom(input.assetSegment)],
        ['description', input.description],
        ['default_frequency', input.defaultFrequency],
        ['default_interval_days', input.defaultIntervalDays],
        ['sort_order', input.sortOrder],
        ['status', input.status],
      ]);
      await EquipmentCategoryRepository.update(connection, id, assignments, params);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'equipment_category',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: input.name ?? before.name, status: input.status ?? before.status },
      });
      const row = await EquipmentCategoryRepository.findById(connection, id);
      if (row === null) throw new NotFoundError('Equipment category', id);
      return mapEquipmentCategory(row);
    });
  }

  async removeCategory(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await EquipmentCategoryRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Equipment category', id);

      const inUse = await EquipmentRepository.count(connection, {
        categoryId: id,
        limit: 1,
        offset: 0,
      });
      if (inUse > 0) {
        throw new ConflictError(
          `${before.name} is used by ${inUse} asset(s); set it to INACTIVE instead of deleting it`,
        );
      }

      await EquipmentCategoryRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'equipment_category',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /* ---------------------------------------------------------------- equipment */

  async list(query: EquipmentListQuery, userId: string) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: EquipmentListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      ...(query.floorId !== undefined ? { floorId: query.floorId } : {}),
      ...(query.areaId !== undefined ? { areaId: query.areaId } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.warrantyStatus !== undefined ? { warrantyStatus: query.warrantyStatus } : {}),
      ...(query.hasOpenProblems !== undefined ? { hasOpenProblems: query.hasOpenProblems } : {}),
      ...(query.maintenanceDue !== undefined ? { maintenanceDue: query.maintenanceDue } : {}),
      ...(query.maintenanceOverdue !== undefined
        ? { maintenanceOverdue: query.maintenanceOverdue }
        : {}),
      excludeRetired: true,
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      EquipmentRepository.list(pool, filter),
      EquipmentRepository.count(pool, filter),
    ]);
    return buildPage(rows.map((row) => mapEquipment(row, userId)), total, page, pageSize);
  }

  /** The equipment profile: everything the detail screen shows, in one round trip. */
  async getById(id: string, userId: string, scope: DetailScope = 'FULL'): Promise<EquipmentDto> {
    const pool = getPool();
    const row = await EquipmentRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Equipment', id);
    return this.detailFor(pool, row, userId, scope);
  }

  /** Resolves a scanned QR payload, an NFC tag or a typed asset id to the profile. */
  async resolve(code: string, userId: string, scope: DetailScope = 'FULL'): Promise<EquipmentDto> {
    const pool = getPool();
    const row = await EquipmentRepository.findByAssetIdOrQr(pool, code.trim());
    if (row === null) throw new NotFoundError('Equipment', code);
    return this.detailFor(pool, row, userId, scope);
  }

  /**
   * A reporter (`equipment.report_problem` without `equipment.view`) gets the machine's
   * identity and the problems already open against it — which is exactly what they need to
   * confirm they scanned the right thing and to avoid reporting the same fault twice. The
   * paperwork, supplier phone numbers, service plan and floor-plan pin belong to the
   * monitoring surface and are omitted rather than merely hidden by the client.
   */
  private async detailFor(
    db: Db,
    row: EquipmentRow,
    userId: string,
    scope: DetailScope,
  ): Promise<EquipmentDto> {
    const openTickets = await MaintenanceRepository.listTickets(db, {
      equipmentId: row.id,
      openOnly: true,
      limit: LIMITS.PAGE_SIZE_DEFAULT,
      offset: 0,
    });
    const base = {
      ...mapEquipment(row, userId),
      openTickets: openTickets.map((ticket) => mapMaintenanceTicket(ticket, userId)),
    };
    if (scope === 'REPORTER') return base;

    const [suppliers, documents, warranties, schedules, position] = await Promise.all([
      EquipmentRepository.listSupplierLinks(db, row.id),
      EquipmentRepository.listDocuments(db, row.id),
      EquipmentRepository.listWarranties(db, row.id),
      MaintenanceRepository.listSchedules(db, {
        equipmentId: row.id,
        limit: LIMITS.PAGE_SIZE_DEFAULT,
        offset: 0,
      }),
      FloorPlanRepository.findPositionForEquipment(db, row.id),
    ]);

    return {
      ...base,
      suppliers: suppliers.map(mapEquipmentSupplierLink),
      documents: documents.map((document) => mapEquipmentDocument(document, userId)),
      warranties: warranties.map(mapEquipmentWarranty),
      schedules: schedules.map(mapMaintenanceSchedule),
      position: position === null ? null : mapFloorPlanPosition(position, userId),
    };
  }

  /**
   * Registers an asset.
   *
   * The asset id is allocated here from the area and category segments and the configured
   * prefix — never supplied by the caller — so two people registering an oven at the same
   * moment cannot collide: the sequence is read `FOR UPDATE` inside this transaction and the
   * unique key on `asset_id` is the backstop.
   */
  async create(input: EquipmentCreateRequest, actor: AuditActor): Promise<EquipmentDto> {
    const id = newId();

    const row = await withTransaction(async (connection) => {
      const location =
        input.locationId === undefined || input.locationId === null
          ? null
          : await EquipmentLocationRepository.findLocationById(connection, input.locationId);
      if (input.locationId !== undefined && input.locationId !== null && location === null) {
        throw new NotFoundError('Location', input.locationId);
      }

      const category =
        input.categoryId === undefined || input.categoryId === null
          ? null
          : await EquipmentCategoryRepository.findById(connection, input.categoryId);
      if (input.categoryId !== undefined && input.categoryId !== null && category === null) {
        throw new NotFoundError('Equipment category', input.categoryId);
      }

      const areaSegment =
        location === null
          ? GENERIC_SEGMENT
          : segmentFrom(
            (await EquipmentLocationRepository.findAreaById(connection, location.area_id))
              ?.asset_segment,
          );
      const assetId = await this.allocateAssetId(
        connection,
        areaSegment,
        segmentFrom(category?.asset_segment),
      );

      await EquipmentRepository.insert(connection, {
        id,
        assetId,
        name: input.name,
        equipmentType: input.equipmentType ?? null,
        brand: input.brand ?? null,
        model: input.model ?? null,
        serialNumber: input.serialNumber ?? null,
        manufacturer: input.manufacturer ?? null,
        categoryId: input.categoryId ?? null,
        locationId: input.locationId ?? null,
        status: input.status ?? EquipmentStatus.OPERATIONAL,
        imageMediaId: input.imageMediaId ?? null,
        specifications: toJsonColumn(input.specifications ?? null),
        purchaseDate: input.purchaseDate ?? null,
        installationDate: input.installationDate ?? null,
        purchasePrice: input.purchasePrice ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        supplierName: input.supplierName ?? null,
        warrantyExpiry: null,
        // Resolves straight back to this profile through the app's deep link handler; the
        // asset id alone also resolves, so a label printed without a code still works.
        qrCode: `menuboard://equipment/${assetId}`,
        nfcTagId: input.nfcTagId ?? null,
        notes: input.notes ?? null,
        capturedVia: input.capturedVia ?? CaptureSource.MANUAL,
        createdBy: actor.userId,
      });

      await EquipmentRepository.insertStatusHistory(connection, {
        id: newId(),
        equipmentId: id,
        fromStatus: null,
        toStatus: input.status ?? EquipmentStatus.OPERATIONAL,
        note: 'Registered',
        ticketId: null,
        changedBy: actor.userId,
      });

      if (location !== null) {
        await EquipmentRepository.insertLocationHistory(connection, {
          id: newId(),
          equipmentId: id,
          fromLocationId: null,
          toLocationId: location.id,
          fromPath: null,
          toPath: pathForLocation(location),
          note: 'Registered',
          movedBy: actor.userId,
        });
      }

      for (const mediaId of input.documentIds ?? []) {
        await EquipmentRepository.insertDocument(connection, {
          id: newId(),
          equipmentId: id,
          mediaId,
          docType: EquipmentDocumentType.OTHER,
          title: null,
          extracted: null,
          uploadedBy: actor.userId ?? '',
        });
      }

      for (const link of input.suppliers ?? []) {
        await this.applySupplierLink(connection, id, link, actor.userId);
      }

      if (input.warrantyExpiry !== undefined && input.warrantyExpiry !== null) {
        await EquipmentRepository.insertWarranty(connection, {
          id: newId(),
          equipmentId: id,
          provider: input.supplierName ?? null,
          policyNumber: null,
          startDate: input.purchaseDate ?? null,
          expiryDate: input.warrantyExpiry,
          months: null,
          terms: null,
          documentId: null,
          createdBy: actor.userId,
        });
        await EquipmentRepository.refreshWarrantyExpiry(connection, id);
      }

      const schedule = scheduleSeedFor(input, category?.default_frequency ?? null, category?.default_interval_days ?? null);
      if (schedule !== null) {
        const anchorDate =
          schedule.anchorDate ?? input.installationDate ?? input.purchaseDate ?? todayIsoDate();
        await MaintenanceRepository.insertSchedule(connection, {
          id: newId(),
          equipmentId: id,
          title: `${category?.name ?? 'Preventive'} maintenance`,
          frequency: schedule.frequency,
          intervalDays: schedule.intervalDays,
          anchorDate,
          nextDueAt: nextDueFrom(anchorDate, schedule.frequency, schedule.intervalDays),
          reminderDays: DEFAULT_REMINDER_DAYS,
          assignedTo: null,
          supplierId: null,
          instructions: null,
          createdBy: actor.userId,
        });
        await EquipmentRepository.refreshMaintenanceDates(connection, id);
      }

      if (input.position !== undefined && input.position !== null) {
        await FloorPlanRepository.upsertPosition(connection, {
          id: newId(),
          floorPlanId: input.position.floorPlanId,
          equipmentId: id,
          x: input.position.x,
          y: input.position.y,
          placedBy: actor.userId,
        });
      }

      const created = await EquipmentRepository.findById(connection, id);
      if (created === null) throw new NotFoundError('Equipment', id);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: id,
        type: MaintenanceActivityType.EQUIPMENT_REGISTERED,
        summary: `${created.name} registered as ${assetId}`,
        detail: pathForLocation(location),
        metadata: { assetId, capturedVia: created.captured_via },
        source: created.captured_via,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_CREATED,
        entityType: 'equipment',
        entityId: id,
        after: { assetId, name: created.name, locationId: created.location_id },
      });
      return created;
    });

    return this.detailFor(getPool(), row, actor.userId ?? '', 'FULL');
  }

  async update(id: string, input: EquipmentUpdateRequest, actor: AuditActor): Promise<EquipmentDto> {
    await withTransaction(async (connection) => {
      const before = await EquipmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Equipment', id);

      const { assignments, params } = buildAssignments([
        ['name', input.name],
        ['equipment_type', input.equipmentType],
        ['brand', input.brand],
        ['model', input.model],
        ['serial_number', input.serialNumber],
        ['manufacturer', input.manufacturer],
        ['category_id', input.categoryId],
        ['image_media_id', input.imageMediaId],
        [
          'specifications',
          input.specifications === undefined ? undefined : toJsonColumn(input.specifications),
        ],
        ['purchase_date', input.purchaseDate],
        ['installation_date', input.installationDate],
        ['purchase_price', input.purchasePrice],
        ['invoice_number', input.invoiceNumber],
        ['supplier_name', input.supplierName],
        ['nfc_tag_id', input.nfcTagId],
        ['notes', input.notes],
      ]);

      // Status and location have their own endpoints because each one writes history; an
      // ordinary edit that changed them silently would leave the timeline lying.
      if (assignments.length > 0) {
        await EquipmentRepository.update(connection, id, assignments, params);
      }

      if (input.warrantyExpiry !== undefined) {
        await this.applyWarrantyExpiry(connection, before, input.warrantyExpiry, actor);
      }

      const updated = await EquipmentRepository.findById(connection, id);
      if (updated === null) throw new NotFoundError('Equipment', id);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: id,
        type: MaintenanceActivityType.EQUIPMENT_UPDATED,
        summary: `${updated.name} details updated`,
        metadata: { fields: Object.keys(input) },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_UPDATED,
        entityType: 'equipment',
        entityId: id,
        before: { name: before.name, categoryId: before.category_id },
        after: { name: updated.name, categoryId: updated.category_id },
      });
    });

    return this.getById(id, actor.userId ?? '');
  }

  /** Erases the asset and, by cascade, its whole maintenance history. Admin only. */
  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await EquipmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Equipment', id);
      if (Number(before.open_ticket_count) > 0) {
        throw new ConflictError(
          `${before.name} has ${before.open_ticket_count} open maintenance ticket(s); close or cancel them first`,
        );
      }

      await EquipmentRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_DELETED,
        entityType: 'equipment',
        entityId: id,
        before: { assetId: before.asset_id, name: before.name },
      });
    });
  }

  async changeStatus(
    id: string,
    input: EquipmentStatusChangeRequest,
    actor: AuditActor,
  ): Promise<EquipmentDto> {
    await withTransaction(async (connection) => {
      const before = await EquipmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Equipment', id);
      if (before.status === input.status) return;

      await this.writeStatus(connection, before, input.status, input.note ?? null, null, actor);
    });

    return this.getById(id, actor.userId ?? '');
  }

  /**
   * Applies a status change with its history row and timeline entry. Shared with the
   * maintenance workflow, which moves an asset to UNDER_MAINTENANCE and back on its behalf.
   */
  async writeStatus(
    db: Db,
    current: EquipmentRow,
    status: EquipmentStatus,
    note: string | null,
    ticketId: string | null,
    actor: AuditActor,
  ): Promise<void> {
    if (current.status === status) return;

    await EquipmentRepository.update(
      db,
      current.id,
      ['status = ?', 'status_note = ?', 'status_changed_at = ?'],
      [status, note, toDbDateTime()],
    );
    await EquipmentRepository.insertStatusHistory(db, {
      id: newId(),
      equipmentId: current.id,
      fromStatus: current.status,
      toStatus: status,
      note,
      ticketId,
      changedBy: actor.userId,
    });
    await maintenanceActivityService.record(db, actor, {
      equipmentId: current.id,
      ticketId,
      type: MaintenanceActivityType.STATUS_CHANGED,
      summary: `Status changed from ${humanise(current.status)} to ${humanise(status)}`,
      detail: note,
      metadata: { from: current.status, to: status },
      source: ticketId === null ? CaptureSource.MANUAL : CaptureSource.SYSTEM,
    });
    await auditService.record(db, actor, {
      action: AuditAction.EQUIPMENT_STATUS_CHANGED,
      entityType: 'equipment',
      entityId: current.id,
      before: { status: current.status },
      after: { status, note },
    });
  }

  async move(id: string, input: EquipmentMoveRequest, actor: AuditActor): Promise<EquipmentDto> {
    await withTransaction(async (connection) => {
      const before = await EquipmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Equipment', id);

      const destination = await EquipmentLocationRepository.findLocationById(
        connection,
        input.locationId,
      );
      if (destination === null) throw new NotFoundError('Location', input.locationId);
      if (before.location_id === destination.id) return;

      await EquipmentRepository.update(connection, id, ['location_id = ?'], [destination.id]);
      await EquipmentRepository.insertLocationHistory(connection, {
        id: newId(),
        equipmentId: id,
        fromLocationId: before.location_id,
        toLocationId: destination.id,
        fromPath: locationPathOf(before),
        toPath: pathForLocation(destination),
        note: input.note ?? null,
        movedBy: actor.userId,
      });

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: id,
        type: MaintenanceActivityType.LOCATION_CHANGED,
        summary: `Moved to ${pathForLocation(destination)}`,
        detail: input.note ?? null,
        metadata: { from: before.location_id, to: destination.id },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_MOVED,
        entityType: 'equipment',
        entityId: id,
        before: { locationId: before.location_id },
        after: { locationId: destination.id },
      });
    });

    return this.getById(id, actor.userId ?? '');
  }

  async listStatusHistory(equipmentId: string): Promise<EquipmentStatusHistoryDto[]> {
    const rows = await EquipmentRepository.listStatusHistory(getPool(), equipmentId, HISTORY_LIMIT);
    return rows.map(mapEquipmentStatusHistory);
  }

  async listLocationHistory(equipmentId: string): Promise<EquipmentLocationHistoryDto[]> {
    const rows = await EquipmentRepository.listLocationHistory(
      getPool(),
      equipmentId,
      HISTORY_LIMIT,
    );
    return rows.map(mapEquipmentLocationHistory);
  }

  async listActivities(equipmentId: string): Promise<MaintenanceActivityDto[]> {
    const rows = await MaintenanceRepository.listActivities(getPool(), {
      equipmentId,
      limit: ACTIVITY_LIMIT,
    });
    return rows.map(mapMaintenanceActivity);
  }

  /* ---------------------------------------------------------------- documents */

  async listDocuments(equipmentId: string, userId: string): Promise<EquipmentDocumentDto[]> {
    const rows = await EquipmentRepository.listDocuments(getPool(), equipmentId);
    return rows.map((row) => mapEquipmentDocument(row, userId));
  }

  async addDocument(
    equipmentId: string,
    input: {
      mediaId: string;
      docType?: EquipmentDocumentType;
      title?: string | null;
      extracted?: DocumentExtractionDto | null;
      /** Records the warranty the OCR read, rather than leaving it on the page alone. */
      applyWarranty?: boolean;
    },
    actor: AuditActor,
  ): Promise<EquipmentDocumentDto> {
    const id = newId();

    await withTransaction(async (connection) => {
      const equipment = await EquipmentRepository.findById(connection, equipmentId);
      if (equipment === null) throw new NotFoundError('Equipment', equipmentId);

      const existing = await EquipmentRepository.listDocuments(connection, equipmentId);
      if (existing.length >= LIMITS.EQUIPMENT_DOCUMENTS_PER_ASSET_MAX) {
        throw new ConflictError(
          `An asset may hold at most ${LIMITS.EQUIPMENT_DOCUMENTS_PER_ASSET_MAX} documents`,
        );
      }

      const media = await mediaAssetRepository.findById(connection, input.mediaId);
      if (media === null) throw new NotFoundError('Media asset', input.mediaId);

      const docType = input.docType ?? EquipmentDocumentType.OTHER;
      await EquipmentRepository.insertDocument(connection, {
        id,
        equipmentId,
        mediaId: input.mediaId,
        docType,
        title: input.title ?? null,
        extracted: toJsonColumn(input.extracted ?? null),
        uploadedBy: actor.userId ?? '',
      });

      const extracted = input.extracted ?? null;
      if (input.applyWarranty === true && extracted !== null) {
        const expiry = extracted.warrantyExpiry ?? null;
        if (expiry !== null) {
          await EquipmentRepository.insertWarranty(connection, {
            id: newId(),
            equipmentId,
            provider: extracted.supplierName ?? equipment.supplier_name,
            policyNumber: extracted.invoiceNumber ?? null,
            startDate: extracted.purchaseDate ?? null,
            expiryDate: expiry,
            months: extracted.warrantyMonths ?? null,
            terms: extracted.notes ?? null,
            documentId: id,
            createdBy: actor.userId,
          });
          await EquipmentRepository.refreshWarrantyExpiry(connection, equipmentId);
          await maintenanceActivityService.record(connection, actor, {
            equipmentId,
            type: MaintenanceActivityType.WARRANTY_RECORDED,
            summary: `Warranty recorded, expiring ${expiry}`,
            metadata: { expiry },
            source: CaptureSource.DOCUMENT_OCR,
          });
        }
      }

      await maintenanceActivityService.record(connection, actor, {
        equipmentId,
        type: MaintenanceActivityType.DOCUMENT_UPLOADED,
        summary: `${humanise(docType)} added`,
        detail: input.title ?? media.file_name,
        metadata: { documentId: id, docType },
        source: extracted === null ? CaptureSource.MANUAL : CaptureSource.DOCUMENT_OCR,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_DOCUMENT_UPLOADED,
        entityType: 'equipment_document',
        entityId: id,
        after: { equipmentId, docType, mediaId: input.mediaId },
      });
    });

    const row = await EquipmentRepository.findDocumentById(getPool(), id);
    if (row === null) throw new NotFoundError('Equipment document', id);
    return mapEquipmentDocument(row, actor.userId ?? '');
  }

  async removeDocument(documentId: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await EquipmentRepository.findDocumentById(connection, documentId);
      if (before === null) throw new NotFoundError('Equipment document', documentId);

      await EquipmentRepository.softDeleteDocument(connection, documentId);
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_DOCUMENT_DELETED,
        entityType: 'equipment_document',
        entityId: documentId,
        before: { equipmentId: before.equipment_id, docType: before.doc_type },
      });
    });
  }

  /* --------------------------------------------------------------- warranties */

  async listWarranties(equipmentId: string): Promise<EquipmentWarrantyDto[]> {
    const rows = await EquipmentRepository.listWarranties(getPool(), equipmentId);
    return rows.map(mapEquipmentWarranty);
  }

  async addWarranty(
    equipmentId: string,
    input: {
      provider?: string | null;
      policyNumber?: string | null;
      startDate?: string | null;
      expiryDate?: string | null;
      months?: number | null;
      terms?: string | null;
      documentId?: string | null;
    },
    actor: AuditActor,
  ): Promise<EquipmentWarrantyDto[]> {
    const id = newId();
    await withTransaction(async (connection) => {
      const equipment = await EquipmentRepository.findById(connection, equipmentId);
      if (equipment === null) throw new NotFoundError('Equipment', equipmentId);

      const expiryDate = input.expiryDate ?? expiryFromMonths(input.startDate ?? null, input.months ?? null);
      await EquipmentRepository.insertWarranty(connection, {
        id,
        equipmentId,
        provider: input.provider ?? null,
        policyNumber: input.policyNumber ?? null,
        startDate: input.startDate ?? null,
        expiryDate,
        months: input.months ?? null,
        terms: input.terms ?? null,
        documentId: input.documentId ?? null,
        createdBy: actor.userId,
      });
      await EquipmentRepository.refreshWarrantyExpiry(connection, equipmentId);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId,
        type: MaintenanceActivityType.WARRANTY_RECORDED,
        summary:
          expiryDate === null
            ? 'Warranty recorded'
            : `Warranty recorded, expiring ${expiryDate}`,
        detail: input.provider ?? null,
        metadata: { warrantyId: id, expiryDate },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_WARRANTY_RECORDED,
        entityType: 'equipment_warranty',
        entityId: id,
        after: { equipmentId, expiryDate },
      });
    });

    return this.listWarranties(equipmentId);
  }

  /**
   * Materialises the single `warrantyExpiry` field the equipment form offers as a real
   * warranty row, so the denormalised column on `equipment` always has a source to be
   * recomputed from. Clearing it deactivates the active rows rather than deleting them.
   */
  private async applyWarrantyExpiry(
    db: PoolConnection,
    equipment: EquipmentRow,
    expiry: string | null,
    actor: AuditActor,
  ): Promise<void> {
    if (expiry === null) {
      await EquipmentRepository.deactivateWarranties(db, equipment.id);
      await EquipmentRepository.refreshWarrantyExpiry(db, equipment.id);
      return;
    }
    if ((equipment.warranty_expiry ?? '').slice(0, 10) === expiry) return;

    await EquipmentRepository.insertWarranty(db, {
      id: newId(),
      equipmentId: equipment.id,
      provider: equipment.supplier_name,
      policyNumber: null,
      startDate: equipment.purchase_date === null ? null : equipment.purchase_date.slice(0, 10),
      expiryDate: expiry,
      months: null,
      terms: null,
      documentId: null,
      createdBy: actor.userId,
    });
    await EquipmentRepository.refreshWarrantyExpiry(db, equipment.id);
    await maintenanceActivityService.record(db, actor, {
      equipmentId: equipment.id,
      type: MaintenanceActivityType.WARRANTY_RECORDED,
      summary: `Warranty recorded, expiring ${expiry}`,
      metadata: { expiry },
    });
  }

  /* ----------------------------------------------------------- supplier links */

  async listSupplierLinks(equipmentId: string): Promise<EquipmentSupplierLinkDto[]> {
    const rows = await EquipmentRepository.listSupplierLinks(getPool(), equipmentId);
    return rows.map(mapEquipmentSupplierLink);
  }

  async setSupplierLink(
    equipmentId: string,
    input: { supplierId: string; role: EquipmentSupplierRole; isDefault?: boolean },
    actor: AuditActor,
  ): Promise<EquipmentSupplierLinkDto[]> {
    await withTransaction(async (connection) => {
      const equipment = await EquipmentRepository.findById(connection, equipmentId);
      if (equipment === null) throw new NotFoundError('Equipment', equipmentId);

      await this.applySupplierLink(connection, equipmentId, input, actor.userId);
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_SUPPLIER_LINKED,
        entityType: 'equipment',
        entityId: equipmentId,
        after: { supplierId: input.supplierId, role: input.role },
      });
    });

    return this.listSupplierLinks(equipmentId);
  }

  async removeSupplierLink(
    equipmentId: string,
    role: EquipmentSupplierRole,
    actor: AuditActor,
  ): Promise<EquipmentSupplierLinkDto[]> {
    await withTransaction(async (connection) => {
      const removed = await EquipmentRepository.removeSupplierLink(connection, equipmentId, role);
      if (!removed) throw new NotFoundError('Supplier link', role);
      await auditService.record(connection, actor, {
        action: AuditAction.EQUIPMENT_SUPPLIER_UNLINKED,
        entityType: 'equipment',
        entityId: equipmentId,
        before: { role },
      });
    });

    return this.listSupplierLinks(equipmentId);
  }

  private async applySupplierLink(
    db: PoolConnection,
    equipmentId: string,
    input: { supplierId: string; role: EquipmentSupplierRole; isDefault?: boolean },
    userId: string | null,
  ): Promise<void> {
    const isDefault = input.isDefault ?? false;
    await EquipmentRepository.upsertSupplierLink(db, {
      id: newId(),
      equipmentId,
      supplierId: input.supplierId,
      role: input.role,
      isDefault,
      createdBy: userId,
    });
    if (isDefault) {
      await EquipmentRepository.clearDefaultSupplier(db, equipmentId, input.role);
    }
  }

  /* -------------------------------------------------------------------- media */

  /**
   * Uploads a photo, voice note or document into the shared media library for this module.
   *
   * Its own endpoint rather than the Menu Master's `/media/upload`: that one is gated by
   * MASTER_WRITE and accepts images only, while somebody reporting a fault holds
   * `equipment.report_problem` and may be sending a voice note or a video of it.
   */
  async uploadMedia(
    input: {
      tempPath: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      title?: string | null;
    },
    actor: AuditActor,
  ): Promise<MediaAssetDto> {
    // `storageKindForMimeType`, not `kindForMimeType`: this is the one endpoint that accepts
    // video, and video is deliberately not an `AttachmentKind`.
    const kind = storageKindForMimeType(input.mimeType);
    const maxBytes = maxBytesForKind(kind);
    if (input.sizeBytes > maxBytes) {
      throw new UnsupportedMediaTypeError(
        `That file exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
      );
    }

    const id = newId();
    const stored = await storeUploadedFile({
      attachmentId: id,
      tempPath: input.tempPath,
      mimeType: input.mimeType,
      kind,
    });

    const row = await withTransaction(async (connection) =>
      mediaAssetRepository.insert(connection, {
        id,
        fileName: input.originalName,
        storagePath: stored.storagePath,
        mimeType: input.mimeType,
        fileExtension: path.extname(input.originalName).toLowerCase() || null,
        sizeBytes: stored.sizeBytes,
        width: null,
        height: null,
        mediaType: MEDIA_TYPE_BY_STORAGE_KIND[kind],
        title: input.title ?? null,
        altText: null,
        checksum: stored.checksum,
        createdBy: actor.userId,
      }),
    );

    return mapMediaAsset(row, actor.userId ?? '');
  }

  /* ---------------------------------------------------------------- dashboard */

  /**
   * The module's landing payload. Leads with problems rather than statistics: the counters
   * exist to be clicked through, and the two lists below them are the actual content.
   */
  async dashboard(userId: string): Promise<EquipmentDashboardDto> {
    const pool = getPool();
    const [counts, recentProblems, upcoming, expiring] = await Promise.all([
      MaintenanceRepository.dashboardCounts(pool),
      MaintenanceRepository.listTickets(pool, {
        openOnly: true,
        limit: DASHBOARD_LIST_LIMIT,
        offset: 0,
      }),
      MaintenanceRepository.listSchedules(pool, {
        dueBefore: addDays(new Date(), DASHBOARD_UPCOMING_DAYS).toISOString().slice(0, 10),
        limit: DASHBOARD_LIST_LIMIT,
        offset: 0,
      }),
      EquipmentRepository.list(pool, {
        warrantyStatus: 'EXPIRING_SOON',
        excludeRetired: true,
        limit: DASHBOARD_LIST_LIMIT,
        offset: 0,
      }),
    ]);

    return {
      counts: {
        totalEquipment: Number(counts.total_equipment),
        operational: Number(counts.operational),
        needingAttention: Number(counts.needing_attention),
        outOfService: Number(counts.out_of_service),
        maintenanceDue: Number(counts.maintenance_due),
        maintenanceOverdue: Number(counts.maintenance_overdue),
        openProblems: Number(counts.open_problems),
        criticalProblems: Number(counts.critical_problems),
        openTickets: Number(counts.open_tickets),
        technicianVisitsPending: Number(counts.technician_visits_pending),
        partsRequired: Number(counts.parts_required),
        supplierFollowUps: Number(counts.supplier_follow_ups),
        warrantyExpiring: Number(counts.warranty_expiring),
      },
      recentProblems: recentProblems.map((row) => mapMaintenanceTicket(row, userId)),
      upcomingMaintenance: upcoming.map(mapMaintenanceSchedule),
      warrantyExpiring: expiring.map((row) => {
        const dto = mapEquipment(row, userId);
        return {
          id: dto.id,
          assetId: dto.assetId,
          name: dto.name,
          warrantyExpiry: dto.warrantyExpiry,
          warrantyDaysRemaining: dto.warrantyDaysRemaining,
          imageUrl: dto.imageUrl,
        };
      }),
    };
  }

  /** `<prefix>-<area>-<category>-<sequence>`, e.g. MTC-KIT-OVN-001. */
  private async allocateAssetId(
    db: PoolConnection,
    areaSegment: string,
    categorySegment: string,
  ): Promise<string> {
    const [prefix, digits] = await Promise.all([
      settingsRepository.getValue<string>(db, 'equipment.assetIdPrefix', DEFAULT_ASSET_PREFIX),
      settingsRepository.getValue<number>(
        db,
        'equipment.assetIdSequenceDigits',
        DEFAULT_SEQUENCE_DIGITS,
      ),
    ]);

    const stem = `${segmentFrom(prefix)}-${areaSegment}-${categorySegment}`;
    const sequence = await EquipmentRepository.nextAssetSequence(db, stem);
    const width = Number.isInteger(digits) && digits > 0 ? digits : DEFAULT_SEQUENCE_DIGITS;
    const assetId = `${stem}-${String(sequence).padStart(width, '0')}`;

    if (assetId.length > LIMITS.EQUIPMENT_ASSET_ID_MAX) {
      throw new ValidationError('The configured Asset ID scheme produces an id that is too long', [
        { path: 'assetId', message: 'Shorten the prefix or the area/category segments' },
      ]);
    }
    return assetId;
  }
}

/* --------------------------------------------------------------------- helpers */

/** Turns a column/value list into the SET clause a repository update expects. */
function buildAssignments(
  entries: ReadonlyArray<[column: string, value: unknown]>,
): { assignments: string[]; params: unknown[] } {
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of entries) {
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    params.push(value);
  }
  return { assignments, params };
}

/** ENUM_MEMBER -> "Enum member", for prose written into the activity timeline. */
function humanise(value: string): string {
  const words = value.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function pathForLocation(location: EquipmentLocationRow | null): string | null {
  if (location === null) return null;
  const path = locationPathOf({
    floor_name: location.floor_name ?? null,
    area_name: location.area_name ?? null,
    location_name: location.name,
    room: location.room,
    section: location.section,
    position: location.position,
  });
  return path === '' ? null : path;
}

/**
 * What the wizard asked for, or — when it said nothing — the category's own recommendation.
 * A category with no recommended interval seeds no schedule, rather than inventing one.
 */
function scheduleSeedFor(
  input: EquipmentCreateRequest,
  categoryFrequency: MaintenanceFrequency | null,
  categoryIntervalDays: number | null,
): ScheduleSeed | null {
  if (input.schedule !== undefined && input.schedule !== null) {
    return {
      frequency: input.schedule.frequency,
      intervalDays: input.schedule.intervalDays ?? null,
      anchorDate: input.schedule.anchorDate ?? null,
    };
  }
  if (categoryFrequency === null) return null;
  return { frequency: categoryFrequency, intervalDays: categoryIntervalDays, anchorDate: null };
}

function nextDueFrom(
  anchorDate: string,
  frequency: MaintenanceFrequency,
  intervalDays: number | null,
): string {
  const days = maintenanceIntervalDays(frequency, intervalDays);
  const anchor = new Date(`${anchorDate}T00:00:00Z`);
  const today = new Date();
  let due = addDays(anchor, days);
  // An asset installed years ago must not land on the overdue list on the day it is entered.
  while (due.getTime() < today.getTime()) due = addDays(due, days);
  return due.toISOString().slice(0, 10);
}

function expiryFromMonths(startDate: string | null, months: number | null): string | null {
  if (startDate === null || months === null) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const expiry = new Date(start);
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  return expiry.toISOString().slice(0, 10);
}

export const equipmentService = new EquipmentService();
