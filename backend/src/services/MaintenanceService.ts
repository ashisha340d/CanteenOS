import {
  CRITICAL_PROBLEM_CATEGORIES,
  CaptureSource,
  EquipmentStatus,
  LIMITS,
  MAINTENANCE_REQUEST_KIND_LABELS,
  MAINTENANCE_TICKET_STATUS_LABELS,
  MaintenanceActivityType,
  MaintenancePriority,
  MaintenanceRequestKind,
  MaintenanceTicketStatus,
  NotificationType,
  PROBLEM_CATEGORY_LABELS,
  ProblemCategory,
  UserRole,
  canTransitionMaintenanceStatus,
  maintenanceIntervalDays,
  type MaintenanceAssignRequest,
  type MaintenanceCompleteRequest,
  type MaintenanceScheduleDto,
  type MaintenanceScheduleWriteRequest,
  type MaintenanceStatusChangeRequest,
  type MaintenanceTicketCreateRequest,
  type MaintenanceTicketDto,
  type MaintenanceTicketListQuery,
  type MaintenanceTicketUpdateRequest,
  type MyMaintenanceDto,
  type NotificationDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import {
  mapMaintenanceActivity,
  mapMaintenanceAssignment,
  mapMaintenanceAttachment,
  mapMaintenanceProblem,
  mapMaintenanceSchedule,
  mapMaintenanceTicket,
} from '../models/mappers';
import type { EquipmentRow, MaintenanceTicketRow } from '../models/rows';
import { EquipmentRepository } from '../repositories/EquipmentRepository';
import {
  MaintenanceRepository,
  type TicketListFilter,
} from '../repositories/MaintenanceRepository';
import { userRepository } from '../repositories/UserRepository';
import { ConflictError, NotFoundError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { addDays, toDbDateTime, todayIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { equipmentService, isHealthyStatus } from './EquipmentService';
import { maintenanceActivityService } from './MaintenanceActivityService';
import { notificationService } from './NotificationService';

/**
 * The maintenance ticket lifecycle, from "the oven is not heating" to a verified, closed job.
 *
 * Three rules run through it:
 *
 *  - **`equipmentId` is the only thing a reporter must supply.** Priority, title, supplier,
 *    location and the ticket number are all resolved here from the asset.
 *  - **`canTransitionMaintenanceStatus` in shared is the only authority on movement.** Both
 *    clients and this service ask the same function, so a button that is enabled on the phone
 *    cannot be refused by the server.
 *  - **Every state change writes the operator timeline and refreshes the asset's counters in
 *    the same transaction.** A ticket that commits without its counter is a dashboard that
 *    lies.
 */

const ACTIVITY_LIMIT = 100;
const MY_LIST_LIMIT = 50;
const DEFAULT_REMINDER_DAYS = 7;

/** Who is told when a fault is raised or escalates. */
const ESCALATION_ROLES: readonly UserRole[] = [
  UserRole.MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

/** Statuses whose arrival means the asset is no longer being worked on. */
const RELEASING_STATUSES: readonly MaintenanceTicketStatus[] = [
  MaintenanceTicketStatus.RESOLVED,
  MaintenanceTicketStatus.VERIFIED,
  MaintenanceTicketStatus.CLOSED,
  MaintenanceTicketStatus.CANCELLED,
];

/** The timeline entry a given arrival deserves; everything else is a plain status change. */
const ACTIVITY_FOR_STATUS: Partial<Record<MaintenanceTicketStatus, MaintenanceActivityType>> = {
  [MaintenanceTicketStatus.SUPPLIER_CONTACTED]: MaintenanceActivityType.SUPPLIER_CONTACTED,
  [MaintenanceTicketStatus.TECHNICIAN_SCHEDULED]: MaintenanceActivityType.TECHNICIAN_VISIT,
  [MaintenanceTicketStatus.WAITING_FOR_PARTS]: MaintenanceActivityType.PARTS_REQUIRED,
  [MaintenanceTicketStatus.RESOLVED]: MaintenanceActivityType.PROBLEM_RESOLVED,
  [MaintenanceTicketStatus.VERIFIED]: MaintenanceActivityType.TICKET_VERIFIED,
  [MaintenanceTicketStatus.CLOSED]: MaintenanceActivityType.TICKET_CLOSED,
};

export class MaintenanceService {
  /* ------------------------------------------------------------------- tickets */

  async list(query: MaintenanceTicketListQuery, userId: string) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: TicketListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.equipmentId !== undefined ? { equipmentId: query.equipmentId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.priority !== undefined ? { priority: query.priority } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.problemCategory !== undefined ? { problemCategory: query.problemCategory } : {}),
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.reportedBy !== undefined ? { reportedBy: query.reportedBy } : {}),
      ...(query.floorId !== undefined ? { floorId: query.floorId } : {}),
      ...(query.areaId !== undefined ? { areaId: query.areaId } : {}),
      ...(query.openOnly !== undefined ? { openOnly: query.openOnly } : {}),
      // `mine` is resolved here rather than by the client, so a phone cannot ask for
      // somebody else's list by editing the query string.
      ...(query.mine === true
        ? { assignedTo: userId }
        : query.assignedTo !== undefined
          ? { assignedTo: query.assignedTo }
          : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      MaintenanceRepository.listTickets(pool, filter),
      MaintenanceRepository.countTickets(pool, filter),
    ]);
    return buildPage(rows.map((row) => mapMaintenanceTicket(row, userId)), total, page, pageSize);
  }

  async getById(id: string, userId: string): Promise<MaintenanceTicketDto> {
    const pool = getPool();
    const row = await MaintenanceRepository.findTicketById(pool, id);
    if (row === null) throw new NotFoundError('Maintenance ticket', id);
    return this.detailFor(pool, row, userId);
  }

  private async detailFor(
    db: Db,
    row: MaintenanceTicketRow,
    userId: string,
  ): Promise<MaintenanceTicketDto> {
    const [problems, attachments, assignments, activities] = await Promise.all([
      MaintenanceRepository.listProblems(db, row.id),
      MaintenanceRepository.listAttachments(db, row.id),
      MaintenanceRepository.listAssignments(db, row.id),
      MaintenanceRepository.listActivities(db, { ticketId: row.id, limit: ACTIVITY_LIMIT }),
    ]);

    return {
      ...mapMaintenanceTicket(row, userId),
      problems: problems.map(mapMaintenanceProblem),
      attachments: attachments.map((attachment) => mapMaintenanceAttachment(attachment, userId)),
      assignments: assignments.map(mapMaintenanceAssignment),
      activities: activities.map(mapMaintenanceActivity),
    };
  }

  /** The phone's landing payload: what is mine, what I reported, what falls due today. */
  async myMaintenance(userId: string): Promise<MyMaintenanceDto> {
    const pool = getPool();
    const [assigned, reported, dueToday] = await Promise.all([
      MaintenanceRepository.listTickets(pool, {
        assignedTo: userId,
        openOnly: true,
        limit: MY_LIST_LIMIT,
        offset: 0,
      }),
      MaintenanceRepository.listTickets(pool, {
        reportedBy: userId,
        openOnly: true,
        limit: MY_LIST_LIMIT,
        offset: 0,
      }),
      MaintenanceRepository.listSchedules(pool, {
        assignedTo: userId,
        dueBefore: todayIsoDate(),
        limit: MY_LIST_LIMIT,
        offset: 0,
      }),
    ]);

    return {
      assigned: assigned.map((row) => mapMaintenanceTicket(row, userId)),
      reported: reported.map((row) => mapMaintenanceTicket(row, userId)),
      dueToday: dueToday.map(mapMaintenanceSchedule),
    };
  }

  /**
   * Opens a ticket.
   *
   * Everything except the equipment is derived: the ticket number from the business date, the
   * priority from the problem category, the title from the category and the asset's name, and
   * the supplier from the asset's links (falling back to any supplier covering its category).
   */
  async create(
    input: MaintenanceTicketCreateRequest,
    actor: AuditActor,
  ): Promise<MaintenanceTicketDto> {
    const id = newId();

    const result = await withTransaction(async (connection) => {
      const equipment = await EquipmentRepository.findById(connection, input.equipmentId);
      if (equipment === null) throw new NotFoundError('Equipment', input.equipmentId);

      const kind = input.kind ?? MaintenanceRequestKind.PROBLEM;
      const problemCategory = input.problemCategory ?? null;
      const priority = input.priority ?? priorityFor(problemCategory, kind);
      const supplier = await EquipmentRepository.resolveContactSupplier(
        connection,
        equipment.id,
      );

      const businessDate = todayIsoDate();
      const sequence = await MaintenanceRepository.nextDailySequence(connection, businessDate);
      const ticketNumber = `MTK-${businessDate.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`;

      const title = (input.title ?? titleFor(kind, problemCategory, equipment.name)).slice(
        0,
        LIMITS.MAINTENANCE_TITLE_MAX,
      );

      await MaintenanceRepository.insertTicket(connection, {
        id,
        ticketNumber,
        businessDate,
        dailySequence: sequence,
        equipmentId: equipment.id,
        kind,
        priority,
        title,
        description: input.description ?? null,
        problemCategory,
        reportedBy: actor.userId ?? '',
        supplierId: supplier?.supplier_id ?? null,
        scheduleId: null,
        capturedVia: input.capturedVia ?? CaptureSource.MANUAL,
      });

      await MaintenanceRepository.insertProblem(connection, {
        id: newId(),
        ticketId: id,
        category: problemCategory ?? ProblemCategory.OTHER,
        description: input.description ?? null,
        aiSuggestedCategory: input.aiSuggestedCategory ?? null,
        aiConfidence: input.aiConfidence ?? null,
        // A request that reached this endpoint was submitted by a person, whatever AI
        // proposed on the way — that is the whole point of the confirmation screen.
        confirmedByUser: true,
        createdBy: actor.userId,
      });

      for (const attachment of (input.attachments ?? []).slice(
        0,
        LIMITS.MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX,
      )) {
        await MaintenanceRepository.insertAttachment(connection, {
          id: newId(),
          ticketId: id,
          mediaId: attachment.mediaId,
          kind: attachment.kind,
          transcript: attachment.transcript ?? null,
          uploadedBy: actor.userId ?? '',
        });
      }

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: equipment.id,
        ticketId: id,
        type: MaintenanceActivityType.PROBLEM_REPORTED,
        summary: `${ticketNumber} raised: ${title}`,
        detail: input.description ?? null,
        metadata: { priority, kind, problemCategory },
        source: input.capturedVia ?? CaptureSource.MANUAL,
      });

      // A reported fault takes the asset's status over only while it is otherwise healthy:
      // an oven already UNDER_MAINTENANCE must not be downgraded by a second report.
      if (
        (kind === MaintenanceRequestKind.PROBLEM || kind === MaintenanceRequestKind.FAULT) &&
        isHealthyStatus(equipment.status)
      ) {
        await equipmentService.writeStatus(
          connection,
          equipment,
          EquipmentStatus.PROBLEM,
          title,
          id,
          actor,
        );
      }
      await EquipmentRepository.refreshTicketCounters(connection, equipment.id);

      const notifications = await this.notifyEscalation(connection, actor, {
        type:
          priority === MaintenancePriority.CRITICAL
            ? NotificationType.MAINTENANCE_CRITICAL
            : NotificationType.MAINTENANCE_REPORTED,
        title: `${ticketNumber} · ${title}`,
        body: `${equipment.asset_id} · ${humanise(priority)} priority`,
        data: { ticketId: id, equipmentId: equipment.id, ticketNumber },
      });

      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_TICKET_CREATED,
        entityType: 'maintenance_ticket',
        entityId: id,
        after: { ticketNumber, equipmentId: equipment.id, priority, kind },
      });

      return notifications;
    });

    notificationService.publish(result);
    return this.getById(id, actor.userId ?? '');
  }

  async update(
    id: string,
    input: MaintenanceTicketUpdateRequest,
    actor: AuditActor,
  ): Promise<MaintenanceTicketDto> {
    await withTransaction(async (connection) => {
      const before = await MaintenanceRepository.findTicketById(connection, id);
      if (before === null) throw new NotFoundError('Maintenance ticket', id);
      this.assertOpen(before);

      const assignments: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      if (input.title !== undefined) set('title', input.title);
      if (input.description !== undefined) set('description', input.description);
      if (input.priority !== undefined) set('priority', input.priority);
      if (input.problemCategory !== undefined) set('problem_category', input.problemCategory);
      if (input.partsRequired !== undefined) set('parts_required', input.partsRequired);
      if (input.costAmount !== undefined) set('cost_amount', input.costAmount);
      if (input.resolutionNotes !== undefined) set('resolution_notes', input.resolutionNotes);

      await MaintenanceRepository.updateTicket(connection, id, assignments, params);
      if (input.priority !== undefined && input.priority !== before.priority) {
        await EquipmentRepository.refreshTicketCounters(connection, before.equipment_id);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_TICKET_UPDATED,
        entityType: 'maintenance_ticket',
        entityId: id,
        before: { title: before.title, priority: before.priority },
        after: { title: input.title ?? before.title, priority: input.priority ?? before.priority },
      });
    });

    return this.getById(id, actor.userId ?? '');
  }

  /**
   * Moves a ticket along the ladder. Forward jumps are allowed — a manager who WhatsApps the
   * supplier the moment a fault lands should not have to press "acknowledge" first — and the
   * only backward move is RESOLVED -> UNDER_MAINTENANCE, which is how a fix that did not hold
   * is reopened without losing the ticket's history.
   */
  async changeStatus(
    id: string,
    input: MaintenanceStatusChangeRequest,
    actor: AuditActor,
  ): Promise<MaintenanceTicketDto> {
    const notifications = await withTransaction(async (connection) => {
      const before = await MaintenanceRepository.findTicketById(connection, id);
      if (before === null) throw new NotFoundError('Maintenance ticket', id);
      if (before.status === input.status) return [];

      if (!canTransitionMaintenanceStatus(before.status, input.status)) {
        throw new ConflictError(
          `A ${MAINTENANCE_TICKET_STATUS_LABELS[before.status].toLowerCase()} ticket cannot become ${MAINTENANCE_TICKET_STATUS_LABELS[input.status].toLowerCase()}`,
        );
      }

      const now = toDbDateTime();
      const assignments = ['status = ?'];
      const params: unknown[] = [input.status];
      const stamp = (column: string): void => {
        assignments.push(`${column} = ?`);
        params.push(now);
      };

      switch (input.status) {
        case MaintenanceTicketStatus.ACKNOWLEDGED:
          stamp('acknowledged_at');
          break;
        case MaintenanceTicketStatus.RESOLVED:
          stamp('resolved_at');
          break;
        case MaintenanceTicketStatus.VERIFIED:
          stamp('verified_at');
          break;
        case MaintenanceTicketStatus.CLOSED:
        case MaintenanceTicketStatus.CANCELLED:
          stamp('closed_at');
          break;
        default:
          break;
      }
      if (input.resolutionNotes !== undefined) {
        assignments.push('resolution_notes = ?');
        params.push(input.resolutionNotes);
      }
      if (input.partsRequired !== undefined) {
        assignments.push('parts_required = ?');
        params.push(input.partsRequired);
      }
      if (input.costAmount !== undefined) {
        assignments.push('cost_amount = ?');
        params.push(input.costAmount);
      }

      await MaintenanceRepository.updateTicket(connection, id, assignments, params);
      await maintenanceActivityService.record(connection, actor, {
        equipmentId: before.equipment_id,
        ticketId: id,
        type: ACTIVITY_FOR_STATUS[input.status] ?? MaintenanceActivityType.TICKET_STATUS_CHANGED,
        summary: `${before.ticket_number} is now ${MAINTENANCE_TICKET_STATUS_LABELS[input.status]}`,
        detail: input.note ?? input.resolutionNotes ?? null,
        metadata: { from: before.status, to: input.status },
      });

      await this.syncEquipmentForStatus(connection, before, input.status, actor);
      await EquipmentRepository.refreshTicketCounters(connection, before.equipment_id);

      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_TICKET_STATUS_CHANGED,
        entityType: 'maintenance_ticket',
        entityId: id,
        before: { status: before.status },
        after: { status: input.status, note: input.note ?? null },
      });

      return notificationService.notify(connection, {
        userIds: [before.reported_by, ...(before.assigned_to === null ? [] : [before.assigned_to])],
        type:
          input.status === MaintenanceTicketStatus.RESOLVED
            ? NotificationType.MAINTENANCE_COMPLETED
            : NotificationType.MAINTENANCE_REPORTED,
        title: `${before.ticket_number} is now ${MAINTENANCE_TICKET_STATUS_LABELS[input.status]}`,
        body: before.title,
        actorId: actor.userId,
        data: { ticketId: id, equipmentId: before.equipment_id, status: input.status },
      });
    });

    notificationService.publish(notifications);
    return this.getById(id, actor.userId ?? '');
  }

  /**
   * Hands the ticket to a person, a supplier, or a named technician of theirs. The previous
   * assignment is superseded rather than overwritten, so the chain stays readable.
   */
  async assign(
    id: string,
    input: MaintenanceAssignRequest,
    actor: AuditActor,
  ): Promise<MaintenanceTicketDto> {
    const notifications = await withTransaction(async (connection) => {
      const before = await MaintenanceRepository.findTicketById(connection, id);
      if (before === null) throw new NotFoundError('Maintenance ticket', id);
      this.assertOpen(before);

      if (input.assignedTo !== undefined && input.assignedTo !== null) {
        const assignee = await userRepository.findById(connection, input.assignedTo);
        if (assignee === null) throw new NotFoundError('User', input.assignedTo);
      }

      await MaintenanceRepository.deactivateAssignments(connection, id);
      await MaintenanceRepository.insertAssignment(connection, {
        id: newId(),
        ticketId: id,
        assignedTo: input.assignedTo ?? null,
        supplierId: input.supplierId ?? null,
        technicianName: input.technicianName ?? null,
        technicianPhone: input.technicianPhone ?? null,
        scheduledAt: input.scheduledAt === undefined || input.scheduledAt === null
          ? null
          : toDbDateTime(new Date(input.scheduledAt)),
        notes: input.notes ?? null,
        assignedBy: actor.userId,
      });

      // A visit with a time on it is scheduled; without one it is merely assigned. Either way
      // the ladder decides whether the ticket may move, never this method.
      const nextStatus =
        input.scheduledAt !== undefined && input.scheduledAt !== null
          ? MaintenanceTicketStatus.TECHNICIAN_SCHEDULED
          : MaintenanceTicketStatus.ASSIGNED;

      const assignments = ['assigned_to = ?', 'supplier_id = ?'];
      const params: unknown[] = [
        input.assignedTo ?? before.assigned_to,
        input.supplierId ?? before.supplier_id,
      ];
      if (input.scheduledAt !== undefined) {
        assignments.push('scheduled_at = ?');
        params.push(
          input.scheduledAt === null ? null : toDbDateTime(new Date(input.scheduledAt)),
        );
      }
      if (canTransitionMaintenanceStatus(before.status, nextStatus)) {
        assignments.push('status = ?');
        params.push(nextStatus);
      }
      await MaintenanceRepository.updateTicket(connection, id, assignments, params);

      const who =
        input.technicianName ??
        (input.assignedTo === undefined || input.assignedTo === null
          ? (before.supplier_name ?? 'the supplier')
          : ((await userRepository.findById(connection, input.assignedTo))?.name ?? 'a colleague'));

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: before.equipment_id,
        ticketId: id,
        type: MaintenanceActivityType.TECHNICIAN_ASSIGNED,
        summary: `${before.ticket_number} assigned to ${who}`,
        detail: input.notes ?? null,
        metadata: {
          assignedTo: input.assignedTo ?? null,
          supplierId: input.supplierId ?? null,
          scheduledAt: input.scheduledAt ?? null,
        },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_TICKET_ASSIGNED,
        entityType: 'maintenance_ticket',
        entityId: id,
        before: { assignedTo: before.assigned_to, supplierId: before.supplier_id },
        after: { assignedTo: input.assignedTo ?? null, supplierId: input.supplierId ?? null },
      });

      // Only the new assignee is told. Broadcasting an assignment trains everyone to ignore
      // the notification.
      if (input.assignedTo === undefined || input.assignedTo === null) return [];
      return notificationService.notify(connection, {
        userIds: [input.assignedTo],
        type: NotificationType.MAINTENANCE_ASSIGNED,
        title: `${before.ticket_number} was assigned to you`,
        body: `${before.asset_id ?? ''} · ${before.title}`.trim(),
        actorId: actor.userId,
        data: { ticketId: id, equipmentId: before.equipment_id },
      });
    });

    notificationService.publish(notifications);
    return this.getById(id, actor.userId ?? '');
  }

  /**
   * Finishing the job from the phone: a photo, optionally a word, and it is done.
   *
   * Also discharges the preventive schedule that raised the ticket, if any — advancing
   * `next_due_at` here rather than in the sweep means a job done early counts from the day it
   * was actually done.
   */
  async complete(
    id: string,
    input: MaintenanceCompleteRequest,
    actor: AuditActor,
  ): Promise<MaintenanceTicketDto> {
    const notifications = await withTransaction(async (connection) => {
      const before = await MaintenanceRepository.findTicketById(connection, id);
      if (before === null) throw new NotFoundError('Maintenance ticket', id);
      this.assertOpen(before);

      const now = toDbDateTime();
      const assignments = ['status = ?', 'resolved_at = ?'];
      const params: unknown[] = [MaintenanceTicketStatus.RESOLVED, now];
      if (input.resolutionNotes !== undefined) {
        assignments.push('resolution_notes = ?');
        params.push(input.resolutionNotes);
      }
      if (input.costAmount !== undefined) {
        assignments.push('cost_amount = ?');
        params.push(input.costAmount);
      }
      await MaintenanceRepository.updateTicket(connection, id, assignments, params);
      await MaintenanceRepository.completeActiveAssignment(connection, id);

      for (const attachment of (input.attachments ?? []).slice(
        0,
        LIMITS.MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX,
      )) {
        await MaintenanceRepository.insertAttachment(connection, {
          id: newId(),
          ticketId: id,
          mediaId: attachment.mediaId,
          kind: attachment.kind,
          transcript: attachment.transcript ?? null,
          uploadedBy: actor.userId ?? '',
        });
      }

      if (input.partsReplaced !== undefined && input.partsReplaced !== null) {
        await maintenanceActivityService.record(connection, actor, {
          equipmentId: before.equipment_id,
          ticketId: id,
          type: MaintenanceActivityType.PARTS_REPLACED,
          summary: 'Parts replaced',
          detail: input.partsReplaced,
        });
      }

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: before.equipment_id,
        ticketId: id,
        type: MaintenanceActivityType.MAINTENANCE_COMPLETED,
        summary: `${before.ticket_number} completed`,
        detail: input.resolutionNotes ?? null,
        metadata: { costAmount: input.costAmount ?? null },
      });

      if (before.schedule_id !== null) {
        await this.advanceSchedule(connection, before.schedule_id);
      }

      if (input.restoreEquipment !== false) {
        await this.syncEquipmentForStatus(
          connection,
          before,
          MaintenanceTicketStatus.RESOLVED,
          actor,
        );
      }
      await EquipmentRepository.refreshTicketCounters(connection, before.equipment_id);

      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_TICKET_COMPLETED,
        entityType: 'maintenance_ticket',
        entityId: id,
        before: { status: before.status },
        after: { status: MaintenanceTicketStatus.RESOLVED, costAmount: input.costAmount ?? null },
      });

      return notificationService.notify(connection, {
        userIds: [before.reported_by],
        type: NotificationType.MAINTENANCE_COMPLETED,
        title: `${before.ticket_number} has been fixed`,
        body: input.resolutionNotes ?? before.title,
        actorId: actor.userId,
        data: { ticketId: id, equipmentId: before.equipment_id },
      });
    });

    notificationService.publish(notifications);
    return this.getById(id, actor.userId ?? '');
  }

  /** A photo, a voice note or a second document added to a ticket already open. */
  async addAttachments(
    id: string,
    attachments: ReadonlyArray<{ mediaId: string; kind: string; transcript?: string | null }>,
    actor: AuditActor,
  ): Promise<MaintenanceTicketDto> {
    await withTransaction(async (connection) => {
      const ticket = await MaintenanceRepository.findTicketById(connection, id);
      if (ticket === null) throw new NotFoundError('Maintenance ticket', id);

      const existing = await MaintenanceRepository.listAttachments(connection, id);
      if (existing.length + attachments.length > LIMITS.MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX) {
        throw new ConflictError(
          `A ticket may hold at most ${LIMITS.MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX} attachments`,
        );
      }

      for (const attachment of attachments) {
        await MaintenanceRepository.insertAttachment(connection, {
          id: newId(),
          ticketId: id,
          mediaId: attachment.mediaId,
          kind: attachment.kind as never,
          transcript: attachment.transcript ?? null,
          uploadedBy: actor.userId ?? '',
        });
      }

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: ticket.equipment_id,
        ticketId: id,
        type: MaintenanceActivityType.ATTACHMENT_ADDED,
        summary: attachments.length === 1 ? 'Attachment added' : `${attachments.length} attachments added`,
      });
    });

    return this.getById(id, actor.userId ?? '');
  }

  /** A line on the timeline and nothing else — the "I called them, no answer" case. */
  async addNote(id: string, note: string, actor: AuditActor): Promise<MaintenanceTicketDto> {
    await withTransaction(async (connection) => {
      const ticket = await MaintenanceRepository.findTicketById(connection, id);
      if (ticket === null) throw new NotFoundError('Maintenance ticket', id);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: ticket.equipment_id,
        ticketId: id,
        type: MaintenanceActivityType.NOTE_ADDED,
        summary: 'Note added',
        detail: note,
      });
    });

    return this.getById(id, actor.userId ?? '');
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await MaintenanceRepository.findTicketById(connection, id);
      if (before === null) throw new NotFoundError('Maintenance ticket', id);

      await MaintenanceRepository.softDeleteTicket(connection, id);
      await EquipmentRepository.refreshTicketCounters(connection, before.equipment_id);
      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_TICKET_DELETED,
        entityType: 'maintenance_ticket',
        entityId: id,
        before: { ticketNumber: before.ticket_number, equipmentId: before.equipment_id },
      });
    });
  }

  /* ----------------------------------------------------------------- schedules */

  async listSchedules(query: {
    equipmentId?: string;
    assignedTo?: string;
    dueBefore?: string;
    includeInactive?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter = {
      ...(query.equipmentId !== undefined ? { equipmentId: query.equipmentId } : {}),
      ...(query.assignedTo !== undefined ? { assignedTo: query.assignedTo } : {}),
      ...(query.dueBefore !== undefined ? { dueBefore: query.dueBefore } : {}),
      activeOnly: query.includeInactive !== true,
    };
    const [rows, total] = await Promise.all([
      MaintenanceRepository.listSchedules(pool, { ...filter, limit: pageSize, offset }),
      MaintenanceRepository.countSchedules(pool, filter),
    ]);
    return buildPage(rows.map(mapMaintenanceSchedule), total, page, pageSize);
  }

  async createSchedule(
    input: MaintenanceScheduleWriteRequest,
    actor: AuditActor,
  ): Promise<MaintenanceScheduleDto> {
    const id = newId();
    await withTransaction(async (connection) => {
      const equipment = await EquipmentRepository.findById(connection, input.equipmentId);
      if (equipment === null) throw new NotFoundError('Equipment', input.equipmentId);

      const anchorDate =
        input.anchorDate ??
        (equipment.installation_date ?? equipment.purchase_date ?? todayIsoDate()).slice(0, 10);
      await MaintenanceRepository.insertSchedule(connection, {
        id,
        equipmentId: input.equipmentId,
        title: input.title ?? 'Preventive maintenance',
        frequency: input.frequency,
        intervalDays: input.intervalDays ?? null,
        anchorDate,
        nextDueAt: nextDueFrom(anchorDate, input.frequency, input.intervalDays ?? null),
        reminderDays: input.reminderDays ?? DEFAULT_REMINDER_DAYS,
        assignedTo: input.assignedTo ?? null,
        supplierId: input.supplierId ?? null,
        instructions: input.instructions ?? null,
        createdBy: actor.userId,
      });
      await EquipmentRepository.refreshMaintenanceDates(connection, input.equipmentId);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: input.equipmentId,
        type: MaintenanceActivityType.SCHEDULE_CREATED,
        summary: `${humanise(input.frequency)} maintenance scheduled`,
        detail: input.instructions ?? null,
        metadata: { scheduleId: id, frequency: input.frequency },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_SCHEDULE_CREATED,
        entityType: 'maintenance_schedule',
        entityId: id,
        after: { equipmentId: input.equipmentId, frequency: input.frequency },
      });
    });

    const row = await MaintenanceRepository.findScheduleById(getPool(), id);
    if (row === null) throw new NotFoundError('Maintenance schedule', id);
    return mapMaintenanceSchedule(row);
  }

  async updateSchedule(
    id: string,
    input: Partial<MaintenanceScheduleWriteRequest>,
    actor: AuditActor,
  ): Promise<MaintenanceScheduleDto> {
    await withTransaction(async (connection) => {
      const before = await MaintenanceRepository.findScheduleById(connection, id);
      if (before === null) throw new NotFoundError('Maintenance schedule', id);

      const assignments: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      if (input.title !== undefined) set('title', input.title);
      if (input.frequency !== undefined) set('frequency', input.frequency);
      if (input.intervalDays !== undefined) set('interval_days', input.intervalDays);
      if (input.anchorDate !== undefined) set('anchor_date', input.anchorDate);
      if (input.reminderDays !== undefined) set('reminder_days', input.reminderDays);
      if (input.assignedTo !== undefined) set('assigned_to', input.assignedTo);
      if (input.supplierId !== undefined) set('supplier_id', input.supplierId);
      if (input.instructions !== undefined) set('instructions', input.instructions);
      if (input.isActive !== undefined) set('is_active', input.isActive ? 1 : 0);

      // Changing the rhythm changes when the next service falls due; leaving `next_due_at`
      // alone would keep the old cadence forever.
      if (
        input.frequency !== undefined ||
        input.intervalDays !== undefined ||
        input.anchorDate !== undefined
      ) {
        const anchorDate = (input.anchorDate ?? before.anchor_date).slice(0, 10);
        const frequency = input.frequency ?? before.frequency;
        const intervalDays =
          input.intervalDays !== undefined ? input.intervalDays : before.interval_days;
        set('next_due_at', nextDueFrom(anchorDate, frequency, intervalDays));
      }

      await MaintenanceRepository.updateSchedule(connection, id, assignments, params);
      await EquipmentRepository.refreshMaintenanceDates(connection, before.equipment_id);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: before.equipment_id,
        type: MaintenanceActivityType.SCHEDULE_UPDATED,
        summary: 'Maintenance schedule updated',
        metadata: { scheduleId: id, fields: Object.keys(input) },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_SCHEDULE_UPDATED,
        entityType: 'maintenance_schedule',
        entityId: id,
        before: { frequency: before.frequency, nextDueAt: before.next_due_at },
        after: { frequency: input.frequency ?? before.frequency },
      });
    });

    const row = await MaintenanceRepository.findScheduleById(getPool(), id);
    if (row === null) throw new NotFoundError('Maintenance schedule', id);
    return mapMaintenanceSchedule(row);
  }

  async removeSchedule(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await MaintenanceRepository.findScheduleById(connection, id);
      if (before === null) throw new NotFoundError('Maintenance schedule', id);

      await MaintenanceRepository.softDeleteSchedule(connection, id);
      await EquipmentRepository.refreshMaintenanceDates(connection, before.equipment_id);
      await auditService.record(connection, actor, {
        action: AuditAction.MAINTENANCE_SCHEDULE_DELETED,
        entityType: 'maintenance_schedule',
        entityId: id,
        before: { equipmentId: before.equipment_id, frequency: before.frequency },
      });
    });
  }

  /** Marks the schedule performed today and moves it on by its own interval. */
  async advanceSchedule(db: PoolConnection, scheduleId: string): Promise<void> {
    const schedule = await MaintenanceRepository.findScheduleById(db, scheduleId);
    if (schedule === null) return;

    const performed = todayIsoDate();
    await MaintenanceRepository.updateSchedule(
      db,
      scheduleId,
      ['last_performed_at = ?', 'next_due_at = ?'],
      [performed, nextDueFrom(performed, schedule.frequency, schedule.interval_days)],
    );
    await EquipmentRepository.refreshMaintenanceDates(db, schedule.equipment_id);
  }

  /* ------------------------------------------------------------------- helpers */

  private assertOpen(ticket: MaintenanceTicketRow): void {
    if (
      ticket.status === MaintenanceTicketStatus.CLOSED ||
      ticket.status === MaintenanceTicketStatus.CANCELLED
    ) {
      throw new ConflictError(
        `${ticket.ticket_number} is ${MAINTENANCE_TICKET_STATUS_LABELS[ticket.status].toLowerCase()} and can no longer be changed`,
      );
    }
  }

  /**
   * Keeps the asset's own status honest as its ticket moves. The asset is only released once
   * *no* open ticket is left against it — two faults on one oven must not have the first fix
   * declare the oven fine.
   */
  private async syncEquipmentForStatus(
    db: PoolConnection,
    ticket: MaintenanceTicketRow,
    status: MaintenanceTicketStatus,
    actor: AuditActor,
  ): Promise<void> {
    const equipment = await EquipmentRepository.findById(db, ticket.equipment_id);
    if (equipment === null) return;

    if (status === MaintenanceTicketStatus.UNDER_MAINTENANCE) {
      await equipmentService.writeStatus(
        db,
        equipment,
        EquipmentStatus.UNDER_MAINTENANCE,
        ticket.ticket_number,
        ticket.id,
        actor,
      );
      return;
    }

    if (!RELEASING_STATUSES.includes(status)) return;
    if (equipment.status === EquipmentStatus.RETIRED) return;

    const otherOpen = await MaintenanceRepository.countTickets(db, {
      equipmentId: ticket.equipment_id,
      openOnly: true,
      limit: 1,
      offset: 0,
    });
    // The ticket being released is still open in the database at this point, so one remaining
    // is this one.
    if (otherOpen > 1) return;

    await equipmentService.writeStatus(
      db,
      equipment,
      EquipmentStatus.OPERATIONAL,
      `${ticket.ticket_number} ${MAINTENANCE_TICKET_STATUS_LABELS[status].toLowerCase()}`,
      ticket.id,
      actor,
    );
  }

  private async notifyEscalation(
    db: PoolConnection,
    actor: AuditActor,
    payload: {
      type: NotificationType;
      title: string;
      body: string;
      data: Record<string, unknown>;
    },
  ): Promise<NotificationDto[]> {
    const recipients = await userRepository.findActiveByRoles(db, ESCALATION_ROLES);
    return notificationService.notify(db, {
      userIds: recipients.map((user) => user.id),
      type: payload.type,
      title: payload.title,
      body: payload.body,
      actorId: actor.userId,
      data: payload.data,
    });
  }
}

