import {
  CleaningChemicalKind,
  CleaningRiskLevel,
  CleaningToolKind,
  FoodContactClass,
  type CleanableAssetTypeDto,
  type CleanableAssetTypeWriteRequest,
  type CleaningChemicalDto,
  type CleaningChemicalWriteRequest,
  type CleaningMethodDto,
  type CleaningMethodWriteRequest,
  type CleaningSetupDto,
  type CleaningStandardDto,
  type CleaningStandardWriteRequest,
  type CleaningToolDto,
  type CleaningToolWriteRequest,
  type MasterListQuery,
  type ShiftDto,
  type ShiftWriteRequest,
  type SkillDto,
  type SkillWriteRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { selectRows, type Db } from '../db/types';
import type { EquipmentAreaRow } from '../models/rows';
import {
  mapCleanableAssetType,
  mapCleaningChemical,
  mapCleaningMethod,
  mapCleaningStandard,
  mapCleaningTool,
  mapShift,
  mapSkill,
} from '../models/mappers';
import { CleaningMasterRepository, type MasterFilter } from '../repositories/CleaningMasterRepository';
import { CleaningProcedureRepository } from '../repositories/CleaningProcedureRepository';
import { ConflictError, NotFoundError } from '../utils/errors';
import { newId } from '../utils/ids';
import { toDbTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * The seven reference tables the cleaning module owns, and the one bundled payload every write
 * form in both clients opens with.
 *
 * Grouped into one service for the same reason they share a repository: to the product they
 * are "the cleaning masters" page, and seven services differing only in a table name would be
 * seven places for the same audit rule to drift.
 */

function filterFrom(query: MasterListQuery): MasterFilter {
  return {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.includeInactive !== undefined ? { includeInactive: query.includeInactive } : {}),
  };
}

/** Assignments/params for the columns a partial write actually names. Absent stays untouched. */
function assignmentsFor(
  input: Record<string, unknown>,
  columns: Readonly<Record<string, string>>,
): { assignments: string[]; params: unknown[] } {
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [field, column] of Object.entries(columns)) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  return { assignments, params };
}

export class CleaningMasterService {
  /* ---------------------------------------------------------------- asset types */

  async listAssetTypes(query: MasterListQuery): Promise<CleanableAssetTypeDto[]> {
    const rows = await CleaningMasterRepository.listAssetTypes(getPool(), filterFrom(query));
    return rows.map(mapCleanableAssetType);
  }

