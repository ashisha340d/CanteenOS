import {
  CleaningAssignmentStrategy,
  LIMITS,
  SkillLevel,
  UserRole,
  type CleaningAssignmentRuleDto,
  type CleaningAssignmentRuleWriteRequest,
  type CleaningWorkforceMemberDto,
  type UserAreaResponsibilityDto,
  type UserAreaResponsibilityWriteRequest,
  type UserShiftAssignmentDto,
  type UserShiftAssignmentWriteRequest,
  type UserSkillDto,
  type UserSkillWriteRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import {
  isWithinShift,
  mapCleaningAssignmentRule,
  mapUserAreaResponsibility,
  mapUserShiftAssignment,
  mapUserSkill,
} from '../models/mappers';
import { CleaningMasterRepository } from '../repositories/CleaningMasterRepository';
import { CleaningTaskRepository } from '../repositories/CleaningTaskRepository';
import { CleaningWorkforceRepository } from '../repositories/CleaningWorkforceRepository';
import { userRepository } from '../repositories/UserRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * Who can clean what, when — and the per-area policy the assignment engine follows.
 *
 * These four tables are the difference between an assignment engine that works and one that
 * hands the deep-clean of a mixer to whoever happens to be idle. They are edited from the
 * portal's Workforce tab and read by `CleaningAssignmentService` on every generated task.
 */

/** The roster the cleaning module considers. Super Admin is an account, not a rota member. */
const ROSTER_ROLES: readonly UserRole[] = [UserRole.EMPLOYEE, UserRole.USER, UserRole.MANAGER];

export class CleaningWorkforceService {
  /**
   * The whole roster, as the engine sees it. One page in the portal, so one request.
   *
   * Deliberately not paginated: a canteen's cleaning roster is tens of people, and splitting it
   * would make "who is on shift right now" a question you have to page through.
   */
  async roster(): Promise<CleaningWorkforceMemberDto[]> {
    const pool = getPool();
    const rows = await userRepository.findActiveByRoles(pool, ROSTER_ROLES);

    const members: CleaningWorkforceMemberDto[] = [];
    for (const user of rows) {
      const [skills, shifts, areas, openTaskCount, overdueTaskCount] = await Promise.all([
        CleaningWorkforceRepository.listUserSkills(pool, user.id),
        CleaningWorkforceRepository.listUserShifts(pool, user.id),
        CleaningWorkforceRepository.listUserAreas(pool, user.id),
        CleaningTaskRepository.countOpenForUser(pool, user.id),
        CleaningTaskRepository.count(pool, {
          assignedTo: user.id,
          overdueOnly: true,
          limit: 1,
          offset: 0,
        }),
      ]);

      const shiftDtos = shifts.map(mapUserShiftAssignment);
      members.push({
        userId: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        skills: skills.map(mapUserSkill),
        shifts: shiftDtos,
        areas: areas.map(mapUserAreaResponsibility),
        openTaskCount,
        overdueTaskCount,
        onShiftNow: shiftDtos.some(
          (shift) =>
            shift.isCurrent &&
            shift.shiftStartsAt !== undefined &&
            shift.shiftEndsAt !== undefined &&
            isWithinShift(shift.shiftStartsAt, shift.shiftEndsAt),
        ),
      });
    }
    return members;
  }

  /* --------------------------------------------------------------------- skills */

  async listUserSkills(userId: string): Promise<UserSkillDto[]> {
    const rows = await CleaningWorkforceRepository.listUserSkills(getPool(), userId);
    return rows.map(mapUserSkill);
  }

  async grantSkill(
    userId: string,
    input: UserSkillWriteRequest,
    actor: AuditActor,
  ): Promise<UserSkillDto[]> {
    await withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);
      const skill = await CleaningMasterRepository.findSkill(connection, input.skillId);
      if (skill === null) throw new NotFoundError('Skill', input.skillId);
      if (
        input.certifiedAt !== undefined &&
        input.certifiedAt !== null &&
        input.certifiedUntil !== undefined &&
        input.certifiedUntil !== null &&
        input.certifiedUntil < input.certifiedAt
      ) {
        throw new ValidationError('A certificate cannot expire before it was issued');
      }

      await CleaningWorkforceRepository.upsertUserSkill(connection, {
        userId,
        skillId: input.skillId,
        level: input.level ?? SkillLevel.BASIC,
        certifiedAt: input.certifiedAt ?? null,
        certifiedUntil: input.certifiedUntil ?? null,
        note: (input.note ?? null)?.slice(0, LIMITS.SKILL_NOTE_MAX) ?? null,
        grantedBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_SKILL_GRANTED,
        entityType: 'user_skill',
        entityId: userId,
        after: { skillId: input.skillId, skill: skill.name, level: input.level ?? SkillLevel.BASIC },
      });
    });
    return this.listUserSkills(userId);
  }

  async revokeSkill(userId: string, skillId: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const removed = await CleaningWorkforceRepository.removeUserSkill(connection, userId, skillId);
      if (!removed) throw new NotFoundError('Skill grant', skillId);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_SKILL_REVOKED,
        entityType: 'user_skill',
        entityId: userId,
        before: { skillId },
      });
    });
  }

  /* --------------------------------------------------------------------- shifts */

  async listUserShifts(userId: string): Promise<UserShiftAssignmentDto[]> {
    const rows = await CleaningWorkforceRepository.listUserShifts(getPool(), userId);
    return rows.map(mapUserShiftAssignment);
  }

  async assignShift(
    userId: string,
    input: UserShiftAssignmentWriteRequest,
    actor: AuditActor,
  ): Promise<UserShiftAssignmentDto[]> {
    if (
      input.effectiveTo !== undefined &&
      input.effectiveTo !== null &&
      input.effectiveTo < input.effectiveFrom
    ) {
      throw new ValidationError('A shift assignment cannot end before it starts');
    }
    await withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);
      const shift = await CleaningMasterRepository.findShift(connection, input.shiftId);
      if (shift === null) throw new NotFoundError('Shift', input.shiftId);

      await CleaningWorkforceRepository.insertUserShift(connection, {
        id: newId(),
        userId,
        shiftId: input.shiftId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_SHIFT_ASSIGNED,
        entityType: 'user_shift_assignment',
        entityId: userId,
        after: { shiftId: input.shiftId, shift: shift.name, from: input.effectiveFrom },
      });
    });
    return this.listUserShifts(userId);
  }

  async removeShift(userId: string, assignmentId: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const removed = await CleaningWorkforceRepository.removeUserShift(connection, assignmentId);
      if (!removed) throw new NotFoundError('Shift assignment', assignmentId);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_SHIFT_UNASSIGNED,
        entityType: 'user_shift_assignment',
        entityId: userId,
        before: { assignmentId },
      });
    });
  }

  /* ------------------------------------------------------------ area ownership */

  async listUserAreas(userId: string): Promise<UserAreaResponsibilityDto[]> {
    const rows = await CleaningWorkforceRepository.listUserAreas(getPool(), userId);
    return rows.map(mapUserAreaResponsibility);
  }

  async listAreaResponsibles(areaId: string): Promise<UserAreaResponsibilityDto[]> {
    const rows = await CleaningWorkforceRepository.listAreaResponsibles(getPool(), areaId);
    return rows.map(mapUserAreaResponsibility);
  }

  async setAreaResponsibility(
    userId: string,
    input: UserAreaResponsibilityWriteRequest,
    actor: AuditActor,
  ): Promise<UserAreaResponsibilityDto[]> {
    await withTransaction(async (connection) => {
      const user = await userRepository.findById(connection, userId);
      if (user === null) throw new NotFoundError('User', userId);
      await CleaningWorkforceRepository.upsertUserArea(connection, {
        userId,
        areaId: input.areaId,
        isPrimary: input.isPrimary ?? false,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_AREA_RESPONSIBILITY_SET,
        entityType: 'user_area_responsibility',
        entityId: userId,
        after: { areaId: input.areaId, isPrimary: input.isPrimary ?? false },
      });
    });
    return this.listUserAreas(userId);
  }

  async removeAreaResponsibility(
    userId: string,
    areaId: string,
    actor: AuditActor,
  ): Promise<void> {
    await withTransaction(async (connection) => {
      const removed = await CleaningWorkforceRepository.removeUserArea(connection, userId, areaId);
      if (!removed) throw new NotFoundError('Area responsibility', areaId);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_AREA_RESPONSIBILITY_REMOVED,
        entityType: 'user_area_responsibility',
        entityId: userId,
        before: { areaId },
      });
    });
  }

  /* ------------------------------------------------------------ assignment rules */

  async listAssignmentRules(): Promise<CleaningAssignmentRuleDto[]> {
    const rows = await CleaningWorkforceRepository.listAssignmentRules(getPool());
    return rows.map(mapCleaningAssignmentRule);
  }

  /**
   * Saves the policy for one area, or the global fallback when `areaId` is null.
   *
   * Upserted rather than created-then-edited: there is at most one policy per area by
   * definition, and forcing a caller to discover whether one already exists would only invite
   * two policies for one area through a race.
   */
  async saveAssignmentRule(
    input: CleaningAssignmentRuleWriteRequest,
    actor: AuditActor,
  ): Promise<CleaningAssignmentRuleDto> {
    const maxOpen = input.maxOpenTasks ?? 10;
    if (maxOpen < 1 || maxOpen > LIMITS.CLEANING_MAX_OPEN_TASKS_CEILING) {
      throw new ValidationError(
        `The open-task ceiling must be between 1 and ${LIMITS.CLEANING_MAX_OPEN_TASKS_CEILING}`,
      );
    }

    const id = await withTransaction(async (connection) => {
      const existing = (await CleaningWorkforceRepository.listAssignmentRules(connection)).find(
        (row) => row.area_id === (input.areaId ?? null),
      );
      const ruleId = existing?.id ?? newId();
      await CleaningWorkforceRepository.upsertAssignmentRule(connection, {
        id: ruleId,
        areaId: input.areaId ?? null,
        strategy: input.strategy ?? CleaningAssignmentStrategy.PRIMARY_RESPONSIBLE_FIRST,
        requireSkillMatch: input.requireSkillMatch ?? true,
        requireShiftMatch: input.requireShiftMatch ?? true,
        requireAreaMatch: input.requireAreaMatch ?? false,
        maxOpenTasks: maxOpen,
        allowRelaxedFallback: input.allowRelaxedFallback ?? false,
        isActive: input.isActive ?? true,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_ASSIGNMENT_POLICY_SAVED,
        entityType: 'cleaning_assignment_rule',
        entityId: ruleId,
        after: { ...input },
      });
      return ruleId;
    });

    const row = await CleaningWorkforceRepository.findAssignmentRuleById(getPool(), id);
    if (row === null) throw new NotFoundError('Assignment policy', id);
    return mapCleaningAssignmentRule(row);
  }

  async deleteAssignmentRule(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await CleaningWorkforceRepository.findAssignmentRuleById(connection, id);
      if (before === null) throw new NotFoundError('Assignment policy', id);
      if (before.area_id === null) {
        throw new ConflictError(
          'The global assignment policy cannot be deleted. Edit it, or switch it off.',
        );
      }
      await CleaningWorkforceRepository.removeAssignmentRule(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.CLEANING_ASSIGNMENT_POLICY_DELETED,
        entityType: 'cleaning_assignment_rule',
        entityId: id,
        before: { areaId: before.area_id, strategy: before.strategy },
      });
    });
  }
}

export const cleaningWorkforceService = new CleaningWorkforceService();
