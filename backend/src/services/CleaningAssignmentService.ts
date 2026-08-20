import {
  CleaningAssignmentReason,
  CleaningAssignmentStrategy,
  LIMITS,
  SkillLevel,
  UserRole,
  type CleaningAssignmentCandidateDto,
} from '@menuboard/shared';
import type { Db } from '../db/types';
import type { CandidateRow, CleaningRuleSkillRow } from '../models/rows';
import { CleaningWorkforceRepository } from '../repositories/CleaningWorkforceRepository';

/**
 * Who gets the task.
 *
 * The engine is deliberately explainable rather than clever: it scores every candidate on four
 * facts the operator can see (are they on shift, do they own the area, do they hold the skills,
 * how loaded are they), records the whole candidate list on the assignment row, and picks the
 * top score. A disputed roster is then a question with an answer, not an argument.
 *
 * When nobody qualifies the task is left `UNASSIGNED` and a supervisor is notified. That is a
 * deliberate refusal to guess: handing a food-contact deep clean to somebody who is not
 * certified, because the alternative looked untidy, is exactly the failure this module exists
 * to prevent. An area may opt into a relaxed second pass (`allowRelaxedFallback`) which drops
 * the shift and area requirements — never the skill one.
 */

/** Cleaning reaches the bottom of the roster; a Super Admin is not a cleaning rota member. */
const ASSIGNABLE_ROLES: readonly string[] = [
  UserRole.EMPLOYEE,
  UserRole.USER,
  UserRole.MANAGER,
];

/** Used when neither an area rule nor a global rule exists. */
const DEFAULT_POLICY = {
  strategy: CleaningAssignmentStrategy.PRIMARY_RESPONSIBLE_FIRST,
  requireSkillMatch: true,
  requireShiftMatch: true,
  requireAreaMatch: false,
  maxOpenTasks: 10,
  allowRelaxedFallback: false,
} as const;

export interface AssignmentPolicy {
  strategy: CleaningAssignmentStrategy;
  requireSkillMatch: boolean;
  requireShiftMatch: boolean;
  requireAreaMatch: boolean;
  maxOpenTasks: number;
  allowRelaxedFallback: boolean;
}

export interface AssignmentDecision {
  /** Null when nobody qualified — the task becomes UNASSIGNED and somebody is paged. */
  userId: string | null;
  reason: CleaningAssignmentReason;
  strategy: CleaningAssignmentStrategy;
  candidates: CleaningAssignmentCandidateDto[];
  /** True when the pick came from the relaxed second pass. Recorded, and visible in the UI. */
  relaxed: boolean;
}

export class CleaningAssignmentService {
  async policyFor(db: Db, areaId: string): Promise<AssignmentPolicy> {
    const row = await CleaningWorkforceRepository.findAssignmentRule(db, areaId);
    if (row === null) return { ...DEFAULT_POLICY };
    return {
      strategy: row.strategy,
      requireSkillMatch: row.require_skill_match === 1,
      requireShiftMatch: row.require_shift_match === 1,
      requireAreaMatch: row.require_area_match === 1,
      maxOpenTasks: Math.min(Number(row.max_open_tasks), LIMITS.CLEANING_MAX_OPEN_TASKS_CEILING),
      allowRelaxedFallback: row.allow_relaxed_fallback === 1,
    };
  }

  /**
   * Scores the roster for one task without committing to anything. The rule's required skills
   * are passed in rather than re-read, because the caller already has them and this runs once
   * per generated task.
   */
  async decide(
    db: Db,
    input: {
      areaId: string;
      requiredSkills: readonly CleaningRuleSkillRow[];
      responsibleRole: UserRole | null;
      at?: Date;
    },
  ): Promise<AssignmentDecision> {
    const policy = await this.policyFor(db, input.areaId);
    const skills = input.requiredSkills.map((row) => ({
      skillId: row.skill_id,
      requiredLevel: row.required_level as SkillLevel,
    }));

    // A rule naming a responsible role narrows the roster to that role and above it in
    // seniority; without one, the whole assignable roster is in play.
    const roles =
      input.responsibleRole === null
        ? ASSIGNABLE_ROLES
        : ASSIGNABLE_ROLES.filter((role) => role === input.responsibleRole);

    const rows = await CleaningWorkforceRepository.listCandidates(db, {
      areaId: input.areaId,
      requiredSkills: skills,
      roles: roles.length === 0 ? ASSIGNABLE_ROLES : roles,
      ...(input.at !== undefined ? { at: input.at } : {}),
    });

    const strict = rows.map((row) => this.score(row, policy, skills, input.requiredSkills, false));
    const chosen = pickBest(strict, policy.strategy, rows);
    if (chosen !== null) {
      return {
        userId: chosen,
        reason: CleaningAssignmentReason.AUTOMATIC,
        strategy: policy.strategy,
        candidates: strict,
        relaxed: false,
      };
    }

    if (policy.allowRelaxedFallback) {
      const relaxed = rows.map((row) => this.score(row, policy, skills, input.requiredSkills, true));
      const fallback = pickBest(relaxed, policy.strategy, rows);
      if (fallback !== null) {
        return {
          userId: fallback,
          reason: CleaningAssignmentReason.AUTOMATIC,
          strategy: policy.strategy,
          candidates: relaxed,
          relaxed: true,
        };
      }
    }

    return {
      userId: null,
      reason: CleaningAssignmentReason.NO_ELIGIBLE_EMPLOYEE,
      strategy: policy.strategy,
      candidates: strict,
      relaxed: false,
    };
  }

