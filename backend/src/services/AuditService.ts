import type { UserRole } from '@menuboard/shared';
import type { Db } from '../db/types';
import { auditRepository, type AuditListFilter } from '../repositories/AuditRepository';
import { mapAuditLog } from '../models/mappers';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { buildPage, resolvePaging } from '../utils/http';

/** Canonical action names. Kept as a closed set so audit queries can rely on them. */
export const AuditAction = {
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.refresh',
  TOKEN_REUSE_DETECTED: 'auth.refresh.reuse',
  PASSWORD_CHANGED: 'auth.password.changed',

  PIN_CREATED: 'auth.pin.created',
  PIN_CHANGED: 'auth.pin.changed',
  PIN_REMOVED: 'auth.pin.removed',
  PASSKEY_REGISTERED: 'auth.passkey.registered',
  PASSKEY_REMOVED: 'auth.passkey.removed',
  FAST_AUTH_PIN_SUCCESS: 'auth.fast.pin.success',
  FAST_AUTH_PIN_FAILED: 'auth.fast.pin.failed',
  FAST_AUTH_PASSKEY_SUCCESS: 'auth.fast.passkey.success',
  FAST_AUTH_PASSKEY_FAILED: 'auth.fast.passkey.failed',
  ACCOUNT_LOCKED: 'auth.account.locked',

  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  USER_ROLE_CHANGED: 'user.role.changed',

  BOARD_CREATED: 'board.created',
  BOARD_UPDATED: 'board.updated',
  BOARD_ARCHIVED: 'board.archived',
  BOARD_MEMBER_ADDED: 'board.member.added',
  BOARD_MEMBER_UPDATED: 'board.member.updated',
  BOARD_MEMBER_REMOVED: 'board.member.removed',

  MASTER_CREATED: 'master.created',
  MASTER_UPDATED: 'master.updated',
  MASTER_DELETED: 'master.deleted',

  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_STATUS_CHANGED: 'order.status.changed',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_ACKNOWLEDGED: 'order.acknowledged',

  THREAD_MESSAGE_POSTED: 'thread.message.posted',
  THREAD_MESSAGE_DELETED: 'thread.message.deleted',

  ATTACHMENT_UPLOADED: 'attachment.uploaded',
  ATTACHMENT_DELETED: 'attachment.deleted',

  BILLING_GENERATED: 'billing.generated',
  BILLING_STATUS_CHANGED: 'billing.status.changed',

  SETTING_UPDATED: 'setting.updated',
  PERMISSION_UPDATED: 'permission.updated',

  GST_MASTER_SYNCED: 'tax.gst.synced',
  GST_MASTER_SYNC_FAILED: 'tax.gst.sync.failed',
  TAX_PROFILE_CREATED: 'tax.profile.created',
  TAX_PROFILE_UPDATED: 'tax.profile.updated',
  TAX_PROFILE_DELETED: 'tax.profile.deleted',
  /** An HSN/SAC code assigned outside the synchronized active master, by an authorised admin. */
  TAX_HSN_OVERRIDDEN: 'tax.hsn.overridden',

  TASK_ASSIGNED: 'task.assigned',
  TASK_SELF_CREATED: 'task.self.created',
  TASK_UPDATED: 'task.updated',
  TASK_STARTED: 'task.started',
  TASK_STOPPED: 'task.stopped',
  TASK_COMPLETED: 'task.completed',
  TASK_CANCELLED: 'task.cancelled',
  TASK_DELETED: 'task.deleted',

  ENTITY_CREATED: 'entity.created',
  ENTITY_UPDATED: 'entity.updated',
  ENTITY_DELETED: 'entity.deleted',

  POS_ORDER_CREATED: 'pos.order.created',
  POS_ORDER_UPDATED: 'pos.order.updated',
  POS_ORDER_STATUS_CHANGED: 'pos.order.status.changed',
  POS_ORDER_CHECKED_OUT: 'pos.order.checked.out',
  /** A settled sale reversed by an offsetting payment. Manager and above. */
  POS_ORDER_VOIDED: 'pos.order.voided',
  /** A bill sent to a physical printer — the one moment MenuBoard drives hardware. */
  POS_BILL_PRINTED: 'pos.bill.printed',
  /** A bill sent to a guest's own phone. Recorded because it leaves the premises. */
  POS_BILL_WHATSAPP_SENT: 'pos.bill.whatsapp.sent',

  /**
   * A counter swap on a settled-but-open ticket: lines cancelled as EXCHANGED and replacement
   * lines written at the same value. Audited because it rewrites what a paid bill is for.
   */
  KDS_ORDER_EXCHANGED: 'kds.order.exchanged',

  /**
   * A counter marked a dish finished (or put it back), or its counted stock ran out. Audited
   * because it is a write from a wall screen into the *menu* — the dish leaves every Digital
   * Menu Board until the next shift reset, and later "why did it vanish at 7pm" deserves an
   * answer naming the counter that said so.
   */
  MENU_ITEM_AVAILABILITY_SET: 'menu.item.availability.set',

  /**
   * The self-service stands. Audited because a kiosk row names the UPI account a guest's money
   * goes to: re-pointing a stand at a different payee is a financial change, and one made from
   * a desk rather than in front of the device it affects.
   */
  KIOSK_DEVICE_CREATED: 'kiosk.device.created',
  KIOSK_DEVICE_UPDATED: 'kiosk.device.updated',
  KIOSK_DEVICE_DELETED: 'kiosk.device.deleted',

  /**
   * The Digital Menu Board screens. Audited because a screen row decides which menu — and
   * therefore which prices — a hall full of guests reads off the wall, and because the board
   * itself is unauthenticated: the row is the only place that choice is recorded being made.
   */
  MENU_BOARD_SCREEN_CREATED: 'menuBoard.screen.created',
  MENU_BOARD_SCREEN_UPDATED: 'menuBoard.screen.updated',
  MENU_BOARD_SCREEN_DELETED: 'menuBoard.screen.deleted',

  /**
   * The shift-change auto-reset (`MenuShiftSchedulerService`): un-hides whatever a shift boundary
   * brings back onto a menu. Audited under a system actor because nobody clicked anything — the
   * clock did — and an operator later wondering why an item that was 86'd is available again
   * needs a row that says so, not a mystery.
   */
  MENU_SHIFT_RESET: 'menu.shift.reset',

  EQUIPMENT_CREATED: 'equipment.created',
  EQUIPMENT_UPDATED: 'equipment.updated',
  EQUIPMENT_DELETED: 'equipment.deleted',
  EQUIPMENT_STATUS_CHANGED: 'equipment.status.changed',
  EQUIPMENT_MOVED: 'equipment.moved',
  EQUIPMENT_DOCUMENT_UPLOADED: 'equipment.document.uploaded',
  EQUIPMENT_DOCUMENT_DELETED: 'equipment.document.deleted',
  EQUIPMENT_WARRANTY_RECORDED: 'equipment.warranty.recorded',
  EQUIPMENT_SUPPLIER_LINKED: 'equipment.supplier.linked',
  EQUIPMENT_SUPPLIER_UNLINKED: 'equipment.supplier.unlinked',

  FLOOR_PLAN_UPLOADED: 'equipment.floorplan.uploaded',
  FLOOR_PLAN_UPDATED: 'equipment.floorplan.updated',
  FLOOR_PLAN_DELETED: 'equipment.floorplan.deleted',
  FLOOR_PLAN_POSITION_SET: 'equipment.floorplan.position.set',
  FLOOR_PLAN_POSITION_REMOVED: 'equipment.floorplan.position.removed',

  MAINTENANCE_TICKET_CREATED: 'maintenance.ticket.created',
  MAINTENANCE_TICKET_UPDATED: 'maintenance.ticket.updated',
  MAINTENANCE_TICKET_STATUS_CHANGED: 'maintenance.ticket.status.changed',
  MAINTENANCE_TICKET_ASSIGNED: 'maintenance.ticket.assigned',
  MAINTENANCE_TICKET_COMPLETED: 'maintenance.ticket.completed',
  MAINTENANCE_TICKET_DELETED: 'maintenance.ticket.deleted',
  MAINTENANCE_SCHEDULE_CREATED: 'maintenance.schedule.created',
  MAINTENANCE_SCHEDULE_UPDATED: 'maintenance.schedule.updated',
  MAINTENANCE_SCHEDULE_DELETED: 'maintenance.schedule.deleted',

  SUPPLIER_CREATED: 'supplier.created',
  SUPPLIER_UPDATED: 'supplier.updated',
  SUPPLIER_DELETED: 'supplier.deleted',
  SUPPLIER_CONTACT_SAVED: 'supplier.contact.saved',
  SUPPLIER_CONTACT_DELETED: 'supplier.contact.deleted',
  /** The dial intent was opened. Written before the call connects — see the 025 header. */
  SUPPLIER_CALLED: 'supplier.called',
  SUPPLIER_WHATSAPP_SENT: 'supplier.whatsapp.sent',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditActor {
  userId: string | null;
  role: UserRole | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  boardId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Every mutation records an audit row, written on the caller's connection so it commits or
 * rolls back with the change it describes. An audit trail that can disagree with the data is
 * worse than none.
 */
export class AuditService {
  async record(db: Db, actor: AuditActor, entry: AuditEntry): Promise<void> {
    try {
      await auditRepository.insert(db, {
        id: newId(),
        actorId: actor.userId,
        actorRole: actor.role,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        boardId: entry.boardId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip: actor.ip,
        userAgent: actor.userAgent,
        requestId: actor.requestId,
      });
    } catch (error) {
      // Audit is important but must not mask the real failure. Log loudly and rethrow so the
      // surrounding transaction still rolls back — a silent audit gap is a compliance hole.
      logger.error('Failed to write audit row', { action: entry.action }, error);
      throw error;
    }
  }

  async list(db: Db, query: AuditListFilter & { page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = resolvePaging(query);
    const { rows, total } = await auditRepository.list(db, {
      ...query,
      limit: pageSize,
      offset,
    });
    return buildPage(rows.map(mapAuditLog), total, page, pageSize);
  }

  async listForEntity(db: Db, entityType: string, entityId: string, limit = 100) {
    const rows = await auditRepository.listForEntity(db, entityType, entityId, limit);
    return rows.map(mapAuditLog);
  }
}

export const auditService = new AuditService();
