import { CaptureSource, type MaintenanceActivityType, type UserRole } from '@menuboard/shared';
import type { Db } from '../db/types';
import { MaintenanceRepository } from '../repositories/MaintenanceRepository';
import { newId } from '../utils/ids';
import { toJsonColumn } from '../utils/json';

/**
 * The operator-facing timeline.
 *
 * Separate from `audit_logs`, which stays the security record: a cook reads "Supplier called",
 * not a before/after JSON diff. Four services write to it (equipment, maintenance, suppliers,
 * floor plans), so the prose is composed here — once — rather than by each caller's client,
 * which is how the phone and the portal would otherwise end up wording the same event
 * differently.
 *
 * Always called on the caller's connection, inside the transaction that caused the event, so
 * an activity row can never describe something that did not commit.
 */

export interface ActivityActor {
  userId: string | null;
  role: UserRole | null;
}

export interface ActivityInput {
  equipmentId: string;
  ticketId?: string | null;
  type: MaintenanceActivityType;
  /** One line, already written for display. */
  summary: string;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: CaptureSource;
}

export const maintenanceActivityService = {
  async record(db: Db, actor: ActivityActor, input: ActivityInput): Promise<void> {
    await MaintenanceRepository.insertActivity(db, {
      id: newId(),
      equipmentId: input.equipmentId,
      ticketId: input.ticketId ?? null,
      type: input.type,
      summary: input.summary,
      detail: input.detail ?? null,
      metadata: toJsonColumn(input.metadata ?? null),
      actorId: actor.userId,
      actorRole: actor.role,
      source: input.source ?? CaptureSource.MANUAL,
    });
  },
};
