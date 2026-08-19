import type {
  CaptureSource,
  EquipmentDocumentType,
  EquipmentStatus,
  EquipmentSupplierRole,
  MaintenanceFrequency,
  MasterStatus,
  WarrantyStatus,
} from '@menuboard/shared';
import { WARRANTY_EXPIRING_DAYS } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type {
  CountRow,
  EquipmentAreaRow,
  EquipmentCategoryRow,
  EquipmentDocumentRow,
  EquipmentFloorRow,
  EquipmentLocationHistoryRow,
  EquipmentLocationRow,
  EquipmentRow,
  EquipmentStatusHistoryRow,
  EquipmentSupplierLinkRow,
  EquipmentWarrantyRow,
} from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * Persistence for the equipment record, its location/category masters and its per-asset
 * history (025_equipment_maintenance.sql).
 *
 * The SELECT below joins the whole location chain on every read. That is deliberate: an
 * equipment card is useless without "Ground Floor · Main Kitchen · Hot Line", and every
 * surface in the module shows one, so making the join optional would only mean every caller
 * asks for it anyway.
 *
 * No sync bookkeeping — this module is REST-served to both clients (see the migration header).
 */

const EQUIPMENT_SELECT = `SELECT e.*,
         c.name AS category_name,
         l.name AS location_name, l.room AS room, l.section AS section, l.position AS position,
         a.id AS area_id, a.name AS area_name,
         f.id AS floor_id, f.name AS floor_name,
         u.name AS created_by_name
    FROM equipment e
    LEFT JOIN equipment_categories c ON c.id = e.category_id
    LEFT JOIN equipment_locations l ON l.id = e.location_id
    LEFT JOIN equipment_areas a ON a.id = l.area_id
    LEFT JOIN equipment_floors f ON f.id = a.floor_id
    LEFT JOIN users u ON u.id = e.created_by`;

export interface EquipmentListFilter {
  search?: string;
  status?: EquipmentStatus;
  categoryId?: string;
  floorId?: string;
  areaId?: string;
  locationId?: string;
  supplierId?: string;
  warrantyStatus?: WarrantyStatus;
  hasOpenProblems?: boolean;
  maintenanceDue?: boolean;
  maintenanceOverdue?: boolean;
  /** Excludes RETIRED, which is how the normal list behaves unless a status is asked for. */
  excludeRetired?: boolean;
  limit: number;
  offset: number;
}

export interface EquipmentInsert {
  id: string;
  assetId: string;
  name: string;
  equipmentType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  locationId: string | null;
  status: EquipmentStatus;
  imageMediaId: string | null;
  specifications: string | null;
  purchaseDate: string | null;
  installationDate: string | null;
  purchasePrice: number | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  warrantyExpiry: string | null;
  qrCode: string | null;
  nfcTagId: string | null;
  notes: string | null;
  capturedVia: CaptureSource;
  createdBy: string | null;
}

