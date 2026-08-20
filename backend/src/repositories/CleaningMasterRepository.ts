import type { MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CleanableAssetTypeRow,
  CleaningChemicalRow,
  CleaningMethodRow,
  CleaningStandardRow,
  CleaningToolRow,
  CountRow,
  ShiftDayRow,
  ShiftRow,
  SkillRow,
} from '../models/rows';
import { toDbDateTime, toDbTime } from '../utils/time';

/**
 * The seven reference tables Cleaning & Hygiene owns: asset types, methods, standards,
 * chemicals, tools, skills and shifts.
 *
 * They are grouped in one repository because they are one thing to the product — "the masters
 * page" — and because seven near-identical files would drift. Each still gets its own typed
 * methods; nothing here is dynamic SQL over a table name supplied by a caller.
 *
 * All seven soft-delete. A chemical referenced by a procedure written three years ago must
 * still resolve, or the record of what was used stops being readable.
 */

export interface MasterFilter {
  search?: string;
  includeInactive?: boolean;
}

function masterWhere(
  alias: string,
  filter: MasterFilter,
  searchColumns: readonly string[],
): { where: string; params: unknown[] } {
  const conditions = [`${alias}.deleted_at IS NULL`];
  const params: unknown[] = [];
  if (filter.includeInactive !== true) conditions.push(`${alias}.status = 'ACTIVE'`);
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push(`(${searchColumns.map((column) => `${alias}.${column} LIKE ?`).join(' OR ')})`);
    const like = `%${filter.search}%`;
    for (const _ of searchColumns) params.push(like);
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export interface AssetTypeInsert {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultRiskLevel: string;
  defaultFoodContact: string;
  sortOrder: number;
  createdBy: string | null;
}

export interface ChemicalInsert {
  id: string;
  code: string;
  name: string;
  chemicalKind: string;
  supplierName: string | null;
  supplierEntityId: string | null;
  purpose: string | null;
  dilutionRatio: string | null;
  concentrationPpm: number | null;
  contactTimeSeconds: number | null;
  applicationMethod: string | null;
  storageRequirement: string | null;
  safetyInformation: string | null;
  expiryDate: string | null;
  safetySheetMediaId: string | null;
  createdBy: string | null;
}

export interface ToolInsert {
  id: string;
  code: string;
  name: string;
  toolKind: string;
  colourCode: string | null;
  description: string | null;
  storageLocation: string | null;
  restrictedAreaId: string | null;
  createdBy: string | null;
}

export interface StandardInsert {
  id: string;
  code: string;
  name: string;
  acceptanceText: string;
  measureUnit: string | null;
  minValue: number | null;
  maxValue: number | null;
  createdBy: string | null;
}

export interface NamedMasterInsert {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  createdBy: string | null;
}

export interface ShiftInsert {
  id: string;
  code: string;
  name: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  createdBy: string | null;
}

/** The five tables whose update path is identical: SET a..b, bump updated_at, honour the soft delete. */
const UPDATABLE = {
  assetTypes: 'cleanable_asset_types',
  methods: 'cleaning_methods',
  standards: 'cleaning_standards',
  chemicals: 'cleaning_chemicals',
  tools: 'cleaning_tools',
  skills: 'skills',
  shifts: 'shifts',
} as const;

type UpdatableMaster = keyof typeof UPDATABLE;

export const CleaningMasterRepository = {
  /** One shared update path. `table` is a key of a compile-time map, never caller text. */
  async update(
    db: Db,
    table: UpdatableMaster,
    id: string,
    assignments: string[],
    params: unknown[],
  ): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE ${UPDATABLE[table]} SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, table: UpdatableMaster, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE ${UPDATABLE[table]} SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /* ---------------------------------------------------------------- asset types */

  async listAssetTypes(db: Db, filter: MasterFilter): Promise<CleanableAssetTypeRow[]> {
    const { where, params } = masterWhere('t', filter, ['code', 'name']);
    return selectRows<CleanableAssetTypeRow>(
      db,
      `SELECT t.*,
              (SELECT COUNT(*) FROM cleanable_assets a
                WHERE a.asset_type_id = t.id AND a.deleted_at IS NULL) AS asset_count
         FROM cleanable_asset_types t
         ${where}
        ORDER BY t.sort_order, t.name`,
      params,
    );
  },

  async findAssetType(db: Db, id: string): Promise<CleanableAssetTypeRow | null> {
    return selectOne<CleanableAssetTypeRow>(
      db,
      `SELECT * FROM cleanable_asset_types WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  },

  async findAssetTypeByCode(db: Db, code: string): Promise<CleanableAssetTypeRow | null> {
    return selectOne<CleanableAssetTypeRow>(
      db,
      `SELECT * FROM cleanable_asset_types WHERE code = ? AND deleted_at IS NULL`,
      [code],
    );
  },

  async insertAssetType(db: Db, input: AssetTypeInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleanable_asset_types
         (id, code, name, description, default_risk_level, default_food_contact, sort_order,
          status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.description,
        input.defaultRiskLevel,
        input.defaultFoodContact,
        input.sortOrder,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  /* -------------------------------------------------------------------- methods */

  async listMethods(db: Db, filter: MasterFilter): Promise<CleaningMethodRow[]> {
    const { where, params } = masterWhere('m', filter, ['code', 'name']);
    return selectRows<CleaningMethodRow>(
      db,
      `SELECT m.* FROM cleaning_methods m ${where} ORDER BY m.sort_order, m.name`,
      params,
    );
  },

  async findMethod(db: Db, id: string): Promise<CleaningMethodRow | null> {
    return selectOne<CleaningMethodRow>(
      db,
      `SELECT * FROM cleaning_methods WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  },

  async insertMethod(db: Db, input: NamedMasterInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_methods
         (id, code, name, description, sort_order, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`,
      [input.id, input.code, input.name, input.description, input.sortOrder, input.createdBy, now, now],
    );
  },

  /* ------------------------------------------------------------------ standards */

  async listStandards(db: Db, filter: MasterFilter): Promise<CleaningStandardRow[]> {
    const { where, params } = masterWhere('s', filter, ['code', 'name', 'acceptance_text']);
    return selectRows<CleaningStandardRow>(
      db,
      `SELECT s.* FROM cleaning_standards s ${where} ORDER BY s.name`,
      params,
    );
  },

  async findStandard(db: Db, id: string): Promise<CleaningStandardRow | null> {
    return selectOne<CleaningStandardRow>(
      db,
      `SELECT * FROM cleaning_standards WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  },

  async insertStandard(db: Db, input: StandardInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_standards
         (id, code, name, acceptance_text, measure_unit, min_value, max_value, status,
          created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.acceptanceText,
        input.measureUnit,
        input.minValue,
        input.maxValue,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  /* ------------------------------------------------------------------ chemicals */

  async listChemicals(db: Db, filter: MasterFilter): Promise<CleaningChemicalRow[]> {
    const { where, params } = masterWhere('c', filter, ['code', 'name', 'purpose', 'supplier_name']);
    return selectRows<CleaningChemicalRow>(
      db,
      `SELECT c.* FROM cleaning_chemicals c ${where} ORDER BY c.name`,
      params,
    );
  },

  async findChemical(db: Db, id: string): Promise<CleaningChemicalRow | null> {
    return selectOne<CleaningChemicalRow>(
      db,
      `SELECT * FROM cleaning_chemicals WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  },

  async countExpiredChemicals(db: Db): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_chemicals
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
          AND expiry_date IS NOT NULL AND expiry_date < CURDATE()`,
    );
    return Number(row?.total ?? 0);
  },

  async insertChemical(db: Db, input: ChemicalInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_chemicals
         (id, code, name, supplier_name, supplier_entity_id, purpose, chemical_kind,
          dilution_ratio, concentration_ppm, contact_time_seconds, application_method,
          storage_requirement, safety_information, expiry_date, safety_sheet_media_id,
          status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.supplierName,
        input.supplierEntityId,
        input.purpose,
        input.chemicalKind,
        input.dilutionRatio,
        input.concentrationPpm,
        input.contactTimeSeconds,
        input.applicationMethod,
        input.storageRequirement,
        input.safetyInformation,
        input.expiryDate,
        input.safetySheetMediaId,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  /* ---------------------------------------------------------------------- tools */

  async listTools(db: Db, filter: MasterFilter): Promise<CleaningToolRow[]> {
    const { where, params } = masterWhere('t', filter, ['code', 'name', 'colour_code']);
    return selectRows<CleaningToolRow>(
      db,
      `SELECT t.*, a.name AS restricted_area_name
         FROM cleaning_tools t
         LEFT JOIN equipment_areas a ON a.id = t.restricted_area_id
         ${where}
        ORDER BY t.name`,
      params,
    );
  },

  async findTool(db: Db, id: string): Promise<CleaningToolRow | null> {
    return selectOne<CleaningToolRow>(
      db,
      `SELECT t.*, a.name AS restricted_area_name
         FROM cleaning_tools t
         LEFT JOIN equipment_areas a ON a.id = t.restricted_area_id
        WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
  },

  async insertTool(db: Db, input: ToolInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_tools
         (id, code, name, tool_kind, colour_code, description, storage_location,
          restricted_area_id, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.toolKind,
        input.colourCode,
        input.description,
        input.storageLocation,
        input.restrictedAreaId,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  /* --------------------------------------------------------------------- skills */

  async listSkills(db: Db, filter: MasterFilter): Promise<SkillRow[]> {
    const { where, params } = masterWhere('s', filter, ['code', 'name']);
    return selectRows<SkillRow>(
      db,
      `SELECT s.*, (SELECT COUNT(*) FROM user_skills us WHERE us.skill_id = s.id) AS holder_count
         FROM skills s ${where} ORDER BY s.sort_order, s.name`,
      params,
    );
  },

  async findSkill(db: Db, id: string): Promise<SkillRow | null> {
    return selectOne<SkillRow>(db, `SELECT * FROM skills WHERE id = ? AND deleted_at IS NULL`, [id]);
  },

  async insertSkill(db: Db, input: NamedMasterInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO skills (id, code, name, description, sort_order, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`,
      [input.id, input.code, input.name, input.description, input.sortOrder, input.createdBy, now, now],
    );
  },

  /* --------------------------------------------------------------------- shifts */

  async listShifts(db: Db, filter: MasterFilter): Promise<ShiftRow[]> {
    const { where, params } = masterWhere('s', filter, ['code', 'name']);
    return selectRows<ShiftRow>(
      db,
      `SELECT s.*,
              (SELECT GROUP_CONCAT(d.day_of_week ORDER BY d.day_of_week)
                 FROM shift_days d WHERE d.shift_id = s.id) AS day_numbers,
              (SELECT COUNT(DISTINCT usa.user_id) FROM user_shift_assignments usa
                WHERE usa.shift_id = s.id
                  AND usa.effective_from <= CURDATE()
                  AND (usa.effective_to IS NULL OR usa.effective_to >= CURDATE())) AS member_count
         FROM shifts s ${where}
        ORDER BY s.sort_order, s.starts_at`,
      params,
    );
  },

  async findShift(db: Db, id: string): Promise<ShiftRow | null> {
    return selectOne<ShiftRow>(
      db,
      `SELECT s.*, (SELECT GROUP_CONCAT(d.day_of_week ORDER BY d.day_of_week)
                      FROM shift_days d WHERE d.shift_id = s.id) AS day_numbers
         FROM shifts s WHERE s.id = ? AND s.deleted_at IS NULL`,
      [id],
    );
  },

  /**
   * The shift the clock is currently inside, if any. A night shift is two ranges, which is why
   * this is not one BETWEEN — and why the caller gets at most one row rather than a guess.
   */
  async findCurrentShift(db: Db, at: Date = new Date()): Promise<ShiftRow | null> {
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:00`;
    const dayOfWeek = at.getDay();
    return selectOne<ShiftRow>(
      db,
      `SELECT s.* FROM shifts s
        WHERE s.deleted_at IS NULL AND s.status = 'ACTIVE'
          AND ((s.crosses_midnight = 0 AND ? >= s.starts_at AND ? < s.ends_at)
            OR (s.crosses_midnight = 1 AND (? >= s.starts_at OR ? < s.ends_at)))
          AND (NOT EXISTS (SELECT 1 FROM shift_days d WHERE d.shift_id = s.id)
            OR EXISTS (SELECT 1 FROM shift_days d WHERE d.shift_id = s.id AND d.day_of_week = ?))
        ORDER BY s.sort_order
        LIMIT 1`,
      [clock, clock, clock, clock, dayOfWeek],
    );
  },

  async insertShift(db: Db, input: ShiftInsert): Promise<void> {
    const now = toDbDateTime();
    const startsAt = toDbTime(input.startsAt);
    const endsAt = toDbTime(input.endsAt);
    await mutate(
      db,
      `INSERT INTO shifts
         (id, code, name, starts_at, ends_at, crosses_midnight, sort_order, status,
          created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        startsAt,
        endsAt,
        endsAt <= startsAt ? 1 : 0,
        input.sortOrder,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async replaceShiftDays(db: Db, shiftId: string, days: readonly number[]): Promise<void> {
    await mutate(db, `DELETE FROM shift_days WHERE shift_id = ?`, [shiftId]);
    if (days.length === 0) return;
    const now = toDbDateTime();
    const unique = [...new Set(days)];
    await mutate(
      db,
      `INSERT INTO shift_days (shift_id, day_of_week, created_at)
       VALUES ${unique.map(() => '(?,?,?)').join(', ')}`,
      unique.flatMap((day) => [shiftId, day, now]),
    );
  },

  async listShiftDays(db: Db, shiftId: string): Promise<ShiftDayRow[]> {
    return selectRows<ShiftDayRow>(
      db,
      `SELECT * FROM shift_days WHERE shift_id = ? ORDER BY day_of_week`,
      [shiftId],
    );
  },

  /* ------------------------------------------------------- shared code lookups */

  /**
   * Whether `code` is already taken on one of the code-unique masters. Checked before insert
   * so the user gets "that code is in use" rather than a duplicate-key error page.
   */
  async codeExists(
    db: Db,
    table: UpdatableMaster,
    code: string,
    excludeId?: string,
  ): Promise<boolean> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM ${UPDATABLE[table]}
        WHERE code = ? AND deleted_at IS NULL ${excludeId === undefined ? '' : 'AND id <> ?'}`,
      excludeId === undefined ? [code] : [code, excludeId],
    );
    return Number(row?.total ?? 0) > 0;
  },

  /** Status flip shared by every master, so the audit entry is written from one place. */
  async setStatus(
    db: Db,
    table: UpdatableMaster,
    id: string,
    status: MasterStatus,
  ): Promise<boolean> {
    return this.update(db, table, id, ['status = ?'], [status]);
  },
};
