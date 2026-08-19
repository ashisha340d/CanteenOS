import {
  FLOOR_PLAN_COORDINATE_MAX,
  MaintenanceActivityType,
  type FloorPlanDto,
  type FloorPlanPositionDto,
  type FloorPlanPositionWriteRequest,
  type FloorPlanViewDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapEquipment, mapFloorPlan, mapFloorPlanPosition } from '../models/mappers';
import { EquipmentLocationRepository, EquipmentRepository } from '../repositories/EquipmentRepository';
import { FloorPlanRepository } from '../repositories/FloorPlanRepository';
import { mediaAssetRepository } from '../repositories/MediaRepository';
import { NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { maintenanceActivityService } from './MaintenanceActivityService';

/**
 * Floor plans and the pins on them.
 *
 * Coordinates are fractions of the image (0..1), never pixels, so the same pin renders
 * correctly on a phone, on a 4K monitor, and after somebody re-uploads the plan at a different
 * size. An asset appears on one plan at a time: pinning it somewhere new removes the pin it
 * left behind, because two pins for one oven is a floor plan that lies.
 */
export class FloorPlanService {
  async list(floorId: string | undefined, userId: string): Promise<FloorPlanDto[]> {
    const rows = await FloorPlanRepository.listPlans(getPool(), floorId);
    return rows.map((row) => mapFloorPlan(row, userId));
  }

  /** The plan, its pins and the assets on that floor nobody has placed yet. */
  async view(floorId: string, userId: string): Promise<FloorPlanViewDto | null> {
    const pool = getPool();
    const floor = await EquipmentLocationRepository.findFloorById(pool, floorId);
    if (floor === null) throw new NotFoundError('Floor', floorId);

    const plan = await FloorPlanRepository.findActivePlanForFloor(pool, floorId);
    if (plan === null) return null;

    const [positions, unplaced] = await Promise.all([
      FloorPlanRepository.listPositions(pool, plan.id),
      FloorPlanRepository.listUnplacedEquipment(pool, floorId, plan.id),
    ]);

    return {
      plan: mapFloorPlan(plan, userId),
      positions: positions.map((position) => mapFloorPlanPosition(position, userId)),
      unplaced: unplaced.map((row) => {
        const dto = mapEquipment(row, userId);
        return {
          id: dto.id,
          assetId: dto.assetId,
          name: dto.name,
          status: dto.status,
          imageUrl: dto.imageUrl,
        };
      }),
    };
  }

  /** Uploading a new plan supersedes the previous one; the old rows stay as history. */
  async upload(
    input: {
      floorId: string;
      name: string;
      mediaId: string;
      width?: number | null;
      height?: number | null;
    },
    actor: AuditActor,
  ): Promise<FloorPlanDto> {
    const id = newId();

    await withTransaction(async (connection) => {
      const floor = await EquipmentLocationRepository.findFloorById(connection, input.floorId);
      if (floor === null) throw new NotFoundError('Floor', input.floorId);

      const media = await mediaAssetRepository.findById(connection, input.mediaId);
      if (media === null) throw new NotFoundError('Media asset', input.mediaId);

      await FloorPlanRepository.insertPlan(connection, {
        id,
        floorId: input.floorId,
        name: input.name,
        mediaId: input.mediaId,
        width: input.width ?? media.width,
        height: input.height ?? media.height,
        uploadedBy: actor.userId,
      });
      await FloorPlanRepository.deactivateOtherPlans(connection, input.floorId, id);

      await auditService.record(connection, actor, {
        action: AuditAction.FLOOR_PLAN_UPLOADED,
        entityType: 'floor_plan',
        entityId: id,
        after: { floorId: input.floorId, name: input.name, mediaId: input.mediaId },
      });
    });

    const row = await FloorPlanRepository.findPlanById(getPool(), id);
    if (row === null) throw new NotFoundError('Floor plan', id);
    return mapFloorPlan(row, actor.userId ?? '');
  }

  async update(
    id: string,
    input: { name?: string; isActive?: boolean },
    actor: AuditActor,
  ): Promise<FloorPlanDto> {
    await withTransaction(async (connection) => {
      const before = await FloorPlanRepository.findPlanById(connection, id);
      if (before === null) throw new NotFoundError('Floor plan', id);

      const assignments: string[] = [];
      const params: unknown[] = [];
      if (input.name !== undefined) {
        assignments.push('name = ?');
        params.push(input.name);
      }
      if (input.isActive !== undefined) {
        assignments.push('is_active = ?');
        params.push(input.isActive ? 1 : 0);
      }
      await FloorPlanRepository.updatePlan(connection, id, assignments, params);
      if (input.isActive === true) {
        await FloorPlanRepository.deactivateOtherPlans(connection, before.floor_id, id);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.FLOOR_PLAN_UPDATED,
        entityType: 'floor_plan',
        entityId: id,
        before: { name: before.name, isActive: before.is_active === 1 },
        after: { name: input.name ?? before.name, isActive: input.isActive ?? before.is_active === 1 },
      });
    });

    const row = await FloorPlanRepository.findPlanById(getPool(), id);
    if (row === null) throw new NotFoundError('Floor plan', id);
    return mapFloorPlan(row, actor.userId ?? '');
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await FloorPlanRepository.findPlanById(connection, id);
      if (before === null) throw new NotFoundError('Floor plan', id);

      await FloorPlanRepository.softDeletePlan(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.FLOOR_PLAN_DELETED,
        entityType: 'floor_plan',
        entityId: id,
        before: { floorId: before.floor_id, name: before.name },
      });
    });
  }

  async setPosition(
    planId: string,
    input: FloorPlanPositionWriteRequest,
    actor: AuditActor,
  ): Promise<FloorPlanPositionDto[]> {
    await withTransaction(async (connection) => {
      const plan = await FloorPlanRepository.findPlanById(connection, planId);
      if (plan === null) throw new NotFoundError('Floor plan', planId);

      const equipment = await EquipmentRepository.findById(connection, input.equipmentId);
      if (equipment === null) throw new NotFoundError('Equipment', input.equipmentId);

      assertFraction('x', input.x);
      assertFraction('y', input.y);

      await FloorPlanRepository.upsertPosition(connection, {
        id: newId(),
        floorPlanId: planId,
        equipmentId: input.equipmentId,
        x: input.x,
        y: input.y,
        placedBy: actor.userId,
      });
      await FloorPlanRepository.removePositionsElsewhere(connection, input.equipmentId, planId);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: input.equipmentId,
        type: MaintenanceActivityType.LOCATION_CHANGED,
        summary: `Placed on the ${plan.name} floor plan`,
        metadata: { floorPlanId: planId, x: input.x, y: input.y },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.FLOOR_PLAN_POSITION_SET,
        entityType: 'floor_plan',
        entityId: planId,
        after: { equipmentId: input.equipmentId, x: input.x, y: input.y },
      });
    });

    return this.listPositions(planId, actor.userId ?? '');
  }

  async removePosition(
    planId: string,
    equipmentId: string,
    actor: AuditActor,
  ): Promise<FloorPlanPositionDto[]> {
    await withTransaction(async (connection) => {
      const removed = await FloorPlanRepository.removePosition(connection, planId, equipmentId);
      if (!removed) throw new NotFoundError('Floor plan position', equipmentId);

      await auditService.record(connection, actor, {
        action: AuditAction.FLOOR_PLAN_POSITION_REMOVED,
        entityType: 'floor_plan',
        entityId: planId,
        before: { equipmentId },
      });
    });

    return this.listPositions(planId, actor.userId ?? '');
  }

  async listPositions(planId: string, userId: string): Promise<FloorPlanPositionDto[]> {
    const rows = await FloorPlanRepository.listPositions(getPool(), planId);
    return rows.map((row) => mapFloorPlanPosition(row, userId));
  }
}

function assertFraction(field: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > FLOOR_PLAN_COORDINATE_MAX) {
    throw new ValidationError('Floor plan coordinates are fractions of the image', [
      { path: field, message: `Must be between 0 and ${FLOOR_PLAN_COORDINATE_MAX}` },
    ]);
  }
}

export const floorPlanService = new FloorPlanService();
