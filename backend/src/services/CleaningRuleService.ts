import {
  CALENDAR_FREQUENCY_KINDS,
  CleaningEventSource,
  CleaningRuleScope,
  CleaningTaskPriority,
  CleaningTriggerEvent,
  SkillLevel,
  type CleaningRuleDto,
  type CleaningRuleListQuery,
  type CleaningRulePreviewDto,
  type CleaningRuleUpdateRequest,
  type CleaningRuleWriteRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapCleanableAsset, mapCleaningRule } from '../models/mappers';
import type { CleaningRuleRow } from '../models/rows';
import { CleanableAssetRepository } from '../repositories/CleanableAssetRepository';
import { CleaningProcedureRepository } from '../repositories/CleaningProcedureRepository';
import { CleaningRuleRepository, type RuleFilter } from '../repositories/CleaningRuleRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { toDbTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { cleaningEngineService } from './CleaningEngineService';
import { cleaningReportService } from './CleaningReportService';

/**
 * Cleaning rules — the configuration the whole module runs on.
 *
 * The validation here is the interesting part. The database enforces the scope shape and the
 * PERIODIC/verification pairings with CHECK constraints, but a constraint violation is a 500
 * with an opaque message. Every one of them is checked first, in words the person filling in
 * the form can act on, and the constraints remain the backstop.
 *
 * `preview` exists because a rule that reaches no asset is the module's commonest configuration
 * mistake and is completely invisible until the day nothing gets cleaned.
 */

/** Frequencies that come due on the calendar always subscribe to the sweep's own event. */
function triggersFor(
  frequencyKind: CleaningRuleWriteRequest['frequencyKind'],
  requested: readonly CleaningTriggerEvent[] | undefined,
): CleaningTriggerEvent[] {
  const explicit = [...(requested ?? [])];
  if (CALENDAR_FREQUENCY_KINDS.includes(frequencyKind)) {
    if (!explicit.includes(CleaningTriggerEvent.SCHEDULE_DUE)) {
      explicit.push(CleaningTriggerEvent.SCHEDULE_DUE);
    }
    return explicit;
  }
  // An event-driven rule with no trigger would never fire. Default it to the event its own
  // frequency names, so the commonest configuration needs no second decision.
  if (explicit.length > 0) return explicit;
  const implied: Partial<Record<string, CleaningTriggerEvent>> = {
    AFTER_EVERY_USE: CleaningTriggerEvent.EQUIPMENT_USED,
    AFTER_EVERY_BATCH: CleaningTriggerEvent.BATCH_COMPLETED,
    AFTER_PRODUCTION_CYCLE: CleaningTriggerEvent.PRODUCTION_COMPLETED,
    AFTER_CONTAMINATION: CleaningTriggerEvent.CONTAMINATION_REPORTED,
    AFTER_SPILL: CleaningTriggerEvent.SPILL_REPORTED,
    AFTER_MAINTENANCE: CleaningTriggerEvent.MAINTENANCE_COMPLETED,
    CONDITION_BASED: CleaningTriggerEvent.MANUAL_TRIGGER,
  };
  const fallback = implied[frequencyKind];
  return fallback === undefined ? [CleaningTriggerEvent.MANUAL_TRIGGER] : [fallback];
}

