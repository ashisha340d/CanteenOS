import { describe, expect, it } from 'vitest';
import { mapTeamActivity } from '../src/models/mappers';
import type { TeamActivityRow } from '../src/models/rows';

function row(overrides: Partial<TeamActivityRow> = {}): TeamActivityRow {
  return {
    user_id: 'u1',
    name: 'Alex Rivera',
    task_id: null,
    task_title: null,
    task_kind: null,
    task_priority: null,
    started_at: null,
    estimated_minutes: null,
    due_at: null,
    last_task_title: null,
    last_active_at: null,
    ...overrides,
  } as TeamActivityRow;
}

/** DATETIME(3) literal `minutes` ago, in the shape the driver hands back. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 23).replace('T', ' ');
}

describe('mapTeamActivity', () => {
  it('derives two-letter initials from the name', () => {
    expect(mapTeamActivity(row()).initials).toBe('AR');
    expect(mapTeamActivity(row({ name: 'Prakash' })).initials).toBe('P');
    expect(mapTeamActivity(row({ name: 'jamie   van der berg' })).initials).toBe('JB');
  });

  it('reports somebody with no task as free', () => {
    const activity = mapTeamActivity(row());
    expect(activity.status).toBe('FREE');
    expect(activity.freeInMinutes).toBeNull();
  });

  it('reports an active work task as working', () => {
    const activity = mapTeamActivity(
      row({ task_id: 't1', task_title: 'Kitchen Prep', task_kind: 'WORK', started_at: minutesAgo(5) }),
    );
    expect(activity.status).toBe('WORKING');
    expect(activity.currentTaskTitle).toBe('Kitchen Prep');
  });

  it('reports an off-time task as off, not working', () => {
    const activity = mapTeamActivity(
      row({ task_id: 't1', task_title: 'Break', task_kind: 'OFF_TIME', started_at: minutesAgo(5) }),
    );
    expect(activity.status).toBe('OFF');
  });

  it('counts down the remaining minutes of an estimate', () => {
    const activity = mapTeamActivity(
      row({
        task_id: 't1',
        task_kind: 'WORK',
        started_at: minutesAgo(15),
        estimated_minutes: 60,
      }),
    );
    expect(activity.freeInMinutes).toBeGreaterThanOrEqual(44);
    expect(activity.freeInMinutes).toBeLessThanOrEqual(45);
  });

  it('never reports a negative remaining time once an estimate is overrun', () => {
    const activity = mapTeamActivity(
      row({ task_id: 't1', task_kind: 'WORK', started_at: minutesAgo(120), estimated_minutes: 30 }),
    );
    expect(activity.freeInMinutes).toBe(0);
  });

  it('leaves the estimate null rather than guessing when none was given', () => {
    const activity = mapTeamActivity(
      row({ task_id: 't1', task_kind: 'WORK', started_at: minutesAgo(10) }),
    );
    expect(activity.freeInMinutes).toBeNull();
  });
});
