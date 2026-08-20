import {
  CleaningProcedureVersionStatus,
  LIMITS,
  type CleaningProcedureDto,
  type CleaningProcedureVersionDto,
  type CleaningProcedureVersionWriteRequest,
  type CleaningProcedureWriteRequest,
  type PageQuery,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapCleaningProcedure, mapCleaningProcedureVersion } from '../models/mappers';
import type { CleaningProcedureVersionRow } from '../models/rows';
import {
  CleaningProcedureRepository,
  type ProcedureFilter,
  type ProcedureStepInsert,
} from '../repositories/CleaningProcedureRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * Cleaning procedures and their versions.
 *
 * The publication ladder is the whole point:
 *
 *  - A procedure starts with no version and cannot be used by any rule.
 *  - `saveDraft` creates or overwrites the single DRAFT — a working copy nobody is following.
 *  - `publish` promotes the draft, archives whatever was published before, and points the
 *    procedure at it. From that moment new tasks pin the new version; tasks already raised keep
 *    pointing at the old one, which is why archived versions are never deleted.
 *
 * A published version is immutable. Editing one means starting a new draft, which is exactly
 * what a hygiene auditor expects of a controlled document.
 */

export interface ProcedureListQuery extends PageQuery {
  includeInactive?: boolean;
  publishedOnly?: boolean;
}

