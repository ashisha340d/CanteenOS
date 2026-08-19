import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { EquipmentRow, FloorPlanPositionRow, FloorPlanRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for floor plans and the pins placed on them.
 *
 * Coordinates are stored as fractions of the image (0..1), so a plan re-uploaded at a
 * different resolution keeps every pin where it was. Nothing here converts to pixels; that is
 * the renderer's job and it differs per client.
 */

const PLAN_SELECT = `SELECT fp.*, f.name AS floor_name,
         (SELECT COUNT(*) FROM floor_plan_equipment_positions p
           WHERE p.floor_plan_id = fp.id) AS position_count
    FROM floor_plans fp
    JOIN equipment_floors f ON f.id = fp.floor_id`;

const POSITION_SELECT = `SELECT p.*,
         e.asset_id, e.name AS equipment_name, e.status, e.image_media_id,
         e.open_ticket_count, e.next_maintenance_at,
         c.name AS category_name
    FROM floor_plan_equipment_positions p
    JOIN equipment e ON e.id = p.equipment_id
    LEFT JOIN equipment_categories c ON c.id = e.category_id`;

export const FloorPlanRepository = {
  async listPlans(db: Db, floorId?: string): Promise<FloorPlanRow[]> {
    const conditions = ['fp.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (floorId !== undefined) {
      conditions.push('fp.floor_id = ?');
      params.push(floorId);
    }
    return selectRows<FloorPlanRow>(
      db,
      `${PLAN_SELECT}
        WHERE ${conditions.join(' AND ')}
        ORDER BY f.level_index, fp.is_active DESC, fp.created_at DESC`,
      params,
    );
  },

  async findPlanById(db: Db, id: string): Promise<FloorPlanRow | null> {
    return selectOne<FloorPlanRow>(
      db,
      `${PLAN_SELECT} WHERE fp.id = ? AND fp.deleted_at IS NULL`,
      [id],
    );
  },

  /** The plan a floor is currently drawn from. Older uploads stay as history. */
  async findActivePlanForFloor(db: Db, floorId: string): Promise<FloorPlanRow | null> {
    return selectOne<FloorPlanRow>(
      db,
      `${PLAN_SELECT}
        WHERE fp.floor_id = ? AND fp.is_active = 1 AND fp.deleted_at IS NULL
        ORDER BY fp.created_at DESC
        LIMIT 1`,
      [floorId],
    );
  },

  async insertPlan(
    db: Db,
    input: {
      id: string;
      floorId: string;
      name: string;
      mediaId: string;
      width: number | null;
      height: number | null;
      uploadedBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO floor_plans
         (id, floor_id, name, media_id, width, height, is_active, uploaded_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,1,?,?,?)`,
      [
        input.id,
        input.floorId,
        input.name,
        input.mediaId,
        input.width,
        input.height,
        input.uploadedBy,
        now,
        now,
      ],
    );
  },

  /** One active plan per floor; called inside the transaction that activates the new one. */
  async deactivateOtherPlans(db: Db, floorId: string, keepId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE floor_plans SET is_active = 0, updated_at = ?
        WHERE floor_id = ? AND id <> ? AND deleted_at IS NULL`,
      [toDbDateTime(), floorId, keepId],
    );
  },

  async updatePlan(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE floor_plans SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDeletePlan(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE floor_plans SET deleted_at = ?, is_active = 0, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /* -------------------------------------------------------------------- positions */

  async listPositions(db: Db, floorPlanId: string): Promise<FloorPlanPositionRow[]> {
    return selectRows<FloorPlanPositionRow>(
      db,
      `${POSITION_SELECT}
        WHERE p.floor_plan_id = ? AND e.deleted_at IS NULL
        ORDER BY e.name`,
      [floorPlanId],
    );
  },

  /** The single pin for an asset, wherever it was placed. Used by the equipment profile. */
  async findPositionForEquipment(db: Db, equipmentId: string): Promise<FloorPlanPositionRow | null> {
    return selectOne<FloorPlanPositionRow>(
      db,
      `${POSITION_SELECT}
        WHERE p.equipment_id = ?
        ORDER BY p.updated_at DESC
        LIMIT 1`,
      [equipmentId],
    );
  },

  async upsertPosition(
    db: Db,
    input: {
      id: string;
      floorPlanId: string;
      equipmentId: string;
      x: number;
      y: number;
      placedBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO floor_plan_equipment_positions
         (id, floor_plan_id, equipment_id, x, y, placed_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE x = VALUES(x), y = VALUES(y),
                               placed_by = VALUES(placed_by),
                               updated_at = VALUES(updated_at)`,
      [input.id, input.floorPlanId, input.equipmentId, input.x, input.y, input.placedBy, now, now],
    );
  },

  /** An asset lives on one plan at a time; moving it clears the pin it left behind. */
  async removePositionsElsewhere(db: Db, equipmentId: string, keepPlanId: string): Promise<void> {
    await mutate(
      db,
      `DELETE FROM floor_plan_equipment_positions
        WHERE equipment_id = ? AND floor_plan_id <> ?`,
      [equipmentId, keepPlanId],
    );
  },

  async removePosition(db: Db, floorPlanId: string, equipmentId: string): Promise<boolean> {
    const result = await mutate(
      db,
      `DELETE FROM floor_plan_equipment_positions
        WHERE floor_plan_id = ? AND equipment_id = ?`,
      [floorPlanId, equipmentId],
    );
    return result.affectedRows > 0;
  },

  /** Assets standing on this floor that nobody has pinned yet — the plan editor's backlog. */
  async listUnplacedEquipment(db: Db, floorId: string, floorPlanId: string): Promise<EquipmentRow[]> {
    return selectRows<EquipmentRow>(
      db,
      `SELECT e.*
         FROM equipment e
         JOIN equipment_locations l ON l.id = e.location_id
         JOIN equipment_areas a ON a.id = l.area_id
        WHERE a.floor_id = ? AND e.deleted_at IS NULL AND e.status <> 'RETIRED'
          AND NOT EXISTS (
                SELECT 1 FROM floor_plan_equipment_positions p
                 WHERE p.equipment_id = e.id AND p.floor_plan_id = ?)
        ORDER BY e.name`,
      [floorId, floorPlanId],
    );
  },
};