/* --------------------------------------------------------------------- helpers */

/**
 * A safety or electrical fault opens CRITICAL whatever the reporter selected, because those
 * two are the categories where waiting for a manager to re-triage is the actual risk.
 */
function priorityFor(
  category: ProblemCategory | null,
  kind: MaintenanceRequestKind,
): MaintenancePriority {
  if (category !== null && CRITICAL_PROBLEM_CATEGORIES.includes(category)) {
    return MaintenancePriority.CRITICAL;
  }
  if (kind === MaintenanceRequestKind.FAULT) return MaintenancePriority.HIGH;
  if (kind === MaintenanceRequestKind.INSPECTION) return MaintenancePriority.LOW;
  return MaintenancePriority.NORMAL;
}

function titleFor(
  kind: MaintenanceRequestKind,
  category: ProblemCategory | null,
  equipmentName: string,
): string {
  const subject =
    category === null ? MAINTENANCE_REQUEST_KIND_LABELS[kind] : PROBLEM_CATEGORY_LABELS[category];
  return `${subject} — ${equipmentName}`;
}

function nextDueFrom(
  anchorDate: string,
  frequency: MaintenanceScheduleWriteRequest['frequency'],
  intervalDays: number | null,
): string {
  const days = maintenanceIntervalDays(frequency, intervalDays);
  const anchor = new Date(`${anchorDate.slice(0, 10)}T00:00:00Z`);
  const today = new Date();
  let due = addDays(anchor, days);
  // A schedule anchored years ago must not land on the overdue list the day it is created.
  while (due.getTime() < today.getTime()) due = addDays(due, days);
  return due.toISOString().slice(0, 10);
}

/** ENUM_MEMBER -> "Enum member", for prose written into the timeline. */
function humanise(value: string): string {
  const words = value.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const maintenanceService = new MaintenanceService();