export class CleaningRuleService {
  async list(query: CleaningRuleListQuery) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: RuleFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.scope !== undefined ? { scope: query.scope } : {}),
      ...(query.areaId !== undefined ? { areaId: query.areaId } : {}),
      ...(query.assetTypeId !== undefined ? { assetTypeId: query.assetTypeId } : {}),
      ...(query.cleanableAssetId !== undefined
        ? { cleanableAssetId: query.cleanableAssetId }
        : {}),
      ...(query.procedureId !== undefined ? { procedureId: query.procedureId } : {}),
      ...(query.frequencyKind !== undefined ? { frequencyKind: query.frequencyKind } : {}),
      ...(query.priority !== undefined ? { priority: query.priority } : {}),
      ...(query.includeInactive !== undefined ? { includeInactive: query.includeInactive } : {}),
      ...(query.problemsOnly !== undefined ? { problemsOnly: query.problemsOnly } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      CleaningRuleRepository.list(pool, filter),
      CleaningRuleRepository.count(pool, filter),
    ]);
    const skills = await CleaningRuleRepository.listSkillsForRules(
      pool,
      rows.map((row) => row.id),
    );
    const items = rows.map((row) =>
      mapCleaningRule(
        row,
        skills.filter((skill) => skill.rule_id === row.id),
      ),
    );
    return buildPage(items, total, page, pageSize);
  }

  async getById(id: string): Promise<CleaningRuleDto> {
    const pool = getPool();
    const row = await CleaningRuleRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Cleaning rule', id);
    const skills = await CleaningRuleRepository.listSkills(pool, id);
    const dto = mapCleaningRule(row, skills);
    dto.targetAssetCount = (await this.targetsFor(pool, row)).length;
    return dto;
  }

  async create(input: CleaningRuleWriteRequest, actor: AuditActor): Promise<CleaningRuleDto> {
    this.assertShape(input);
    const id = newId();
    await withTransaction(async (connection) => {
      const existing = await CleaningRuleRepository.findByCode(connection, input.code);
      if (existing !== null) throw new ConflictError(`Rule code "${input.code}" is already in use`);

      const procedure = await CleaningProcedureRepository.findById(connection, input.procedureId);
      if (procedure === null) throw new NotFoundError('Cleaning procedure', input.procedureId);

      await CleaningRuleRepository.insert(connection, {
        id,
        code: input.code,
        taskName: input.taskName,
        purpose: input.purpose ?? null,
        scope: input.scope,
        cleanableAssetId: input.scope === CleaningRuleScope.ASSET ? (input.cleanableAssetId ?? null) : null,
        assetTypeId: input.scope === CleaningRuleScope.ASSET ? null : (input.assetTypeId ?? null),
        areaId: input.scope === CleaningRuleScope.ASSET_TYPE_IN_AREA ? (input.areaId ?? null) : null,
        procedureId: input.procedureId,
        frequencyKind: input.frequencyKind,
        intervalDays: input.intervalDays ?? null,
        dayOfWeek: input.dayOfWeek ?? null,
        dayOfMonth: input.dayOfMonth ?? null,
        shiftId: input.shiftId ?? null,
        dueTime: input.dueTime === undefined || input.dueTime === null ? null : toDbTime(input.dueTime),
        dueWithinMinutes: input.dueWithinMinutes ?? null,
        responsibleRole: input.responsibleRole ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        priority: input.priority ?? CleaningTaskPriority.NORMAL,
        requiresVerification: input.requiresVerification ?? false,
        verificationMethod: input.verificationMethod ?? null,
        verifierRole: input.verifierRole ?? null,
        standardId: input.standardId ?? null,
        isActive: input.isActive ?? true,
        createdBy: actor.userId,
      });

      await CleaningRuleRepository.replaceTriggers(
        connection,
        id,
        triggersFor(input.frequencyKind, input.triggers),
      );
      await CleaningRuleRepository.replaceSkills(
        connection,
        id,
        (input.requiredSkills ?? []).map((skill) => ({
          skillId: skill.skillId,
          requiredLevel: skill.requiredLevel ?? SkillLevel.BASIC,
        })),
      );

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_RULE_CREATED,
        entityType: 'cleaning_rule',
        entityId: id,
        after: { code: input.code, taskName: input.taskName, scope: input.scope },
      });
    });
    return this.getById(id);
  }

  async update(
    id: string,
    input: CleaningRuleUpdateRequest,
    actor: AuditActor,
  ): Promise<CleaningRuleDto> {
    await withTransaction(async (connection) => {
      const before = await CleaningRuleRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Cleaning rule', id);

      // A partial write is validated as the whole rule it would produce, not as the fields it
      // happens to carry: changing the scope alone can invalidate an untouched column.
      const merged: CleaningRuleWriteRequest = {
        code: input.code ?? before.code,
        taskName: input.taskName ?? before.task_name,
        scope: input.scope ?? before.scope,
        cleanableAssetId:
          input.cleanableAssetId !== undefined ? input.cleanableAssetId : before.cleanable_asset_id,
        assetTypeId: input.assetTypeId !== undefined ? input.assetTypeId : before.asset_type_id,
        areaId: input.areaId !== undefined ? input.areaId : before.area_id,
        procedureId: input.procedureId ?? before.procedure_id,
        frequencyKind: input.frequencyKind ?? before.frequency_kind,
        intervalDays: input.intervalDays !== undefined ? input.intervalDays : before.interval_days,
        requiresVerification:
          input.requiresVerification !== undefined
            ? input.requiresVerification
            : before.requires_verification === 1,
        verificationMethod:
          input.verificationMethod !== undefined
            ? input.verificationMethod
            : before.verification_method,
      };
      this.assertShape(merged);

      if (input.code !== undefined && input.code !== before.code) {
        const clash = await CleaningRuleRepository.findByCode(connection, input.code);
        if (clash !== null && clash.id !== id) {
          throw new ConflictError(`Rule code "${input.code}" is already in use`);
        }
      }

      const assignments: string[] = [];
      const params: unknown[] = [];
      const push = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
      };

      if (input.code !== undefined) push('code', input.code);
      if (input.taskName !== undefined) push('task_name', input.taskName);
      if (input.purpose !== undefined) push('purpose', input.purpose);
      if (input.scope !== undefined) {
        // The three scope columns move together — the CHECK constraint refuses any other shape.
        push('scope', merged.scope);
        push(
          'cleanable_asset_id',
          merged.scope === CleaningRuleScope.ASSET ? merged.cleanableAssetId : null,
        );
        push('asset_type_id', merged.scope === CleaningRuleScope.ASSET ? null : merged.assetTypeId);
        push(
          'area_id',
          merged.scope === CleaningRuleScope.ASSET_TYPE_IN_AREA ? merged.areaId : null,
        );
      } else {
        if (input.cleanableAssetId !== undefined) push('cleanable_asset_id', input.cleanableAssetId);
        if (input.assetTypeId !== undefined) push('asset_type_id', input.assetTypeId);
        if (input.areaId !== undefined) push('area_id', input.areaId);
      }
      if (input.procedureId !== undefined) push('procedure_id', input.procedureId);
      if (input.frequencyKind !== undefined) push('frequency_kind', input.frequencyKind);
      if (input.intervalDays !== undefined) push('interval_days', input.intervalDays);
      if (input.dayOfWeek !== undefined) push('day_of_week', input.dayOfWeek);
      if (input.dayOfMonth !== undefined) push('day_of_month', input.dayOfMonth);
      if (input.shiftId !== undefined) push('shift_id', input.shiftId);
      if (input.dueTime !== undefined) {
        push('due_time', input.dueTime === null ? null : toDbTime(input.dueTime));
      }
      if (input.dueWithinMinutes !== undefined) push('due_within_minutes', input.dueWithinMinutes);
      if (input.responsibleRole !== undefined) push('responsible_role', input.responsibleRole);
      if (input.estimatedMinutes !== undefined) push('estimated_minutes', input.estimatedMinutes);
      if (input.priority !== undefined) push('priority', input.priority);
      if (input.requiresVerification !== undefined) {
        push('requires_verification', input.requiresVerification);
      }
      if (input.verificationMethod !== undefined) {
        push('verification_method', input.verificationMethod);
      }
      if (input.verifierRole !== undefined) push('verifier_role', input.verifierRole);
      if (input.standardId !== undefined) push('standard_id', input.standardId);
      if (input.isActive !== undefined) push('is_active', input.isActive);

      await CleaningRuleRepository.update(connection, id, assignments, params);

      if (input.triggers !== undefined || input.frequencyKind !== undefined) {
        await CleaningRuleRepository.replaceTriggers(
          connection,
          id,
          triggersFor(merged.frequencyKind, input.triggers),
        );
      }
      if (input.requiredSkills !== undefined) {
        await CleaningRuleRepository.replaceSkills(
          connection,
          id,
          input.requiredSkills.map((skill) => ({
            skillId: skill.skillId,
            requiredLevel: skill.requiredLevel ?? SkillLevel.BASIC,
          })),
        );
      }

      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_RULE_UPDATED,
        entityType: 'cleaning_rule',
        entityId: id,
        before: {
          code: before.code,
          scope: before.scope,
          frequencyKind: before.frequency_kind,
          isActive: before.is_active === 1,
        },
        after: { ...input },
      });
    });
    return this.getById(id);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await CleaningRuleRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Cleaning rule', id);
      if (Number(before.open_task_count ?? 0) > 0) {
        throw new ConflictError(
          'That rule still has open tasks. Close or cancel them before deleting it.',
        );
      }
      await CleaningRuleRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_RULE_DELETED,
        entityType: 'cleaning_rule',
        entityId: id,
        before: { code: before.code, taskName: before.task_name },
      });
    });
  }

  /**
   * What this rule would raise right now, and what is stopping it.
   *
   * Shown beside the rule in both clients, because "reaches 0 assets" and "the procedure was
   * never published" are the two ways a rule silently does nothing.
   */
  async preview(id: string, userId: string): Promise<CleaningRulePreviewDto> {
    const pool = getPool();
    const rule = await CleaningRuleRepository.findById(pool, id);
    if (rule === null) throw new NotFoundError('Cleaning rule', id);

    const targets = await this.targetsFor(pool, rule);
    const blockers: string[] = [];

    const version = await CleaningProcedureRepository.findPublishedVersion(
      pool,
      rule.procedure_id,
    );
    if (version === null) {
      blockers.push('Its procedure has no published version, so it cannot raise any work.');
    }
    if (rule.is_active !== 1) blockers.push('The rule is switched off.');
    if (targets.length === 0) {
      blockers.push('It currently reaches no available cleanable asset.');
    }

    const now = new Date();
    const occurrenceKey = cleaningEngineService.occurrenceKeyFor(rule, now);
    const nextDueAt =
      occurrenceKey === null ? null : cleaningEngineService.dueAtFor(rule, now);

    return {
      ruleId: rule.id,
      taskName: rule.task_name,
      targets: targets.map((row) => {
        const dto = mapCleanableAsset(row, userId);
        return {
          id: dto.id,
          code: dto.code,
          name: dto.name,
          ...(dto.areaName !== undefined ? { areaName: dto.areaName } : {}),
          ...(dto.locationPath !== undefined ? { locationPath: dto.locationPath } : {}),
        };
      }),
      nextDueAt: nextDueAt === null ? null : nextDueAt.toISOString(),
      blockers,
    };
  }

  /**
   * Runs the rule now, by hand.
   *
   * Goes through the event log like everything else, so a manually-run rule is as explainable
   * afterwards as an automatic one.
   */
  async runNow(id: string, actor: AuditActor, userId: string) {
    const pool = getPool();
    const rule = await CleaningRuleRepository.findById(pool, id);
    if (rule === null) throw new NotFoundError('Cleaning rule', id);

    const result = await cleaningReportService.publishEvent(
      {
        eventType: CleaningTriggerEvent.MANUAL_TRIGGER,
        source: CleaningEventSource.ADMIN,
        ...(rule.cleanable_asset_id !== null
          ? { cleanableAssetId: rule.cleanable_asset_id }
          : {}),
        ...(rule.area_id !== null ? { areaId: rule.area_id } : {}),
        ...(rule.asset_type_id !== null ? { assetTypeId: rule.asset_type_id } : {}),
        note: `Run by hand: ${rule.code}`,
      },
      actor,
      userId,
      { allowFallback: false },
    );

    await withTransaction(async (connection) => {
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_RULE_RUN,
        entityType: 'cleaning_rule',
        entityId: id,
        after: { tasksCreated: result.tasks.length },
      });
    });

    return result;
  }

  private async targetsFor(db: Db, rule: CleaningRuleRow) {
    return CleanableAssetRepository.listForRuleScope(db, {
      cleanableAssetId: rule.cleanable_asset_id,
      assetTypeId: rule.asset_type_id,
      areaId: rule.area_id,
    });
  }

  /** The three pairings the database also enforces, phrased for the person filling in a form. */
  private assertShape(input: {
    scope: CleaningRuleWriteRequest['scope'];
    cleanableAssetId?: string | null;
    assetTypeId?: string | null;
    areaId?: string | null;
    frequencyKind: CleaningRuleWriteRequest['frequencyKind'];
    intervalDays?: number | null;
    requiresVerification?: boolean;
    verificationMethod?: CleaningRuleWriteRequest['verificationMethod'];
  }): void {
    if (input.scope === CleaningRuleScope.ASSET) {
      if (input.cleanableAssetId === undefined || input.cleanableAssetId === null) {
        throw new ValidationError('Choose the asset this rule applies to');
      }
    } else if (input.assetTypeId === undefined || input.assetTypeId === null) {
      throw new ValidationError('Choose the asset type this rule applies to');
    }
    if (input.scope === CleaningRuleScope.ASSET_TYPE_IN_AREA) {
      if (input.areaId === undefined || input.areaId === null) {
        throw new ValidationError('Choose the area this rule applies to');
      }
    }
    if (input.frequencyKind === 'PERIODIC') {
      if (input.intervalDays === undefined || input.intervalDays === null || input.intervalDays < 1) {
        throw new ValidationError('Say how many days apart a periodic rule comes due');
      }
    }
    if (input.requiresVerification === true) {
      if (input.verificationMethod === undefined || input.verificationMethod === null) {
        throw new ValidationError('Choose how a completed clean is checked');
      }
    }
  }
}

export const cleaningRuleService = new CleaningRuleService();
