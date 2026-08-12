import type {
  CaptureSource,
  MaintenanceActivityType,
  MaintenanceAttachmentKind,
  MaintenanceFrequency,
  MaintenancePriority,
  MaintenanceRequestKind,
  MaintenanceTicketStatus,
  ProblemCategory,
} from '@menuboard/shared';
import { WARRANTY_EXPIRING_DAYS } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CountRow,
  EquipmentDashboardCountsRow,
  MaintenanceActivityRow,
  MaintenanceAssignmentRow,
  MaintenanceAttachmentRow,
  MaintenanceProblemRow,
  MaintenanceScheduleRow,
  MaintenanceTicketRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for maintenance tickets, their satellites and preventive schedules.
 *
 * Every ticket read joins its equipment and location. A ticket that says "not heating" without
 * saying which oven, on which floor, is worthless to the person reading the dashboard, so the
 * join is not optional anywhere in the module.
 */

const TICKET_SELECT = `SELECT t.*,
         rep.name AS reported_by_name,
         asg.name AS assigned_to_name,
         s.name AS supplier_name, s.phone AS supplier_phone, s.whatsapp AS supplier_whatsapp,
         e.asset_id AS asset_id, e.name AS equipment_name,
         e.image_media_id AS equipment_image_media_id,
         c.name AS category_name,
         l.name AS location_name, l.room AS room, l.section AS section,
         a.name AS area_name, f.name AS floor_name,
         (SELECT COUNT(*) FROM maintenance_attachments ma
           WHERE ma.ticket_id = t.id AND ma.deleted_at IS NULL) AS attachment_count
    FROM maintenance_tickets t
    JOIN equipment e ON e.id = t.equipment_id
    JOIN users rep ON rep.id = t.reported_by
    LEFT JOIN users asg ON asg.id = t.assigned_to
    LEFT JOIN equipment_suppliers s ON s.id = t.supplier_id
    LEFT JOIN equipment_categories c ON c.id = e.category_id
    LEFT JOIN equipment_locations l ON l.id = e.location_id
    LEFT JOIN equipment_areas a ON a.id = l.area_id
    LEFT JOIN equipment_floors f ON f.id = a.floor_id`;

const SCHEDULE_SELECT = `SELECT s.*, e.name AS equipment_name, e.asset_id AS asset_id,
         u.name AS assigned_to_name, sup.name AS supplier_name
    FROM maintenance_schedules s
    JOIN equipment e ON e.id = s.equipment_id
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN equipment_suppliers sup ON sup.id = s.supplier_id`;

export interface TicketListFilter {
  search?: string;
  equipmentId?: string;
  status?: MaintenanceTicketStatus;
  priority?: MaintenancePriority;
  kind?: MaintenanceRequestKind;
  problemCategory?: ProblemCategory;
  supplierId?: string;
  assignedTo?: string;
  reportedBy?: string;
  floorId?: string;
  areaId?: string;
  openOnly?: boolean;
  limit: number;
  offset: number;
}

export interface TicketInsert {
  id: string;
  ticketNumber: string;
  businessDate: string;
  dailySequence: number;
  equipmentId: string;
  kind: MaintenanceRequestKind;
  priority: MaintenancePriority;
  title: string;
  description: string | null;
  problemCategory: ProblemCategory | null;
  reportedBy: string;
  supplierId: string | null;
  scheduleId: string | null;
  capturedVia: CaptureSource;
}