function listWhere(filter: EquipmentListFilter): { where: string; params: unknown[] } {
  const conditions = ['e.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    conditions.push('e.status = ?');
    params.push(filter.status);
  } else if (filter.excludeRetired === true) {
    conditions.push("e.status <> 'RETIRED'");
  }
  if (filter.categoryId !== undefined) {
    conditions.push('e.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.locationId !== undefined) {
    conditions.push('e.location_id = ?');
    params.push(filter.locationId);
  }
  if (filter.areaId !== undefined) {
    conditions.push('a.id = ?');
    params.push(filter.areaId);
  }
  if (filter.floorId !== undefined) {
    conditions.push('f.id = ?');
    params.push(filter.floorId);
  }
  if (filter.supplierId !== undefined) {
    conditions.push(
      'EXISTS (SELECT 1 FROM equipment_supplier_links esl WHERE esl.equipment_id = e.id AND esl.supplier_id = ?)',
    );
    params.push(filter.supplierId);
  }
  if (filter.hasOpenProblems === true) {
    conditions.push('e.open_ticket_count > 0');
  }
  if (filter.maintenanceOverdue === true) {
    conditions.push('e.next_maintenance_at IS NOT NULL AND e.next_maintenance_at < CURDATE()');
  } else if (filter.maintenanceDue === true) {
    // "Due" means due now or within the week — an overdue asset is also due.
    conditions.push(
      'e.next_maintenance_at IS NOT NULL AND e.next_maintenance_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)',
    );
  }
  if (filter.warrantyStatus !== undefined) {
    switch (filter.warrantyStatus) {
      case 'ACTIVE':
        conditions.push(
          'e.warranty_expiry IS NOT NULL AND e.warranty_expiry > DATE_ADD(CURDATE(), INTERVAL ? DAY)',
        );
        params.push(WARRANTY_EXPIRING_DAYS);
        break;
      case 'EXPIRING_SOON':
        conditions.push(
          'e.warranty_expiry IS NOT NULL AND e.warranty_expiry >= CURDATE() AND e.warranty_expiry <= DATE_ADD(CURDATE(), INTERVAL ? DAY)',
        );
        params.push(WARRANTY_EXPIRING_DAYS);
        break;
      case 'EXPIRED':
        conditions.push('e.warranty_expiry IS NOT NULL AND e.warranty_expiry < CURDATE()');
        break;
      default:
        conditions.push('e.warranty_expiry IS NULL');
        break;
    }
  }
  if (filter.search !== undefined && filter.search !== '') {
    conditions.push(
      '(e.name LIKE ? OR e.asset_id LIKE ? OR e.brand LIKE ? OR e.model LIKE ? OR e.serial_number LIKE ? OR e.equipment_type LIKE ?)',
    );
    const like = `%${filter.search}%`;
    params.push(like, like, like, like, like, like);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export const EquipmentRepository = {
  async list(db: Db, filter: EquipmentListFilter): Promise<EquipmentRow[]> {
    const { where, params } = listWhere(filter);
    return selectRows<EquipmentRow>(
      db,
      `${EQUIPMENT_SELECT} ${where}
        ORDER BY e.critical_ticket_count DESC, e.open_ticket_count DESC,
                 e.next_maintenance_at IS NULL, e.next_maintenance_at, e.name
        LIMIT ? OFFSET ?`,
      [...params, filter.limit, filter.offset],
    );
  },

  async count(db: Db, filter: EquipmentListFilter): Promise<number> {
    const { where, params } = listWhere(filter);
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total
         FROM equipment e
         LEFT JOIN equipment_locations l ON l.id = e.location_id
         LEFT JOIN equipment_areas a ON a.id = l.area_id
         LEFT JOIN equipment_floors f ON f.id = a.floor_id
        ${where}`,
      params,
    );
    return Number(row?.total ?? 0);
  },

  async findById(db: Db, id: string): Promise<EquipmentRow | null> {
    return selectOne<EquipmentRow>(
      db,
      `${EQUIPMENT_SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`,
      [id],
    );
  },

  /** Resolves a scanned QR payload or a typed asset id to the asset itself. */
  async findByAssetIdOrQr(db: Db, value: string): Promise<EquipmentRow | null> {
    return selectOne<EquipmentRow>(
      db,
      `${EQUIPMENT_SELECT} WHERE (e.asset_id = ? OR e.qr_code = ? OR e.nfc_tag_id = ?) AND e.deleted_at IS NULL`,
      [value, value, value],
    );
  },

  async listByFloor(db: Db, floorId: string): Promise<EquipmentRow[]> {
    return selectRows<EquipmentRow>(
      db,
      `${EQUIPMENT_SELECT}
        WHERE f.id = ? AND e.deleted_at IS NULL AND e.status <> 'RETIRED'
        ORDER BY e.name`,
      [floorId],
    );
  },

  /**
   * Next sequence number for an asset-id prefix. `FOR UPDATE` on the matching rows makes two
   * simultaneous registrations safe; the unique key on `asset_id` is the backstop.
   */
  async nextAssetSequence(db: Db, prefix: string): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(asset_id, '-', -1) AS UNSIGNED)), 0) AS total
         FROM equipment
        WHERE asset_id LIKE ?
        FOR UPDATE`,
      [`${prefix}-%`],
    );
    return Number(row?.total ?? 0) + 1;
  },

  async insert(db: Db, input: EquipmentInsert): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment
         (id, asset_id, name, equipment_type, brand, model, serial_number, manufacturer,
          category_id, location_id, status, status_changed_at, image_media_id, specifications,
          purchase_date, installation_date, purchase_price, invoice_number, supplier_name,
          warranty_expiry, qr_code, nfc_tag_id, notes, captured_via, created_by,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.assetId,
        input.name,
        input.equipmentType,
        input.brand,
        input.model,
        input.serialNumber,
        input.manufacturer,
        input.categoryId,
        input.locationId,
        input.status,
        now,
        input.imageMediaId,
        input.specifications,
        input.purchaseDate,
        input.installationDate,
        input.purchasePrice,
        input.invoiceNumber,
        input.supplierName,
        input.warrantyExpiry,
        input.qrCode,
        input.nfcTagId,
        input.notes,
        input.capturedVia,
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
      `UPDATE equipment SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE equipment SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /**
   * Recomputes the asset's open/critical ticket counters from the tickets themselves.
   *
   * Called inside the same transaction as every ticket state change. Recomputing beats
   * incrementing: an increment that misses one path leaves a counter permanently wrong, while
   * this is idempotent and self-healing.
   */
  async refreshTicketCounters(db: Db, equipmentId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE equipment e
          SET e.open_ticket_count = (
                SELECT COUNT(*) FROM maintenance_tickets t
                 WHERE t.equipment_id = e.id AND t.deleted_at IS NULL
                   AND t.status NOT IN ('CLOSED','CANCELLED')),
              e.critical_ticket_count = (
                SELECT COUNT(*) FROM maintenance_tickets t
                 WHERE t.equipment_id = e.id AND t.deleted_at IS NULL
                   AND t.status NOT IN ('CLOSED','CANCELLED') AND t.priority = 'CRITICAL'),
              e.updated_at = ?
        WHERE e.id = ?`,
      [toDbDateTime(), equipmentId],
    );
  },

  /** Mirrors the earliest active schedule onto the asset so lists need no join. */
  async refreshMaintenanceDates(db: Db, equipmentId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE equipment e
          SET e.next_maintenance_at = (
                SELECT MIN(s.next_due_at) FROM maintenance_schedules s
                 WHERE s.equipment_id = e.id AND s.is_active = 1 AND s.deleted_at IS NULL),
              e.last_maintenance_at = (
                SELECT MAX(s.last_performed_at) FROM maintenance_schedules s
                 WHERE s.equipment_id = e.id AND s.deleted_at IS NULL),
              e.updated_at = ?
        WHERE e.id = ?`,
      [toDbDateTime(), equipmentId],
    );
  },

  /** Mirrors the latest active warranty's expiry onto the asset. */
  async refreshWarrantyExpiry(db: Db, equipmentId: string): Promise<void> {
    await mutate(
      db,
      `UPDATE equipment e
          SET e.warranty_expiry = (
                SELECT MAX(w.expiry_date) FROM equipment_warranties w
                 WHERE w.equipment_id = e.id AND w.is_active = 1 AND w.deleted_at IS NULL),
              e.updated_at = ?
        WHERE e.id = ?`,
      [toDbDateTime(), equipmentId],
    );
  },

  /* --------------------------------------------------------------- status history */

  async insertStatusHistory(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      fromStatus: EquipmentStatus | null;
      toStatus: EquipmentStatus;
      note: string | null;
      ticketId: string | null;
      changedBy: string | null;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO equipment_status_history
         (id, equipment_id, from_status, to_status, note, ticket_id, changed_by, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.fromStatus,
        input.toStatus,
        input.note,
        input.ticketId,
        input.changedBy,
        toDbDateTime(),
      ],
    );
  },

  async listStatusHistory(db: Db, equipmentId: string, limit: number): Promise<EquipmentStatusHistoryRow[]> {
    return selectRows<EquipmentStatusHistoryRow>(
      db,
      `SELECT h.*, u.name AS changed_by_name
         FROM equipment_status_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.equipment_id = ?
        ORDER BY h.created_at DESC
        LIMIT ?`,
      [equipmentId, limit],
    );
  },

  async insertLocationHistory(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      fromLocationId: string | null;
      toLocationId: string | null;
      fromPath: string | null;
      toPath: string | null;
      note: string | null;
      movedBy: string | null;
    },
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO equipment_location_history
         (id, equipment_id, from_location_id, to_location_id, from_path, to_path, note,
          moved_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.fromLocationId,
        input.toLocationId,
        input.fromPath,
        input.toPath,
        input.note,
        input.movedBy,
        toDbDateTime(),
      ],
    );
  },

  async listLocationHistory(
    db: Db,
    equipmentId: string,
    limit: number,
  ): Promise<EquipmentLocationHistoryRow[]> {
    return selectRows<EquipmentLocationHistoryRow>(
      db,
      `SELECT h.*, u.name AS moved_by_name
         FROM equipment_location_history h
         LEFT JOIN users u ON u.id = h.moved_by
        WHERE h.equipment_id = ?
        ORDER BY h.created_at DESC
        LIMIT ?`,
      [equipmentId, limit],
    );
  },

  /* ------------------------------------------------------------------- documents */

  async insertDocument(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      mediaId: string;
      docType: EquipmentDocumentType;
      title: string | null;
      extracted: string | null;
      uploadedBy: string;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_documents
         (id, equipment_id, media_id, doc_type, title, extracted, uploaded_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.mediaId,
        input.docType,
        input.title,
        input.extracted,
        input.uploadedBy,
        now,
        now,
      ],
    );
  },

  async listDocuments(db: Db, equipmentId: string): Promise<EquipmentDocumentRow[]> {
    return selectRows<EquipmentDocumentRow>(
      db,
      `SELECT d.*, m.file_name, m.mime_type, m.size_bytes, u.name AS uploaded_by_name
         FROM equipment_documents d
         JOIN media_assets m ON m.id = d.media_id
         LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.equipment_id = ? AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC`,
      [equipmentId],
    );
  },

  async findDocumentById(db: Db, id: string): Promise<EquipmentDocumentRow | null> {
    return selectOne<EquipmentDocumentRow>(
      db,
      `SELECT d.*, m.file_name, m.mime_type, m.size_bytes, u.name AS uploaded_by_name
         FROM equipment_documents d
         JOIN media_assets m ON m.id = d.media_id
         LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.id = ? AND d.deleted_at IS NULL`,
      [id],
    );
  },

  async softDeleteDocument(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE equipment_documents SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },

  /* ------------------------------------------------------------------ warranties */

  async insertWarranty(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      provider: string | null;
      policyNumber: string | null;
      startDate: string | null;
      expiryDate: string | null;
      months: number | null;
      terms: string | null;
      documentId: string | null;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_warranties
         (id, equipment_id, provider, policy_number, start_date, expiry_date, months, terms,
          document_id, is_active, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      [
        input.id,
        input.equipmentId,
        input.provider,
        input.policyNumber,
        input.startDate,
        input.expiryDate,
        input.months,
        input.terms,
        input.documentId,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  /** Supersedes every active warranty. Rows are kept — a lapsed policy is still history. */
  async deactivateWarranties(db: Db, equipmentId: string): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `UPDATE equipment_warranties SET is_active = 0, updated_at = ?
        WHERE equipment_id = ? AND is_active = 1 AND deleted_at IS NULL`,
      [now, equipmentId],
    );
  },

  async listWarranties(db: Db, equipmentId: string): Promise<EquipmentWarrantyRow[]> {
    return selectRows<EquipmentWarrantyRow>(
      db,
      `SELECT * FROM equipment_warranties
        WHERE equipment_id = ? AND deleted_at IS NULL
        ORDER BY expiry_date DESC`,
      [equipmentId],
    );
  },

  /* -------------------------------------------------------------- supplier links */

  async listSupplierLinks(db: Db, equipmentId: string): Promise<EquipmentSupplierLinkRow[]> {
    return selectRows<EquipmentSupplierLinkRow>(
      db,
      `SELECT esl.*, s.name AS supplier_name, s.phone, s.whatsapp, s.contact_person
         FROM equipment_supplier_links esl
         JOIN equipment_suppliers s ON s.id = esl.supplier_id
        WHERE esl.equipment_id = ?
        ORDER BY esl.is_default DESC, FIELD(esl.role,'MAINTENANCE','PRIMARY','ALTERNATIVE')`,
      [equipmentId],
    );
  },

  async upsertSupplierLink(
    db: Db,
    input: {
      id: string;
      equipmentId: string;
      supplierId: string;
      role: EquipmentSupplierRole;
      isDefault: boolean;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_supplier_links
         (id, equipment_id, supplier_id, role, is_default, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE supplier_id = VALUES(supplier_id),
                               is_default = VALUES(is_default),
                               updated_at = VALUES(updated_at)`,
      [
        input.id,
        input.equipmentId,
        input.supplierId,
        input.role,
        input.isDefault ? 1 : 0,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  /** At most one default per asset; called inside the transaction that sets the new one. */
  async clearDefaultSupplier(db: Db, equipmentId: string, keepRole: EquipmentSupplierRole): Promise<void> {
    await mutate(
      db,
      `UPDATE equipment_supplier_links SET is_default = 0, updated_at = ?
        WHERE equipment_id = ? AND role <> ?`,
      [toDbDateTime(), equipmentId, keepRole],
    );
  },

  async removeSupplierLink(db: Db, equipmentId: string, role: EquipmentSupplierRole): Promise<boolean> {
    const result = await mutate(
      db,
      `DELETE FROM equipment_supplier_links WHERE equipment_id = ? AND role = ?`,
      [equipmentId, role],
    );
    return result.affectedRows > 0;
  },

  /**
   * The supplier a one-tap Call/WhatsApp should reach.
   *
   * Explicit default first, then the maintenance/primary/alternative preference order, and
   * finally any supplier that covers this asset's category — so the button still works for an
   * asset nobody has configured a supplier for yet.
   */
  async resolveContactSupplier(db: Db, equipmentId: string): Promise<EquipmentSupplierLinkRow | null> {
    const linked = await selectOne<EquipmentSupplierLinkRow>(
      db,
      `SELECT esl.*, s.name AS supplier_name, s.phone, s.whatsapp, s.contact_person
         FROM equipment_supplier_links esl
         JOIN equipment_suppliers s ON s.id = esl.supplier_id
        WHERE esl.equipment_id = ? AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
        ORDER BY esl.is_default DESC, FIELD(esl.role,'MAINTENANCE','PRIMARY','ALTERNATIVE')
        LIMIT 1`,
      [equipmentId],
    );
    if (linked !== null) return linked;

    return selectOne<EquipmentSupplierLinkRow>(
      db,
      `SELECT NULL AS id, e.id AS equipment_id, s.id AS supplier_id, 'MAINTENANCE' AS role,
              0 AS is_default, NULL AS created_by, s.created_at, s.updated_at,
              s.name AS supplier_name, s.phone, s.whatsapp, s.contact_person
         FROM equipment e
         JOIN supplier_service_categories ssc ON ssc.category_id = e.category_id
         JOIN equipment_suppliers s ON s.id = ssc.supplier_id
        WHERE e.id = ? AND s.status = 'ACTIVE' AND s.deleted_at IS NULL
        ORDER BY s.name
        LIMIT 1`,
      [equipmentId],
    );
  },
};

/* ------------------------------------------------------------- location masters */

export interface LocationMasterInsert {
  id: string;
  code: string;
  name: string;
  createdBy: string | null;
}

export const EquipmentLocationRepository = {
  async listFloors(db: Db, includeInactive: boolean): Promise<EquipmentFloorRow[]> {
    const statusFilter = includeInactive ? '' : "AND f.status = 'ACTIVE'";
    return selectRows<EquipmentFloorRow>(
      db,
      `SELECT f.*,
              (SELECT COUNT(*) FROM equipment_areas a
                WHERE a.floor_id = f.id AND a.deleted_at IS NULL) AS area_count,
              (SELECT COUNT(*) FROM equipment e
                 JOIN equipment_locations l ON l.id = e.location_id
                 JOIN equipment_areas a ON a.id = l.area_id
                WHERE a.floor_id = f.id AND e.deleted_at IS NULL) AS equipment_count,
              (SELECT COUNT(*) FROM floor_plans fp
                WHERE fp.floor_id = f.id AND fp.is_active = 1 AND fp.deleted_at IS NULL) AS floor_plan_count
         FROM equipment_floors f
        WHERE f.deleted_at IS NULL ${statusFilter}
        ORDER BY f.level_index, f.name`,
    );
  },

  async findFloorById(db: Db, id: string): Promise<EquipmentFloorRow | null> {
    return selectOne<EquipmentFloorRow>(
      db,
      `SELECT * FROM equipment_floors WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  },

  async insertFloor(
    db: Db,
    input: LocationMasterInsert & { levelIndex: number },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_floors (id, code, name, level_index, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,'ACTIVE',?,?,?)`,
      [input.id, input.code, input.name, input.levelIndex, input.createdBy, now, now],
    );
  },

  async updateFloor(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE equipment_floors SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async listAreas(db: Db, floorId: string | undefined, includeInactive: boolean): Promise<EquipmentAreaRow[]> {
    const conditions = ['a.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (floorId !== undefined) {
      conditions.push('a.floor_id = ?');
      params.push(floorId);
    }
    if (!includeInactive) conditions.push("a.status = 'ACTIVE'");

    return selectRows<EquipmentAreaRow>(
      db,
      `SELECT a.*, f.name AS floor_name,
              (SELECT COUNT(*) FROM equipment e
                 JOIN equipment_locations l ON l.id = e.location_id
                WHERE l.area_id = a.id AND e.deleted_at IS NULL) AS equipment_count
         FROM equipment_areas a
         JOIN equipment_floors f ON f.id = a.floor_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY f.level_index, a.sort_order, a.name`,
      params,
    );
  },

  async findAreaById(db: Db, id: string): Promise<EquipmentAreaRow | null> {
    return selectOne<EquipmentAreaRow>(
      db,
      `SELECT a.*, f.name AS floor_name FROM equipment_areas a
         JOIN equipment_floors f ON f.id = a.floor_id
        WHERE a.id = ? AND a.deleted_at IS NULL`,
      [id],
    );
  },

  async insertArea(
    db: Db,
    input: LocationMasterInsert & { floorId: string; assetSegment: string; sortOrder: number },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_areas
         (id, floor_id, code, name, asset_segment, sort_order, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.floorId,
        input.code,
        input.name,
        input.assetSegment,
        input.sortOrder,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async updateArea(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE equipment_areas SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async listLocations(
    db: Db,
    filter: { areaId?: string; floorId?: string; includeInactive: boolean },
  ): Promise<EquipmentLocationRow[]> {
    const conditions = ['l.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filter.areaId !== undefined) {
      conditions.push('l.area_id = ?');
      params.push(filter.areaId);
    }
    if (filter.floorId !== undefined) {
      conditions.push('a.floor_id = ?');
      params.push(filter.floorId);
    }
    if (!filter.includeInactive) conditions.push("l.status = 'ACTIVE'");

    return selectRows<EquipmentLocationRow>(
      db,
      `SELECT l.*, a.name AS area_name, f.id AS floor_id, f.name AS floor_name,
              (SELECT COUNT(*) FROM equipment e
                WHERE e.location_id = l.id AND e.deleted_at IS NULL) AS equipment_count
         FROM equipment_locations l
         JOIN equipment_areas a ON a.id = l.area_id
         JOIN equipment_floors f ON f.id = a.floor_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY f.level_index, a.sort_order, l.sort_order, l.name`,
      params,
    );
  },

  async findLocationById(db: Db, id: string): Promise<EquipmentLocationRow | null> {
    return selectOne<EquipmentLocationRow>(
      db,
      `SELECT l.*, a.name AS area_name, f.id AS floor_id, f.name AS floor_name
         FROM equipment_locations l
         JOIN equipment_areas a ON a.id = l.area_id
         JOIN equipment_floors f ON f.id = a.floor_id
        WHERE l.id = ? AND l.deleted_at IS NULL`,
      [id],
    );
  },

  async insertLocation(
    db: Db,
    input: {
      id: string;
      areaId: string;
      name: string;
      room: string | null;
      section: string | null;
      position: string | null;
      sortOrder: number;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_locations
         (id, area_id, name, room, section, position, sort_order, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      [
        input.id,
        input.areaId,
        input.name,
        input.room,
        input.section,
        input.position,
        input.sortOrder,
        input.createdBy,
        now,
        now,
      ],
    );
  },

  async updateLocation(db: Db, id: string, assignments: string[], params: unknown[]): Promise<boolean> {
    if (assignments.length === 0) return false;
    const result = await mutate(
      db,
      `UPDATE equipment_locations SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },
};

/* ---------------------------------------------------------------- categories */

export const EquipmentCategoryRepository = {
  async list(db: Db, includeInactive: boolean): Promise<EquipmentCategoryRow[]> {
    const statusFilter = includeInactive ? '' : "AND c.status = 'ACTIVE'";
    return selectRows<EquipmentCategoryRow>(
      db,
      `SELECT c.*,
              (SELECT COUNT(*) FROM equipment e
                WHERE e.category_id = c.id AND e.deleted_at IS NULL) AS equipment_count
         FROM equipment_categories c
        WHERE c.deleted_at IS NULL ${statusFilter}
        ORDER BY c.sort_order, c.name`,
    );
  },

  async findById(db: Db, id: string): Promise<EquipmentCategoryRow | null> {
    return selectOne<EquipmentCategoryRow>(
      db,
      `SELECT * FROM equipment_categories WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
  },

  /** Used by AI identification to map a model's free-text guess onto a real category. */
  async findByNameLike(db: Db, term: string): Promise<EquipmentCategoryRow | null> {
    return selectOne<EquipmentCategoryRow>(
      db,
      `SELECT * FROM equipment_categories
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
          AND (LOWER(name) = LOWER(?) OR LOWER(code) = LOWER(?) OR LOWER(?) LIKE CONCAT('%', LOWER(name), '%'))
        ORDER BY CASE WHEN LOWER(name) = LOWER(?) THEN 0 ELSE 1 END, sort_order
        LIMIT 1`,
      [term, term, term, term],
    );
  },

  async insert(
    db: Db,
    input: {
      id: string;
      code: string;
      name: string;
      assetSegment: string;
      description: string | null;
      defaultFrequency: MaintenanceFrequency | null;
      defaultIntervalDays: number | null;
      sortOrder: number;
      status: MasterStatus;
      createdBy: string | null;
    },
  ): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO equipment_categories
         (id, code, name, asset_segment, description, default_frequency, default_interval_days,
          sort_order, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.id,
        input.code,
        input.name,
        input.assetSegment,
        input.description,
        input.defaultFrequency,
        input.defaultIntervalDays,
        input.sortOrder,
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
      `UPDATE equipment_categories SET ${assignments.join(', ')}, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [...params, toDbDateTime(), id],
    );
    return result.affectedRows > 0;
  },

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE equipment_categories SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  },
};