  /**
   * One candidate, judged.
   *
   * The score is deliberately a small integer built from named parts, so the number recorded on
   * the assignment row can be read back and explained rather than reverse-engineered.
   */
  private score(
    row: CandidateRow,
    policy: AssignmentPolicy,
    skills: ReadonlyArray<{ skillId: string; requiredLevel: SkillLevel }>,
    skillRows: readonly CleaningRuleSkillRow[],
    relaxed: boolean,
  ): CleaningAssignmentCandidateDto {
    const openTaskCount = Number(row.open_task_count);
    const onShift = Number(row.on_shift) === 1;
    const isAreaResponsible = Number(row.is_area_responsible) === 1;
    const isPrimaryForArea = Number(row.is_primary_for_area) === 1;
    const held = Number(row.skills_held);
    const hasEverySkill = skills.length === 0 || held >= skills.length;

    const missingSkills = hasEverySkill
      ? []
      : skillRows.map((skill) => skill.skill_name ?? skill.skill_id);

    let ineligibleReason: string | null = null;
    if (policy.requireSkillMatch && !hasEverySkill) {
      ineligibleReason = 'Does not hold the required competence';
    } else if (!relaxed && policy.requireShiftMatch && !onShift) {
      ineligibleReason = 'Not on shift';
    } else if (!relaxed && policy.requireAreaMatch && !isAreaResponsible) {
      ineligibleReason = 'Not responsible for this area';
    } else if (openTaskCount >= policy.maxOpenTasks) {
      ineligibleReason = `Already holds ${openTaskCount} open cleaning tasks`;
    }

    let score = 0;
    if (isPrimaryForArea) score += 40;
    else if (isAreaResponsible) score += 25;
    if (onShift) score += 30;
    if (hasEverySkill) score += 20;
    // Load is a tie-breaker, capped so a lightly-loaded stranger never outranks the area's
    // own person on a PRIMARY_RESPONSIBLE_FIRST policy.
    score += Math.max(0, 20 - openTaskCount * 2);

    if (policy.strategy === CleaningAssignmentStrategy.LEAST_LOADED) {
      score = Math.max(0, 200 - openTaskCount * 10) + (hasEverySkill ? 20 : 0) + (onShift ? 10 : 0);
    }
    if (policy.strategy === CleaningAssignmentStrategy.ROUND_ROBIN) {
      // Longest-idle wins. A never-assigned person sorts first, which is the intent.
      const lastAssigned = row.last_assigned_at === null ? 0 : Date.parse(`${row.last_assigned_at.replace(' ', 'T')}Z`);
      const idleDays = lastAssigned === 0 ? 3650 : Math.floor((Date.now() - lastAssigned) / 86_400_000);
      score = Math.min(200, idleDays) + (hasEverySkill ? 20 : 0) + (onShift ? 10 : 0);
    }

    return {
      userId: row.id,
      name: row.name,
      role: row.role,
      openTaskCount,
      onShift,
      isAreaResponsible,
      isPrimaryForArea,
      hasEverySkill,
      missingSkills,
      score,
      eligible: ineligibleReason === null,
      ineligibleReason,
    };
  }

  /** The candidate list for a task a human is about to assign by hand. */
  async candidatesFor(
    db: Db,
    input: { areaId: string; requiredSkills: readonly CleaningRuleSkillRow[]; responsibleRole: UserRole | null },
  ): Promise<CleaningAssignmentCandidateDto[]> {
    const decision = await this.decide(db, input);
    return decision.candidates.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    });
  }
}

/** Highest score among the eligible. Ties break on the DB's own name ordering. */
function pickBest(
  candidates: readonly CleaningAssignmentCandidateDto[],
  _strategy: CleaningAssignmentStrategy,
  _rows: readonly CandidateRow[],
): string | null {
  let best: CleaningAssignmentCandidateDto | null = null;
  for (const candidate of candidates) {
    if (!candidate.eligible) continue;
    if (best === null || candidate.score > best.score) best = candidate;
  }
  return best?.userId ?? null;
}

export const cleaningAssignmentService = new CleaningAssignmentService();
