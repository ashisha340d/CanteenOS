import type { CallOutcome, CallStatus, MasterStatus } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CountRow,
  EquipmentCallLogRow,
  EquipmentSupplierRow,
  EquipmentWhatsappLogRow,
  SupplierContactRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the maintenance supplier master, its contacts, and the record of every call
 * and WhatsApp message sent about a piece of equipment.
 *
 * The two log tables live here rather than with the tickets because they are supplier
 * communication first and ticket satellites second: a call is routinely placed from the
 * equipment profile with no ticket open at all.
 */

const SUPPLIER_SELECT = `SELECT s.*,
         ent.name AS entity_name,
         (SELECT GROUP_CONCAT(ssc.category_id) FROM supplier_service_categories ssc
           WHERE ssc.supplier_id = s.id) AS category_ids,
         (SELECT GROUP_CONCAT(c.name ORDER BY c.sort_order) FROM supplier_service_categories ssc
            JOIN equipment_categories c ON c.id = ssc.category_id
           WHERE ssc.supplier_id = s.id) AS category_names,
         (SELECT COUNT(DISTINCT esl.equipment_id) FROM equipment_supplier_links esl
           WHERE esl.supplier_id = s.id) AS equipment_count,
         (SELECT COUNT(*) FROM maintenance_tickets t
           WHERE t.supplier_id = s.id AND t.deleted_at IS NULL
             AND t.status NOT IN ('CLOSED','CANCELLED')) AS open_ticket_count
    FROM equipment_suppliers s
    LEFT JOIN entities ent ON ent.id = s.entity_id`;

export interface SupplierListFilter {
  search?: string;
  status?: MasterStatus;
  categoryId?: string;
  limit: number;
  offset: number;
}

export interface SupplierInsert {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  serviceCategory: string | null;
  serviceArea: string | null;
  notes: string | null;
  entityId: string | null;
  status: MasterStatus;
  createdBy: string | null;
}

