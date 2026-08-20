import type {
  CleaningFrequencyKind,
  CleaningRuleScope,
  CleaningTaskPriority,
  CleaningTriggerEvent,
  CleaningVerificationMethod,
  SkillLevel,
  UserRole,
} from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CleaningRuleRow,
  CleaningRuleSkillRow,
  CleaningRuleTriggerRow,
  CountRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Cleaning rules: what must be cleaned, how often, to what standard, by whom.
 *
 * `published_version_id` is resolved by the SELECT rather than stored, because "can this rule
 * currently raise work?" is a question about the procedure's publication state, not about the
 * rule — and a stored answer would go stale the moment somebody archived a version.
 */

const RULE_SELECT = `SELECT r.*,
         p.name AS procedure_name, p.code AS procedure_code,
         p.current_version_id AS published_version_id,
         ca.name AS cleanable_asset_name,
         at.name AS asset_type_name,
         ar.name AS area_name,
         sh.name AS shift_name,
         st.name AS standard_name,
         (SELECT GROUP_CONCAT(t.event_type) FROM cleaning_rule_triggers t
           WHERE t.rule_id = r.id) AS trigger_events,
         (SELECT COUNT(*) FROM cleaning_tasks ct
           WHERE ct.rule_id = r.id AND ct.status NOT IN ('CLOSED','CANCELLED')) AS open_task_count,
         (SELECT MAX(ct.created_at) FROM cleaning_tasks ct WHERE ct.rule_id = r.id) AS last_generated_at,
         (SELECT COUNT(*) FROM cleanable_assets a
           WHERE a.deleted_at IS NULL AND a.status = 'ACTIVE' AND a.is_available = 1
             AND (CASE r.scope
                    WHEN 'ASSET' THEN a.id = r.cleanable_asset_id
                    WHEN 'ASSET_TYPE_IN_AREA'
                      THEN a.asset_type_id = r.asset_type_id AND a.area_id = r.area_id
                    ELSE a.asset_type_id = r.asset_type_id
                  END)) AS target_asset_count
    FROM cleaning_rules r
    JOIN cleaning_procedures p ON p.id = r.procedure_id
    LEFT JOIN cleanable_assets ca ON ca.id = r.cleanable_asset_id
    LEFT JOIN cleanable_asset_types at ON at.id = r.asset_type_id
    LEFT JOIN equipment_areas ar ON ar.id = r.area_id
    LEFT JOIN shifts sh ON sh.id = r.shift_id
    LEFT JOIN cleaning_standards st ON st.id = r.standard_id`;

export interface RuleFilter {
  search?: string;
  scope?: CleaningRuleScope;
  areaId?: string;
  assetTypeId?: string;
  cleanableAssetId?: string;
  procedureId?: string;
  frequencyKind?: CleaningFrequencyKind;
  priority?: CleaningTaskPriority;
  includeInactive?: boolean;
  problemsOnly?: boolean;
  limit: number;
  offset: number;
}

export interface RuleInsert {
  id: string;
  code: string;
  taskName: string;
  purpose: string | null;
  scope: CleaningRuleScope;
  cleanableAssetId: string | null;
  assetTypeId: string | null;
  areaId: string | null;
  procedureId: string;
  frequencyKind: CleaningFrequencyKind;
  intervalDays: number | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  shiftId: string | null;
  dueTime: string | null;
  dueWithinMinutes: number | null;
  responsibleRole: UserRole | null;
  estimatedMinutes: number | null;
  priority: CleaningTaskPriority;
  requiresVerification: boolean;
  verificationMethod: CleaningVerificationMethod | null;
  verifierRole: UserRole | null;
  standardId: string | null;
  isActive: boolean;
  createdBy: string | null;
}

