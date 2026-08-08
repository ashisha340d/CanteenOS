import {
  AttachmentOwnerType,
  LIMITS,
  MessageType,
  NotificationType,
  type CreateThreadMessageRequest,
  type ThreadMessageDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapAttachment, mapThreadMessage } from '../models/mappers';
import { attachmentRepository } from '../repositories/AttachmentRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import { userRepository } from '../repositories/UserRepository';
import { boardRepository } from '../repositories/BoardRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { notificationService } from './NotificationService';

/**
 * The board feed. Every message belongs to a board; `orderId` is optional and says what the
 * message is *about* — null for a general board post, set for a comment or voice note on that
 * order (which the app renders nested under the order's card in the same feed).
 *
 * Messages are append-only, which is what makes them conflict-free under offline sync: a new
 * id always inserts, so two devices posting at once never contend. SYSTEM messages in the same
 * table materialise order history; `ORDER_CREATED` is what renders the structured order card.
 */
export class ThreadService {
  async list(
    orderId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<ThreadMessageDto[]> {
    const pool = getPool();
    const order = await orderRepository.findById(pool, orderId);
    if (order === null) throw new NotFoundError('Order', orderId);

    const limit = Math.min(options.limit ?? 50, LIMITS.PAGE_SIZE_MAX);
    const rows = await threadRepository.listForOrder(pool, orderId, {
      limit,
      ...(options.before !== undefined ? { before: options.before } : {}),
    });
    return this.withAttachments(rows);
  }

  /** The whole board feed — general posts and order-scoped messages in one page. */
  async listForBoard(
    boardId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<ThreadMessageDto[]> {
    const pool = getPool();
    const limit = Math.min(options.limit ?? 50, LIMITS.PAGE_SIZE_MAX);
    const rows = await threadRepository.listForBoard(pool, boardId, {
      limit,
      ...(options.before !== undefined ? { before: options.before } : {}),
    });
    return this.withAttachments(rows);
  }

  /** Attachments are fetched in one batch rather than per message. */
  private async withAttachments(
    rows: Awaited<ReturnType<typeof threadRepository.listForBoard>>,
  ): Promise<ThreadMessageDto[]> {
    const attachments = await attachmentRepository.listForOwners(
      getPool(),
      AttachmentOwnerType.THREAD_MESSAGE,
      rows.map((row) => row.id),
    );
    const byMessage = new Map<string, ReturnType<typeof mapAttachment>[]>();
    for (const attachment of attachments) {
      if (attachment.owner_id === null) continue;
      const list = byMessage.get(attachment.owner_id) ?? [];
      list.push(mapAttachment(attachment));
      byMessage.set(attachment.owner_id, list);
    }

    return rows.map((row) => {
      const message = mapThreadMessage(row);
      const messageAttachments = byMessage.get(row.id);
      return messageAttachments ? { ...message, attachments: messageAttachments } : message;
    });
  }

  /**
   * Posts to the board feed. Exactly one of `target.orderId` / `target.boardId` needs to be
   * known by the caller: the order routes pass the order and the board is derived from it;
   * the board-feed route passes the board and an optional order from the request body.
   */
  async post(
    target: { boardId: string | null; orderId: string | null },
    input: CreateThreadMessageRequest,
    actor: AuditActor & { userId: string },
  ): Promise<ThreadMessageDto> {
    const hasBody = typeof input.body === 'string' && input.body.trim() !== '';
    const hasAttachments = (input.attachmentIds ?? []).length > 0;

    if (!hasBody && !hasAttachments) {
      throw new ValidationError('A message needs text or an attachment', [
        { path: 'body', message: 'Type a message or attach a photo or voice note' },
      ]);
    }

    const result = await withTransaction(async (connection) => {
      const orderId = target.orderId;
      const order =
        orderId === null ? null : await orderRepository.findById(connection, orderId);
      if (orderId !== null && order === null) throw new NotFoundError('Order', orderId);

      // An order-scoped message always inherits its order's board, so the two can never
      // disagree; a general post uses the board the route was keyed on.
      const boardId = order?.board_id ?? target.boardId;
      if (boardId === null) throw new NotFoundError('Board');

      if (input.parentMessageId !== undefined && input.parentMessageId !== null) {
        const parent = await threadRepository.findById(connection, input.parentMessageId);
        if (parent === null) throw new NotFoundError('Parent message', input.parentMessageId);
        // A reply must stay inside the feed it belongs to.
        if (parent.board_id !== boardId) {
          throw new ValidationError('The parent message belongs to a different board');
        }
      }

      const mentioned = await this.resolveMentions(
        connection,
        boardId,
        input.mentionedUserIds ?? [],
      );

      const messageId = input.id ?? newId();
      const row = await threadRepository.insert(connection, {
        id: messageId,
        boardId,
        orderId,
        parentMessageId: input.parentMessageId ?? null,
        authorId: actor.userId,
        messageType: MessageType.USER,
        body: hasBody ? (input.body as string).trim() : null,
        mentionedUserIds: mentioned,
        systemEvent: null,
        systemMeta: null,
      });

      if (hasAttachments) {
        await attachmentRepository.bindToOwner(
          connection,
          input.attachmentIds as string[],
          AttachmentOwnerType.THREAD_MESSAGE,
          messageId,
          actor.userId,
        );
      }

      const subject = order === null ? 'the board' : order.order_number;

      // Mentions and replies are separate signals: a mention always notifies, while a plain
      // reply notifies the people already involved. Recipients are deduplicated so a mentioned
      // participant receives one notification, not two.
      const mentionNotifications = await notificationService.notify(connection, {
        userIds: mentioned,
        type: NotificationType.MENTION,
        title: `You were mentioned on ${subject}`,
        body: row.body,
        boardId,
        orderId,
        actorId: actor.userId,
      });

      // A general board post has no participant set to notify — only its mentions fire.
      const participants =
        orderId === null
          ? []
          : await threadRepository.findThreadParticipants(connection, orderId, actor.userId);
      const replyRecipients = participants.filter((userId) => !mentioned.includes(userId));

      const replyNotifications = await notificationService.notify(connection, {
        userIds: replyRecipients,
        type: NotificationType.THREAD_REPLY,
        title: `New message on ${subject}`,
        body: row.body,
        boardId,
        orderId,
        actorId: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.THREAD_MESSAGE_POSTED,
        entityType: 'thread_message',
        entityId: messageId,
        boardId,
        after: { orderId, hasAttachments, mentionCount: mentioned.length },
      });

      return {
        row,
        boardId,
        orderId,
        notifications: [...mentionNotifications, ...replyNotifications],
      };
    });

    notificationService.publish(result.notifications);
    realtime.emitThreadMessage(
      result.boardId,
      result.orderId,
      result.row.id,
      Number(result.row.sync_seq),
    );

    return mapThreadMessage(result.row);
  }

  /**
   * Tombstones a message. The author may always remove their own; removing someone else's
   * requires THREAD_DELETE_ANY, which the route enforces before calling in.
   */
  async remove(
    messageId: string,
    actor: AuditActor & { userId: string },
    options: { canDeleteAny: boolean },
  ): Promise<void> {
    const result = await withTransaction(async (connection) => {
      const row = await threadRepository.findById(connection, messageId);
      if (row === null) throw new NotFoundError('Message', messageId);

      // System messages are the order's history; deleting one would falsify the record.
      if (row.message_type === MessageType.SYSTEM) {
        throw new ForbiddenError('System history entries cannot be deleted');
      }
      if (row.author_id !== actor.userId && !options.canDeleteAny) {
        throw new ForbiddenError('You can only delete your own messages');
      }

      await threadRepository.softDelete(connection, messageId);

      await auditService.record(connection, actor, {
        action: AuditAction.THREAD_MESSAGE_DELETED,
        entityType: 'thread_message',
        entityId: messageId,
        boardId: row.board_id,
        before: { orderId: row.order_id, authorId: row.author_id },
      });

      return { boardId: row.board_id };
    });

    realtime.emitBoardChange(result.boardId, ['thread_messages'], 0);
  }

  /**
   * Keeps mentions honest: only active members of the order's board can be mentioned, so a
   * client cannot use the mention list to notify arbitrary users.
   */
  private async resolveMentions(
    db: Parameters<typeof userRepository.findByIds>[0],
    boardId: string,
    requested: readonly string[],
  ): Promise<string[]> {
    if (requested.length === 0) return [];

    const unique = [...new Set(requested)].slice(0, LIMITS.MENTIONS_MAX);
    const members = await boardRepository.listMembers(db, boardId);
    const memberIds = new Set(members.map((member) => member.user_id));

    return unique.filter((userId) => memberIds.has(userId));
  }
}

export const threadService = new ThreadService();