function listWhere(filter: SupplierListFilter): { where: string; params: unknown[] } {
  const conditions = ['s.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    conditions.push('s.status = ?');
    params.push(filter.status);
  }
  if (filter.categoryId !== undefined) {
    conditions.push(
      'EXISTS (SELECT 1 FROM supplier_service_categories ssc WHERE ssc.supplier_id = s.id AND ssc.category_id = ?)',
    );
    params.push(filter.categoryId);
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push('(s.name LIKE ? OR s.code LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const SupplierRepository = {
  async list(db: Db, filter: SupplierListFilter): Promise<EquipmentSupplierRow[]> {
    const { where, params } = listWhere(filter);
    return selectRows<EquipmentSupplierRow>(
      db,
      `${SUPPLIER_SELECT} ${where} ORDER BY s.status, s.name LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: SupplierListFilter): Promise<number> {
    const { where, params } = listWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM equipment_suppliers s ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findById(db: Db, id: string): Promise<EquipmentSupplierRow | null> {
    return selectOne<EquipmentSupplierRow>(
      db,
      `${SUPPLIER_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL`,
      [id],
    );
  },

  /** Highest existing numeric suffix for the auto-allocated `SUP-0001` code. */
  async nextCodeSequence(db: Db): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(CAST(SUBSTRING(code, 5) AS UNSIGNED)), 0) AS total
         FROM equipment_suppliers WHERE code LIKE 'SUP-%' FOR UPDATE`,
    );
    return Number(row?.total ?? 0) + 1;
  },

  async insert(db: Db, input: SupplierInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_suppliers
         (id, code, name, contact_person, phone, whatsapp, email, service_category,
          service_area, notes, entity_id, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.contactPerson,
        input.phone,
        input.whatsapp,
        input.email,
        input.serviceCategory,
        input.serviceArea,
        input.notes,
        input.entityId,
        input.status,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async update(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE equipment_suppliers SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE equipment_suppliers SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /** How many assets would lose their configured supplier if this one were removed. */
  async countLinkedEquipment(db: Db, supplierId: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM equipment_supplier_links WHERE supplier_id = ?`,
      [supplierId],
    );
    return Number(row?.total ?? 0);
  },

  /* ------------------------------------------------------------ service categories */

  async replaceServiceCategories(db: Db, supplierId: string, categoryIds: string[]): Promise<void> {
    await mutate(db, `DELETE FROM supplier_service_categories WHERE supplier_id = ?`, [supplierId]);
    if (categoryIds.length === 0) return;

    const now = toDbDateTime();
    const placeholders = categoryIds.map(() => '(?,?,?)').join(', ');
    const params = categoryIds.flatMap((categoryId) => [supplierId, categoryId, now]);
    await mutate(
      db,
      `INSERT INTO supplier_service_categories (supplier_id, category_id, created_at)
       VALUES ${placeholders}`,
      params,
    );
  },

  /* -------------------------------------------------------------------- contacts */

  async listContacts(db: Db, supplierId: string): Promise<SupplierContactRow[]> {
    return selectRows<SupplierContactRow>(
      db,
      `SELECT * FROM supplier_contacts
        WHERE supplier_id = ? AND deleted_at IS NULL
        ORDER BY is_primary DESC, name`,
      [supplierId],
    );
  },

  async findContactById(db: Db, id: string): Promise<SupplierContactRow | null> {
    return selectOne<SupplierContactRow>(
      db,
      `SELECT * FROM supplier_contacts WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  },

  async insertContact(
    db: Db,
    input: {
      id: string;
      supplierId: string;
      name: string;
      role: string | null;
      phone: string | null;
      whatsapp: string | null;
      email: string | null;
      isPrimary: boolean;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO supplier_contacts
         (id, supplier_id, name, role, phone, whatsapp, email, is_primary, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.supplierId,
        input.name,
        input.role,
        input.phone,
        input.whatsapp,
        input.email,
        input.isPrimary ? 1 : 0,
        now,
        now,
      ],
    );
  },

  async updateContact(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE supplier_contacts SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  /** At most one primary contact per supplier; called inside the setting transaction. */
  async clearPrimaryContact(db: Db, supplierId: string, keepId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE supplier_contacts SET is_primary = 0, updated_at = ?
        WHERE supplier_id = ? AND id <> ?`,
      [toDbDateTime(), supplierId, keepId],
    );
  },

  async softDeleteContact(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE supplier_contacts SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /* ------------------------------------------------------------------- call logs */

  async insertCallLog(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      ticketId: string | null;
      supplierId: string | null;
      contactId: string | null;
      phoneNumber: string;
      calledBy: string;
      status: CallStatus;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_call_logs
         (id, equipment_id, ticket_id, supplier_id, contact_id, phone_number, called_by,
          called_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.ticketId,
        input.supplierId,
        input.contactId,
        input.phoneNumber,
        input.calledBy,
        now,
        input.status,
        now,
        now,
      ],
    );
  },

  async findCallLogById(db: Db, id: string): Promise<EquipmentCallLogRow | null> {
    return selectOne<EquipmentCallLogRow>(
      db,
      `SELECT cl.*, s.name AS supplier_name, u.name AS called_by_name
         FROM equipment_call_logs cl
         LEFT JOIN equipment_suppliers s ON s.id = cl.supplier_id
         LEFT JOIN users u ON u.id = cl.called_by
        WHERE cl.id = ?`,
      [id],
    );
  },

  async updateCallLog(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE equipment_call_logs SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async listCallLogs(
    db: Db,
    filter: { equipmentId?: string; ticketId?: string; supplierId?: string; outcome?: CallOutcome; limit: number },
  ): Promise<EquipmentCallLogRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.equipmentId !== undefined) {
      conditions.push('cl.equipment_id = ?');
      params.push(filter.equipmentId);
    }
    if (filter.ticketId !== undefined) {
      conditions.push('cl.ticket_id = ?');
      params.push(filter.ticketId);
    }
    if (filter.supplierId !== undefined) {
      conditions.push('cl.supplier_id = ?');
      params.push(filter.supplierId);
    }
    if (filter.outcome !== undefined) {
      conditions.push('cl.outcome = ?');
      params.push(filter.outcome);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return selectRows<EquipmentCallLogRow>(
      db,
      `SELECT cl.*, s.name AS supplier_name, u.name AS called_by_name
         FROM equipment_call_logs cl
         LEFT JOIN equipment_suppliers s ON s.id = cl.supplier_id
         LEFT JOIN users u ON u.id = cl.called_by
        ${where}
        ORDER BY cl.called_at DESC
        LIMIT ?`,
      [...params, filter.limit],
    );
  },

  /* --------------------------------------------------------------- whatsapp logs */

  async insertWhatsappLog(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      ticketId: string | null;
      supplierId: string | null;
      phoneNumber: string;
      message: string;
      mediaIds: string | null;
      sentBy: string;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_whatsapp_logs
         (id, equipment_id, ticket_id, supplier_id, phone_number, message, media_ids, sent_by,
          sent_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.ticketId,
        input.supplierId,
        input.phoneNumber,
        input.message,
        input.mediaIds,
        input.sentBy,
        now,
        now,
      ],
    );
  },

  async listWhatsappLogs(
    db: Db,
    filter: { equipmentId?: string; ticketId?: string; supplierId?: string; limit: number },
  ): Promise<EquipmentWhatsappLogRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.equipmentId !== undefined) {
      conditions.push('wl.equipment_id = ?');
      params.push(filter.equipmentId);
    }
    if (filter.ticketId !== undefined) {
      conditions.push('wl.ticket_id = ?');
      params.push(filter.ticketId);
    }
    if (filter.supplierId !== undefined) {
      conditions.push('wl.supplier_id = ?');
      params.push(filter.supplierId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    return selectRows<EquipmentWhatsappLogRow>(
      db,
      `SELECT wl.*, s.name AS supplier_name, u.name AS sent_by_name
         FROM equipment_whatsapp_logs wl
         LEFT JOIN equipment_suppliers s ON s.id = wl.supplier_id
         LEFT JOIN users u ON u.id = wl.sent_by
        ${where}
        ORDER BY wl.sent_at DESC
        LIMIT ?`,
      [...params, filter.limit],
    );
  },
};
