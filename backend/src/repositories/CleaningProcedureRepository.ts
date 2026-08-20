import type { CleaningProcedureVersionStatus, MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CleaningProcedureChemicalRow,
  CleaningProcedureRow,
  CleaningProcedureStepRow,
  CleaningProcedureToolRow,
  CleaningProcedureVersionRow,
  CountRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Cleaning procedures — the SOP a task tells its operator to follow — and their versions.
 *
 * The versioning is the point of this file. A task pins `procedure_version_id`, never
 * `procedure_id`, so a procedure edited in March cannot rewrite what somebody signed off in
 * January. Only a PUBLISHED version is ever pinned; a DRAFT is a working copy and an ARCHIVED
 * one is history that some old task still points at.
 */

const VERSION_SELECT = `SELECT v.*,
         p.name AS procedure_name, p.code AS procedure_code,
         m.name AS method_name,
         s.name AS standard_name, s.acceptance_text AS standard_acceptance_text,
         u.name AS published_by_name
    FROM cleaning_procedure_versions v
    JOIN cleaning_procedures p ON p.id = v.procedure_id
    LEFT JOIN cleaning_methods m ON m.id = v.method_id
    LEFT JOIN cleaning_standards s ON s.id = v.standard_id
    LEFT JOIN users u ON u.id = v.published_by`;

const PROCEDURE_SELECT = `SELECT p.*,
         cv.version AS current_version,
         (SELECT COUNT(*) FROM cleaning_procedure_versions v WHERE v.procedure_id = p.id) AS version_count,
         (SELECT COUNT(*) FROM cleaning_procedure_versions v
           WHERE v.procedure_id = p.id AND v.status = 'DRAFT') AS draft_count,
         (SELECT COUNT(*) FROM cleaning_rules r
           WHERE r.procedure_id = p.id AND r.deleted_at IS NULL) AS rule_count
    FROM cleaning_procedures p
    LEFT JOIN cleaning_procedure_versions cv ON cv.id = p.current_version_id`;

export interface ProcedureFilter {
  search?: string;
  includeInactive?: boolean;
  /** Only procedures with a published version — what a rule form may legally offer. */
  publishedOnly?: boolean;
  limit: number;
  offset: number;
}

export interface ProcedureInsert {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdBy: string | null;
}

export interface ProcedureVersionInsert {
  id: string;
  procedureId: string;
  version: number;
  methodId: string | null;
  standardId: string | null;
  changeNote: string | null;
  ppeRequired: string | null;
  requiresDisassembly: boolean;
  requiresRinse: boolean;
  requiresFinalRinse: boolean;
  requiresDrying: boolean;
  contactTimeSeconds: number | null;
  estimatedMinutes: number | null;
  safetyNotes: string | null;
  createdBy: string | null;
}

export interface ProcedureStepInsert {
  id: string;
  versionId: string;
  stepNumber: number;
  title: string;
  instruction: string | null;
  chemicalId: string | null;
  toolId: string | null;
  durationSeconds: number | null;
  isMandatory: boolean;
  requiresPhoto: boolean;
}

function procedureWhere(filter: ProcedureFilter): { where: string; params: unknown[] } {
  const conditions = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filter.includeInactive !== true) conditions.push("p.status = 'ACTIVE'");
  if (filter.publishedOnly === true) conditions.push('p.current_version_id IS NOT NULL');
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(p.name LIKE ? OR p.code LIKE ? OR p.description LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const CleaningProcedureRepository = {
  async list(db: Db, filter: ProcedureFilter): Promise<CleaningProcedureRow[]> {
    const { where, params } = procedureWhere(filter);
    return selectRows<CleaningProcedureRow>(
      db,
      `${PROCEDURE_SELECT} ${where} ORDER BY p.name LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: ProcedureFilter): Promise<number> {
    const { where, params } = procedureWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_procedures p ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findById(db: Db, id: string): Promise<CleaningProcedureRow | null> {
    return selectOne<CleaningProcedureRow>(
      db,
      `${PROCEDURE_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    );
  },

  async codeExists(db: Db, code: string, excludeId?: string): Promise<boolean> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_procedures
        WHERE code = ? AND deleted_at IS NULL ${excludeId === undefined ? '' : 'AND id <> ?'}`,
      excludeId === undefined ? [code] : [code, excludeId],
    );
    return Number(row?.total ?? 0) > 0;
  },

  async insert(db: Db, input: ProcedureInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_procedures
         (id, code, name, description, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,'ACTIVE',?,?,?)`,
      [input.id, input.code, input.name, input.description, input.createdBy, now, now],
    );
  },

  async update(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE cleaning_procedures SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async setStatus(db: Db, id: string, status: MasterStatus): Promise<boolean> {
    return this.update(db, id, ['status = ?'], [status]);
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE cleaning_procedures SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /* ----------------------------------------------------------------- versions */

  async listVersions(db: Db, procedureId: string): Promise<CleaningProcedureVersionRow[]> {
    return selectRows<CleaningProcedureVersionRow>(
      db,
      `${VERSION_SELECT} WHERE v.procedure_id = ? ORDER BY v.version DESC`,
      [procedureId],
    );
  },

  async findVersion(db: Db, id: string): Promise<CleaningProcedureVersionRow | null> {
    return selectOne<CleaningProcedureVersionRow>(db, `${VERSION_SELECT} WHERE v.id = ?`, [id]);
  },

  async findDraft(db: Db, procedureId: string): Promise<CleaningProcedureVersionRow | null> {
    return selectOne<CleaningProcedureVersionRow>(
      db,
      `${VERSION_SELECT} WHERE v.procedure_id = ? AND v.status = 'DRAFT' ORDER BY v.version DESC LIMIT 1`,
      [procedureId],
    );
  },

  /** The version a task raised right now would pin. Null means the rule cannot raise work. */
  async findPublishedVersion(
    db: Db,
    procedureId: string,
  ): Promise<CleaningProcedureVersionRow | null> {
    return selectOne<CleaningProcedureVersionRow>(
      db,
      `${VERSION_SELECT}
        WHERE v.procedure_id = ? AND v.status = 'PUBLISHED'
        ORDER BY v.version DESC LIMIT 1`,
      [procedureId],
    );
  },

  async nextVersionNumber(db: Db, procedureId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(version), 0) AS total FROM cleaning_procedure_versions
        WHERE procedure_id = ? FOR UPDATE`,
      [procedureId],
    );
    return Number(row?.total ?? 0) + 1;
  },

  async insertVersion(db: Db, input: ProcedureVersionInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_procedure_versions
         (id, procedure_id, version, status, method_id, standard_id, change_note, ppe_required,
          requires_disassembly, requires_rinse, requires_final_rinse, requires_drying,
          contact_time_seconds, estimated_minutes, safety_notes, created_by, created_at, updated_at)
       VALUES (?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.procedureId,
        input.version,
        input.methodId,
        input.standardId,
        input.changeNote,
        input.ppeRequired,
        input.requiresDisassembly ? 1 : 0,
        input.requiresRinse ? 1 : 0,
        input.requiresFinalRinse ? 1 : 0,
        input.requiresDrying ? 1 : 0,
        input.contactTimeSeconds,
        input.estimatedMinutes,
        input.safetyNotes,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async updateVersion(
    db: Db,
    id: string,
    assignments: string[],
    params: unknown[],
  ): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE cleaning_procedure_versions SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async setVersionStatus(
    db: Db,
    id: string,
    status: CleaningProcedureVersionStatus,
    actorId: string | null,
  ): Promise<void> {
    const now = toDbDateTime();
    if (status === 'PUBLISHED') {
      await mutate(
        db,
        `UPDATE cleaning_procedure_versions
            SET status = 'PUBLISHED', published_at = ?, published_by = ?, updated_at = ?
          WHERE id = ?`,
        [now, actorId, now, id],
      );
      return;
    }
    if (status === 'ARCHIVED') {
      await mutate(
        db,
        `UPDATE cleaning_procedure_versions SET status = 'ARCHIVED', archived_at = ?, updated_at = ?
          WHERE id = ?`,
        [now, now, id],
      );
      return;
    }
    await mutate(
      db,
      `UPDATE cleaning_procedure_versions SET status = ?, updated_at = ? WHERE id = ?`,
      [status, now, id],
    );
  },

  /** Archives whatever was published before, so exactly one version is current at a time. */
  async archiveOtherPublished(db: Db, procedureId: string, keepId: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE cleaning_procedure_versions
          SET status = 'ARCHIVED', archived_at = ?, updated_at = ?
        WHERE procedure_id = ? AND id <> ? AND status = 'PUBLISHED'`,
      [now, now, procedureId, keepId],
    );
  },

  async setCurrentVersion(db: Db, procedureId: string, versionId: string | null): Promise<void> {
    await mutate(
      db,
      `UPDATE cleaning_procedures SET current_version_id = ?, updated_at = ? WHERE id = ?`,
      [versionId, toDbDateTime(), procedureId],
    );
  },

  async deleteVersion(db: Db, id: string): Promise<boolean> {
    const result = await mutate(
      db,
      `DELETE FROM cleaning_procedure_versions WHERE id = ? AND status = 'DRAFT'`,
      [id],
    );
    return result.affectedRows > 0;
  },

  /** True when some task still points at this version — it may never be hard-deleted. */
  async versionInUse(db: Db, versionId: string): Promise<boolean> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM cleaning_tasks WHERE procedure_version_id = ?`,
      [versionId],
    );
    return Number(row?.total ?? 0) > 0;
  },

  /* -------------------------------------------------------------------- steps */

  async listSteps(db: Db, versionId: string): Promise<CleaningProcedureStepRow[]> {
    return selectRows<CleaningProcedureStepRow>(
      db,
      `SELECT s.*, c.name AS chemical_name, t.name AS tool_name
         FROM cleaning_procedure_steps s
         LEFT JOIN cleaning_chemicals c ON c.id = s.chemical_id
         LEFT JOIN cleaning_tools t ON t.id = s.tool_id
        WHERE s.version_id = ?
        ORDER BY s.step_number`,
      [versionId],
    );
  },

  async listStepsForVersions(
    db: Db,
    versionIds: readonly string[],
  ): Promise<CleaningProcedureStepRow[]> {
    if (versionIds.length === 0) return [];
    return selectRows<CleaningProcedureStepRow>(
      db,
      `SELECT s.*, c.name AS chemical_name, t.name AS tool_name
         FROM cleaning_procedure_steps s
         LEFT JOIN cleaning_chemicals c ON c.id = s.chemical_id
         LEFT JOIN cleaning_tools t ON t.id = s.tool_id
        WHERE s.version_id IN (${versionIds.map(() => '?').join(',')})
        ORDER BY s.version_id, s.step_number`,
      [...versionIds],
    );
  },

  async replaceSteps(db: Db, versionId: string, steps: readonly ProcedureStepInsert[]): Promise<void> {
    await mutate(db, `DELETE FROM cleaning_procedure_steps WHERE version_id = ?`, [versionId]);
    if (steps.length === 0) return;
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_procedure_steps
         (id, version_id, step_number, title, instruction, chemical_id, tool_id,
          duration_seconds, is_mandatory, requires_photo, created_at, updated_at)
       VALUES ${steps.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(', ')}`,
      steps.flatMap((step) => [
        step.id,
        versionId,
        step.stepNumber,
        step.title,
        step.instruction,
        step.chemicalId,
        step.toolId,
        step.durationSeconds,
        step.isMandatory ? 1 : 0,
        step.requiresPhoto ? 1 : 0,
        now,
        now,
      ]),
    );
  },

  /* -------------------------------------------------- chemicals and tools used */

  async listVersionChemicals(db: Db, versionId: string): Promise<CleaningProcedureChemicalRow[]> {
    return selectRows<CleaningProcedureChemicalRow>(
      db,
      `SELECT pc.*, c.name AS chemical_name, c.chemical_kind
         FROM cleaning_procedure_chemicals pc
         JOIN cleaning_chemicals c ON c.id = pc.chemical_id
        WHERE pc.version_id = ?
        ORDER BY c.name`,
      [versionId],
    );
  },

  async listVersionTools(db: Db, versionId: string): Promise<CleaningProcedureToolRow[]> {
    return selectRows<CleaningProcedureToolRow>(
      db,
      `SELECT pt.*, t.name AS tool_name, t.tool_kind, t.colour_code
         FROM cleaning_procedure_tools pt
         JOIN cleaning_tools t ON t.id = pt.tool_id
        WHERE pt.version_id = ?
        ORDER BY t.name`,
      [versionId],
    );
  },

  async replaceVersionChemicals(
    db: Db,
    versionId: string,
    rows: ReadonlyArray<{
      chemicalId: string;
      concentrationPpm: number | null;
      dilutionRatio: string | null;
      contactTimeSeconds: number | null;
      note: string | null;
    }>,
  ): Promise<void> {
    await mutate(db, `DELETE FROM cleaning_procedure_chemicals WHERE version_id = ?`, [versionId]);
    if (rows.length === 0) return;
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_procedure_chemicals
         (version_id, chemical_id, concentration_ppm, dilution_ratio, contact_time_seconds, note, created_at)
       VALUES ${rows.map(() => '(?,?,?,?,?,?,?)').join(', ')}`,
      rows.flatMap((row) => [
        versionId,
        row.chemicalId,
        row.concentrationPpm,
        row.dilutionRatio,
        row.contactTimeSeconds,
        row.note,
        now,
      ]),
    );
  },

  async replaceVersionTools(
    db: Db,
    versionId: string,
    rows: ReadonlyArray<{ toolId: string; note: string | null }>,
  ): Promise<void> {
    await mutate(db, `DELETE FROM cleaning_procedure_tools WHERE version_id = ?`, [versionId]);
    if (rows.length === 0) return;
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO cleaning_procedure_tools (version_id, tool_id, note, created_at)
       VALUES ${rows.map(() => '(?,?,?,?)').join(', ')}`,
      rows.flatMap((row) => [versionId, row.toolId, row.note, now]),
    );
  },
};
