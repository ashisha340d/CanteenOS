import {
  CallStatus,
  CaptureSource,
  LIMITS,
  MaintenanceActivityType,
  MaintenanceTicketStatus,
  MasterStatus,
  canTransitionMaintenanceStatus,
  type CallOutcome,
  type EquipmentCallLogDto,
  type EquipmentCallLogRequest,
  type EquipmentCallOutcomeRequest,
  type EquipmentSupplierDto,
  type EquipmentSupplierWriteRequest,
  type EquipmentWhatsappLogDto,
  type SupplierContactDto,
  type SupplierContactWriteRequest,
  type WhatsappDraftDto,
  type WhatsappSendRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { PoolConnection } from '../db/types';
import {
  mapEquipmentCallLog,
  mapEquipmentSupplier,
  mapEquipmentWhatsappLog,
  mapSupplierContact,
} from '../models/mappers';
import { EquipmentRepository } from '../repositories/EquipmentRepository';
import { MaintenanceRepository } from '../repositories/MaintenanceRepository';
import { SupplierRepository, type SupplierListFilter } from '../repositories/SupplierRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { toJsonColumn } from '../utils/json';
import { signMenuMediaUrl } from '../utils/mediaStorage';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { maintenanceActivityService } from './MaintenanceActivityService';

/**
 * The maintenance supplier master, its contacts, and the record of every call and WhatsApp
 * message sent about a piece of equipment.
 *
 * Contacting a supplier is deliberately a *server* operation even though the phone is what
 * dials: the message body, the asset id it quotes and the photo links it carries are composed
 * here, so the supplier receives the same wording whether the sender used the phone or the
 * portal — and so the fact that they were contacted at all lands on the asset's timeline
 * rather than only in somebody's call history.
 */

const CODE_PREFIX = 'SUP-';
const CODE_PAD = 4;
const LOG_LIMIT = 100;
/** Photos attached to the WhatsApp message. More than three is a slideshow, not a fault report. */
const WHATSAPP_PHOTO_LIMIT = 3;

export class SupplierService {
  async list(query: {
    search?: string;
    status?: MasterStatus;
    categoryId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: SupplierListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      SupplierRepository.list(pool, filter),
      SupplierRepository.count(pool, filter),
    ]);
    return buildPage(rows.map(mapEquipmentSupplier), total, page, pageSize);
  }

  async getById(id: string): Promise<EquipmentSupplierDto> {
    const pool = getPool();
    const row = await SupplierRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Supplier', id);
    const contacts = await SupplierRepository.listContacts(pool, id);
    return { ...mapEquipmentSupplier(row), contacts: contacts.map(mapSupplierContact) };
  }

  async create(
    input: EquipmentSupplierWriteRequest,
    actor: AuditActor,
  ): Promise<EquipmentSupplierDto> {
    const id = newId();

    await withTransaction(async (connection) => {
      const code =
        input.code !== undefined && input.code !== null && input.code.trim() !== ''
          ? input.code.trim()
          : `${CODE_PREFIX}${String(await SupplierRepository.nextCodeSequence(connection)).padStart(CODE_PAD, '0')}`;

      try {
        await SupplierRepository.insert(connection, {
          id,
          code,
          name: input.name,
          contactPerson: input.contactPerson ?? null,
          phone: input.phone ?? null,
          whatsapp: normaliseWhatsapp(input.whatsapp ?? null),
          email: input.email ?? null,
          serviceCategory: input.serviceCategory ?? null,
          serviceArea: input.serviceArea ?? null,
          notes: input.notes ?? null,
          entityId: input.entityId ?? null,
          status: input.status ?? MasterStatus.ACTIVE,
          createdBy: actor.userId,
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new ConflictError(`A supplier with code "${code}" already exists`);
        }
        throw error;
      }

      if (input.categoryIds !== undefined) {
        await SupplierRepository.replaceServiceCategories(connection, id, input.categoryIds);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_CREATED,
        entityType: 'equipment_supplier',
        entityId: id,
        after: { code, name: input.name },
      });
    });

    return this.getById(id);
  }

  async update(
    id: string,
    input: Partial<EquipmentSupplierWriteRequest>,
    actor: AuditActor,
  ): Promise<EquipmentSupplierDto> {
    await withTransaction(async (connection) => {
      const before = await SupplierRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Supplier', id);

      const assignments: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      if (input.code !== undefined && input.code !== null) set('code', input.code.trim());
      if (input.name !== undefined) set('name', input.name);
      if (input.contactPerson !== undefined) set('contact_person', input.contactPerson);
      if (input.phone !== undefined) set('phone', input.phone);
      if (input.whatsapp !== undefined) set('whatsapp', normaliseWhatsapp(input.whatsapp));
      if (input.email !== undefined) set('email', input.email);
      if (input.serviceCategory !== undefined) set('service_category', input.serviceCategory);
      if (input.serviceArea !== undefined) set('service_area', input.serviceArea);
      if (input.notes !== undefined) set('notes', input.notes);
      if (input.entityId !== undefined) set('entity_id', input.entityId);
      if (input.status !== undefined) set('status', input.status);

      await SupplierRepository.update(connection, id, assignments, params);
      if (input.categoryIds !== undefined) {
        await SupplierRepository.replaceServiceCategories(connection, id, input.categoryIds);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_UPDATED,
        entityType: 'equipment_supplier',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: input.name ?? before.name, status: input.status ?? before.status },
      });
    });

    return this.getById(id);
  }

  /** Refused while equipment still points at it: deactivate instead of orphaning assets. */
  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await SupplierRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Supplier', id);

      const linked = await SupplierRepository.countLinkedEquipment(connection, id);
      if (linked > 0) {
        throw new ConflictError(
          `${before.name} is the supplier for ${linked} asset(s); set it to INACTIVE instead of deleting it`,
        );
      }

      await SupplierRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_DELETED,
        entityType: 'equipment_supplier',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /* ------------------------------------------------------------------ contacts */

  async listContacts(supplierId: string): Promise<SupplierContactDto[]> {
    const rows = await SupplierRepository.listContacts(getPool(), supplierId);
    return rows.map(mapSupplierContact);
  }

  async addContact(
    supplierId: string,
    input: SupplierContactWriteRequest,
    actor: AuditActor,
  ): Promise<SupplierContactDto[]> {
    const id = newId();
    await withTransaction(async (connection) => {
      const supplier = await SupplierRepository.findById(connection, supplierId);
      if (supplier === null) throw new NotFoundError('Supplier', supplierId);

      await SupplierRepository.insertContact(connection, {
        id,
        supplierId,
        name: input.name,
        role: input.role ?? null,
        phone: input.phone ?? null,
        whatsapp: normaliseWhatsapp(input.whatsapp ?? null),
        email: input.email ?? null,
        isPrimary: input.isPrimary ?? false,
      });
      if (input.isPrimary === true) {
        await SupplierRepository.clearPrimaryContact(connection, supplierId, id);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_CONTACT_SAVED,
        entityType: 'supplier_contact',
        entityId: id,
        after: { supplierId, name: input.name },
      });
    });

    return this.listContacts(supplierId);
  }

  async updateContact(
    contactId: string,
    input: Partial<SupplierContactWriteRequest>,
    actor: AuditActor,
  ): Promise<SupplierContactDto[]> {
    const supplierId = await withTransaction(async (connection) => {
      const before = await SupplierRepository.findContactById(connection, contactId);
      if (before === null) throw new NotFoundError('Supplier contact', contactId);

      const assignments: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      if (input.name !== undefined) set('name', input.name);
      if (input.role !== undefined) set('role', input.role);
      if (input.phone !== undefined) set('phone', input.phone);
      if (input.whatsapp !== undefined) set('whatsapp', normaliseWhatsapp(input.whatsapp));
      if (input.email !== undefined) set('email', input.email);
      if (input.isPrimary !== undefined) set('is_primary', input.isPrimary ? 1 : 0);

      await SupplierRepository.updateContact(connection, contactId, assignments, params);
      if (input.isPrimary === true) {
        await SupplierRepository.clearPrimaryContact(connection, before.supplier_id, contactId);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_CONTACT_SAVED,
        entityType: 'supplier_contact',
        entityId: contactId,
        before: { name: before.name },
        after: { name: input.name ?? before.name },
      });
      return before.supplier_id;
    });

    return this.listContacts(supplierId);
  }

  async removeContact(contactId: string, actor: AuditActor): Promise<SupplierContactDto[]> {
    const supplierId = await withTransaction(async (connection) => {
      const before = await SupplierRepository.findContactById(connection, contactId);
      if (before === null) throw new NotFoundError('Supplier contact', contactId);

      await SupplierRepository.softDeleteContact(connection, contactId);
      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_CONTACT_DELETED,
        entityType: 'supplier_contact',
        entityId: contactId,
        before: { supplierId: before.supplier_id, name: before.name },
      });
      return before.supplier_id;
    });

    return this.listContacts(supplierId);
  }

  /* --------------------------------------------------------------------- calls */

  /**
   * Logged when the dialer opens, not when the call ends: Android exposes no reliable "call
   * finished" signal without READ_CALL_LOG, which this product does not request. The outcome
   * is filled in by the single tap the caller makes afterwards.
   */
  async logCall(input: EquipmentCallLogRequest, actor: AuditActor): Promise<EquipmentCallLogDto> {
    const id = newId();

    await withTransaction(async (connection) => {
      const equipment = await EquipmentRepository.findById(connection, input.equipmentId);
      if (equipment === null) throw new NotFoundError('Equipment', input.equipmentId);

      await SupplierRepository.insertCallLog(connection, {
        id,
        equipmentId: input.equipmentId,
        ticketId: input.ticketId ?? null,
        supplierId: input.supplierId ?? null,
        contactId: input.contactId ?? null,
        phoneNumber: input.phoneNumber,
        calledBy: actor.userId ?? '',
        status: CallStatus.DIALLED,
      });

      const supplierName =
        input.supplierId === undefined || input.supplierId === null
          ? input.phoneNumber
          : ((await SupplierRepository.findById(connection, input.supplierId))?.name ??
            input.phoneNumber);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: input.equipmentId,
        ticketId: input.ticketId ?? null,
        type: MaintenanceActivityType.CALL_MADE,
        summary: `Called ${supplierName}`,
        detail: input.phoneNumber,
        metadata: { callLogId: id, supplierId: input.supplierId ?? null },
      });
      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_CALLED,
        entityType: 'equipment_call_log',
        entityId: id,
        after: { equipmentId: input.equipmentId, supplierId: input.supplierId ?? null },
      });
    });

    const row = await SupplierRepository.findCallLogById(getPool(), id);
    if (row === null) throw new NotFoundError('Call log', id);
    return mapEquipmentCallLog(row);
  }

  /** The one tap after hanging up. Nothing longer is ever asked for. */
  async recordCallOutcome(
    callLogId: string,
    input: EquipmentCallOutcomeRequest,
    actor: AuditActor,
  ): Promise<EquipmentCallLogDto> {
    await withTransaction(async (connection) => {
      const before = await SupplierRepository.findCallLogById(connection, callLogId);
      if (before === null) throw new NotFoundError('Call log', callLogId);

      const assignments = ['outcome = ?', 'status = ?'];
      const params: unknown[] = [input.outcome, input.status ?? CallStatus.CONNECTED];
      if (input.durationSeconds !== undefined) {
        assignments.push('duration_seconds = ?');
        params.push(input.durationSeconds);
      }
      if (input.notes !== undefined) {
        assignments.push('notes = ?');
        params.push(input.notes);
      }
      await SupplierRepository.updateCallLog(connection, callLogId, assignments, params);

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: before.equipment_id,
        ticketId: before.ticket_id,
        type: MaintenanceActivityType.SUPPLIER_CONTACTED,
        summary: `Call outcome: ${humanise(input.outcome)}`,
        detail: input.notes ?? null,
        metadata: { callLogId, outcome: input.outcome },
      });
    });

    const row = await SupplierRepository.findCallLogById(getPool(), callLogId);
    if (row === null) throw new NotFoundError('Call log', callLogId);
    return mapEquipmentCallLog(row);
  }

  async listCallLogs(filter: {
    equipmentId?: string;
    ticketId?: string;
    supplierId?: string;
    outcome?: CallOutcome;
  }): Promise<EquipmentCallLogDto[]> {
    const rows = await SupplierRepository.listCallLogs(getPool(), { ...filter, limit: LOG_LIMIT });
    return rows.map(mapEquipmentCallLog);
  }

  /* ------------------------------------------------------------------ whatsapp */

  /**
   * Composes the message and hands back a `wa.me` link the client only has to open.
   *
   * Nothing is sent from the server — WhatsApp Business messaging is not part of this product
   * — but the wording, the asset id and the photo links are built here so the phone and the
   * portal can never word the same request differently.
   */
  async whatsappDraft(
    input: { equipmentId: string; ticketId?: string | null; supplierId?: string | null },
    userId: string,
  ): Promise<WhatsappDraftDto> {
    const pool = getPool();
    const equipment = await EquipmentRepository.findById(pool, input.equipmentId);
    if (equipment === null) throw new NotFoundError('Equipment', input.equipmentId);

    const supplier =
      input.supplierId === undefined || input.supplierId === null
        ? await EquipmentRepository.resolveContactSupplier(pool, input.equipmentId)
        : await SupplierRepository.findById(pool, input.supplierId).then((row) =>
          row === null
            ? null
            : { supplier_id: row.id, supplier_name: row.name, whatsapp: row.whatsapp, phone: row.phone },
        );

    if (supplier === null) {
      throw new ValidationError('No supplier is configured for this equipment', [
        { path: 'supplierId', message: 'Link a supplier to the asset, or pick one to contact' },
      ]);
    }

    const number = normaliseWhatsapp(supplier.whatsapp ?? supplier.phone ?? null);
    if (number === null) {
      throw new ValidationError(`${supplier.supplier_name} has no WhatsApp number on record`, [
        { path: 'supplierId', message: 'Add a WhatsApp number to the supplier first' },
      ]);
    }

    const ticket =
      input.ticketId === undefined || input.ticketId === null
        ? null
        : await MaintenanceRepository.findTicketById(pool, input.ticketId);

    const mediaIds =
      ticket === null
        ? []
        : await MaintenanceRepository.listAttachmentMediaIds(pool, ticket.id, WHATSAPP_PHOTO_LIMIT);
    const mediaUrls = mediaIds.map((mediaId) => signMenuMediaUrl(mediaId, userId));

    const message = composeWhatsappMessage({
      supplierName: supplier.supplier_name ?? '',
      assetId: equipment.asset_id,
      equipmentName: equipment.name,
      brandModel: [equipment.brand, equipment.model].filter((part) => part !== null).join(' '),
      locationPath: [equipment.floor_name, equipment.area_name, equipment.location_name]
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' · '),
      ticketNumber: ticket?.ticket_number ?? null,
      problem: ticket?.title ?? equipment.status_note ?? null,
      description: ticket?.description ?? null,
      mediaUrls,
    });

    return {
      supplierId: supplier.supplier_id,
      supplierName: supplier.supplier_name ?? '',
      phoneNumber: number,
      message,
      deepLink: `https://wa.me/${number}?text=${encodeURIComponent(message)}`,
      mediaUrls,
    };
  }

  /** Records that the draft was actually opened, so the timeline shows the supplier was told. */
  async logWhatsapp(input: WhatsappSendRequest, actor: AuditActor): Promise<EquipmentWhatsappLogDto> {
    const draft = await this.whatsappDraft(
      {
        equipmentId: input.equipmentId,
        ticketId: input.ticketId ?? null,
        supplierId: input.supplierId ?? null,
      },
      actor.userId ?? '',
    );
    const message = (input.message ?? draft.message).slice(0, LIMITS.WHATSAPP_MESSAGE_MAX);
    const id = newId();

    await withTransaction(async (connection) => {
      const mediaIds =
        input.ticketId === undefined || input.ticketId === null
          ? []
          : await MaintenanceRepository.listAttachmentMediaIds(
            connection,
            input.ticketId,
            WHATSAPP_PHOTO_LIMIT,
          );

      await SupplierRepository.insertWhatsappLog(connection, {
        id,
        equipmentId: input.equipmentId,
        ticketId: input.ticketId ?? null,
        supplierId: draft.supplierId,
        phoneNumber: draft.phoneNumber,
        message,
        mediaIds: toJsonColumn(mediaIds),
        sentBy: actor.userId ?? '',
      });

      await maintenanceActivityService.record(connection, actor, {
        equipmentId: input.equipmentId,
        ticketId: input.ticketId ?? null,
        type: MaintenanceActivityType.WHATSAPP_SENT,
        summary: `WhatsApp sent to ${draft.supplierName}`,
        detail: message,
        metadata: { whatsappLogId: id, supplierId: draft.supplierId },
        source: CaptureSource.MANUAL,
      });
      await this.markSupplierContacted(connection, input.ticketId ?? null, draft.supplierId, actor);

      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_WHATSAPP_SENT,
        entityType: 'equipment_whatsapp_log',
        entityId: id,
        after: { equipmentId: input.equipmentId, supplierId: draft.supplierId },
      });
    });

    const rows = await SupplierRepository.listWhatsappLogs(getPool(), {
      equipmentId: input.equipmentId,
      limit: 1,
    });
    const row = rows[0];
    if (row === undefined) throw new NotFoundError('WhatsApp log', id);
    return mapEquipmentWhatsappLog(row, actor.userId ?? '');
  }

  async listWhatsappLogs(
    filter: { equipmentId?: string; ticketId?: string; supplierId?: string },
    userId: string,
  ): Promise<EquipmentWhatsappLogDto[]> {
    const rows = await SupplierRepository.listWhatsappLogs(getPool(), {
      ...filter,
      limit: LOG_LIMIT,
    });
    return rows.map((row) => mapEquipmentWhatsappLog(row, userId));
  }

  /**
   * Reaching for the supplier is itself a step in the ticket's life, so a ticket still sitting
   * at REPORTED moves to SUPPLIER_CONTACTED rather than waiting for somebody to remember.
   */
  private async markSupplierContacted(
    db: PoolConnection,
    ticketId: string | null,
    supplierId: string,
    actor: AuditActor,
  ): Promise<void> {
    if (ticketId === null) return;
    const ticket = await MaintenanceRepository.findTicketById(db, ticketId);
    if (ticket === null) return;

    const next = MaintenanceTicketStatus.SUPPLIER_CONTACTED;
    // Only ever a step forward: a ticket already at a later rung must not be dragged back
    // because somebody sent a follow-up message.
    if (ticket.status === next || !canTransitionMaintenanceStatus(ticket.status, next)) return;

    await MaintenanceRepository.updateTicket(
      db,
      ticketId,
      ['status = ?', 'supplier_id = ?'],
      [next, ticket.supplier_id ?? supplierId],
    );
    await auditService.record(db, actor, {
      action: AuditAction.MAINTENANCE_TICKET_STATUS_CHANGED,
      entityType: 'maintenance_ticket',
      entityId: ticketId,
      before: { status: ticket.status },
      after: { status: next },
    });
  }
}

