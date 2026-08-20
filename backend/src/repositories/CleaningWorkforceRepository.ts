import type { CleaningAssignmentStrategy, SkillLevel } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CandidateRow,
  CleaningAssignmentRuleRow,
  UserAreaResponsibilityRow,
  UserShiftAssignmentRow,
  UserSkillRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Who can clean what, when: skills held, shifts worked, areas owned, and the per-area policy
 * the assignment engine follows.
 *
 * `listCandidates` is the interesting one. It answers "who could take this task, and how good
 * a fit are they" in a single query rather than fetching every user and filtering in Node —
 * the engine runs once per generated task, and a nightly sweep generates hundreds.
 */

export const CleaningWorkforceRepository = {
  /* --------------------------------------------------------------------- skills */

  async listUserSkills(db: Db, userId: string): Promise<UserSkillRow[]> {
    return selectRows<UserSkillRow>(
      db,
      `SELECT us.*, s.name AS skill_name, g.name AS granted_by_name
         FROM user_skills us
         JOIN skills s ON s.id = us.skill_id
         LEFT JOIN users g ON g.id = us.granted_by
        WHERE us.user_id = ? AND s.deleted_at IS NULL
        ORDER BY s.sort_order, s.name`,
      [userId],
    );
  },

  async listSkillHolders(db: Db, skillId: string): Promise<UserSkillRow[]> {
    return selectRows<UserSkillRow>(
      db,
      `SELECT us.*, u.name AS user_name, s.name AS skill_name
         FROM user_skills us
         JOIN users u ON u.id = us.user_id
         JOIN skills s ON s.id = us.skill_id
        WHERE us.skill_id = ? AND u.deleted_at IS NULL
        ORDER BY u.name`,
      [skillId],
    );
  },

  async upsertUserSkill(
    db: Db,
    input: {
      userId: string;
      skillId: string;
      level: SkillLevel;
      certifiedAt: string | null;
      certifiedUntil: string | null;
      note: string | null;
      grantedBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO user_skills
         (user_id, skill_id, level, certified_at, certified_until, note, granted_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         level = VALUES(level), certified_at = VALUES(certified_at),
         certified_until = VALUES(certified_until), note = VALUES(note),
         granted_by = VALUES(granted_by), updated_at = VALUES(updated_at)`,
      [
        input.userId,
        input.skillId,
        input.level,
        input.certifiedAt,
        input.certifiedUntil,
        input.note,
        input.grantedBy,
        now,
        now,
      ],
    );
  },

  async removeUserSkill(db: Db, userId: string, skillId: string): Promise<boolean> {
    const result = await mutate(
      db,
      `DELETE FROM user_skills WHERE user_id = ? AND skill_id = ?`,
      [userId, skillId],
    );
    return result.affectedRows > 0;
  },

  /* --------------------------------------------------------------------- shifts */

  async listUserShifts(db: Db, userId: string): Promise<UserShiftAssignmentRow[]> {
    return selectRows<UserShiftAssignmentRow>(
      db,
      `SELECT usa.*, s.name AS shift_name, s.starts_at AS shift_starts_at, s.ends_at AS shift_ends_at
         FROM user_shift_assignments usa
         JOIN shifts s ON s.id = usa.shift_id
        WHERE usa.user_id = ?
        ORDER BY usa.effective_from DESC`,
      [userId],
    );
  },

  async listShiftMembers(db: Db, shiftId: string): Promise<UserShiftAssignmentRow[]> {
    return selectRows<UserShiftAssignmentRow>(
      db,
      `SELECT usa.*, u.name AS user_name, s.name AS shift_name,
              s.starts_at AS shift_starts_at, s.ends_at AS shift_ends_at
         FROM user_shift_assignments usa
         JOIN users u ON u.id = usa.user_id
         JOIN shifts s ON s.id = usa.shift_id
        WHERE usa.shift_id = ? AND u.deleted_at IS NULL
          AND usa.effective_from <= CURDATE()
          AND (usa.effective_to IS NULL OR usa.effective_to >= CURDATE())
        ORDER BY u.name`,
      [shiftId],
    );
  },

  async insertUserShift(
    db: Db,
    input: {
      id: string;
      userId: string;
      shiftId: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO user_shift_assignments
         (id, user_id, shift_id, effective_from, effective_to, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         effective_to = VALUES(effective_to), updated_at = VALUES(updated_at)`,
      [
        input.id,
        input.userId,
        input.shiftId,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async removeUserShift(db: Db, id: string): Promise<boolean> {
    const result = await mutate(db, `DELETE FROM user_shift_assignments WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },

  /* ------------------------------------------------------------ area ownership */

  async listUserAreas(db: Db, userId: string): Promise<UserAreaResponsibilityRow[]> {
    return selectRows<UserAreaResponsibilityRow>(
      db,
      `SELECT uar.*, a.name AS area_name, f.name AS floor_name
         FROM user_area_responsibilities uar
         JOIN equipment_areas a ON a.id = uar.area_id
         LEFT JOIN equipment_floors f ON f.id = a.floor_id
        WHERE uar.user_id = ?
        ORDER BY uar.is_primary DESC, a.name`,
      [userId],
    );
  },

  async listAreaResponsibles(db: Db, areaId: string): Promise<UserAreaResponsibilityRow[]> {
    return selectRows<UserAreaResponsibilityRow>(
      db,
      `SELECT uar.*, u.name AS user_name, a.name AS area_name
         FROM user_area_responsibilities uar
         JOIN users u ON u.id = uar.user_id
         JOIN equipment_areas a ON a.id = uar.area_id
        WHERE uar.area_id = ? AND u.deleted_at IS NULL
        ORDER BY uar.is_primary DESC, u.name`,
      [areaId],
    );
  },

  async listAllResponsibles(db: Db): Promise<UserAreaResponsibilityRow[]> {
    return selectRows<UserAreaResponsibilityRow>(
      db,
      `SELECT uar.*, u.name AS user_name, a.name AS area_name
         FROM user_area_responsibilities uar
         JOIN users u ON u.id = uar.user_id
         JOIN equipment_areas a ON a.id = uar.area_id
        WHERE u.deleted_at IS NULL
        ORDER BY a.name, uar.is_primary DESC, u.name`,
    );
  },

  async upsertUserArea(
    db: Db,
    input: { userId: string; areaId: string; isPrimary: boolean; createdBy: string | null },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO user_area_responsibilities
         (user_id, area_id, is_primary, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary), updated_at = VALUES(updated_at)`,
      [input.userId, input.areaId, input.isPrimary ? 1 : 0, input.createdBy, now, now],
    );
  },

  async removeUserArea(db: Db, userId: string, areaId: string): Promise<boolean> {
    const result = await mutate(
      db,
      `DELETE FROM user_area_responsibilities WHERE user_id = ? AND area_id = ?`,
      [userId, areaId],
    );
    return result.affectedRows > 0;
  },

  /* ------------------------------------------------------------ assignment rules */

  async listAssignmentRules(db: Db): Promise<CleaningAssignmentRuleRow[]> {
    return selectRows<CleaningAssignmentRuleRow>(
      db,
      `SELECT ar.*, a.name AS area_name
         FROM cleaning_assignment_rules ar
         LEFT JOIN equipment_areas a ON a.id = ar.area_id
        ORDER BY ar.area_id IS NULL DESC, a.name`,
    );
  },

  /**
   * The policy for an area: its own rule if it has one, otherwise the global fallback. Null
   * means neither exists and the service falls back to its compiled-in defaults.
   */
  async findAssignmentRule(
    db: Db,
    areaId: string,
  ): Promise<CleaningAssignmentRuleRow | null> {
    return selectOne<CleaningAssignmentRuleRow>(
      db,
      `SELECT ar.*, a.name AS area_name
         FROM cleaning_assignment_rules ar
         LEFT JOIN equipment_areas a ON a.id = ar.area_id
        WHERE ar.is_active = 1 AND (ar.area_id = ? OR ar.area_id IS NULL)
        ORDER BY ar.area_id IS NULL
        LIMIT 1`,
      [areaId],
    );
  },

  async findAssignmentRuleById(db: Db, id: string): Promise<CleaningAssignmentRuleRow | null> {
    return selectOne<CleaningAssignmentRuleRow>(
      db,
      `SELECT ar.*, a.name AS area_name
         FROM cleaning_assignment_rules ar
         LEFT JOIN equipment_areas a ON a.id = ar.area_id
        WHERE ar.id = ?`,
      [id],
    );
  },

  async upsertAssignmentRule(
    db: Db,
    input: {
      id: string;
      areaId: string | null;
      strategy: CleaningAssignmentStrategy;
      requireSkillMatch: boolean;
      requireShiftMatch: boolean;
      requireAreaMatch: boolean;
      maxOpenTasks: number;
      allowRelaxedFallback: boolean;
      isActive: boolean;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_assignment_rules
         (id, area_id, strategy, require_skill_match, require_shift_match, require_area_match,
          max_open_tasks, allow_relaxed_fallback, is_active, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         strategy = VALUES(strategy),
         require_skill_match = VALUES(require_skill_match),
         require_shift_match = VALUES(require_shift_match),
         require_area_match = VALUES(require_area_match),
         max_open_tasks = VALUES(max_open_tasks),
         allow_relaxed_fallback = VALUES(allow_relaxed_fallback),
         is_active = VALUES(is_active),
         updated_at = VALUES(updated_at)`,
      [
        input.id,
        input.areaId,
        input.strategy,
        input.requireSkillMatch ? 1 : 0,
        input.requireShiftMatch ? 1 : 0,
        input.requireAreaMatch ? 1 : 0,
        input.maxOpenTasks,
        input.allowRelaxedFallback ? 1 : 0,
        input.isActive ? 1 : 0,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async removeAssignmentRule(db: Db, id: string): Promise<boolean> {
    const result = await mutate(db, `DELETE FROM cleaning_assignment_rules WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },

  /* ------------------------------------------------------------------ candidates */

  /**
   * Everyone who could conceivably take a task in `areaId`, with the four facts the engine
   * scores on: current load, whether they are on shift now, whether they own the area, and how
   * many of the required skills they actually hold at the required level.
   *
   * `requiredSkills` is a list of `skillId:level` pairs; an empty list makes `skills_held` zero
   * for everyone, which the caller reads as "no skill requirement".
   */
  async listCandidates(
    db: Db,
    input: {
      areaId: string;
      requiredSkills: ReadonlyArray<{ skillId: string; requiredLevel: SkillLevel }>;
      /** Only these roles are ever considered. Cleaning reaches down to EMPLOYEE. */
      roles: readonly string[];
      at?: Date;
    },
  ): Promise<CandidateRow[]> {
    const at = input.at ?? new Date();
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:00`;
    const dayOfWeek = at.getDay();

    const params: unknown[] = [];

    // A held level satisfies a requirement when it is at or above it. The ladder is three deep,
    // so the comparison is spelled out rather than joined against a lookup table.
    let skillsHeld = '0';
    if (input.requiredSkills.length > 0) {
      const clauses = input.requiredSkills.map(() => {
        return `(SELECT COUNT(*) FROM user_skills us
                  WHERE us.user_id = u.id AND us.skill_id = ?
                    AND FIELD(us.level,'BASIC','COMPETENT','EXPERT') >= FIELD(?,'BASIC','COMPETENT','EXPERT')
                    AND (us.certified_until IS NULL OR us.certified_until >= CURDATE()))`;
      });
      skillsHeld = clauses.join(' + ');
      for (const skill of input.requiredSkills) params.push(skill.skillId, skill.requiredLevel);
    }

    params.push(clock, clock, clock, clock, dayOfWeek);
    params.push(input.areaId, input.areaId);
    params.push(...input.roles);

    return selectRows<CandidateRow>(
      db,
      `SELECT u.id, u.name, u.role,
              (SELECT COUNT(*) FROM cleaning_tasks ct
                WHERE ct.assigned_to = u.id
                  AND ct.status NOT IN ('CLOSED','CANCELLED')) AS open_task_count,
              ${skillsHeld} AS skills_held,
              EXISTS (SELECT 1
                        FROM user_shift_assignments usa
                        JOIN shifts s ON s.id = usa.shift_id
                       WHERE usa.user_id = u.id
                         AND s.deleted_at IS NULL AND s.status = 'ACTIVE'
                         AND usa.effective_from <= CURDATE()
                         AND (usa.effective_to IS NULL OR usa.effective_to >= CURDATE())
                         AND ((s.crosses_midnight = 0 AND ? >= s.starts_at AND ? < s.ends_at)
                           OR (s.crosses_midnight = 1 AND (? >= s.starts_at OR ? < s.ends_at)))
                         AND (NOT EXISTS (SELECT 1 FROM shift_days d WHERE d.shift_id = s.id)
                           OR EXISTS (SELECT 1 FROM shift_days d
                                       WHERE d.shift_id = s.id AND d.day_of_week = ?))) AS on_shift,
              EXISTS (SELECT 1 FROM user_area_responsibilities uar
                       WHERE uar.user_id = u.id AND uar.area_id = ?) AS is_area_responsible,
              EXISTS (SELECT 1 FROM user_area_responsibilities uar
                       WHERE uar.user_id = u.id AND uar.area_id = ?
                         AND uar.is_primary = 1) AS is_primary_for_area,
              (SELECT MAX(ct.assigned_at) FROM cleaning_tasks ct
                WHERE ct.assigned_to = u.id) AS last_assigned_at
         FROM users u
        WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
          AND u.role IN (${input.roles.map(() => '?').join(',')})
        ORDER BY u.name`,
      params,
    );
  },
};