function ticketWhere(filter: TicketListFilter): { where: string; params: unknown[] } {
  const conditions = ['t.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.equipmentId !== undefined) {
    conditions.push('t.equipment_id = ?');
    params.push(filter.equipmentId);
  }
  if (filter.status !== undefined) {
    conditions.push('t.status = ?');
    params.push(filter.status);
  }
  if (filter.openOnly === true) {
    conditions.push("t.status NOT IN ('CLOSED','CANCELLED')");
  }
  if (filter.priority !== undefined) {
    conditions.push('t.priority = ?');
    params.push(filter.priority);
  }
  if (filter.kind !== undefined) {
    conditions.push('t.kind = ?');
    params.push(filter.kind);
  }
  if (filter.problemCategory !== undefined) {
    conditions.push('t.problem_category = ?');
    params.push(filter.problemCategory);
  }
  if (filter.supplierId !== undefined) {
    conditions.push('t.supplier_id = ?');
    params.push(filter.supplierId);
  }
  if (filter.assignedTo !== undefined) {
    conditions.push('t.assigned_to = ?');
    params.push(filter.assignedTo);
  }
  if (filter.reportedBy !== undefined) {
    conditions.push('t.reported_by = ?');
    params.push(filter.reportedBy);
  }
  if (filter.areaId !== undefined) {
    conditions.push('a.id = ?');
    params.push(filter.areaId);
  }
  if (filter.floorId !== undefined) {
    conditions.push('f.id = ?');
    params.push(filter.floorId);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(t.title LIKE ? OR t.ticket_number LIKE ? OR e.name LIKE ? OR e.asset_id LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const MaintenanceRepository = {
  async listTickets(db: Db, filter: TicketListFilter): Promise<MaintenanceTicketRow[]> {
    const { where, params } = ticketWhere(filter);
    return selectRows<MaintenanceTicketRow>(
      db,
      `${TICKET_SELECT} ${where}
        ORDER BY FIELD(t.priority,'CRITICAL','HIGH','NORMAL','LOW'),
                 FIELD(t.status,'REPORTED','ACKNOWLEDGED','ASSIGNED','SUPPLIER_CONTACTED',
                       'TECHNICIAN_SCHEDULED','UNDER_MAINTENANCE','WAITING_FOR_PARTS',
                       'RESOLVED','VERIFIED','CLOSED','CANCELLED'),
                 t.reported_at DESC
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async countTickets(db: Db, filter: TicketListFilter): Promise<number> {
    const { where, params } = ticketWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total
         FROM maintenance_tickets t
         JOIN equipment e ON e.id = t.equipment_id
         LEFT JOIN equipment_locations l ON l.id = e.location_id
         LEFT JOIN equipment_areas a ON a.id = l.area_id
         LEFT JOIN equipment_floors f ON f.id = a.floor_id
        ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findTicketById(db: Db, id: string): Promise<MaintenanceTicketRow | null> {
    return selectOne<MaintenanceTicketRow>(
      db,
      `${TICKET_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
  },

  /**
   * Next ticket number for a business date. `FOR UPDATE` makes two people reporting a fault at
   * the same moment safe; the unique key on `(business_date, daily_sequence)` is the backstop.
   */
  async nextDailySequence(db: Db, businessDate: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(daily_sequence), 0) AS total
         FROM maintenance_tickets WHERE business_date = ? FOR UPDATE`,
      [businessDate],
    );
    return Number(row?.total ?? 0) + 1;
  },

  async insertTicket(db: Db, input: TicketInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO maintenance_tickets
         (id, ticket_number, business_date, daily_sequence, equipment_id, kind, status, priority,
          title, description, problem_category, reported_by, reported_at, supplier_id,
          schedule_id, captured_via, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'REPORTED',?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.ticketNumber,
        input.businessDate,
        input.dailySequence,
        input.equipmentId,
        input.kind,
        input.priority,
        input.title,
        input.description,
        input.problemCategory,
        input.reportedBy,
        now,
        input.supplierId,
        input.scheduleId,
        input.capturedVia,
        now,
        now,
      ],
    );
  },

  async updateTicket(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE maintenance_tickets SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDeleteTicket(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE maintenance_tickets SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /* --------------------------------------------------------------------- problems */

  async insertProblem(
    db: Db,
    input: {
      id: string;
      ticketId: string;
      category: ProblemCategory;
      description: string | null;
      aiSuggestedCategory: ProblemCategory | null;
      aiConfidence: number | null;
      confirmedByUser: boolean;
      createdBy: string | null;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO maintenance_problems
         (id, ticket_id, category, description, ai_suggested_category, ai_confidence,
          confirmed_by_user, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.ticketId,
        input.category,
        input.description,
        input.aiSuggestedCategory,
        input.aiConfidence,
        input.confirmedByUser ? 1 : 0,
        input.createdBy,
        toDbDateTime(),
      ],
    );
  },

  async listProblems(db: Db, ticketId: string): Promise<MaintenanceProblemRow[]> {
    return selectRows<MaintenanceProblemRow>(
      db,
      `SELECT * FROM maintenance_problems WHERE ticket_id = ? ORDER BY created_at`,
      [ticketId],
    );
  },

  /* ------------------------------------------------------------------ attachments */

  async insertAttachment(
    db: Db,
    input: {
      id: string;
      ticketId: string;
      mediaId: string;
      kind: MaintenanceAttachmentKind;
      transcript: string | null;
      uploadedBy: string;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO maintenance_attachments
         (id, ticket_id, media_id, kind, transcript, uploaded_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [input.id, input.ticketId, input.mediaId, input.kind, input.transcript, input.uploadedBy, now, now],
    );
  },

  async listAttachments(db: Db, ticketId: string): Promise<MaintenanceAttachmentRow[]> {
    return selectRows<MaintenanceAttachmentRow>(
      db,
      `SELECT ma.*, m.file_name, m.mime_type, u.name AS uploaded_by_name
         FROM maintenance_attachments ma
         JOIN media_assets m ON m.id = ma.media_id
         LEFT JOIN users u ON u.id = ma.uploaded_by
        WHERE ma.ticket_id = ? AND ma.deleted_at IS NULL
        ORDER BY ma.created_at`,
      [ticketId],
    );
  },

  /** Photo ids for the WhatsApp message body, newest first, capped by the caller. */
  async listAttachmentMediaIds(db: Db, ticketId: string, limit: number): Promise<string[]> {
    const rows = await selectRows<MaintenanceAttachmentRow>(
      db,
      `SELECT ma.* FROM maintenance_attachments ma
        WHERE ma.ticket_id = ? AND ma.kind = 'PHOTO' AND ma.deleted_at IS NULL
        ORDER BY ma.created_at DESC
        LIMIT ?`,
      [ticketId, limit],
    );
    return rows.map((row) => row.media_id);
  },

  /* ------------------------------------------------------------------ assignments */

  async insertAssignment(
    db: Db,
    input: {
      id: string;
      ticketId: string;
      assignedTo: string | null;
      supplierId: string | null;
      technicianName: string | null;
      technicianPhone: string | null;
      scheduledAt: string | null;
      notes: string | null;
      assignedBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO maintenance_assignments
         (id, ticket_id, assigned_to, supplier_id, technician_name, technician_phone,
          scheduled_at, notes, assigned_by, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
      [
        input.id,
        input.ticketId,
        input.assignedTo,
        input.supplierId,
        input.technicianName,
        input.technicianPhone,
        input.scheduledAt,
        input.notes,
        input.assignedBy,
        now,
        now,
      ],
    );
  },

  /** Supersedes previous assignments so exactly one row is current. */
  async deactivateAssignments(db: Db, ticketId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE maintenance_assignments SET is_active = 0, updated_at = ?
        WHERE ticket_id = ? AND is_active = 1`,
      [toDbDateTime(), ticketId],
    );
  },

  async completeActiveAssignment(db: Db, ticketId: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE maintenance_assignments SET completed_at = ?, updated_at = ?
        WHERE ticket_id = ? AND is_active = 1 AND completed_at IS NULL`,
      [now, now, ticketId],
    );
  },

  async listAssignments(db: Db, ticketId: string): Promise<MaintenanceAssignmentRow[]> {
    return selectRows<MaintenanceAssignmentRow>(
      db,
      `SELECT ma.*, u.name AS assigned_to_name, s.name AS supplier_name, ab.name AS assigned_by_name
         FROM maintenance_assignments ma
         LEFT JOIN users u ON u.id = ma.assigned_to
         LEFT JOIN users ab ON ab.id = ma.assigned_by
         LEFT JOIN equipment_suppliers s ON s.id = ma.supplier_id
        WHERE ma.ticket_id = ?
        ORDER BY ma.created_at DESC`,
      [ticketId],
    );
  },

  /* ------------------------------------------------------------------- activities */

  async insertActivity(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      ticketId: string | null;
      type: MaintenanceActivityType;
      summary: string;
      detail: string | null;
      metadata: string | null;
      actorId: string | null;
      actorRole: string | null;
      source: CaptureSource;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO maintenance_activities
         (id, equipment_id, ticket_id, type, summary, detail, metadata, actor_id, actor_role,
          source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.ticketId,
        input.type,
        input.summary,
        input.detail,
        input.metadata,
        input.actorId,
        input.actorRole,
        input.source,
        toDbDateTime(),
      ],
    );
  },

  async listActivities(
    db: Db,
    filter: { equipmentId?: string; ticketId?: string; limit: number },
  ): Promise<MaintenanceActivityRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.equipmentId !== undefined) {
      conditions.push('act.equipment_id = ?');
      params.push(filter.equipmentId);
    }
    if (filter.ticketId !== undefined) {
      conditions.push('act.ticket_id = ?');
      params.push(filter.ticketId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return selectRows<MaintenanceActivityRow>(
      db,
      `SELECT act.*, u.name AS actor_name
         FROM maintenance_activities act
         LEFT JOIN users u ON u.id = act.actor_id
        ${where}
        ORDER BY act.created_at DESC, act.id DESC
        LIMIT ?`,
      [...params, filter.limit],
    );
  },

  /* -------------------------------------------------------------------- schedules */

  async insertSchedule(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      title: string;
      frequency: MaintenanceFrequency;
      intervalDays: number | null;
      anchorDate: string;
      nextDueAt: string;
      reminderDays: number;
      assignedTo: string | null;
      supplierId: string | null;
      instructions: string | null;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO maintenance_schedules
         (id, equipment_id, title, frequency, interval_days, anchor_date, next_due_at,
          reminder_days, assigned_to, supplier_id, instructions, is_active, created_by,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.title,
        input.frequency,
        input.intervalDays,
        input.anchorDate,
        input.nextDueAt,
        input.reminderDays,
        input.assignedTo,
        input.supplierId,
        input.instructions,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async findScheduleById(db: Db, id: string): Promise<MaintenanceScheduleRow | null> {
    return selectOne<MaintenanceScheduleRow>(
      db,
      `${SCHEDULE_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL`,
      [id],
    );
  },

  async listSchedules(
    db: Db,
    filter: {
      equipmentId?: string;
      assignedTo?: string;
      dueBefore?: string;
      activeOnly?: boolean;
      limit: number;
      offset: number;
    },
  ): Promise<MaintenanceScheduleRow[]> {
    const conditions = ['s.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filter.equipmentId !== undefined) {
      conditions.push('s.equipment_id = ?');
      params.push(filter.equipmentId);
    }
    if (filter.assignedTo !== undefined) {
      conditions.push('s.assigned_to = ?');
      params.push(filter.assignedTo);
    }
    if (filter.dueBefore !== undefined) {
      conditions.push('s.next_due_at <= ?');
      params.push(filter.dueBefore);
    }
    if (filter.activeOnly !== false) conditions.push('s.is_active = 1');

    return selectRows<MaintenanceScheduleRow>(
      db,
      `${SCHEDULE_SELECT}
        WHERE ${conditions.join(' AND ')}
        ORDER BY s.next_due_at, e.name
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async countSchedules(
    db: Db,
    filter: { equipmentId?: string; assignedTo?: string; dueBefore?: string; activeOnly?: boolean },
  ): Promise<number> {
    const conditions = ['s.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filter.equipmentId !== undefined) {
      conditions.push('s.equipment_id = ?');
      params.push(filter.equipmentId);
    }
    if (filter.assignedTo !== undefined) {
      conditions.push('s.assigned_to = ?');
      params.push(filter.assignedTo);
    }
    if (filter.dueBefore !== undefined) {
      conditions.push('s.next_due_at <= ?');
      params.push(filter.dueBefore);
    }
    if (filter.activeOnly !== false) conditions.push('s.is_active = 1');

    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM maintenance_schedules s WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async updateSchedule(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE maintenance_schedules SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDeleteSchedule(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE maintenance_schedules SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /**
   * Schedules that have fallen due and have no open ticket already covering them. Used by the
   * scheduler sweep, which must be idempotent: running it twice in a day must not raise the
   * same preventive ticket twice.
   */
  async listDueSchedulesWithoutTicket(db: Db, limit: number): Promise<MaintenanceScheduleRow[]> {
    return selectRows<MaintenanceScheduleRow>(
      db,
      `${SCHEDULE_SELECT}
        WHERE s.deleted_at IS NULL AND s.is_active = 1
          AND s.next_due_at <= CURDATE()
          AND e.deleted_at IS NULL AND e.status <> 'RETIRED'
          AND NOT EXISTS (
                SELECT 1 FROM maintenance_tickets t
                 WHERE t.schedule_id = s.id AND t.deleted_at IS NULL
                   AND t.status NOT IN ('CLOSED','CANCELLED'))
        ORDER BY s.next_due_at
        LIMIT ?`,
      [limit],
    );
  },

  /* -------------------------------------------------------------------- dashboard */

  /**
   * Every dashboard counter in one round trip.
   *
   * Correlated scalar subqueries rather than a pile of joins: each one is answered by an index
   * on the table it targets, and the alternative (one query per tile) is thirteen round trips
   * for a screen that must open instantly.
   */
  async dashboardCounts(db: Db): Promise<EquipmentDashboardCountsRow> {
    const row = await selectOne<EquipmentDashboardCountsRow>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL AND status <> 'RETIRED') AS total_equipment,
         (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL
            AND status IN ('OPERATIONAL','RUNNING','IDLE')) AS operational,
         (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL
            AND status IN ('NEEDS_ATTENTION','PROBLEM')) AS needing_attention,
         (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL
            AND status = 'OUT_OF_SERVICE') AS out_of_service,
         (SELECT COUNT(*) FROM maintenance_schedules WHERE deleted_at IS NULL AND is_active = 1
            AND next_due_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS maintenance_due,
         (SELECT COUNT(*) FROM maintenance_schedules WHERE deleted_at IS NULL AND is_active = 1
            AND next_due_at < CURDATE()) AS maintenance_overdue,
         (SELECT COUNT(*) FROM maintenance_tickets WHERE deleted_at IS NULL
            AND status NOT IN ('CLOSED','CANCELLED')
            AND kind IN ('PROBLEM','FAULT')) AS open_problems,
         (SELECT COUNT(*) FROM maintenance_tickets WHERE deleted_at IS NULL
            AND status NOT IN ('CLOSED','CANCELLED') AND priority = 'CRITICAL') AS critical_problems,
         (SELECT COUNT(*) FROM maintenance_tickets WHERE deleted_at IS NULL
            AND status NOT IN ('CLOSED','CANCELLED')) AS open_tickets,
         (SELECT COUNT(*) FROM maintenance_tickets WHERE deleted_at IS NULL
            AND status = 'TECHNICIAN_SCHEDULED') AS technician_visits_pending,
         (SELECT COUNT(*) FROM maintenance_tickets WHERE deleted_at IS NULL
            AND status = 'WAITING_FOR_PARTS') AS parts_required,
         (SELECT COUNT(*) FROM equipment_call_logs
            WHERE outcome = 'FOLLOW_UP_REQUIRED') AS supplier_follow_ups,
         (SELECT COUNT(*) FROM equipment WHERE deleted_at IS NULL AND status <> 'RETIRED'
            AND warranty_expiry IS NOT NULL
            AND warranty_expiry BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)) AS warranty_expiring`,
      [WARRANTY_EXPIRING_DAYS],
    );
    if (row === null) {
      throw new Error('Dashboard aggregate returned no row');
    }
    return row;
  },
};