  async createAssetType(
    input: CleanableAssetTypeWriteRequest,
    actor: AuditActor,
  ): Promise<CleanableAssetTypeDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningMasterRepository.codeExists(connection, 'assetTypes', input.code)) {
        throw new ConflictError(`Asset type code "${input.code}" is already in use`);
      }
      await CleaningMasterRepository.insertAssetType(connection, {
        id,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        defaultRiskLevel: input.defaultRiskLevel ?? CleaningRiskLevel.MEDIUM,
        defaultFoodContact: input.defaultFoodContact ?? FoodContactClass.NON_FOOD,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_CREATED,
        entityType: 'cleanable_asset_type',
        entityId: id,
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findAssetType(connection, id);
      if (row === null) throw new NotFoundError('Cleanable asset type', id);
      return mapCleanableAssetType(row);
    });
  }

  async updateAssetType(
    id: string,
    input: Partial<CleanableAssetTypeWriteRequest>,
    actor: AuditActor,
  ): Promise<CleanableAssetTypeDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findAssetType(connection, id);
      if (before === null) throw new NotFoundError('Cleanable asset type', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningMasterRepository.codeExists(connection, 'assetTypes', input.code, id)) {
          throw new ConflictError(`Asset type code "${input.code}" is already in use`);
        }
      }
      const { assignments, params } = assignmentsFor(input, {
        code: 'code',
        name: 'name',
        description: 'description',
        defaultRiskLevel: 'default_risk_level',
        defaultFoodContact: 'default_food_contact',
        sortOrder: 'sort_order',
        status: 'status',
      });
      await CleaningMasterRepository.update(connection, 'assetTypes', id, assignments, params);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_UPDATED,
        entityType: 'cleanable_asset_type',
        entityId: id,
        before: { code: before.code, name: before.name, status: before.status },
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findAssetType(connection, id);
      if (row === null) throw new NotFoundError('Cleanable asset type', id);
      return mapCleanableAssetType(row);
    });
  }

  async deleteAssetType(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findAssetType(connection, id);
      if (before === null) throw new NotFoundError('Cleanable asset type', id);
      if (Number(before.asset_count ?? 0) > 0) {
        throw new ConflictError('That type is still used by cleanable assets');
      }
      await CleaningMasterRepository.softDelete(connection, 'assetTypes', id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_DELETED,
        entityType: 'cleanable_asset_type',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /* -------------------------------------------------------------------- methods */

  async listMethods(query: MasterListQuery): Promise<CleaningMethodDto[]> {
    const rows = await CleaningMasterRepository.listMethods(getPool(), filterFrom(query));
    return rows.map(mapCleaningMethod);
  }

  async createMethod(
    input: CleaningMethodWriteRequest,
    actor: AuditActor,
  ): Promise<CleaningMethodDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningMasterRepository.codeExists(connection, 'methods', input.code)) {
        throw new ConflictError(`Method code "${input.code}" is already in use`);
      }
      await CleaningMasterRepository.insertMethod(connection, {
        id,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_CREATED,
        entityType: 'cleaning_method',
        entityId: id,
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findMethod(connection, id);
      if (row === null) throw new NotFoundError('Cleaning method', id);
      return mapCleaningMethod(row);
    });
  }

  async updateMethod(
    id: string,
    input: Partial<CleaningMethodWriteRequest>,
    actor: AuditActor,
  ): Promise<CleaningMethodDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findMethod(connection, id);
      if (before === null) throw new NotFoundError('Cleaning method', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningMasterRepository.codeExists(connection, 'methods', input.code, id)) {
          throw new ConflictError(`Method code "${input.code}" is already in use`);
        }
      }
      const { assignments, params } = assignmentsFor(input, {
        code: 'code',
        name: 'name',
        description: 'description',
        sortOrder: 'sort_order',
        status: 'status',
      });
      await CleaningMasterRepository.update(connection, 'methods', id, assignments, params);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_UPDATED,
        entityType: 'cleaning_method',
        entityId: id,
        before: { code: before.code, name: before.name },
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findMethod(connection, id);
      if (row === null) throw new NotFoundError('Cleaning method', id);
      return mapCleaningMethod(row);
    });
  }

  async deleteMethod(id: string, actor: AuditActor): Promise<void> {
    await this.softDeleteMaster('methods', 'cleaning_method', id, actor, (db, entityId) =>
      CleaningMasterRepository.findMethod(db, entityId),
    );
  }

  /* ------------------------------------------------------------------ standards */

  async listStandards(query: MasterListQuery): Promise<CleaningStandardDto[]> {
    const rows = await CleaningMasterRepository.listStandards(getPool(), filterFrom(query));
    return rows.map(mapCleaningStandard);
  }

  async createStandard(
    input: CleaningStandardWriteRequest,
    actor: AuditActor,
  ): Promise<CleaningStandardDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningMasterRepository.codeExists(connection, 'standards', input.code)) {
        throw new ConflictError(`Standard code "${input.code}" is already in use`);
      }
      this.assertRange(input.minValue ?? null, input.maxValue ?? null);
      await CleaningMasterRepository.insertStandard(connection, {
        id,
        code: input.code,
        name: input.name,
        acceptanceText: input.acceptanceText,
        measureUnit: input.measureUnit ?? null,
        minValue: input.minValue ?? null,
        maxValue: input.maxValue ?? null,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_CREATED,
        entityType: 'cleaning_standard',
        entityId: id,
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findStandard(connection, id);
      if (row === null) throw new NotFoundError('Cleaning standard', id);
      return mapCleaningStandard(row);
    });
  }

  async updateStandard(
    id: string,
    input: Partial<CleaningStandardWriteRequest>,
    actor: AuditActor,
  ): Promise<CleaningStandardDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findStandard(connection, id);
      if (before === null) throw new NotFoundError('Cleaning standard', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningMasterRepository.codeExists(connection, 'standards', input.code, id)) {
          throw new ConflictError(`Standard code "${input.code}" is already in use`);
        }
      }
      this.assertRange(
        input.minValue !== undefined ? input.minValue : numberOrNull(before.min_value),
        input.maxValue !== undefined ? input.maxValue : numberOrNull(before.max_value),
      );
      const { assignments, params } = assignmentsFor(input, {
        code: 'code',
        name: 'name',
        acceptanceText: 'acceptance_text',
        measureUnit: 'measure_unit',
        minValue: 'min_value',
        maxValue: 'max_value',
        status: 'status',
      });
      await CleaningMasterRepository.update(connection, 'standards', id, assignments, params);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_UPDATED,
        entityType: 'cleaning_standard',
        entityId: id,
        before: { code: before.code, name: before.name },
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findStandard(connection, id);
      if (row === null) throw new NotFoundError('Cleaning standard', id);
      return mapCleaningStandard(row);
    });
  }

  async deleteStandard(id: string, actor: AuditActor): Promise<void> {
    await this.softDeleteMaster('standards', 'cleaning_standard', id, actor, (db, entityId) =>
      CleaningMasterRepository.findStandard(db, entityId),
    );
  }

  /** A standard whose window is inside out would pass nothing, silently. */
  private assertRange(min: number | null, max: number | null): void {
    if (min !== null && max !== null && min > max) {
      throw new ConflictError('The minimum value cannot be greater than the maximum');
    }
  }

  /* ------------------------------------------------------------------ chemicals */

  async listChemicals(query: MasterListQuery, userId: string): Promise<CleaningChemicalDto[]> {
    const rows = await CleaningMasterRepository.listChemicals(getPool(), filterFrom(query));
    return rows.map((row) => mapCleaningChemical(row, userId));
  }

  async createChemical(
    input: CleaningChemicalWriteRequest,
    actor: AuditActor,
  ): Promise<CleaningChemicalDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningMasterRepository.codeExists(connection, 'chemicals', input.code)) {
        throw new ConflictError(`Chemical code "${input.code}" is already in use`);
      }
      await CleaningMasterRepository.insertChemical(connection, {
        id,
        code: input.code,
        name: input.name,
        chemicalKind: input.chemicalKind ?? CleaningChemicalKind.OTHER,
        supplierName: input.supplierName ?? null,
        supplierEntityId: input.supplierEntityId ?? null,
        purpose: input.purpose ?? null,
        dilutionRatio: input.dilutionRatio ?? null,
        concentrationPpm: input.concentrationPpm ?? null,
        contactTimeSeconds: input.contactTimeSeconds ?? null,
        applicationMethod: input.applicationMethod ?? null,
        storageRequirement: input.storageRequirement ?? null,
        safetyInformation: input.safetyInformation ?? null,
        expiryDate: input.expiryDate ?? null,
        safetySheetMediaId: input.safetySheetMediaId ?? null,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_CREATED,
        entityType: 'cleaning_chemical',
        entityId: id,
        after: { code: input.code, name: input.name, kind: input.chemicalKind },
      });
      const row = await CleaningMasterRepository.findChemical(connection, id);
      if (row === null) throw new NotFoundError('Cleaning chemical', id);
      return mapCleaningChemical(row, actor.userId ?? '');
    });
  }

  async updateChemical(
    id: string,
    input: Partial<CleaningChemicalWriteRequest>,
    actor: AuditActor,
  ): Promise<CleaningChemicalDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findChemical(connection, id);
      if (before === null) throw new NotFoundError('Cleaning chemical', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningMasterRepository.codeExists(connection, 'chemicals', input.code, id)) {
          throw new ConflictError(`Chemical code "${input.code}" is already in use`);
        }
      }
      const { assignments, params } = assignmentsFor(input, {
        code: 'code',
        name: 'name',
        chemicalKind: 'chemical_kind',
        supplierName: 'supplier_name',
        supplierEntityId: 'supplier_entity_id',
        purpose: 'purpose',
        dilutionRatio: 'dilution_ratio',
        concentrationPpm: 'concentration_ppm',
        contactTimeSeconds: 'contact_time_seconds',
        applicationMethod: 'application_method',
        storageRequirement: 'storage_requirement',
        safetyInformation: 'safety_information',
        expiryDate: 'expiry_date',
        safetySheetMediaId: 'safety_sheet_media_id',
        status: 'status',
      });
      await CleaningMasterRepository.update(connection, 'chemicals', id, assignments, params);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_UPDATED,
        entityType: 'cleaning_chemical',
        entityId: id,
        before: { code: before.code, name: before.name },
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findChemical(connection, id);
      if (row === null) throw new NotFoundError('Cleaning chemical', id);
      return mapCleaningChemical(row, actor.userId ?? '');
    });
  }

  async deleteChemical(id: string, actor: AuditActor): Promise<void> {
    await this.softDeleteMaster('chemicals', 'cleaning_chemical', id, actor, (db, entityId) =>
      CleaningMasterRepository.findChemical(db, entityId),
    );
  }

  /* ---------------------------------------------------------------------- tools */

  async listTools(query: MasterListQuery): Promise<CleaningToolDto[]> {
    const rows = await CleaningMasterRepository.listTools(getPool(), filterFrom(query));
    return rows.map(mapCleaningTool);
  }

  async createTool(input: CleaningToolWriteRequest, actor: AuditActor): Promise<CleaningToolDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningMasterRepository.codeExists(connection, 'tools', input.code)) {
        throw new ConflictError(`Tool code "${input.code}" is already in use`);
      }
      await CleaningMasterRepository.insertTool(connection, {
        id,
        code: input.code,
        name: input.name,
        toolKind: input.toolKind ?? CleaningToolKind.OTHER,
        colourCode: input.colourCode ?? null,
        description: input.description ?? null,
        storageLocation: input.storageLocation ?? null,
        restrictedAreaId: input.restrictedAreaId ?? null,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_CREATED,
        entityType: 'cleaning_tool',
        entityId: id,
        after: { code: input.code, name: input.name },
      });
      const row = await CleaningMasterRepository.findTool(connection, id);
      if (row === null) throw new NotFoundError('Cleaning tool', id);
      return mapCleaningTool(row);
    });
  }

  async updateTool(
    id: string,
    input: Partial<CleaningToolWriteRequest>,
    actor: AuditActor,
  ): Promise<CleaningToolDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findTool(connection, id);
      if (before === null) throw new NotFoundError('Cleaning tool', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningMasterRepository.codeExists(connection, 'tools', input.code, id)) {
          throw new ConflictError(`Tool code "${input.code}" is already in use`);
        }
      }
      const { assignments, params } = assignmentsFor(input, {
        code: 'code',
        name: 'name',
        toolKind: 'tool_kind',
        colourCode: 'colour_code',
        description: 'description',
        storageLocation: 'storage_location',
        restrictedAreaId: 'restricted_area_id',
        status: 'status',
      });
      await CleaningMasterRepository.update(connection, 'tools', id, assignments, params);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_UPDATED,
        entityType: 'cleaning_tool',
        entityId: id,
        before: { code: before.code, name: before.name },
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findTool(connection, id);
      if (row === null) throw new NotFoundError('Cleaning tool', id);
      return mapCleaningTool(row);
    });
  }

  async deleteTool(id: string, actor: AuditActor): Promise<void> {
    await this.softDeleteMaster('tools', 'cleaning_tool', id, actor, (db, entityId) =>
      CleaningMasterRepository.findTool(db, entityId),
    );
  }

  /* --------------------------------------------------------------------- skills */

  async listSkills(query: MasterListQuery): Promise<SkillDto[]> {
    const rows = await CleaningMasterRepository.listSkills(getPool(), filterFrom(query));
    return rows.map(mapSkill);
  }

  async createSkill(input: SkillWriteRequest, actor: AuditActor): Promise<SkillDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningMasterRepository.codeExists(connection, 'skills', input.code)) {
        throw new ConflictError(`Skill code "${input.code}" is already in use`);
      }
      await CleaningMasterRepository.insertSkill(connection, {
        id,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_CREATED,
        entityType: 'skill',
        entityId: id,
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findSkill(connection, id);
      if (row === null) throw new NotFoundError('Skill', id);
      return mapSkill(row);
    });
  }

  async updateSkill(
    id: string,
    input: Partial<SkillWriteRequest>,
    actor: AuditActor,
  ): Promise<SkillDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findSkill(connection, id);
      if (before === null) throw new NotFoundError('Skill', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningMasterRepository.codeExists(connection, 'skills', input.code, id)) {
          throw new ConflictError(`Skill code "${input.code}" is already in use`);
        }
      }
      const { assignments, params } = assignmentsFor(input, {
        code: 'code',
        name: 'name',
        description: 'description',
        sortOrder: 'sort_order',
        status: 'status',
      });
      await CleaningMasterRepository.update(connection, 'skills', id, assignments, params);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_UPDATED,
        entityType: 'skill',
        entityId: id,
        before: { code: before.code, name: before.name },
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findSkill(connection, id);
      if (row === null) throw new NotFoundError('Skill', id);
      return mapSkill(row);
    });
  }

  async deleteSkill(id: string, actor: AuditActor): Promise<void> {
    await this.softDeleteMaster('skills', 'skill', id, actor, (db, entityId) =>
      CleaningMasterRepository.findSkill(db, entityId),
    );
  }

  /* --------------------------------------------------------------------- shifts */

  async listShifts(query: MasterListQuery): Promise<ShiftDto[]> {
    const rows = await CleaningMasterRepository.listShifts(getPool(), filterFrom(query));
    return rows.map(mapShift);
  }

  async createShift(input: ShiftWriteRequest, actor: AuditActor): Promise<ShiftDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningMasterRepository.codeExists(connection, 'shifts', input.code)) {
        throw new ConflictError(`Shift code "${input.code}" is already in use`);
      }
      await CleaningMasterRepository.insertShift(connection, {
        id,
        code: input.code,
        name: input.name,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await CleaningMasterRepository.replaceShiftDays(connection, id, input.days ?? []);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_CREATED,
        entityType: 'shift',
        entityId: id,
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findShift(connection, id);
      if (row === null) throw new NotFoundError('Shift', id);
      return mapShift(row);
    });
  }

  async updateShift(
    id: string,
    input: Partial<ShiftWriteRequest>,
    actor: AuditActor,
  ): Promise<ShiftDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningMasterRepository.findShift(connection, id);
      if (before === null) throw new NotFoundError('Shift', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningMasterRepository.codeExists(connection, 'shifts', input.code, id)) {
          throw new ConflictError(`Shift code "${input.code}" is already in use`);
        }
      }

      const assignments: string[] = [];
      const params: unknown[] = [];
      if (input.code !== undefined) {
        assignments.push('code = ?');
        params.push(input.code);
      }
      if (input.name !== undefined) {
        assignments.push('name = ?');
        params.push(input.name);
      }
      if (input.sortOrder !== undefined) {
        assignments.push('sort_order = ?');
        params.push(input.sortOrder);
      }
      if (input.status !== undefined) {
        assignments.push('status = ?');
        params.push(input.status);
      }
      // Whether a shift crosses midnight is derived from its own hours, never supplied — an
      // inconsistent pair here would make the "who is on shift" query silently wrong.
      if (input.startsAt !== undefined || input.endsAt !== undefined) {
        const startsAt = toDbTime(input.startsAt ?? before.starts_at);
        const endsAt = toDbTime(input.endsAt ?? before.ends_at);
        assignments.push('starts_at = ?', 'ends_at = ?', 'crosses_midnight = ?');
        params.push(startsAt, endsAt, endsAt <= startsAt ? 1 : 0);
      }
      await CleaningMasterRepository.update(connection, 'shifts', id, assignments, params);
      if (input.days !== undefined) {
        await CleaningMasterRepository.replaceShiftDays(connection, id, input.days);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_UPDATED,
        entityType: 'shift',
        entityId: id,
        before: { code: before.code, startsAt: before.starts_at, endsAt: before.ends_at },
        after: { ...input },
      });
      const row = await CleaningMasterRepository.findShift(connection, id);
      if (row === null) throw new NotFoundError('Shift', id);
      return mapShift(row);
    });
  }

  async deleteShift(id: string, actor: AuditActor): Promise<void> {
    await this.softDeleteMaster('shifts', 'shift', id, actor, (db, entityId) =>
      CleaningMasterRepository.findShift(db, entityId),
    );
  }

  /* ------------------------------------------------------------ shared deletion */

  private async softDeleteMaster(
    table: 'methods' | 'standards' | 'chemicals' | 'tools' | 'skills' | 'shifts',
    entityType: string,
    id: string,
    actor: AuditActor,
    find: (db: Db, id: string) => Promise<{ code: string; name: string } | null>,
  ): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await find(connection, id);
      if (before === null) throw new NotFoundError(entityType, id);
      await CleaningMasterRepository.softDelete(connection, table, id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_MASTER_DELETED,
        entityType,
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /* ---------------------------------------------------------------------- setup */

  /**
   * Everything a cleaning form needs, in one request.
   *
   * Both clients open a rule or procedure editor needing the same eight lookups; on a phone
   * over canteen wifi, eight round trips is the difference between a form that opens and one
   * that spins.
   */
  async setup(userId: string): Promise<CleaningSetupDto> {
    const pool = getPool();
    const filter: MasterFilter = {};
    const [assetTypes, methods, standards, chemicals, tools, skills, shifts, procedures, areas] =
      await Promise.all([
        CleaningMasterRepository.listAssetTypes(pool, filter),
        CleaningMasterRepository.listMethods(pool, filter),
        CleaningMasterRepository.listStandards(pool, filter),
        CleaningMasterRepository.listChemicals(pool, filter),
        CleaningMasterRepository.listTools(pool, filter),
        CleaningMasterRepository.listSkills(pool, filter),
        CleaningMasterRepository.listShifts(pool, filter),
        CleaningProcedureRepository.list(pool, { limit: 500, offset: 0 }),
        listAreas(pool),
      ]);

    return {
      areas,
      assetTypes: assetTypes.map(mapCleanableAssetType),
      methods: methods.map(mapCleaningMethod),
      standards: standards.map(mapCleaningStandard),
      chemicals: chemicals.map((row) => mapCleaningChemical(row, userId)),
      tools: tools.map(mapCleaningTool),
      skills: skills.map(mapSkill),
      shifts: shifts.map(mapShift),
      procedures: procedures.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        currentVersionId: row.current_version_id,
      })),
    };
  }
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Areas live in the equipment location tree; cleaning reads them and never writes them. */
async function listAreas(
  db: Db,
): Promise<Array<{ id: string; name: string; floorId: string | null; floorName: string | null }>> {
  const rows = await selectRows<EquipmentAreaRow>(
    db,
    `SELECT a.*, f.name AS floor_name
       FROM equipment_areas a
       LEFT JOIN equipment_floors f ON f.id = a.floor_id
      WHERE a.deleted_at IS NULL AND a.status = 'ACTIVE'
      ORDER BY f.level_index, a.sort_order, a.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    floorId: row.floor_id,
    floorName: row.floor_name ?? null,
  }));
}

export const cleaningMasterService = new CleaningMasterService();