function ruleWhere(filter: RuleFilter): { where: string; params: unknown[] } {
  const conditions = ['r.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.includeInactive !== true) conditions.push('r.is_active = 1');
  if (filter.scope !== undefined) {
    conditions.push('r.scope = ?');
    params.push(filter.scope);
  }
  if (filter.areaId !== undefined) {
    // A global rule reaches every area, so "rules for this area" must include it.
    conditions.push("(r.area_id = ? OR r.scope = 'ASSET_TYPE_GLOBAL')");
    params.push(filter.areaId);
  }
  if (filter.assetTypeId !== undefined) {
    conditions.push('r.asset_type_id = ?');
    params.push(filter.assetTypeId);
  }
  if (filter.cleanableAssetId !== undefined) {
    conditions.push('r.cleanable_asset_id = ?');
    params.push(filter.cleanableAssetId);
  }
  if (filter.procedureId !== undefined) {
    conditions.push('r.procedure_id = ?');
    params.push(filter.procedureId);
  }
  if (filter.frequencyKind !== undefined) {
    conditions.push('r.frequency_kind = ?');
    params.push(filter.frequencyKind);
  }
  if (filter.priority !== undefined) {
    conditions.push('r.priority = ?');
    params.push(filter.priority);
  }
  if (filter.problemsOnly === true) {
    conditions.push(`(p.current_version_id IS NULL
      OR (r.scope <> 'ASSET' AND NOT EXISTS (
            SELECT 1 FROM cleanable_assets a
             WHERE a.deleted_at IS NULL AND a.status = 'ACTIVE'
               AND a.asset_type_id = r.asset_type_id
               AND (r.area_id IS NULL OR a.area_id = r.area_id)))
      OR (r.scope = 'ASSET' AND NOT EXISTS (
            SELECT 1 FROM cleanable_assets a
             WHERE a.id = r.cleanable_asset_id AND a.deleted_at IS NULL AND a.status = 'ACTIVE')))`);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(r.task_name LIKE ? OR r.code LIKE ? OR r.purpose LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const CleaningRuleRepository = {
  async list(db: Db, filter: RuleFilter): Promise<CleaningRuleRow[]> {
    const { where, params } = ruleWhere(filter);
    return selectRows<CleaningRuleRow>(
      db,
      `${RULE_SELECT} ${where}
        ORDER BY r.priority = 'CRITICAL' DESC, r.priority = 'HIGH' DESC, r.task_name
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: RuleFilter): Promise<number> {
    const { where, params } = ruleWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_rules r
         JOIN cleaning_procedures p ON p.id = r.procedure_id
        ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findById(db: Db, id: string): Promise<CleaningRuleRow | null> {
    return selectOne<CleaningRuleRow>(
      db,
      `${RULE_SELECT} WHERE r.id = ? AND r.deleted_at IS NULL`,
      [id],
    );
  },

  async findByCode(db: Db, code: string): Promise<CleaningRuleRow | null> {
    return selectOne<CleaningRuleRow>(
      db,
      `${RULE_SELECT} WHERE r.code = ? AND r.deleted_at IS NULL`,
      [code],
    );
  },

  /**
   * Active rules subscribed to `event`, narrowed to those whose scope could reach the event's
   * subject. The engine still resolves the exact asset list; this is the cheap first cut.
   */
  async listForTrigger(
    db: Db,
    event: CleaningTriggerEvent,
    subject: { cleanableAssetId?: string | null; areaId?: string | null; assetTypeId?: string | null },
  ): Promise<CleaningRuleRow[]> {
    const conditions = [
      'r.deleted_at IS NULL',
      'r.is_active = 1',
      'EXISTS (SELECT 1 FROM cleaning_rule_triggers t WHERE t.rule_id = r.id AND t.event_type = ?)',
    ];
    const params: unknown[] = [event];

    const scopeClauses: string[] = ["r.scope = 'ASSET_TYPE_GLOBAL'"];
    if (subject.cleanableAssetId !== undefined && subject.cleanableAssetId !== null) {
      scopeClauses.push("(r.scope = 'ASSET' AND r.cleanable_asset_id = ?)");
      params.push(subject.cleanableAssetId);
    }
    if (subject.areaId !== undefined && subject.areaId !== null) {
      scopeClauses.push("(r.scope = 'ASSET_TYPE_IN_AREA' AND r.area_id = ?)");
      params.push(subject.areaId);
    }
    conditions.push(`(${scopeClauses.join(' OR ')})`);

    return selectRows<CleaningRuleRow>(
      db,
      `${RULE_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY r.priority DESC, r.task_name`,
      params,
    );
  },

  /** Every active rule whose frequency the sweep can compute a due date for. */
  async listCalendarRules(
    db: Db,
    kinds: readonly CleaningFrequencyKind[],
  ): Promise<CleaningRuleRow[]> {
    if (kinds.length === 0) return [];
    return selectRows<CleaningRuleRow>(
      db,
      `${RULE_SELECT}
        WHERE r.deleted_at IS NULL AND r.is_active = 1
          AND r.frequency_kind IN (${kinds.map(() => '?').join(',')})
          AND p.current_version_id IS NOT NULL
        ORDER BY r.task_name`,
      [...kinds],
    );
  },

  async insert(db: Db, input: RuleInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_rules
         (id, code, task_name, purpose, scope, cleanable_asset_id, asset_type_id, area_id,
          procedure_id, frequency_kind, interval_days, day_of_week, day_of_month, shift_id,
          due_time, due_within_minutes, responsible_role, estimated_minutes, priority,
          requires_verification, verification_method, verifier_role, standard_id, is_active,
          created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.code,
        input.taskName,
        input.purpose,
        input.scope,
        input.cleanableAssetId,
        input.assetTypeId,
        input.areaId,
        input.procedureId,
        input.frequencyKind,
        input.intervalDays,
        input.dayOfWeek,
        input.dayOfMonth,
        input.shiftId,
        input.dueTime,
        input.dueWithinMinutes,
        input.responsibleRole,
        input.estimatedMinutes,
        input.priority,
        input.requiresVerification ? 1 : 0,
        input.verificationMethod,
        input.verifierRole,
        input.standardId,
        input.isActive ? 1 : 0,
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
      `UPDATE cleaning_rules SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE cleaning_rules SET deleted_at = ?, is_active = 0, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /* ------------------------------------------------------- triggers and skills */

  async listTriggers(db: Db, ruleId: string): Promise<CleaningTriggerEvent[]> {
    const rows = await selectRows<CleaningRuleTriggerRow>(
      db,
      `SELECT * FROM cleaning_rule_triggers WHERE rule_id = ? ORDER BY event_type`,
      [ruleId],
    );
    return rows.map((row) => row.event_type);
  },

  async replaceTriggers(
    db: Db,
    ruleId: string,
    events: readonly CleaningTriggerEvent[],
  ): Promise<void> {
    await mutate(db, `DELETE FROM cleaning_rule_triggers WHERE rule_id = ?`, [ruleId]);
    if (events.length === 0) return;
    const now = toDbDateTime();
    const unique = [...new Set(events)];
    await mutate(
      db,
      `INSERT INTO cleaning_rule_triggers (rule_id, event_type, created_at)
       VALUES ${unique.map(() => '(?,?,?)').join(', ')}`,
      unique.flatMap((event) => [ruleId, event, now]),
    );
  },

  async listSkills(db: Db, ruleId: string): Promise<CleaningRuleSkillRow[]> {
    return selectRows<CleaningRuleSkillRow>(
      db,
      `SELECT rs.*, s.name AS skill_name
         FROM cleaning_rule_skills rs
         JOIN skills s ON s.id = rs.skill_id
        WHERE rs.rule_id = ?
        ORDER BY s.name`,
      [ruleId],
    );
  },

  async listSkillsForRules(
    db: Db,
    ruleIds: readonly string[],
  ): Promise<CleaningRuleSkillRow[]> {
    if (ruleIds.length === 0) return [];
    return selectRows<CleaningRuleSkillRow>(
      db,
      `SELECT rs.*, s.name AS skill_name
         FROM cleaning_rule_skills rs
         JOIN skills s ON s.id = rs.skill_id
        WHERE rs.rule_id IN (${ruleIds.map(() => '?').join(',')})
        ORDER BY s.name`,
      [...ruleIds],
    );
  },

  async replaceSkills(
    db: Db,
    ruleId: string,
    skills: ReadonlyArray<{ skillId: string; requiredLevel: SkillLevel }>,
  ): Promise<void> {
    await mutate(db, `DELETE FROM cleaning_rule_skills WHERE rule_id = ?`, [ruleId]);
    if (skills.length === 0) return;
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_rule_skills (rule_id, skill_id, required_level, created_at)
       VALUES ${skills.map(() => '(?,?,?,?)').join(', ')}`,
      skills.flatMap((skill) => [ruleId, skill.skillId, skill.requiredLevel, now]),
    );
  },
};
