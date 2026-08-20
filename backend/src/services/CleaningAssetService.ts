import {
  LIMITS,
  type CleanableAssetAvailabilityRequest,
  type CleanableAssetCreateRequest,
  type CleanableAssetDto,
  type CleanableAssetListQuery,
  type CleanableAssetUpdateRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { selectOne, type Db, type PoolConnection } from '../db/types';
import { mapCleanableAsset } from '../models/mappers';
import type { CleanableAssetRow, EquipmentAreaRow } from '../models/rows';
import {
  CleanableAssetRepository,
  type CleanableAssetFilter,
} from '../repositories/CleanableAssetRepository';
import { CleaningMasterRepository } from '../repositories/CleaningMasterRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * The register of cleanable things.
 *
 * Two behaviours here are load-bearing rather than convenience:
 *
 *  - **The code is generated.** `KIT-FOOD-0007` = area segment, type segment, sequence. Asking
 *    somebody registering a chopping board to invent a code is how a register ends up with
 *    "board2" in it.
 *  - **Every area gets a general asset on demand.** `resolveReportTarget` is the one place a
 *    report naming only a place becomes a row the engine can raise work against, and it
 *    creates the area's `AREA`-typed asset the first time somebody reports that area. Without
 *    it, "the corridor needs mopping" would have nowhere to land.
 */

const AREA_TYPE_CODE = 'AREA';

export class CleaningAssetService {
  async list(query: CleanableAssetListQuery, userId: string) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: CleanableAssetFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.areaId !== undefined ? { areaId: query.areaId } : {}),
      ...(query.floorId !== undefined ? { floorId: query.floorId } : {}),
      ...(query.assetTypeId !== undefined ? { assetTypeId: query.assetTypeId } : {}),
      ...(query.riskLevel !== undefined ? { riskLevel: query.riskLevel } : {}),
      ...(query.foodContact !== undefined ? { foodContact: query.foodContact } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.equipmentId !== undefined ? { equipmentId: query.equipmentId } : {}),
      ...(query.availableOnly !== undefined ? { availableOnly: query.availableOnly } : {}),
      ...(query.withoutRules !== undefined ? { withoutRules: query.withoutRules } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      CleanableAssetRepository.list(pool, filter),
      CleanableAssetRepository.count(pool, filter),
    ]);
    return buildPage(
      rows.map((row) => mapCleanableAsset(row, userId)),
      total,
      page,
      pageSize,
    );
  }

  async getById(id: string, userId: string): Promise<CleanableAssetDto> {
    const row = await CleanableAssetRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Cleanable asset', id);
    return mapCleanableAsset(row, userId);
  }

  /** A scanned label or a typed code — the phone's way in without browsing the register. */
  async resolve(code: string, userId: string): Promise<CleanableAssetDto> {
    const row = await CleanableAssetRepository.findByCode(getPool(), code.trim());
    if (row === null) throw new NotFoundError('Cleanable asset', code);
    return mapCleanableAsset(row, userId);
  }

  async create(input: CleanableAssetCreateRequest, actor: AuditActor): Promise<CleanableAssetDto> {
    const id = newId();
    const row = await withTransaction(async (connection) => {
      const type = await CleaningMasterRepository.findAssetType(connection, input.assetTypeId);
      if (type === null) throw new NotFoundError('Cleanable asset type', input.assetTypeId);
      const area = await findArea(connection, input.areaId);
      if (area === null) throw new NotFoundError('Area', input.areaId);

      const code =
        input.code !== undefined && input.code.trim() !== ''
          ? input.code.trim().toUpperCase()
          : await this.nextCode(connection, area.asset_segment, type.code);

      const clash = await CleanableAssetRepository.findByCode(connection, code);
      if (clash !== null) throw new ConflictError(`Asset code "${code}" is already in use`);

      if (input.equipmentId !== undefined && input.equipmentId !== null) {
        const linked = await CleanableAssetRepository.findByEquipmentId(
          connection,
          input.equipmentId,
        );
        if (linked !== null) {
          throw new ConflictError(`That equipment is already registered as "${linked.name}"`);
        }
      }

      await CleanableAssetRepository.insert(connection, {
        id,
        code,
        name: input.name,
        assetTypeId: input.assetTypeId,
        areaId: input.areaId,
        locationId: input.locationId ?? null,
        equipmentId: input.equipmentId ?? null,
        description: input.description ?? null,
        positionNote: input.positionNote ?? null,
        // Risk and food-contact default from the type rather than from a constant: that is
        // the entire reason the type carries them.
        riskLevel: input.riskLevel ?? type.default_risk_level,
        foodContact: input.foodContact ?? type.default_food_contact,
        imageMediaId: input.imageMediaId ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANABLE_ASSET_CREATED,
        entityType: 'cleanable_asset',
        entityId: id,
        after: { code, name: input.name, areaId: input.areaId, assetTypeId: input.assetTypeId },
      });

      const created = await CleanableAssetRepository.findById(connection, id);
      if (created === null) throw new NotFoundError('Cleanable asset', id);
      return created;
    });
    return mapCleanableAsset(row, actor.userId ?? '');
  }

  async update(
    id: string,
    input: CleanableAssetUpdateRequest,
    actor: AuditActor,
  ): Promise<CleanableAssetDto> {
    const row = await withTransaction(async (connection) => {
      const before = await CleanableAssetRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Cleanable asset', id);

      if (input.equipmentId !== undefined && input.equipmentId !== null) {
        const linked = await CleanableAssetRepository.findByEquipmentId(
          connection,
          input.equipmentId,
        );
        if (linked !== null && linked.id !== id) {
          throw new ConflictError(`That equipment is already registered as "${linked.name}"`);
        }
      }

      const columns: Record<string, string> = {
        name: 'name',
        assetTypeId: 'asset_type_id',
        areaId: 'area_id',
        locationId: 'location_id',
        equipmentId: 'equipment_id',
        description: 'description',
        positionNote: 'position_note',
        riskLevel: 'risk_level',
        foodContact: 'food_contact',
        imageMediaId: 'image_media_id',
        notes: 'notes',
        status: 'status',
      };
      const assignments: string[] = [];
      const params: unknown[] = [];
      for (const [field, column] of Object.entries(columns)) {
        const value = (input as Record<string, unknown>)[field];
        if (value === undefined) continue;
        assignments.push(`${column} = ?`);
        params.push(value);
      }
      await CleanableAssetRepository.update(connection, id, assignments, params);

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANABLE_ASSET_UPDATED,
        entityType: 'cleanable_asset',
        entityId: id,
        before: {
          name: before.name,
          areaId: before.area_id,
          riskLevel: before.risk_level,
          foodContact: before.food_contact,
          status: before.status,
        },
        after: { ...input },
      });

      const after = await CleanableAssetRepository.findById(connection, id);
      if (after === null) throw new NotFoundError('Cleanable asset', id);
      return after;
    });
    return mapCleanableAsset(row, actor.userId ?? '');
  }

  /**
   * Takes an asset out of service, or puts it back.
   *
   * Its own endpoint rather than a field on the update, because the generator reads this flag
   * on every sweep — an oven that is being rebuilt should not accrue overdue cleaning tasks —
   * and because "who took the fryer out of the cleaning schedule, and why" is a question the
   * audit trail must answer directly.
   */
  async setAvailability(
    id: string,
    input: CleanableAssetAvailabilityRequest,
    actor: AuditActor,
  ): Promise<CleanableAssetDto> {
    if (!input.isAvailable && (input.reason ?? '').trim() === '') {
      throw new ValidationError('Say why the asset is unavailable');
    }
    const row = await withTransaction(async (connection) => {
      const before = await CleanableAssetRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Cleanable asset', id);
      await CleanableAssetRepository.update(
        connection,
        id,
        ['is_available = ?', 'unavailable_reason = ?'],
        [input.isAvailable ? 1 : 0, input.isAvailable ? null : (input.reason ?? null)],
      );
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANABLE_ASSET_AVAILABILITY_CHANGED,
        entityType: 'cleanable_asset',
        entityId: id,
        before: { isAvailable: before.is_available === 1, reason: before.unavailable_reason },
        after: { isAvailable: input.isAvailable, reason: input.reason ?? null },
      });
      const after = await CleanableAssetRepository.findById(connection, id);
      if (after === null) throw new NotFoundError('Cleanable asset', id);
      return after;
    });
    return mapCleanableAsset(row, actor.userId ?? '');
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await CleanableAssetRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Cleanable asset', id);
      if (Number(before.open_task_count ?? 0) > 0) {
        throw new ConflictError(
          'That asset still has open cleaning tasks. Close or cancel them first.',
        );
      }
      await CleanableAssetRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANABLE_ASSET_DELETED,
        entityType: 'cleanable_asset',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /**
   * The asset a report is really about.
   *
   * Named asset wins. Failing that, the equipment's linked cleanable asset. Failing that, the
   * area's general asset — created on first use, so an area a nobody has registered anything
   * in still accepts "this needs cleaning".
   */
  async resolveReportTarget(
    connection: PoolConnection,
    input: { cleanableAssetId?: string | null; areaId?: string | null; equipmentId?: string | null },
    actor: AuditActor,
  ): Promise<CleanableAssetRow> {
    if (input.cleanableAssetId !== undefined && input.cleanableAssetId !== null) {
      const asset = await CleanableAssetRepository.findById(connection, input.cleanableAssetId);
      if (asset === null) throw new NotFoundError('Cleanable asset', input.cleanableAssetId);
      return asset;
    }

    if (input.equipmentId !== undefined && input.equipmentId !== null) {
      const linked = await CleanableAssetRepository.findByEquipmentId(
        connection,
        input.equipmentId,
      );
      if (linked !== null) return linked;
    }

    if (input.areaId === undefined || input.areaId === null) {
      throw new ValidationError('Name the area or the thing that needs cleaning');
    }
    return this.ensureAreaGeneralAsset(connection, input.areaId, actor);
  }

  /** The area's own `AREA`-typed asset, created the first time it is needed. */
  async ensureAreaGeneralAsset(
    connection: PoolConnection,
    areaId: string,
    actor: AuditActor,
  ): Promise<CleanableAssetRow> {
    const existing = await CleanableAssetRepository.findAreaGeneralAsset(connection, areaId);
    if (existing !== null) return existing;

    const area = await findArea(connection, areaId);
    if (area === null) throw new NotFoundError('Area', areaId);
    const type = await CleaningMasterRepository.findAssetTypeByCode(connection, AREA_TYPE_CODE);
    if (type === null) {
      throw new ConflictError(
        `The "${AREA_TYPE_CODE}" cleanable asset type is missing. Restore it before reporting an area.`,
      );
    }

    const id = newId();
    const code = await this.nextCode(connection, area.asset_segment, type.code);
    await CleanableAssetRepository.insert(connection, {
      id,
      code,
      name: `${area.name} — general area`,
      assetTypeId: type.id,
      areaId,
      locationId: null,
      equipmentId: null,
      description: 'The area itself: floors, walls, surfaces and anything not registered separately.',
      positionNote: null,
      riskLevel: type.default_risk_level,
      foodContact: type.default_food_contact,
      imageMediaId: null,
      notes: null,
      createdBy: actor.userId,
    });
    await auditService.record(connection, actor, {
      action: AuditAction.CLEANABLE_ASSET_CREATED,
      entityType: 'cleanable_asset',
      entityId: id,
      after: { code, name: `${area.name} — general area`, areaId, reason: 'area report' },
    });

    const created = await CleanableAssetRepository.findById(connection, id);
    if (created === null) throw new NotFoundError('Cleanable asset', id);
    return created;
  }

  /** `KIT-FOOD-0007`. Segments are truncated so the code fits its column at any input length. */
  private async nextCode(db: Db, areaSegment: string, typeCode: string): Promise<string> {
    const area = areaSegment.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'GEN';
    const type = typeCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'ASSET';
    const prefix = `${area}-${type}`;
    const sequence = await CleanableAssetRepository.nextCodeSequence(db, prefix);
    return `${prefix}-${String(sequence).padStart(4, '0')}`.slice(
      0,
      LIMITS.CLEANABLE_ASSET_CODE_MAX,
    );
  }
}

async function findArea(db: Db, areaId: string): Promise<EquipmentAreaRow | null> {
  return selectOne<EquipmentAreaRow>(
    db,
    `SELECT a.*, f.name AS floor_name
       FROM equipment_areas a
       LEFT JOIN equipment_floors f ON f.id = a.floor_id
      WHERE a.id = ? AND a.deleted_at IS NULL`,
    [areaId],
  );
}

export const cleaningAssetService = new CleaningAssetService();