export class CleaningProcedureService {
  async list(query: ProcedureListQuery) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: ProcedureFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.includeInactive !== undefined ? { includeInactive: query.includeInactive } : {}),
      ...(query.publishedOnly !== undefined ? { publishedOnly: query.publishedOnly } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      CleaningProcedureRepository.list(pool, filter),
      CleaningProcedureRepository.count(pool, filter),
    ]);
    return buildPage(rows.map(mapCleaningProcedure), total, page, pageSize);
  }

  async getById(id: string): Promise<CleaningProcedureDto> {
    const pool = getPool();
    const row = await CleaningProcedureRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Cleaning procedure', id);
    const versions = await CleaningProcedureRepository.listVersions(pool, id);
    return {
      ...mapCleaningProcedure(row),
      versions: await Promise.all(versions.map((version) => this.hydrateVersion(pool, version))),
    };
  }

  async getVersion(id: string): Promise<CleaningProcedureVersionDto> {
    const pool = getPool();
    const row = await CleaningProcedureRepository.findVersion(pool, id);
    if (row === null) throw new NotFoundError('Procedure version', id);
    return this.hydrateVersion(pool, row);
  }

  private async hydrateVersion(
    db: Db,
    row: CleaningProcedureVersionRow,
  ): Promise<CleaningProcedureVersionDto> {
    const [steps, chemicals, tools] = await Promise.all([
      CleaningProcedureRepository.listSteps(db, row.id),
      CleaningProcedureRepository.listVersionChemicals(db, row.id),
      CleaningProcedureRepository.listVersionTools(db, row.id),
    ]);
    return mapCleaningProcedureVersion(row, { steps, chemicals, tools });
  }

  async create(
    input: CleaningProcedureWriteRequest,
    actor: AuditActor,
  ): Promise<CleaningProcedureDto> {
    const id = newId();
    return withTransaction(async (connection) => {
      if (await CleaningProcedureRepository.codeExists(connection, input.code)) {
        throw new ConflictError(`Procedure code "${input.code}" is already in use`);
      }
      await CleaningProcedureRepository.insert(connection, {
        id,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_PROCEDURE_CREATED,
        entityType: 'cleaning_procedure',
        entityId: id,
        after: { ...input },
      });
      const row = await CleaningProcedureRepository.findById(connection, id);
      if (row === null) throw new NotFoundError('Cleaning procedure', id);
      return mapCleaningProcedure(row);
    });
  }

  async update(
    id: string,
    input: Partial<CleaningProcedureWriteRequest>,
    actor: AuditActor,
  ): Promise<CleaningProcedureDto> {
    return withTransaction(async (connection) => {
      const before = await CleaningProcedureRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Cleaning procedure', id);
      if (input.code !== undefined && input.code !== before.code) {
        if (await CleaningProcedureRepository.codeExists(connection, input.code, id)) {
          throw new ConflictError(`Procedure code "${input.code}" is already in use`);
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
      if (input.description !== undefined) {
        assignments.push('description = ?');
        params.push(input.description);
      }
      if (input.status !== undefined) {
        assignments.push('status = ?');
        params.push(input.status);
      }
      await CleaningProcedureRepository.update(connection, id, assignments, params);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_PROCEDURE_UPDATED,
        entityType: 'cleaning_procedure',
        entityId: id,
        before: { code: before.code, name: before.name, status: before.status },
        after: { ...input },
      });
      const row = await CleaningProcedureRepository.findById(connection, id);
      if (row === null) throw new NotFoundError('Cleaning procedure', id);
      return mapCleaningProcedure(row);
    });
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await CleaningProcedureRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Cleaning procedure', id);
      if (Number(before.rule_count ?? 0) > 0) {
        throw new ConflictError('That procedure is still used by cleaning rules');
      }
      await CleaningProcedureRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_PROCEDURE_DELETED,
        entityType: 'cleaning_procedure',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /**
   * Creates the procedure's draft, or replaces the one that is already open.
   *
   * Steps, chemicals and tools arrive whole and replace what was there. A procedure is read as
   * an ordered list, and patching step 4 of a version whose step 3 somebody else deleted is a
   * race with no useful answer.
   */
  async saveDraft(
    procedureId: string,
    input: CleaningProcedureVersionWriteRequest,
    actor: AuditActor,
  ): Promise<CleaningProcedureVersionDto> {
    if (input.steps !== undefined) this.assertSteps(input.steps);

    const versionId = await withTransaction(async (connection) => {
      const procedure = await CleaningProcedureRepository.findById(connection, procedureId);
      if (procedure === null) throw new NotFoundError('Cleaning procedure', procedureId);

      let draft = await CleaningProcedureRepository.findDraft(connection, procedureId);
      if (draft === null) {
        const id = newId();
        const version = await CleaningProcedureRepository.nextVersionNumber(
          connection,
          procedureId,
        );
        await CleaningProcedureRepository.insertVersion(connection, {
          id,
          procedureId,
          version,
          methodId: input.methodId ?? null,
          standardId: input.standardId ?? null,
          changeNote: input.changeNote ?? null,
          ppeRequired: input.ppeRequired ?? null,
          requiresDisassembly: input.requiresDisassembly ?? false,
          requiresRinse: input.requiresRinse ?? false,
          requiresFinalRinse: input.requiresFinalRinse ?? false,
          requiresDrying: input.requiresDrying ?? false,
          contactTimeSeconds: input.contactTimeSeconds ?? null,
          estimatedMinutes: input.estimatedMinutes ?? null,
          safetyNotes: input.safetyNotes ?? null,
          createdBy: actor.userId,
        });
        draft = await CleaningProcedureRepository.findVersion(connection, id);
        if (draft === null) throw new NotFoundError('Procedure version', id);
      } else {
        const columns: Record<string, string> = {
          methodId: 'method_id',
          standardId: 'standard_id',
          changeNote: 'change_note',
          ppeRequired: 'ppe_required',
          requiresDisassembly: 'requires_disassembly',
          requiresRinse: 'requires_rinse',
          requiresFinalRinse: 'requires_final_rinse',
          requiresDrying: 'requires_drying',
          contactTimeSeconds: 'contact_time_seconds',
          estimatedMinutes: 'estimated_minutes',
          safetyNotes: 'safety_notes',
        };
        const assignments: string[] = [];
        const params: unknown[] = [];
        for (const [field, column] of Object.entries(columns)) {
          const value = (input as Record<string, unknown>)[field];
          if (value === undefined) continue;
          assignments.push(`${column} = ?`);
          params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
        }
        await CleaningProcedureRepository.updateVersion(
          connection,
          draft.id,
          assignments,
          params,
        );
      }

      if (input.steps !== undefined) {
        const steps: ProcedureStepInsert[] = input.steps.map((step, index) => ({
          id: newId(),
          versionId: draft.id,
          // Renumbered from the submitted order, so a client cannot leave a gap or a duplicate.
          stepNumber: index + 1,
          title: step.title,
          instruction: step.instruction ?? null,
          chemicalId: step.chemicalId ?? null,
          toolId: step.toolId ?? null,
          durationSeconds: step.durationSeconds ?? null,
          isMandatory: step.isMandatory ?? true,
          requiresPhoto: step.requiresPhoto ?? false,
        }));
        await CleaningProcedureRepository.replaceSteps(connection, draft.id, steps);
      }

      if (input.chemicals !== undefined) {
        await CleaningProcedureRepository.replaceVersionChemicals(
          connection,
          draft.id,
          input.chemicals.map((chemical) => ({
            chemicalId: chemical.chemicalId,
            concentrationPpm: chemical.concentrationPpm ?? null,
            dilutionRatio: chemical.dilutionRatio ?? null,
            contactTimeSeconds: chemical.contactTimeSeconds ?? null,
            note: chemical.note ?? null,
          })),
        );
      }

      if (input.tools !== undefined) {
        await CleaningProcedureRepository.replaceVersionTools(
          connection,
          draft.id,
          input.tools.map((tool) => ({ toolId: tool.toolId, note: tool.note ?? null })),
        );
      }

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_PROCEDURE_VERSION_SAVED,
        entityType: 'cleaning_procedure_version',
        entityId: draft.id,
        after: { procedureId, version: draft.version, steps: input.steps?.length ?? undefined },
      });

      return draft.id;
    });

    return this.getVersion(versionId);
  }

  /** Promotes the draft. From here it is a controlled document and cannot be edited again. */
  async publish(
    procedureId: string,
    actor: AuditActor,
  ): Promise<CleaningProcedureVersionDto> {
    const versionId = await withTransaction(async (connection) => {
      const procedure = await CleaningProcedureRepository.findById(connection, procedureId);
      if (procedure === null) throw new NotFoundError('Cleaning procedure', procedureId);
      const draft = await CleaningProcedureRepository.findDraft(connection, procedureId);
      if (draft === null) throw new ConflictError('There is no draft to publish');

      const steps = await CleaningProcedureRepository.listSteps(connection, draft.id);
      if (steps.length === 0) {
        throw new ValidationError('A procedure needs at least one step before it can be published');
      }

      await CleaningProcedureRepository.setVersionStatus(
        connection,
        draft.id,
        CleaningProcedureVersionStatus.PUBLISHED,
        actor.userId,
      );
      await CleaningProcedureRepository.archiveOtherPublished(connection, procedureId, draft.id);
      await CleaningProcedureRepository.setCurrentVersion(connection, procedureId, draft.id);

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_PROCEDURE_PUBLISHED,
        entityType: 'cleaning_procedure_version',
        entityId: draft.id,
        after: { procedureId, version: draft.version, steps: steps.length },
      });
      return draft.id;
    });
    return this.getVersion(versionId);
  }

  /** Starts a new draft from a published version, so an edit begins with what is in force. */
  async cloneToDraft(
    procedureId: string,
    actor: AuditActor,
  ): Promise<CleaningProcedureVersionDto> {
    const versionId = await withTransaction(async (connection) => {
      const procedure = await CleaningProcedureRepository.findById(connection, procedureId);
      if (procedure === null) throw new NotFoundError('Cleaning procedure', procedureId);
      const existingDraft = await CleaningProcedureRepository.findDraft(connection, procedureId);
      if (existingDraft !== null) return existingDraft.id;

      const source = await CleaningProcedureRepository.findPublishedVersion(
        connection,
        procedureId,
      );
      if (source === null) {
        throw new ConflictError('There is no published version to copy');
      }

      const id = newId();
      const version = await CleaningProcedureRepository.nextVersionNumber(connection, procedureId);
      await CleaningProcedureRepository.insertVersion(connection, {
        id,
        procedureId,
        version,
        methodId: source.method_id,
        standardId: source.standard_id,
        changeNote: null,
        ppeRequired: source.ppe_required,
        requiresDisassembly: source.requires_disassembly === 1,
        requiresRinse: source.requires_rinse === 1,
        requiresFinalRinse: source.requires_final_rinse === 1,
        requiresDrying: source.requires_drying === 1,
        contactTimeSeconds: source.contact_time_seconds,
        estimatedMinutes: source.estimated_minutes,
        safetyNotes: source.safety_notes,
        createdBy: actor.userId,
      });

      const [steps, chemicals, tools] = await Promise.all([
        CleaningProcedureRepository.listSteps(connection, source.id),
        CleaningProcedureRepository.listVersionChemicals(connection, source.id),
        CleaningProcedureRepository.listVersionTools(connection, source.id),
      ]);
      await CleaningProcedureRepository.replaceSteps(
        connection,
        id,
        steps.map((step) => ({
          id: newId(),
          versionId: id,
          stepNumber: Number(step.step_number),
          title: step.title,
          instruction: step.instruction,
          chemicalId: step.chemical_id,
          toolId: step.tool_id,
          durationSeconds: step.duration_seconds,
          isMandatory: step.is_mandatory === 1,
          requiresPhoto: step.requires_photo === 1,
        })),
      );
      await CleaningProcedureRepository.replaceVersionChemicals(
        connection,
        id,
        chemicals.map((chemical) => ({
          chemicalId: chemical.chemical_id,
          concentrationPpm: chemical.concentration_ppm,
          dilutionRatio: chemical.dilution_ratio,
          contactTimeSeconds: chemical.contact_time_seconds,
          note: chemical.note,
        })),
      );
      await CleaningProcedureRepository.replaceVersionTools(
        connection,
        id,
        tools.map((tool) => ({ toolId: tool.tool_id, note: tool.note })),
      );

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_PROCEDURE_VERSION_SAVED,
        entityType: 'cleaning_procedure_version',
        entityId: id,
        after: { procedureId, version, clonedFrom: source.version },
      });
      return id;
    });
    return this.getVersion(versionId);
  }

  async discardDraft(procedureId: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const draft = await CleaningProcedureRepository.findDraft(connection, procedureId);
      if (draft === null) throw new NotFoundError('Draft version', procedureId);
      await CleaningProcedureRepository.deleteVersion(connection, draft.id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_PROCEDURE_ARCHIVED,
        entityType: 'cleaning_procedure_version',
        entityId: draft.id,
        before: { procedureId, version: draft.version },
      });
    });
  }

  private assertSteps(steps: readonly { title: string }[]): void {
    if (steps.length > LIMITS.CLEANING_STEPS_PER_VERSION_MAX) {
      throw new ValidationError(
        `A procedure may have at most ${LIMITS.CLEANING_STEPS_PER_VERSION_MAX} steps`,
      );
    }
  }
}

export const cleaningProcedureService = new CleaningProcedureService();
