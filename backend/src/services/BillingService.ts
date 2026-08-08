import { createHash } from 'node:crypto';
import {
  BillingStatus,
  MessageType,
  SystemEvent,
  type BillingExportDto,
  type BillingSnapshot,
  type BillingSnapshotItem,
  type BillingSnapshotOrder,
  type GenerateBillingRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapBillingExport } from '../models/mappers';
import { billingRepository } from '../repositories/BillingRepository';
import { boardRepository } from '../repositories/BoardRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { fromDbDate, fromDbDateTime, fromDbTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * Billing generation.
 *
 * Admin Portal only, explicitly triggered, and strictly one-way. Generation reads completed
 * operational orders and freezes them into an immutable JSON snapshot; it never writes to
 * orders, so operational data continues to live independently of any billing artefact.
 *
 * Regenerating the same period produces a new version rather than replacing the old snapshot —
 * an export that was already acted on must remain exactly as it was.
 *
 * BILLING_GENERATE is in ANDROID_FORBIDDEN_CAPABILITIES, so no Android session can reach this
 * service regardless of the signed-in user's role.
 */
export class BillingService {
  async list(query: {
    boardId?: string;
    status?: BillingStatus;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { page, pageSize, offset } = resolvePaging(query);
    const { rows, total } = await billingRepository.list(getPool(), {
      ...(query.boardId !== undefined ? { boardId: query.boardId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      limit: pageSize,
      offset,
    });
    return buildPage(rows.map(mapBillingExport), total, page, pageSize);
  }

  async getById(id: string): Promise<BillingExportDto> {
    const row = await billingRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Billing export', id);
    return mapBillingExport(row);
  }

  /** The frozen payload, returned verbatim. Never recomputed from current data. */
  async getSnapshot(id: string): Promise<BillingSnapshot> {
    const snapshot = await billingRepository.findSnapshot(getPool(), id);
    if (snapshot === null) throw new NotFoundError('Billing export', id);
    return snapshot;
  }

  async generate(
    input: GenerateBillingRequest,
    actor: AuditActor & { userId: string },
  ): Promise<BillingExportDto> {
    if (input.periodFrom > input.periodTo) {
      throw new ValidationError('The billing period is inverted', [
        { path: 'periodTo', message: 'The end date must not be before the start date' },
      ]);
    }

    return withTransaction(async (connection) => {
      const boardId = input.boardId ?? null;
      if (boardId !== null) {
        const board = await boardRepository.findById(connection, boardId, {
          includeDeleted: true,
        });
        if (board === null) throw new NotFoundError('Board', boardId);
      }

      const orderRows = await billingRepository.findSnapshotOrders(
        connection,
        boardId,
        input.periodFrom,
        input.periodTo,
      );

      if (orderRows.length === 0) {
        throw new ConflictError(
          'No completed orders fall in this period, so there is nothing to bill',
        );
      }

      const itemRows = await billingRepository.findSnapshotItems(
        connection,
        orderRows.map((row) => row.id),
      );

      const itemsByOrder = new Map<string, BillingSnapshotItem[]>();
      for (const item of itemRows) {
        const list = itemsByOrder.get(item.order_id) ?? [];
        list.push({
          menuItemId: item.menu_item_id,
          categoryName: item.category_name,
          itemName: item.item_name,
          quantity: Number(item.quantity),
          unit: item.unit,
          notes: item.notes,
        });
        itemsByOrder.set(item.order_id, list);
      }

      const orders: BillingSnapshotOrder[] = orderRows.map((row) => ({
        orderId: row.id,
        orderNumber: row.order_number,
        boardName: row.board_name,
        activityName: row.activity_name,
        venue: row.venue,
        pax: Number(row.pax),
        requiredDate: fromDbDate(row.required_date) as string,
        requiredTime: fromDbTime(row.required_time) as string,
        status: row.status,
        completedAt: fromDbDateTime(row.completed_at),
        createdByName: row.created_by_name,
        items: itemsByOrder.get(row.id) ?? [],
      }));

      const billingVersion = await billingRepository.nextVersion(
        connection,
        boardId,
        input.periodFrom,
        input.periodTo,
      );

      const generatedAt = new Date().toISOString();
      const snapshot: BillingSnapshot = {
        generatedAt,
        generatedBy: actor.userId,
        billingVersion,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        boardId,
        orders,
      };

      // Checksum over the frozen content, so any later tampering with the stored JSON is
      // detectable.
      const checksum = createHash('sha256')
        .update(JSON.stringify(snapshot.orders))
        .digest('hex');

      const totalPax = orders.reduce((sum, order) => sum + order.pax, 0);

      const row = await billingRepository.insert(connection, {
        id: newId(),
        boardId,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        billingVersion,
        totalOrders: orders.length,
        totalPax,
        snapshot,
        checksum,
        notes: input.notes ?? null,
        generatedBy: actor.userId,
      });

      // Processing the bill is what puts the Billed pill on these orders and freezes them —
      // `isOrderLocked` reads `billed_at`, and every write path consults it. Done deliberately
      // here rather than on FINALIZED: the snapshot is already immutable, so leaving the source
      // orders editable would let them drift away from the export downstream systems received.
      await orderRepository.markBilled(
        connection,
        orderRows.map((order) => order.id),
        row.id,
      );

      for (const order of orderRows) {
        await threadRepository.insert(connection, {
          id: newId(),
          boardId: order.board_id,
          orderId: order.id,
          parentMessageId: null,
          authorId: null,
          messageType: MessageType.SYSTEM,
          body: null,
          mentionedUserIds: [],
          systemEvent: SystemEvent.ORDER_BILLED,
          systemMeta: {
            billingExportId: row.id,
            billingVersion,
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
            billedBy: actor.userId,
          },
        });
      }

      // Billing generation is always logged — required by the specification.
      await auditService.record(connection, actor, {
        action: AuditAction.BILLING_GENERATED,
        entityType: 'billing_export',
        entityId: row.id,
        boardId,
        after: {
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          billingVersion,
          totalOrders: orders.length,
          totalPax,
          checksum,
        },
      });

      return mapBillingExport(row);
    });
  }

  /**
   * Advances an export's lifecycle. GENERATED may be finalised or cancelled; a finalised or
   * cancelled export is terminal, because downstream systems have already consumed it.
   */
  async updateStatus(
    id: string,
    status: BillingStatus,
    actor: AuditActor,
  ): Promise<BillingExportDto> {
    return withTransaction(async (connection) => {
      const before = await billingRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Billing export', id);

      if (before.status !== BillingStatus.GENERATED) {
        throw new ConflictError(
          `This export is ${before.status.toLowerCase()} and can no longer change state`,
        );
      }
      if (status === BillingStatus.GENERATED) {
        throw new ValidationError('An export cannot be returned to the GENERATED state');
      }

      await billingRepository.updateStatus(connection, id, status);

      await auditService.record(connection, actor, {
        action: AuditAction.BILLING_STATUS_CHANGED,
        entityType: 'billing_export',
        entityId: id,
        boardId: before.board_id,
        before: { status: before.status },
        after: { status },
      });

      const row = await billingRepository.findById(connection, id);
      if (row === null) throw new NotFoundError('Billing export', id);
      return mapBillingExport(row);
    });
  }
}

export const billingService = new BillingService();
