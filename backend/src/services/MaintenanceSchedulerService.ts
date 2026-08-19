import {
  CaptureSource,
  MAINTENANCE_FREQUENCY_LABELS,
  MaintenanceActivityType,
  MaintenancePriority,
  MaintenanceRequestKind,
  NotificationType,
  UserRole,
  WARRANTY_EXPIRING_DAYS,
  type NotificationDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import type { MaintenanceScheduleRow } from '../models/rows';
import { EquipmentRepository } from '../repositories/EquipmentRepository';
import { MaintenanceRepository } from '../repositories/MaintenanceRepository';
import { notificationRepository } from '../repositories/NotificationRepository';
import { userRepository } from '../repositories/UserRepository';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { toDbDateTime, todayIsoDate } from '../utils/time';
import { type AuditActor } from './AuditService';
import { maintenanceActivityService } from './MaintenanceActivityService';
import { notificationService } from './NotificationService';

/**
 * The preventive-maintenance sweep: turns schedules that have fallen due into tickets, and
 * raises the due / overdue / warranty reminders.
 *
 * Everything here is idempotent, because the sweep runs on a timer and on demand and may run
 * twice in a day:
 *
 *  - a schedule already covered by an open ticket raises nothing
 *    (`listDueSchedulesWithoutTicket` does that filtering in SQL);
 *  - a reminder already sent inside its own window is not sent again
 *    (`existsForSubjectSince`).
 *
 * There is no job table. The schedules themselves are the queue, which is what makes a missed
 * run harmless: the next one picks up exactly what the last one would have done.
 */

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A canteen does not have thousands of assets; this is a guard, not a page size. */
const SWEEP_BATCH = 200;

const ESCALATION_ROLES: readonly UserRole[] = [
  UserRole.MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

/** The sweep acts on nobody's behalf; its rows are attributed to the system. */
const SYSTEM_ACTOR: AuditActor = {
  userId: null,
  role: null,
  ip: null,
  userAgent: null,
  requestId: null,
};

export interface SweepResult {
  ticketsRaised: number;
  remindersSent: number;
  overdueEscalated: number;
  warrantiesFlagged: number;
}

export class MaintenanceSchedulerService {
  private timer: NodeJS.Timeout | null = null;

  /** Started from server.ts alongside the other background work. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.runQuietly();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
    void this.runQuietly();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async runQuietly(): Promise<void> {
    try {
      const result = await this.sweep();
      if (
        result.ticketsRaised > 0 ||
        result.remindersSent > 0 ||
        result.overdueEscalated > 0 ||
        result.warrantiesFlagged > 0
      ) {
        logger.info('Maintenance sweep complete', { ...result });
      }
    } catch (error) {
      logger.error('Maintenance sweep failed', undefined, error);
    }
  }

  async sweep(): Promise<SweepResult> {
    const pool = getPool();
    const escalation = await userRepository.findActiveByRoles(pool, ESCALATION_ROLES);
    const escalationIds = escalation.map((user) => user.id);

    const raised = await this.raiseDueTickets(escalationIds);
    const reminders = await this.sendReminders(pool);
    const warranties = await this.flagWarranties(pool, escalationIds);

    notificationService.publish([
      ...raised.notifications,
      ...reminders.notifications,
      ...warranties.notifications,
    ]);

    return {
      ticketsRaised: raised.count,
      remindersSent: reminders.count,
      overdueEscalated: raised.overdue,
      warrantiesFlagged: warranties.count,
    };
  }

  /** Due schedules become SCHEDULED tickets — one per schedule, never a duplicate. */
  private async raiseDueTickets(
    escalationIds: readonly string[],
  ): Promise<{ count: number; overdue: number; notifications: NotificationDto[] }> {
    const due = await MaintenanceRepository.listDueSchedulesWithoutTicket(getPool(), SWEEP_BATCH);
    if (due.length === 0) return { count: 0, overdue: 0, notifications: [] };

    const fallbackReporter = await this.systemReporter(getPool());
    const notifications: NotificationDto[] = [];
    let count = 0;
    let overdue = 0;

    for (const schedule of due) {
      const reporter = schedule.assigned_to ?? schedule.created_by ?? fallbackReporter;
      if (reporter === null) {
        logger.warn('Skipping due maintenance schedule: no user to attribute the ticket to', {
          scheduleId: schedule.id,
        });
        continue;
      }

      const isOverdue = schedule.next_due_at.slice(0, 10) < todayIsoDate();
      const raisedNotifications = await withTransaction(async (connection) =>
        this.raiseTicketFor(connection, schedule, reporter, isOverdue, escalationIds),
      );

      notifications.push(...raisedNotifications);
      count += 1;
      if (isOverdue) overdue += 1;
    }

    return { count, overdue, notifications };
  }

  private async raiseTicketFor(
    db: PoolConnection,
    schedule: MaintenanceScheduleRow,
    reporterId: string,
    isOverdue: boolean,
    escalationIds: readonly string[],
  ): Promise<NotificationDto[]> {
    const businessDate = todayIsoDate();
    const sequence = await MaintenanceRepository.nextDailySequence(db, businessDate);
    const ticketNumber = `MTK-${businessDate.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`;
    const id = newId();
    const title = `${schedule.title} — ${schedule.equipment_name ?? 'equipment'}`;

    await MaintenanceRepository.insertTicket(db, {
      id,
      ticketNumber,
      businessDate,
      dailySequence: sequence,
      equipmentId: schedule.equipment_id,
      kind: MaintenanceRequestKind.SCHEDULED,
      // An overdue service outranks a merely due one; neither is CRITICAL, because a
      // preventive job that nobody has looked at is not a machine that has stopped.
      priority: isOverdue ? MaintenancePriority.HIGH : MaintenancePriority.NORMAL,
      title,
      description: schedule.instructions,
      problemCategory: null,
      reportedBy: reporterId,
      supplierId: schedule.supplier_id,
      scheduleId: schedule.id,
      capturedVia: CaptureSource.SYSTEM,
    });

    if (schedule.assigned_to !== null) {
      await MaintenanceRepository.updateTicket(
        db,
        id,
        ['assigned_to = ?'],
        [schedule.assigned_to],
      );
    }

    await maintenanceActivityService.record(db, SYSTEM_ACTOR, {
      equipmentId: schedule.equipment_id,
      ticketId: id,
      type: MaintenanceActivityType.PROBLEM_REPORTED,
      summary: `${ticketNumber} raised automatically: ${MAINTENANCE_FREQUENCY_LABELS[schedule.frequency].toLowerCase()} service due`,
      detail: schedule.instructions,
      metadata: { scheduleId: schedule.id, dueAt: schedule.next_due_at, overdue: isOverdue },
      source: CaptureSource.SYSTEM,
    });
    await EquipmentRepository.refreshTicketCounters(db, schedule.equipment_id);

    const recipients =
      schedule.assigned_to === null ? escalationIds : [schedule.assigned_to, ...escalationIds];
    return notificationService.notify(db, {
      userIds: recipients,
      type: isOverdue ? NotificationType.MAINTENANCE_OVERDUE : NotificationType.MAINTENANCE_DUE,
      title: isOverdue ? `Overdue: ${title}` : `Due now: ${title}`,
      body: `${schedule.asset_id ?? ''} · ${ticketNumber}`.trim(),
      data: {
        ticketId: id,
        equipmentId: schedule.equipment_id,
        scheduleId: schedule.id,
        ticketNumber,
      },
    });
  }

  /**
   * Advance warning for a service that is coming but not yet due — the point of
   * `reminder_days`. One reminder per schedule per window, never a daily drip.
   */
  private async sendReminders(
    db: Db,
  ): Promise<{ count: number; notifications: NotificationDto[] }> {
    const upcoming = await MaintenanceRepository.listSchedulesNeedingReminder(db, SWEEP_BATCH);
    const notifications: NotificationDto[] = [];
    let count = 0;

    for (const schedule of upcoming) {
      const windowStart = toDbDateTime(
        new Date(Date.now() - Math.max(1, Number(schedule.reminder_days)) * 86_400_000),
      );
      const alreadySent = await notificationRepository.existsForSubjectSince(
        db,
        NotificationType.MAINTENANCE_DUE,
        schedule.id,
        windowStart,
      );
      if (alreadySent) continue;

      const recipients =
        schedule.assigned_to === null
          ? (await userRepository.findActiveByRoles(db, ESCALATION_ROLES)).map((user) => user.id)
          : [schedule.assigned_to];

      const sent = await notificationService.notify(db, {
        userIds: recipients,
        type: NotificationType.MAINTENANCE_DUE,
        title: `${schedule.title} is due on ${schedule.next_due_at.slice(0, 10)}`,
        body: `${schedule.asset_id ?? ''} ${schedule.equipment_name ?? ''}`.trim(),
        data: { scheduleId: schedule.id, equipmentId: schedule.equipment_id },
      });
      notifications.push(...sent);
      if (sent.length > 0) count += 1;
    }

    return { count, notifications };
  }

  /** One notice per asset per warranty window, so a lapse is noticed while it can still be used. */
  private async flagWarranties(
    db: Db,
    escalationIds: readonly string[],
  ): Promise<{ count: number; notifications: NotificationDto[] }> {
    if (escalationIds.length === 0) return { count: 0, notifications: [] };

    const expiring = await EquipmentRepository.list(db, {
      warrantyStatus: 'EXPIRING_SOON',
      excludeRetired: true,
      limit: SWEEP_BATCH,
      offset: 0,
    });
    const windowStart = toDbDateTime(new Date(Date.now() - WARRANTY_EXPIRING_DAYS * 86_400_000));
    const notifications: NotificationDto[] = [];
    let count = 0;

    for (const equipment of expiring) {
      const alreadySent = await notificationRepository.existsForSubjectSince(
        db,
        NotificationType.WARRANTY_EXPIRING,
        equipment.id,
        windowStart,
      );
      if (alreadySent) continue;

      const sent = await notificationService.notify(db, {
        userIds: escalationIds,
        type: NotificationType.WARRANTY_EXPIRING,
        title: `Warranty expiring: ${equipment.name}`,
        body: `${equipment.asset_id} · expires ${(equipment.warranty_expiry ?? '').slice(0, 10)}`,
        data: { equipmentId: equipment.id, warrantyExpiry: equipment.warranty_expiry },
      });
      notifications.push(...sent);
      if (sent.length > 0) count += 1;
    }

    return { count, notifications };
  }

  /**
   * Somebody has to own a system-raised ticket, because `reported_by` is not nullable — a
   * ticket that resolves to no one is a ticket nobody can be asked about. An unassigned
   * schedule falls back to an administrator.
   */
  private async systemReporter(db: Db): Promise<string | null> {
    const admins = await userRepository.findActiveByRoles(db, [
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
    ]);
    return admins[0]?.id ?? null;
  }
}

export const maintenanceSchedulerService = new MaintenanceSchedulerService();
