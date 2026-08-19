import { describe, expect, it } from 'vitest';

import {
  CALENDAR_FREQUENCY_KINDS,
  CLEANING_TASK_ACTIONABLE_STATUSES,
  CLEANING_TASK_OPEN_STATUSES,
  CLEANING_TASK_TERMINAL_STATUSES,
  CLEANING_TASK_TRANSITIONS,
  Capability,
  CleaningFrequencyKind,
  CleaningTaskStatus,
  PUBLISHABLE_TRIGGER_EVENTS,
  ROLE_CAPABILITIES,
  SkillLevel,
  CleaningTriggerEvent,
  UserRole,
  canTransitionCleaningTask,
  isCleaningTaskOpen,
  isCleaningTaskTerminal,
  skillLevelMeets,
} from '../src';

const ALL_STATUSES = Object.values(CleaningTaskStatus);

describe('cleaning task state machine', () => {
  it('declares a transition list for every status, so no status is unreachable by omission', () => {
    for (const status of ALL_STATUSES) {
      expect(CLEANING_TASK_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('never permits a transition to a status outside the enum', () => {
    for (const status of ALL_STATUSES) {
      for (const next of CLEANING_TASK_TRANSITIONS[status]) {
        expect(ALL_STATUSES).toContain(next);
      }
    }
  });

  it('walks the normal path PLANNED -> ASSIGNED -> STARTED -> COMPLETED -> ... -> CLOSED', () => {
    const path = [
      CleaningTaskStatus.PLANNED,
      CleaningTaskStatus.ASSIGNED,
      CleaningTaskStatus.STARTED,
      CleaningTaskStatus.COMPLETED,
      CleaningTaskStatus.VERIFICATION_REQUIRED,
      CleaningTaskStatus.VERIFIED,
      CleaningTaskStatus.CLOSED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      const from = path[i] as CleaningTaskStatus;
      const to = path[i + 1] as CleaningTaskStatus;
      expect(canTransitionCleaningTask(from, to)).toBe(true);
    }
  });

  it('walks the no-verification path COMPLETED -> CLOSED', () => {
    expect(canTransitionCleaningTask(CleaningTaskStatus.COMPLETED, CleaningTaskStatus.CLOSED)).toBe(
      true,
    );
  });

  it('walks the failure path FAILED -> RECLEAN -> RECLEANED -> REVERIFY -> VERIFIED -> CLOSED', () => {
    const path = [
      CleaningTaskStatus.VERIFICATION_REQUIRED,
      CleaningTaskStatus.FAILED,
      CleaningTaskStatus.RECLEAN_REQUIRED,
      CleaningTaskStatus.RECLEANED,
      CleaningTaskStatus.REVERIFICATION_REQUIRED,
      CleaningTaskStatus.VERIFIED,
      CleaningTaskStatus.CLOSED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      const from = path[i] as CleaningTaskStatus;
      const to = path[i + 1] as CleaningTaskStatus;
      expect(canTransitionCleaningTask(from, to)).toBe(true);
    }
  });

  it('allows a second failure, so a task that fails its recheck can be recleaned again', () => {
    expect(
      canTransitionCleaningTask(
        CleaningTaskStatus.REVERIFICATION_REQUIRED,
        CleaningTaskStatus.FAILED,
      ),
    ).toBe(true);
  });

  it('lets nothing leave a terminal status', () => {
    for (const status of CLEANING_TASK_TERMINAL_STATUSES) {
      expect(CLEANING_TASK_TRANSITIONS[status]).toEqual([]);
      expect(isCleaningTaskTerminal(status)).toBe(true);
      for (const target of ALL_STATUSES) {
        expect(canTransitionCleaningTask(status, target)).toBe(false);
      }
    }
  });

  it('refuses the shortcuts a careless screen would try', () => {
    // Skipping the work entirely.
    expect(canTransitionCleaningTask(CleaningTaskStatus.PLANNED, CleaningTaskStatus.COMPLETED)).toBe(
      false,
    );
    // Marking a task verified without anybody completing it.
    expect(canTransitionCleaningTask(CleaningTaskStatus.ASSIGNED, CleaningTaskStatus.VERIFIED)).toBe(
      false,
    );
    // Closing a task that failed its check, which would bury the failure.
    expect(canTransitionCleaningTask(CleaningTaskStatus.FAILED, CleaningTaskStatus.CLOSED)).toBe(
      false,
    );
    // Passing a task straight from "needs recleaning" without recleaning it.
    expect(
      canTransitionCleaningTask(CleaningTaskStatus.RECLEAN_REQUIRED, CleaningTaskStatus.VERIFIED),
    ).toBe(false);
    // Reopening a closed occurrence rather than raising the next one.
    expect(canTransitionCleaningTask(CleaningTaskStatus.CLOSED, CleaningTaskStatus.STARTED)).toBe(
      false,
    );
  });

  it('can always reach a terminal status from every non-terminal status', () => {
    // Guards against a state that traps a task forever, which would strand real work.
    for (const start of ALL_STATUSES) {
      const seen = new Set<CleaningTaskStatus>([start]);
      const queue: CleaningTaskStatus[] = [start];
      let reachedTerminal = false;
      while (queue.length > 0) {
        const current = queue.shift() as CleaningTaskStatus;
        if (isCleaningTaskTerminal(current)) {
          reachedTerminal = true;
          break;
        }
        for (const next of CLEANING_TASK_TRANSITIONS[current]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(reachedTerminal).toBe(true);
    }
  });

  it('treats every non-terminal status as open, and no terminal status as open', () => {
    for (const status of ALL_STATUSES) {
      expect(isCleaningTaskOpen(status)).toBe(!isCleaningTaskTerminal(status));
    }
    expect(CLEANING_TASK_OPEN_STATUSES.length + CLEANING_TASK_TERMINAL_STATUSES.length).toBe(
      ALL_STATUSES.length,
    );
  });

  it('only calls a status actionable when the operator can move it forward', () => {
    for (const status of CLEANING_TASK_ACTIONABLE_STATUSES) {
      expect(CLEANING_TASK_TRANSITIONS[status].length).toBeGreaterThan(0);
      expect(isCleaningTaskTerminal(status)).toBe(false);
    }
  });
});

describe('cleaning trigger events', () => {
  it('never lets a client publish SCHEDULE_DUE, which only the sweep may raise', () => {
    expect(PUBLISHABLE_TRIGGER_EVENTS).not.toContain(CleaningTriggerEvent.SCHEDULE_DUE);
  });

  it('exposes every other trigger for publication', () => {
    const all = Object.values(CleaningTriggerEvent);
    expect(PUBLISHABLE_TRIGGER_EVENTS.length).toBe(all.length - 1);
    for (const event of all) {
      if (event !== CleaningTriggerEvent.SCHEDULE_DUE) {
        expect(PUBLISHABLE_TRIGGER_EVENTS).toContain(event);
      }
    }
  });
});

describe('cleaning frequency kinds', () => {
  it('classifies only the kinds a scheduler can compute a date for as calendar kinds', () => {
    expect(CALENDAR_FREQUENCY_KINDS).toContain(CleaningFrequencyKind.DAILY);
    expect(CALENDAR_FREQUENCY_KINDS).toContain(CleaningFrequencyKind.WEEKLY);
    expect(CALENDAR_FREQUENCY_KINDS).toContain(CleaningFrequencyKind.MONTHLY);
    expect(CALENDAR_FREQUENCY_KINDS).toContain(CleaningFrequencyKind.PERIODIC);
    expect(CALENDAR_FREQUENCY_KINDS).toContain(CleaningFrequencyKind.PER_SHIFT);
  });

  it('keeps every event-driven kind out of the calendar set', () => {
    const eventDriven = [
      CleaningFrequencyKind.AFTER_EVERY_USE,
      CleaningFrequencyKind.AFTER_EVERY_BATCH,
      CleaningFrequencyKind.AFTER_PRODUCTION_CYCLE,
      CleaningFrequencyKind.AFTER_CONTAMINATION,
      CleaningFrequencyKind.AFTER_SPILL,
      CleaningFrequencyKind.AFTER_MAINTENANCE,
      CleaningFrequencyKind.CONDITION_BASED,
    ];
    for (const kind of eventDriven) {
      expect(CALENDAR_FREQUENCY_KINDS).not.toContain(kind);
    }
    // Together they must account for every kind, or the generator would silently ignore one.
    expect(CALENDAR_FREQUENCY_KINDS.length + eventDriven.length).toBe(
      Object.values(CleaningFrequencyKind).length,
    );
  });
});

describe('skill levels', () => {
  it('accepts an equal or higher level and refuses a lower one', () => {
    expect(skillLevelMeets(SkillLevel.BASIC, SkillLevel.BASIC)).toBe(true);
    expect(skillLevelMeets(SkillLevel.EXPERT, SkillLevel.BASIC)).toBe(true);
    expect(skillLevelMeets(SkillLevel.COMPETENT, SkillLevel.COMPETENT)).toBe(true);
    expect(skillLevelMeets(SkillLevel.BASIC, SkillLevel.COMPETENT)).toBe(false);
    expect(skillLevelMeets(SkillLevel.COMPETENT, SkillLevel.EXPERT)).toBe(false);
  });
});

describe('cleaning capability matrix', () => {
  const employee = ROLE_CAPABILITIES[UserRole.EMPLOYEE];
  const user = ROLE_CAPABILITIES[UserRole.USER];
  const manager = ROLE_CAPABILITIES[UserRole.MANAGER];
  const admin = ROLE_CAPABILITIES[UserRole.ADMIN];
  const superAdmin = ROLE_CAPABILITIES[UserRole.SUPER_ADMIN];

  it('lets an Employee see, do and report cleaning work', () => {
    expect(employee).toContain(Capability.CLEANING_VIEW);
    expect(employee).toContain(Capability.CLEANING_WORK);
    expect(employee).toContain(Capability.CLEANING_REPORT_INCIDENT);
  });

  it('never lets an Employee verify their own work or configure the system', () => {
    expect(employee).not.toContain(Capability.CLEANING_VERIFY);
    expect(employee).not.toContain(Capability.CLEANING_ASSIGN);
    expect(employee).not.toContain(Capability.CLEANING_RULE_MANAGE);
    expect(employee).not.toContain(Capability.CLEANING_PROCEDURE_MANAGE);
    expect(employee).not.toContain(Capability.CLEANING_CHEMICAL_MANAGE);
    expect(employee).not.toContain(Capability.CLEANING_ASSET_MANAGE);
    expect(employee).not.toContain(Capability.CLEANING_WORKFORCE_MANAGE);
    expect(employee).not.toContain(Capability.CLEANING_EVENT_PUBLISH);
    expect(employee).not.toContain(Capability.CLEANING_COMPLIANCE_VIEW);
    expect(employee).not.toContain(Capability.CLEANING_DELETE);
  });

  it('gives a User exactly the Employee cleaning grants and nothing more', () => {
    expect(user).toContain(Capability.CLEANING_WORK);
    expect(user).not.toContain(Capability.CLEANING_VERIFY);
    expect(user).not.toContain(Capability.CLEANING_DELETE);
  });

  it('gives a Manager verification, assignment and every configuration grant', () => {
    for (const capability of [
      Capability.CLEANING_VERIFY,
      Capability.CLEANING_ASSIGN,
      Capability.CLEANING_ASSET_MANAGE,
      Capability.CLEANING_RULE_MANAGE,
      Capability.CLEANING_PROCEDURE_MANAGE,
      Capability.CLEANING_CHEMICAL_MANAGE,
      Capability.CLEANING_CORRECTIVE_ACTION_MANAGE,
      Capability.CLEANING_WORKFORCE_MANAGE,
      Capability.CLEANING_EVENT_PUBLISH,
      Capability.CLEANING_COMPLIANCE_VIEW,
    ]) {
      expect(manager).toContain(capability);
    }
  });

  it('withholds deletion from a Manager and grants it to an Admin', () => {
    expect(manager).not.toContain(Capability.CLEANING_DELETE);
    expect(admin).toContain(Capability.CLEANING_DELETE);
  });

  it('keeps the tiers nested, so no cleaning grant is given to a Manager but lost to an Admin', () => {
    for (const capability of manager) {
      expect(admin).toContain(capability);
    }
    for (const capability of employee) {
      expect(user).toContain(capability);
    }
  });

  it('gives Super Admin every cleaning capability an Admin holds', () => {
    const cleaningAdmin = admin.filter((c) => c.startsWith('cleaning.'));
    for (const capability of cleaningAdmin) {
      expect(superAdmin).toContain(capability);
    }
  });

  it('grants no cleaning capability to nobody, so none was declared and forgotten', () => {
    const declared = Object.values(Capability).filter((c) => c.startsWith('cleaning.'));
    const granted = new Set<string>([
      ...employee,
      ...user,
      ...manager,
      ...admin,
      ...superAdmin,
    ]);
    for (const capability of declared) {
      expect(granted.has(capability)).toBe(true);
    }
    expect(declared.length).toBe(14);
  });
});
