import {
  CleaningProcedureVersionStatus,
  CleaningRiskLevel,
  CleaningStepStatus,
  CleaningTaskPriority,
  CleaningTaskStatus,
  CorrectiveActionStatus,
  FoodContactClass,
} from '@menuboard/shared';
import type { StatusToneName } from '@/lib/tones';

/**
 * Status → tone for Cleaning & Hygiene.
 *
 * The module contributes another twenty-odd statuses, and they collapse onto the same six
 * tones the rest of the portal uses rather than introducing new colours. A reader learns "red
 * means stopped, amber means moving, green means done" once and it holds everywhere.
 */

export const CLEANING_TASK_STATUS_TONE: Readonly<Record<CleaningTaskStatus, StatusToneName>> = {
  [CleaningTaskStatus.PLANNED]: 'neutral',
  // Amber, not grey: a task nobody could be given is the one status a supervisor must act on.
  [CleaningTaskStatus.UNASSIGNED]: 'progress',
  [CleaningTaskStatus.ASSIGNED]: 'info',
  [CleaningTaskStatus.STARTED]: 'progress',
  [CleaningTaskStatus.COMPLETED]: 'success',
  [CleaningTaskStatus.VERIFICATION_REQUIRED]: 'progress',
  [CleaningTaskStatus.VERIFIED]: 'success',
  [CleaningTaskStatus.FAILED]: 'danger',
  [CleaningTaskStatus.RECLEAN_REQUIRED]: 'danger',
  [CleaningTaskStatus.RECLEANED]: 'success',
  [CleaningTaskStatus.REVERIFICATION_REQUIRED]: 'progress',
  [CleaningTaskStatus.CLOSED]: 'muted',
  [CleaningTaskStatus.CANCELLED]: 'muted',
};

export const CLEANING_PRIORITY_TONE: Readonly<Record<CleaningTaskPriority, StatusToneName>> = {
  [CleaningTaskPriority.LOW]: 'muted',
  [CleaningTaskPriority.NORMAL]: 'neutral',
  [CleaningTaskPriority.HIGH]: 'progress',
  [CleaningTaskPriority.CRITICAL]: 'danger',
};

export const RISK_TONE: Readonly<Record<CleaningRiskLevel, StatusToneName>> = {
  [CleaningRiskLevel.LOW]: 'muted',
  [CleaningRiskLevel.MEDIUM]: 'neutral',
  [CleaningRiskLevel.HIGH]: 'progress',
  [CleaningRiskLevel.CRITICAL]: 'danger',
};

export const FOOD_CONTACT_TONE: Readonly<Record<FoodContactClass, StatusToneName>> = {
  [FoodContactClass.DIRECT]: 'danger',
  [FoodContactClass.INDIRECT]: 'progress',
  [FoodContactClass.NON_FOOD]: 'muted',
};

export const CORRECTIVE_STATUS_TONE: Readonly<Record<CorrectiveActionStatus, StatusToneName>> = {
  [CorrectiveActionStatus.OPEN]: 'danger',
  [CorrectiveActionStatus.IN_PROGRESS]: 'progress',
  [CorrectiveActionStatus.VERIFICATION_PENDING]: 'info',
  [CorrectiveActionStatus.CLOSED]: 'muted',
  [CorrectiveActionStatus.CANCELLED]: 'muted',
};

export const PROCEDURE_VERSION_TONE: Readonly<
  Record<CleaningProcedureVersionStatus, StatusToneName>
> = {
  [CleaningProcedureVersionStatus.DRAFT]: 'progress',
  [CleaningProcedureVersionStatus.PUBLISHED]: 'success',
  [CleaningProcedureVersionStatus.ARCHIVED]: 'muted',
};

export const STEP_STATUS_TONE: Readonly<Record<CleaningStepStatus, StatusToneName>> = {
  [CleaningStepStatus.PENDING]: 'neutral',
  [CleaningStepStatus.DONE]: 'success',
  [CleaningStepStatus.SKIPPED]: 'progress',
};

/** A compliance percentage read as a traffic light. The thresholds are the industry's usual. */
export function complianceTone(rate: number): StatusToneName {
  if (rate >= 95) return 'success';
  if (rate >= 80) return 'progress';
  return 'danger';
}

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * "Due in 2 h" / "40 min overdue" — the form a person actually reads a cleaning deadline in.
 *
 * Minutes below an hour, hours below a day, days after that: a task due in 90 minutes and one
 * due in six days are different kinds of urgent and should not be measured in the same unit.
 */
export function dueLabel(dueAt: string | null | undefined, isOverdue = false): string {
  if (dueAt === null || dueAt === undefined || dueAt === '') return 'No deadline';
  const target = new Date(dueAt).getTime();
  if (Number.isNaN(target)) return dueAt;
  const deltaMinutes = Math.round((target - Date.now()) / 60_000);
  const magnitude = Math.abs(deltaMinutes);
  const amount =
    magnitude < 60
      ? `${magnitude} min`
      : magnitude < 1440
        ? `${Math.round(magnitude / 60)} h`
        : `${Math.round(magnitude / 1440)} d`;
  if (deltaMinutes < 0 || isOverdue) return `${amount} overdue`;
  if (deltaMinutes === 0) return 'Due now';
  return `Due in ${amount}`;
}

/** "1 h 10 min" from a step's declared duration. */
export function durationLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds <= 0) return null;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
