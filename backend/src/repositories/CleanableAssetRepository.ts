import type { CleaningRiskLevel, FoodContactClass, MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { CleanableAssetRow, CountRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * The register of things that get cleaned.
 *
 * The SELECT joins the whole location chain and the asset's live counters on every read,
 * because every surface in the module shows both — a task list without "Main Kitchen · Hot
 * Line" is a list of nouns nobody can act on.
 *
 * The counters are subqueries rather than stored columns: unlike the maintenance module's,
 * these change on a schedule sweep that touches thousands of rows at once, and a stored
 * counter would need refreshing in the same breath. Counting is cheap against
 * `ix_cleaning_tasks_asset`.
 */

/** Whether any active rule reaches this asset. Its three scopes, in one condition. */
const RULE_COUNT_SUBQUERY = `(SELECT COUNT(*) FROM cleaning_rules r
    WHERE r.deleted_at IS NULL AND r.is_active = 1
      AND (r.cleanable_asset_id = a.id
        OR (r.scope = 'ASSET_TYPE_GLOBAL' AND r.asset_type_id = a.asset_type_id)
        OR (r.scope = 'ASSET_TYPE_IN_AREA' AND r.asset_type_id = a.asset_type_id
            AND r.area_id = a.area_id)))`;

const ASSET_SELECT = `SELECT a.*,
         ${RULE_COUNT_SUBQUERY} AS rule_count,
         t.name AS asset_type_name,
         ar.name AS area_name,
         f.id AS floor_id, f.name AS floor_name,
         l.name AS location_name, l.room AS room, l.section AS section, l.position AS position,
         e.asset_id AS equipment_asset_id, e.name AS equipment_name,
         (SELECT COUNT(*) FROM cleaning_tasks ct
           WHERE ct.cleanable_asset_id = a.id
             AND ct.status NOT IN ('CLOSED','CANCELLED')) AS open_task_count,
         (SELECT COUNT(*) FROM cleaning_tasks ct
           WHERE ct.cleanable_asset_id = a.id
             AND ct.status NOT IN ('CLOSED','CANCELLED')
             AND ct.due_at IS NOT NULL AND ct.due_at < UTC_TIMESTAMP(3)) AS overdue_task_count,
         (SELECT MAX(ct.completed_at) FROM cleaning_tasks ct
           WHERE ct.cleanable_asset_id = a.id AND ct.completed_at IS NOT NULL) AS last_cleaned_at,
         (SELECT cu.name FROM cleaning_tasks ct
            LEFT JOIN users cu ON cu.id = ct.completed_by
           WHERE ct.cleanable_asset_id = a.id AND ct.completed_at IS NOT NULL
           ORDER BY ct.completed_at DESC LIMIT 1) AS last_cleaned_by_name
    FROM cleanable_assets a
    LEFT JOIN cleanable_asset_types t ON t.id = a.asset_type_id
    LEFT JOIN equipment_areas ar ON ar.id = a.area_id
    LEFT JOIN equipment_floors f ON f.id = ar.floor_id
    LEFT JOIN equipment_locations l ON l.id = a.location_id
    LEFT JOIN equipment e ON e.id = a.equipment_id`;

export interface CleanableAssetFilter {
  search?: string;
  areaId?: string;
  floorId?: string;
  assetTypeId?: string;
  riskLevel?: CleaningRiskLevel;
  foodContact?: FoodContactClass;
  status?: MasterStatus;
  equipmentId?: string;
  availableOnly?: boolean;
  withoutRules?: boolean;
  limit: number;
  offset: number;
}

export interface CleanableAssetInsert {
  id: string;
  code: string;
  name: string;
  assetTypeId: string;
  areaId: string;
  locationId: string | null;
  equipmentId: string | null;
  description: string | null;
  positionNote: string | null;
  riskLevel: CleaningRiskLevel;
  foodContact: FoodContactClass;
  imageMediaId: string | null;
  notes: string | null;
  createdBy: string | null;
}

function listWhere(filter: CleanableAssetFilter): { where: string; params: unknown[] } {
  const conditions = ['a.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    conditions.push('a.status = ?');
    params.push(filter.status);
  } else {
    conditions.push("a.status = 'ACTIVE'");
  }
  if (filter.areaId !== undefined) {
    conditions.push('a.area_id = ?');
    params.push(filter.areaId);
  }
  if (filter.floorId !== undefined) {
    conditions.push('ar.floor_id = ?');
    params.push(filter.floorId);
  }
  if (filter.assetTypeId !== undefined) {
    conditions.push('a.asset_type_id = ?');
    params.push(filter.assetTypeId);
  }
  if (filter.riskLevel !== undefined) {
    conditions.push('a.risk_level = ?');
    params.push(filter.riskLevel);
  }
  if (filter.foodContact !== undefined) {
    conditions.push('a.food_contact = ?');
    params.push(filter.foodContact);
  }
  if (filter.equipmentId !== undefined) {
    conditions.push('a.equipment_id = ?');
    params.push(filter.equipmentId);
  }
  if (filter.availableOnly === true) conditions.push('a.is_available = 1');
  if (filter.withoutRules === true) conditions.push(`${RULE_COUNT_SUBQUERY} = 0`);
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(a.name LIKE ? OR a.code LIKE ? OR a.description LIKE ? OR a.position_note LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const CleanableAssetRepository = {
  async list(db: Db, filter: CleanableAssetFilter): Promise<CleanableAssetRow[]> {
    const { where, params } = listWhere(filter);
    return selectRows<CleanableAssetRow>(
      db,
      `${ASSET_SELECT}
        ${where}
        ORDER BY a.risk_level = 'CRITICAL' DESC, a.risk_level = 'HIGH' DESC, ar.name, a.name
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: CleanableAssetFilter): Promise<number> {
    const { where, params } = listWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total
         FROM cleanable_assets a
         LEFT JOIN equipment_areas ar ON ar.id = a.area_id
        ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findById(db: Db, id: string): Promise<CleanableAssetRow | null> {
    return selectOne<CleanableAssetRow>(
      db,
      `${ASSET_SELECT}
        WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
  },

  async findByCode(db: Db, code: string): Promise<CleanableAssetRow | null> {
    return selectOne<CleanableAssetRow>(
      db,
      `${ASSET_SELECT} WHERE a.code = ? AND a.deleted_at IS NULL`,
      [code],
    );
  },

  async findByEquipmentId(db: Db, equipmentId: string): Promise<CleanableAssetRow | null> {
    return selectOne<CleanableAssetRow>(
      db,
      `${ASSET_SELECT} WHERE a.equipment_id = ? AND a.deleted_at IS NULL`,
      [equipmentId],
    );
  },

  /**
   * The area's general cleanable asset — the one a report that names only a place resolves to.
   *
   * Matched by type code rather than a flag column: `AREA` is a seeded type whose entire
   * purpose is "the place itself, as opposed to something in it".
   */
  async findAreaGeneralAsset(db: Db, areaId: string): Promise<CleanableAssetRow | null> {
    return selectOne<CleanableAssetRow>(
      db,
      `${ASSET_SELECT}
        WHERE a.area_id = ? AND a.deleted_at IS NULL AND a.status = 'ACTIVE' AND t.code = 'AREA'
        ORDER BY a.created_at
        LIMIT 1`,
      [areaId],
    );
  },

  /** Resolves a rule's scope to the assets it currently reaches. */
  async listForRuleScope(
    db: Db,
    scope: { cleanableAssetId?: string | null; assetTypeId?: string | null; areaId?: string | null },
  ): Promise<CleanableAssetRow[]> {
    if (scope.cleanableAssetId !== undefined && scope.cleanableAssetId !== null) {
      const row = await this.findById(db, scope.cleanableAssetId);
      return row === null || row.is_available !== 1 || row.status !== 'ACTIVE' ? [] : [row];
    }
    const conditions = [
      'a.deleted_at IS NULL',
      "a.status = 'ACTIVE'",
      'a.is_available = 1',
      'a.asset_type_id = ?',
    ];
    const params: unknown[] = [scope.assetTypeId];
    if (scope.areaId !== undefined && scope.areaId !== null) {
      conditions.push('a.area_id = ?');
      params.push(scope.areaId);
    }
    return selectRows<CleanableAssetRow>(
      db,
      `${ASSET_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY ar.name, a.name`,
      params,
    );
  },

  async nextCodeSequence(db: Db, prefix: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(code, '-', -1) AS UNSIGNED)), 0) AS total
         FROM cleanable_assets
        WHERE code LIKE ?
        FOR UPDATE`,
      [`${prefix}-%`],
    );
    return Number(row?.total ?? 0) + 1;
  },

  async insert(db: Db, input: CleanableAssetInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleanable_assets
         (id, code, name, asset_type_id, area_id, location_id, equipment_id, description,
          position_note, risk_level, food_contact, is_available, image_media_id, notes,
          status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.assetTypeId,
        input.areaId,
        input.locationId,
        input.equipmentId,
        input.description,
        input.positionNote,
        input.riskLevel,
        input.foodContact,
        input.imageMediaId,
        input.notes,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async update(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE cleanable_assets SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE cleanable_assets SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  async countWithoutRules(db: Db): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleanable_assets a
        WHERE a.deleted_at IS NULL AND a.status = 'ACTIVE' AND ${RULE_COUNT_SUBQUERY} = 0`,
    );
    return Number(row?.total ?? 0);
  },

  /**
   * Critical / direct-food-contact assets with an outstanding overdue clean. The single number
   * on the dashboard that should stop somebody's morning.
   */
  async countCriticalUncleaned(db: Db): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(DISTINCT a.id) AS total
         FROM cleanable_assets a
         JOIN cleaning_tasks ct ON ct.cleanable_asset_id = a.id
        WHERE a.deleted_at IS NULL AND a.status = 'ACTIVE'
          AND (a.risk_level = 'CRITICAL' OR a.food_contact = 'DIRECT')
          AND ct.status NOT IN ('CLOSED','CANCELLED')
          AND ct.due_at IS NOT NULL AND ct.due_at < UTC_TIMESTAMP(3)`,
    );
    return Number(row?.total ?? 0);
  },
};
