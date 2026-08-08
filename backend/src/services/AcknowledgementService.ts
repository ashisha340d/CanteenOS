import {
  MessageType,
  NotificationType,
  OrderStatus,
  SystemEvent,
  type AcknowledgementDto,
  type CreateAcknowledgementRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapAcknowledgement } from '../models/mappers';
import { acknowledgementRepository } from '../repositories/AcknowledgementRepository';
import { boardRepository } from '../repositories/BoardRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { notificationService } from './NotificationService';

export interface AcknowledgementSummary {
  acknowledgements: AcknowledgementDto[];
  pendingUserIds: string[];
}

/**
 * Order acknowledgement.
 *
 * Idempotent by `(order_id, user_id)`: acknowledging twice is a no-op rather than an error,
 * which is what lets an offline device replay the operation safely.
 */
export class AcknowledgementService {
  async summary(orderId: string): Promise<AcknowledgementSummary> {
    const pool = getPool();
    const order = await orderRepository.findById(pool, orderId);
    if (order === null) throw new NotFoundError('Order', orderId);

    const [rows, pendingUserIds] = await Promise.all([
      acknowledgementRepository.listForOrder(pool, orderId),
      acknowledgementRepository.findPendingUserIds(pool, orderId, order.board_id),
    ]);

    return { acknowledgements: rows.map(mapAcknowledgement), pendingUserIds };
  }

  async acknowledge(
    orderId: string,
    input: CreateAcknowledgementRequest,
    actor: AuditActor & { userId: string },
  ): Promise<AcknowledgementDto> {
    const result = await withTransaction(async (connection) => {
      const order = await orderRepository.findByIdForUpdate(connection, orderId);
      if (order === null || order.deleted_at !== null) {
        throw new NotFoundError('Order', orderId);
      }

      // Every board member may acknowledge, including viewers — but only members.
      const boardRole = await boardRepository.findActiveRole(
        connection,
        order.board_id,
        actor.userId,
      );
      if (boardRole === null) {
        throw new ForbiddenError('Only board members can acknowledge an order');
      }

      const { row, created } = await acknowledgementRepository.upsert(connection, {
        id: input.id ?? newId(),
        orderId,
        userId: actor.userId,
        note: input.note ?? null,
      });

      if (!created) {
        // Already acknowledged: return the existing record without re-notifying.
        return { row, boardId: order.board_id, notifications: [], created: false };
      }

      await threadRepository.insert(connection, {
        id: newId(),
        boardId: order.board_id,
        orderId,
        parentMessageId: null,
        authorId: null,
        messageType: MessageType.SYSTEM,
        body: null,
        mentionedUserIds: [],
        systemEvent: SystemEvent.ORDER_ACKNOWLEDGED,
        systemMeta: { userId: actor.userId, note: input.note ?? null },
      });

      // The first acknowledgement moves a pending order forward, so the board reflects that
      // someone has picked it up without anyone changing status by hand.
      if (order.status === OrderStatus.PENDING) {
        await orderRepository.updateStatus(
          connection,
          orderId,
          OrderStatus.ACKNOWLEDGED,
          actor.userId,
        );
        await threadRepository.insert(connection, {
          id: newId(),
          boardId: order.board_id,
          orderId,
          parentMessageId: null,
          authorId: null,
          messageType: MessageType.SYSTEM,
          body: null,
          mentionedUserIds: [],
          systemEvent: SystemEvent.ORDER_STATUS_CHANGED,
          systemMeta: {
            from: OrderStatus.PENDING,
            to: OrderStatus.ACKNOWLEDGED,
            reason: 'first acknowledgement',
          },
        });
      }

      const notifications = await notificationService.notify(connection, {
        userIds: [order.created_by],
        type: NotificationType.ACKNOWLEDGEMENT,
        title: `${order.order_number} was acknowledged`,
        body: input.note ?? null,
        boardId: order.board_id,
        orderId,
        actorId: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_ACKNOWLEDGED,
        entityType: 'acknowledgement',
        entityId: row.id,
        boardId: order.board_id,
        after: { orderId, note: input.note ?? null },
      });

      return { row, boardId: order.board_id, notifications, created: true };
    });

    if (result.created) {
      notificationService.publish(result.notifications);
      realtime.emitAcknowledgement(
        result.boardId,
        orderId,
        actor.userId,
        Number(result.row.sync_seq),
      );
    }

    return mapAcknowledgement(result.row);
  }

  /** Withdraws an acknowledgement. Only the person who gave it may take it back. */
  async withdraw(
    orderId: string,
    actor: AuditActor & { userId: string },
  ): Promise<void> {
    const result = await withTransaction(async (connection) => {
      const existing = await acknowledgementRepository.find(connection, orderId, actor.userId);
      if (existing === null || existing.deleted_at !== null) {
        throw new NotFoundError('Acknowledgement');
      }

      const order = await orderRepository.findById(connection, orderId);
      if (order === null) throw new NotFoundError('Order', orderId);

      await acknowledgementRepository.softDelete(connection, orderId, actor.userId);

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_ACKNOWLEDGED,
        entityType: 'acknowledgement',
        entityId: existing.id,
        boardId: order.board_id,
        before: { orderId, userId: actor.userId },
        after: null,
      });

      return { boardId: order.board_id };
    });

    realtime.emitBoardChange(result.boardId, ['acknowledgements'], 0);
  }
}

export const acknowledgementService = new AcknowledgementService();
