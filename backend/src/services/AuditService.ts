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

  /**
   * Cleaning & hygiene. A hygiene record is the thing a food-safety auditor asks for, so every
   * write that changes what was cleaned, by whom, or whether it passed is audited — including
   * the ones a machine made.
   */
  CLEANING_MASTER_CREATED: 'cleaning.master.created',
  CLEANING_MASTER_UPDATED: 'cleaning.master.updated',
  CLEANING_MASTER_DELETED: 'cleaning.master.deleted',

  CLEANABLE_ASSET_CREATED: 'cleaning.asset.created',
  CLEANABLE_ASSET_UPDATED: 'cleaning.asset.updated',
  CLEANABLE_ASSET_DELETED: 'cleaning.asset.deleted',
  CLEANABLE_ASSET_AVAILABILITY_CHANGED: 'cleaning.asset.availability.changed',

  CLEANING_PROCEDURE_CREATED: 'cleaning.procedure.created',
  CLEANING_PROCEDURE_UPDATED: 'cleaning.procedure.updated',
  CLEANING_PROCEDURE_DELETED: 'cleaning.procedure.deleted',
  CLEANING_PROCEDURE_VERSION_SAVED: 'cleaning.procedure.version.saved',
  CLEANING_PROCEDURE_PUBLISHED: 'cleaning.procedure.published',
  CLEANING_PROCEDURE_ARCHIVED: 'cleaning.procedure.archived',

  CLEANING_RULE_CREATED: 'cleaning.rule.created',
  CLEANING_RULE_UPDATED: 'cleaning.rule.updated',
  CLEANING_RULE_DELETED: 'cleaning.rule.deleted',
  CLEANING_RULE_RUN: 'cleaning.rule.run',

  CLEANING_TASK_CREATED: 'cleaning.task.created',
  CLEANING_TASK_ASSIGNED: 'cleaning.task.assigned',
  CLEANING_TASK_STARTED: 'cleaning.task.started',
  CLEANING_TASK_STEP_RECORDED: 'cleaning.task.step.recorded',
  CLEANING_TASK_COMPLETED: 'cleaning.task.completed',
  CLEANING_TASK_VERIFIED: 'cleaning.task.verified',
  CLEANING_TASK_FAILED: 'cleaning.task.failed',
  CLEANING_TASK_CANCELLED: 'cleaning.task.cancelled',
  CLEANING_TASK_DELETED: 'cleaning.task.deleted',
  CLEANING_EVIDENCE_ADDED: 'cleaning.task.evidence.added',
  CLEANING_EVIDENCE_DELETED: 'cleaning.task.evidence.deleted',

  CLEANING_INCIDENT_REPORTED: 'cleaning.incident.reported',
  CLEANING_EVENT_PUBLISHED: 'cleaning.event.published',

  CLEANING_CORRECTIVE_ACTION_RAISED: 'cleaning.corrective_action.raised',
  CLEANING_CORRECTIVE_ACTION_UPDATED: 'cleaning.corrective_action.updated',
  CLEANING_CORRECTIVE_ACTION_CLOSED: 'cleaning.corrective_action.closed',

  CLEANING_SKILL_GRANTED: 'cleaning.workforce.skill.granted',
  CLEANING_SKILL_REVOKED: 'cleaning.workforce.skill.revoked',
  CLEANING_SHIFT_ASSIGNED: 'cleaning.workforce.shift.assigned',
  CLEANING_SHIFT_UNASSIGNED: 'cleaning.workforce.shift.unassigned',
  CLEANING_AREA_RESPONSIBILITY_SET: 'cleaning.workforce.area.set',
  CLEANING_AREA_RESPONSIBILITY_REMOVED: 'cleaning.workforce.area.removed',
  CLEANING_ASSIGNMENT_POLICY_SAVED: 'cleaning.assignment_policy.saved',
  CLEANING_ASSIGNMENT_POLICY_DELETED: 'cleaning.assignment_policy.deleted',

  /**
   * The purchase masters. Audited to the same standard as the menu: a product's unit, tax
   * profile and reorder level decide what a bill is checked against and what gets ordered, so
   * "who changed the pack size" has to have an answer.
   */
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  /** Per-location stock policy: the reorder levels that drive requirement generation. */
  PRODUCT_LOCATION_UPSERTED: 'product.location.upserted',
  PRODUCT_LOCATION_DELETED: 'product.location.deleted',

  INVENTORY_LOCATION_CREATED: 'inventory.location.created',
  INVENTORY_LOCATION_UPDATED: 'inventory.location.updated',
  INVENTORY_LOCATION_DELETED: 'inventory.location.deleted',

  UOM_CREATED: 'inventory.uom.created',
  UOM_UPDATED: 'inventory.uom.updated',
  UOM_DELETED: 'inventory.uom.deleted',

  /** The mapping bill-scanning resolves against. One action for insert and update alike. */
  SUPPLIER_PRODUCT_UPSERTED: 'purchase.supplier_product.upserted',
  SUPPLIER_PRODUCT_DELETED: 'purchase.supplier_product.deleted',

  /** Credit terms, bank details and the approval flag on a VENDOR entity. */
  VENDOR_PROFILE_UPDATED: 'purchase.vendor.profile.updated',

  /**
   * Stock adjustments. Audited harder than any other purchase document, because an adjustment
   * rewrites the physical truth with no supplier paperwork behind it — POSTED is the moment a
   * balance changed on somebody's word alone, and it needs a name against it forever.
   */
  STOCK_ADJUSTMENT_CREATED: 'stock.adjustment.created',
  STOCK_ADJUSTMENT_UPDATED: 'stock.adjustment.updated',
  STOCK_ADJUSTMENT_SUBMITTED: 'stock.adjustment.submitted',
  STOCK_ADJUSTMENT_POSTED: 'stock.adjustment.posted',
  STOCK_ADJUSTMENT_CANCELLED: 'stock.adjustment.cancelled',

  /** Physical counts. RECORDED covers a sheet of physical quantities being entered. */
  STOCK_COUNT_CREATED: 'stock.count.created',
  STOCK_COUNT_RECORDED: 'stock.count.recorded',
  STOCK_COUNT_SUBMITTED: 'stock.count.submitted',
  STOCK_COUNT_APPROVED: 'stock.count.approved',
  STOCK_COUNT_CANCELLED: 'stock.count.cancelled',

  /**
   * The direct purchase chain. POSTED is the moment stock, an invoice, a vendor liability and
   * possibly a payment all came into existence in one transaction, so each generated document
   * is audited in its own right rather than folded into the entry's row.
   */
  PURCHASE_ENTRY_CREATED: 'purchase.entry.created',
  PURCHASE_ENTRY_UPDATED: 'purchase.entry.updated',
  PURCHASE_ENTRY_READY: 'purchase.entry.ready',
  PURCHASE_ENTRY_POSTED: 'purchase.entry.posted',
  PURCHASE_ENTRY_CANCELLED: 'purchase.entry.cancelled',

  GOODS_RECEIPT_CREATED: 'purchase.goods_receipt.created',
  GOODS_RECEIPT_POSTED: 'purchase.goods_receipt.posted',

  PURCHASE_INVOICE_CREATED: 'purchase.invoice.created',
  PURCHASE_INVOICE_POSTED: 'purchase.invoice.posted',

  /** Money left the business. Admin only, and audited with the allocation it settled. */
  VENDOR_PAYMENT_POSTED: 'purchase.vendor_payment.posted',
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