/* --------------------------------------------------------------------- helpers */

/** wa.me wants digits only, E.164 without the '+'. Anything else is stored as given. */
function normaliseWhatsapp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = value.replace(/\D/g, '');
  if (digits === '') return null;
  return digits.slice(0, LIMITS.SUPPLIER_PHONE_MAX);
}

function humanise(value: string): string {
  const words = value.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The message a supplier receives. Written as a person would write it, with the asset id and
 * the location first — those are the two things a service engineer asks for on the phone.
 */
function composeWhatsappMessage(input: {
  supplierName: string;
  assetId: string;
  equipmentName: string;
  brandModel: string;
  locationPath: string;
  ticketNumber: string | null;
  problem: string | null;
  description: string | null;
  mediaUrls: string[];
}): string {
  const lines: string[] = [];
  lines.push(`Hello ${input.supplierName},`);
  lines.push('');
  lines.push(
    input.ticketNumber === null
      ? `We need service on ${input.equipmentName} (${input.assetId}).`
      : `Service request ${input.ticketNumber} — ${input.equipmentName} (${input.assetId}).`,
  );
  if (input.brandModel !== '') lines.push(`Make/model: ${input.brandModel}`);
  if (input.locationPath !== '') lines.push(`Location: ${input.locationPath}`);
  if (input.problem !== null && input.problem !== '') lines.push(`Problem: ${input.problem}`);
  if (input.description !== null && input.description !== '') lines.push(input.description);
  if (input.mediaUrls.length > 0) {
    lines.push('');
    lines.push('Photos:');
    for (const url of input.mediaUrls) lines.push(url);
  }
  lines.push('');
  lines.push('Please let us know when you can attend.');
  return lines.join('\n');
}

export const supplierService = new SupplierService();
