import {
  LIMITS,
  MessageType,
  NotificationType,
  OrderPriority,
  OrderStatus,
  SystemEvent,
  TERMINAL_ORDER_STATUSES,
  UserRole,
  buildOrderNumber,
  canTransitionOrderStatus,
  isOrderLocked,
  isValidOrderNumber,
  Capability,
  type AssignOrderRequest,
  type AttachmentOwnerType,
  type CreateOrderItemRequest,
  type CreateOrderRequest,
  type OrderDetailDto,
  type OrderDto,
  type OrderListQuery,
  type UpdateOrderQuantitiesRequest,
  type UpdateOrderRequest,
  type UpdateOrderStatusRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db, PoolConnection } from '../db/types';
import {
  mapAcknowledgement,
  mapAttachment,
  mapOrder,
  mapOrderItem,
} from '../models/mappers';
import type { OrderRow } from '../models/rows';
import { acknowledgementRepository } from '../repositories/AcknowledgementRepository';
import { attachmentRepository } from '../repositories/AttachmentRepository';
import { boardRepository } from '../repositories/BoardRepository';
import { permissionsCacheService } from './PermissionsCacheService';
import { activityTypeRepository, menuItemRepository } from '../repositories/MasterRepository';
import {
  orderRepository,
  type OrderItemInput,
} from '../repositories/OrderRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import { userRepository } from '../repositories/UserRepository';
import { realtime } from '../realtime/RealtimeGateway';
import {
  ConflictError,
  ForbiddenError,
  InvalidStatusTransitionError,
  NotFoundError,
  StaleWriteError,
  ValidationError,
} from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { notificationService } from './NotificationService';
import { taskService } from './TaskService';

export interface OrderActor extends AuditActor {
  userId: string;
  role: UserRole;
}

export class OrderService {
  /* ------------------------------------------------------------------ reads */

  async list(
    actor: { userId: string; role: UserRole },
    query: OrderListQuery,
  ) {
    const { page, pageSize, offset } = resolvePaging(query);
    const pool = getPool();

    const filter = {
      ...(query.boardId !== undefined ? { boardId: query.boardId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.priority !== undefined ? { priority: query.priority } : {}),
      ...(query.activityTypeId !== undefined ? { activityTypeId: query.activityTypeId } : {}),
      ...(query.createdBy !== undefined ? { createdBy: query.createdBy } : {}),
      ...(query.dateFrom !== undefined ? { dateFrom: query.dateFrom } : {}),
      ...(query.dateTo !== undefined ? { dateTo: query.dateTo } : {}),
      ...(query.search !== undefined ? { search: query.search } : {}),
      limit: pageSize,
      offset,
    };

    // Non-administrators are confined to the boards they belong to. Without this an order id
    // guessed from another board would be listable.
    const seesAllBoards = actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN;
    const scoped =
      seesAllBoards || query.boardId !== undefined
        ? filter
        : { ...filter, boardIds: await boardRepository.listBoardIdsForUser(pool, actor.userId) };

    const { rows, total } = await orderRepository.list(pool, scoped);
    return buildPage(rows.map(mapOrder), total, page, pageSize);
  }

  async getDetail(orderId: string): Promise<OrderDetailDto> {
    const pool = getPool();
    const order = await orderRepository.findById(pool, orderId);
    if (order === null) throw new NotFoundError('Order', orderId);

    const [items, attachments, acknowledgements, pendingUserIds, messageCount] = await Promise.all(
      [
        orderRepository.listItems(pool, orderId),
        attachmentRepository.listForOwner(pool, 'ORDER', orderId),
        acknowledgementRepository.listForOrder(pool, orderId),
        acknowledgementRepository.findPendingUserIds(pool, orderId, order.board_id),
        threadRepository.countForOrder(pool, orderId),
      ],
    );

    return {
      ...mapOrder(order),
      items: items.map(mapOrderItem),
      attachments: attachments.map(mapAttachment),
      acknowledgements: acknowledgements.map(mapAcknowledgement),
      pendingAcknowledgementUserIds: pendingUserIds,
      messageCount,
    };
  }

  /** Board id for an order — used by authorisation middleware before the handler runs. */
  async findBoardId(orderId: string): Promise<string | null> {
    const order = await orderRepository.findById(getPool(), orderId);
    return order === null ? null : order.board_id;
  }

  /* ----------------------------------------------------------------- create */

  async create(input: CreateOrderRequest, actor: OrderActor): Promise<OrderDetailDto> {
    const orderId = input.id ?? newId();

    // The device may supply the number it generated offline so the value the user already saw
    // is preserved; otherwise it is derived here from the same deterministic rule.
    const orderNumber = input.orderNumber ?? buildOrderNumber(orderId, input.requiredDate);
    if (!isValidOrderNumber(orderNumber)) {
      throw new ValidationError('Order number is malformed', [
        { path: 'orderNumber', message: 'Expected the format ORD-YYYYMMDD-XXXXXX' },
      ]);
    }

    const result = await withTransaction(async (connection) => {
      // The board arrives in the body, so it cannot be guarded by URL-based middleware — the
      // membership check belongs here.
      await this.assertCanCreateOnBoard(connection, input.boardId, actor);
      await this.assertBoardUsable(connection, input.boardId);
      await this.assertActivityValid(connection, input.activityTypeId, input.customActivity);

      const duplicate = await orderRepository.findByOrderNumber(connection, orderNumber);
      if (duplicate !== null) {
        throw new ConflictError(`Order number ${orderNumber} already exists`);
      }

      const items = await this.resolveItems(connection, input.items);

      const order = await orderRepository.insert(connection, {
        id: orderId,
        orderNumber,
        boardId: input.boardId,
        activityTypeId: input.activityTypeId ?? null,
        customActivity: input.customActivity ?? null,
        venue: input.venue,
        pax: input.pax,
        requiredDate: input.requiredDate,
        requiredTime: input.requiredTime,
        priority: input.priority ?? OrderPriority.NORMAL,
        status: OrderStatus.PENDING,
        createdBy: actor.userId,
      });

      await orderRepository.insertItems(connection, order.id, items);

      if (input.attachmentIds !== undefined && input.attachmentIds.length > 0) {
        await attachmentRepository.bindToOwner(
          connection,
          input.attachmentIds,
          'ORDER',
          order.id,
          actor.userId,
        );
      }

      // History is materialised as a system thread message (docs/SCOPE.md decision 2).
      // This row is what renders the structured order card in the board feed, so it carries
      // the fields the card shows — the orders row stays authoritative for live status.
      await this.writeSystemMessage(connection, order.board_id, order.id, SystemEvent.ORDER_CREATED, {
        orderNumber,
        venue: order.venue,
        pax: order.pax,
        itemCount: items.length,
        requiredDate: order.required_date,
        requiredTime: order.required_time,
        priority: order.priority,
        createdBy: order.created_by,
      });

      const notifications = await this.notifyBoard(connection, order, actor, {
        type: NotificationType.NEW_ORDER,
        title: `New order ${orderNumber}`,
        body: `${order.venue} · ${order.pax} pax · ${order.required_date}`,
      });

      const mentioned = collectMentions(items);
      const mentionNotifications = await notificationService.notify(connection, {
        userIds: mentioned,
        type: NotificationType.MENTION,
        title: `You were mentioned on ${orderNumber}`,
        body: order.venue,
        boardId: order.board_id,
        orderId: order.id,
        actorId: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_CREATED,
        entityType: 'order',
        entityId: order.id,
        boardId: order.board_id,
        after: {
          orderNumber,
          venue: order.venue,
          pax: order.pax,
          requiredDate: order.required_date,
          itemCount: items.length,
        },
      });

      return { order, notifications: [...notifications, ...mentionNotifications] };
    });

    notificationService.publish(result.notifications);
    realtime.emitOrderChange(
      result.order.board_id,
      result.order.id,
      Number(result.order.sync_seq),
    );

    return this.getDetail(result.order.id);
  }

  /* ----------------------------------------------------------------- update */

  async update(
    orderId: string,
    input: UpdateOrderRequest,
    actor: OrderActor,
  ): Promise<OrderDetailDto> {
    const result = await withTransaction(async (connection) => {
      const before = await orderRepository.findByIdForUpdate(connection, orderId);
      if (before === null || before.deleted_at !== null) {
        throw new NotFoundError('Order', orderId);
      }

      this.assertEditable(before);

      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== Number(before.revision)
      ) {
        throw new StaleWriteError(Number(before.revision));
      }

      const nextActivityTypeId =
        input.activityTypeId !== undefined ? input.activityTypeId : before.activity_type_id;
      const nextCustomActivity =
        input.customActivity !== undefined ? input.customActivity : before.custom_activity;
      await this.assertActivityValid(connection, nextActivityTypeId, nextCustomActivity);

      const order = await orderRepository.update(connection, orderId, {
        ...(input.activityTypeId !== undefined ? { activityTypeId: input.activityTypeId } : {}),
        ...(input.customActivity !== undefined ? { customActivity: input.customActivity } : {}),
        ...(input.venue !== undefined ? { venue: input.venue } : {}),
        ...(input.pax !== undefined ? { pax: input.pax } : {}),
        ...(input.requiredDate !== undefined ? { requiredDate: input.requiredDate } : {}),
        ...(input.requiredTime !== undefined ? { requiredTime: input.requiredTime } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      });
      if (order === null) throw new NotFoundError('Order', orderId);

      let newMentions: string[] = [];
      if (input.items !== undefined) {
        const items = await this.resolveItems(connection, input.items);
        await orderRepository.replaceItems(connection, orderId, items);
        newMentions = collectMentions(items);

        await this.writeSystemMessage(connection, order.board_id, orderId, SystemEvent.ORDER_ITEMS_CHANGED, {
          itemCount: items.length,
          changedBy: actor.userId,
        });
      }

      await this.writeSystemMessage(connection, order.board_id, orderId, SystemEvent.ORDER_UPDATED, {
        changedBy: actor.userId,
        changedFields: Object.keys(input).filter((key) => key !== 'expectedRevision'),
      });

      const notifications = await notificationService.notify(connection, {
        userIds: newMentions,
        type: NotificationType.MENTION,
        title: `You were mentioned on ${order.order_number}`,
        body: order.venue,
        boardId: order.board_id,
        orderId: order.id,
        actorId: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_UPDATED,
        entityType: 'order',
        entityId: orderId,
        boardId: order.board_id,
        before: {
          venue: before.venue,
          pax: before.pax,
          requiredDate: before.required_date,
          requiredTime: before.required_time,
          priority: before.priority,
        },
        after: {
          venue: order.venue,
          pax: order.pax,
          requiredDate: order.required_date,
          requiredTime: order.required_time,
          priority: order.priority,
        },
      });

      return { order, notifications };
    });

    notificationService.publish(result.notifications);
    realtime.emitOrderChange(
      result.order.board_id,
      result.order.id,
      Number(result.order.sync_seq),
    );

    return this.getDetail(orderId);
  }

  /* --------------------------------------------------------------- status */

  async updateStatus(
    orderId: string,
    input: UpdateOrderStatusRequest,
    actor: OrderActor,
  ): Promise<OrderDto> {
    const result = await withTransaction(async (connection) => {
      const before = await orderRepository.findByIdForUpdate(connection, orderId);
      if (before === null || before.deleted_at !== null) {
        throw new NotFoundError('Order', orderId);
      }

      // Idempotent: re-sending the current status is a no-op, which matters because an offline
      // device may replay the same status change.
      if (before.status === input.status) {
        return { order: before, notifications: [], changed: false };
      }

      // A billed order is frozen for everyone — including its own status.
      if (isOrderLocked(mapOrder(before))) {
        throw new ConflictError(
          'This order has been billed and can no longer be changed by anyone',
        );
      }

      if (!canTransitionOrderStatus(before.status, input.status)) {
        throw new InvalidStatusTransitionError(before.status, input.status);
      }

      // Marking Done retires the order from the active set, so it carries its own capability
      // rather than riding along with ordinary status moves.
      if (input.status === OrderStatus.DONE) {
        await this.assertBoardCapability(
          connection,
          before.board_id,
          actor,
          Capability.ORDER_DONE,
          'Only an Admin or Manager can mark an order Done',
        );
      }

      const order = await orderRepository.updateStatus(
        connection,
        orderId,
        input.status,
        actor.userId,
      );
      if (order === null) throw new NotFoundError('Order', orderId);

      await this.writeSystemMessage(connection, order.board_id, orderId, SystemEvent.ORDER_STATUS_CHANGED, {
        from: before.status,
        to: input.status,
        changedBy: actor.userId,
        ...(input.note !== undefined ? { note: input.note } : {}),
      });

      const notifications = await this.notifyBoard(connection, order, actor, {
        type: NotificationType.STATUS_CHANGED,
        title: `${order.order_number} is now ${humanStatus(input.status)}`,
        body: input.note ?? order.venue,
      });

      await auditService.record(connection, actor, {
        action:
          input.status === OrderStatus.CANCELLED
            ? AuditAction.ORDER_CANCELLED
            : AuditAction.ORDER_STATUS_CHANGED,
        entityType: 'order',
        entityId: orderId,
        boardId: order.board_id,
        before: { status: before.status },
        after: { status: order.status, note: input.note ?? null },
      });

      return { order, notifications, changed: true };
    });

    if (result.changed) {
      notificationService.publish(result.notifications);
      realtime.emitOrderChange(
        result.order.board_id,
        result.order.id,
        Number(result.order.sync_seq),
      );
    }
    return mapOrder(result.order);
  }

  /* ----------------------------------------------------------- assignment */

  /**
   * Hands the order to a board member, or returns it to the pool when `assignedTo` is null.
   *
   * Assignment is not part of the status lifecycle, so this deliberately does not move
   * `status` — an order can be handed over before it is acknowledged and reassigned
   * mid-service without disturbing where the kitchen actually is.
   *
   * The assignee must already be a member of the order's board: handing work to someone who
   * cannot see the board would silently strand it.
   */
  async assign(
    orderId: string,
    input: AssignOrderRequest,
    actor: OrderActor,
  ): Promise<OrderDto> {
    const result = await withTransaction(async (connection) => {
      const before = await orderRepository.findByIdForUpdate(connection, orderId);
      if (before === null || before.deleted_at !== null) {
        throw new NotFoundError('Order', orderId);
      }

      await this.assertBoardCapability(
        connection,
        before.board_id,
        actor,
        Capability.ORDER_ASSIGN,
        'Only a Manager or Admin can assign an order',
      );

      if (isOrderLocked(mapOrder(before))) {
        throw new ConflictError(
          'This order has been billed and can no longer be changed by anyone',
        );
      }

      // Replaying the same assignment is a no-op, so an offline device can resend safely.
      if (before.assigned_to === input.assignedTo) {
        return { order: before, notifications: [], changed: false };
      }

      let assigneeName: string | null = null;
      if (input.assignedTo !== null) {
        const membership = await boardRepository.findMember(
          connection,
          before.board_id,
          input.assignedTo,
        );
        if (membership === null) {
          throw new ValidationError('That person is not on this board', [
            { path: 'assignedTo', message: 'Add them to the board before assigning work' },
          ]);
        }
        const user = await userRepository.findById(connection, input.assignedTo);
        assigneeName = user?.name ?? null;
      }

      const order = await orderRepository.updateAssignee(connection, orderId, input.assignedTo);
      if (order === null) throw new NotFoundError('Order', orderId);

      // Mirror the handover into the assignee's task list, in the same transaction, so "My
      // Tasks" and the order can never disagree about who owns this work.
      await taskService.syncOrderAssignment(connection, {
        orderId: order.id,
        orderNumber: order.order_number,
        boardId: order.board_id,
        venue: order.venue,
        requiredDate: order.required_date,
        requiredTime: order.required_time,
        priority: order.priority,
        assignedTo: input.assignedTo,
        assignerRole: actor.role,
      });

      await this.writeSystemMessage(
        connection,
        order.board_id,
        orderId,
        SystemEvent.ORDER_ASSIGNED,
        {
          from: before.assigned_to,
          to: input.assignedTo,
          assigneeName,
          changedBy: actor.userId,
        },
      );

      // Only the new assignee is told, not the whole board: an assignment is a message to one
      // person, and broadcasting it would train everyone to ignore the notification.
      const notifications =
        input.assignedTo === null
          ? []
          : await notificationService.notify(connection, {
            userIds: [input.assignedTo],
            type: NotificationType.STATUS_CHANGED,
            title: `${order.order_number} was assigned to you`,
            body: order.venue,
            boardId: order.board_id,
            orderId: order.id,
            actorId: actor.userId,
            data: { orderNumber: order.order_number, status: order.status },
          });

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_UPDATED,
        entityType: 'order',
        entityId: orderId,
        boardId: order.board_id,
        before: { assignedTo: before.assigned_to },
        after: { assignedTo: order.assigned_to },
      });

      return { order, notifications, changed: true };
    });

    if (result.changed) {
      notificationService.publish(result.notifications);
      realtime.emitOrderChange(
        result.order.board_id,
        result.order.id,
        Number(result.order.sync_seq),
      );
    }
    return mapOrder(result.order);
  }

  /* -------------------------------------------------- quantity & pax edits */

  /**
   * The Manager-and-above edit path: change the serving count, retune line quantities,
   * strike lines out, supersede them, or add new ones.
   *
   * Separate from {@link update} because it carries a different capability and because every
   * change here is narrated into the board feed with its before and after values — the
   * specification asks for the edit history to be readable in the thread, not buried in an
   * audit table. A cancelled line is struck through rather than removed, and a replacement
   * is inserted immediately beneath the line it supersedes.
   */
  async updateQuantities(
    orderId: string,
    input: UpdateOrderQuantitiesRequest,
    actor: OrderActor,
  ): Promise<OrderDetailDto> {
    const result = await withTransaction(async (connection) => {
      const before = await orderRepository.findByIdForUpdate(connection, orderId);
      if (before === null || before.deleted_at !== null) {
        throw new NotFoundError('Order', orderId);
      }
      this.assertEditable(before);

      await this.assertBoardCapability(
        connection,
        before.board_id,
        actor,
        Capability.ORDER_QUANTITY_EDIT,
        'Your role does not allow changing quantities or the pax count',
      );

      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== Number(before.revision)
      ) {
        throw new StaleWriteError(Number(before.revision));
      }

      const items = await orderRepository.listItems(connection, orderId);
      const byId = new Map(items.map((row) => [row.id, row]));
      const boardId = before.board_id;

      if (input.pax !== undefined && input.pax !== Number(before.pax)) {
        await orderRepository.update(connection, orderId, { pax: input.pax });
        await this.writeSystemMessage(connection, boardId, orderId, SystemEvent.ORDER_PAX_CHANGED, {
          from: Number(before.pax),
          to: input.pax,
          changedBy: actor.userId,
          ...(input.note !== undefined ? { note: input.note } : {}),
        });
      }

      for (const change of input.items ?? []) {
        const item = byId.get(change.itemId);
        if (item === undefined) throw new NotFoundError('Order item', change.itemId);
        if (item.cancelled_at !== null) {
          throw new ConflictError('That line was cancelled and can no longer be re-quantified');
        }
        const from = Number(item.quantity);
        if (from === change.quantity) continue;

        await orderRepository.updateItemQuantity(connection, change.itemId, change.quantity);
        await this.writeSystemMessage(
          connection,
          boardId,
          orderId,
          SystemEvent.ORDER_ITEM_QUANTITY_CHANGED,
          {
            itemId: change.itemId,
            menuItemId: item.menu_item_id,
            customItemName: item.custom_item_name,
            unit: item.unit,
            from,
            to: change.quantity,
            changedBy: actor.userId,
          },
        );
      }

      for (const itemId of input.cancelItemIds ?? []) {
        const item = byId.get(itemId);
        if (item === undefined) throw new NotFoundError('Order item', itemId);
        if (item.cancelled_at !== null) continue;

        await orderRepository.cancelItem(connection, itemId, actor.userId);
        await this.writeSystemMessage(
          connection,
          boardId,
          orderId,
          SystemEvent.ORDER_ITEM_CANCELLED,
          {
            itemId,
            menuItemId: item.menu_item_id,
            customItemName: item.custom_item_name,
            quantity: Number(item.quantity),
            unit: item.unit,
            changedBy: actor.userId,
          },
        );
      }

      // A replacement sorts to `original + 0.5` so it lands directly beneath the line it
      // supersedes without renumbering anything else.
      for (const replacement of input.replaceItems ?? []) {
        const item = byId.get(replacement.itemId);
        if (item === undefined) throw new NotFoundError('Order item', replacement.itemId);
        if (item.cancelled_at !== null) {
          throw new ConflictError('That line was already cancelled');
        }

        const [resolved] = await this.resolveItems(connection, [
          {
            menuItemId: replacement.menuItemId ?? null,
            customItemName: replacement.customItemName ?? null,
            quantity: replacement.quantity,
            ...(replacement.unit !== undefined ? { unit: replacement.unit } : {}),
            notes: replacement.notes ?? null,
            sortOrder: Number(item.sort_order),
          },
        ]);
        if (resolved === undefined) {
          throw new NotFoundError('Menu item', replacement.menuItemId ?? replacement.itemId);
        }

        await orderRepository.insertItems(connection, orderId, [resolved]);
        await orderRepository.cancelItem(connection, item.id, actor.userId, resolved.id);
        await this.writeSystemMessage(
          connection,
          boardId,
          orderId,
          SystemEvent.ORDER_ITEM_REPLACED,
          {
            itemId: item.id,
            replacementItemId: resolved.id,
            from: {
              menuItemId: item.menu_item_id,
              customItemName: item.custom_item_name,
              quantity: Number(item.quantity),
              unit: item.unit,
            },
            to: {
              menuItemId: resolved.menuItemId,
              customItemName: resolved.customItemName,
              quantity: resolved.quantity,
              unit: resolved.unit,
            },
            changedBy: actor.userId,
          },
        );
      }

      if (input.addItems !== undefined && input.addItems.length > 0) {
        const highestSort = items.reduce(
          (max, row) => Math.max(max, Number(row.sort_order)),
          -1,
        );
        const resolved = await this.resolveItems(
          connection,
          input.addItems.map((item, index) => ({
            ...item,
            sortOrder: item.sortOrder ?? highestSort + 1 + index,
          })),
        );
        await orderRepository.insertItems(connection, orderId, resolved);
        for (const item of resolved) {
          await this.writeSystemMessage(
            connection,
            boardId,
            orderId,
            SystemEvent.ORDER_ITEM_ADDED,
            {
              itemId: item.id,
              menuItemId: item.menuItemId,
              customItemName: item.customItemName,
              quantity: item.quantity,
              unit: item.unit,
              changedBy: actor.userId,
            },
          );
        }
      }

      const order = await orderRepository.findById(connection, orderId);
      if (order === null) throw new NotFoundError('Order', orderId);

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_UPDATED,
        entityType: 'order',
        entityId: orderId,
        boardId,
        before: { pax: Number(before.pax) },
        after: { pax: Number(order.pax), ...(input.note ? { note: input.note } : {}) },
      });

      return { order };
    });

    realtime.emitOrderChange(
      result.order.board_id,
      result.order.id,
      Number(result.order.sync_seq),
    );
    return this.getDetail(orderId);
  }

  /* ------------------------------------------------------------- internals */

  /**
   * Guards operational writes. A billed order is frozen for everyone, including Super
   * Admin; a cancelled one has nothing left to edit. DONE is *not* included: closing an
   * order out should not retroactively block correcting a typo on it before it is billed.
   */
  private assertEditable(order: OrderRow): void {
    if (order.billed_at !== null) {
      throw new ConflictError(
        'This order has been billed and can no longer be edited by anyone',
      );
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new ConflictError('A cancelled order can no longer be edited');
    }
  }

  /**
   * Board-scoped capability check inside a transaction, matching the two-grant rule the
   * route middleware applies: a global grant reaches every board only for roles that can
   * see every board (Admin and above); everyone else needs a membership that grants it.
   */
  private async assertBoardCapability(
    db: Db,
    boardId: string,
    actor: OrderActor,
    capability: Capability,
    message: string,
  ): Promise<void> {
    if (actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN) return;

    const boardRole = await boardRepository.findActiveRole(db, boardId, actor.userId);
    if (boardRole === null) {
      throw new ForbiddenError('You are not a member of this board');
    }
    if (
      permissionsCacheService.roleHasCapability(actor.role, capability) ||
      permissionsCacheService.boardRoleHasCapability(boardRole, capability)
    ) {
      return;
    }
    throw new ForbiddenError(message);
  }

  /**
   * Creating an order requires ORDER_CREATE on the target board. Administrators hold it
   * globally; everyone else must be a member whose board role grants it, which excludes viewers.
   */
  private async assertCanCreateOnBoard(
    db: Db,
    boardId: string,
    actor: OrderActor,
  ): Promise<void> {
    await this.assertBoardCapability(
      db,
      boardId,
      actor,
      Capability.ORDER_CREATE,
      'Your role on this board does not allow creating orders',
    );
  }

  private async assertBoardUsable(db: Db, boardId: string): Promise<void> {
    const board = await boardRepository.findById(db, boardId);
    if (board === null) throw new NotFoundError('Board', boardId);
    if (board.status === 'ARCHIVED') {
      throw new ConflictError('This board is archived and no longer accepts new orders');
    }
  }

  /**
   * An order is described either by a catalogued activity type or by free text. The database
   * enforces "not both null"; this produces the actionable message.
   */
  private async assertActivityValid(
    db: Db,
    activityTypeId: string | null | undefined,
    customActivity: string | null | undefined,
  ): Promise<void> {
    const hasCustom = typeof customActivity === 'string' && customActivity.trim() !== '';

    if (!activityTypeId && !hasCustom) {
      throw new ValidationError('An activity is required', [
        {
          path: 'activityTypeId',
          message: 'Select an activity type or enter a custom activity',
        },
      ]);
    }

    if (activityTypeId) {
      const activity = await activityTypeRepository.findById(db, activityTypeId);
      if (activity === null) throw new NotFoundError('Activity type', activityTypeId);
      if (activity.status !== 'ACTIVE') {
        throw new ValidationError('That activity type is inactive', [
          { path: 'activityTypeId', message: 'Choose an active activity type' },
        ]);
      }
    }
  }

  /**
   * Validates the item set and fills the unit from the menu master when the client omitted
   * it, so an order line always states its unit.
   *
   * A line names its dish either by `menuItemId` or by `customItemName` — never both. An
   * ad-hoc line is not looked up against the master catalogue at all; it defaults to the
   * generic `NOS` unit when the client did not state one.
   */
  private async resolveItems(
    db: Db,
    requested: readonly CreateOrderItemRequest[],
  ): Promise<OrderItemInput[]> {
    if (requested.length === 0) {
      throw new ValidationError('An order needs at least one item', [
        { path: 'items', message: 'Add at least one item' },
      ]);
    }
    if (requested.length > LIMITS.ORDER_ITEMS_PER_ORDER_MAX) {
      throw new ValidationError('Too many items on one order', [
        {
          path: 'items',
          message: `An order can hold at most ${LIMITS.ORDER_ITEMS_PER_ORDER_MAX} items`,
        },
      ]);
    }

    for (const item of requested) {
      const named = typeof item.customItemName === 'string' && item.customItemName.trim() !== '';
      if ((item.menuItemId != null) === named) {
        throw new ValidationError('Each line needs exactly one item name', [
          {
            path: 'items',
            message: named
              ? 'Provide either a menu item or a custom item name, not both'
              : 'Choose a menu item or type a custom item name',
          },
        ]);
      }
    }

    const menuItemIds = [
      ...new Set(
        requested
          .map((item) => item.menuItemId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const menuItems =
      menuItemIds.length === 0 ? [] : await menuItemRepository.findByIds(db, menuItemIds);
    const byId = new Map(menuItems.map((row) => [row.id, row]));

    const missing = menuItemIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new ValidationError('One or more menu items could not be found', [
        { path: 'items', message: `Unknown menu item(s): ${missing.join(', ')}` },
      ]);
    }

    return requested.map((item, index) => {
      const shared = {
        id: item.id ?? newId(),
        quantity: item.quantity,
        notes: item.notes ?? null,
        mentionedUserIds: [...new Set(item.mentionedUserIds ?? [])].slice(
          0,
          LIMITS.MENTIONS_MAX,
        ),
        sortOrder: item.sortOrder ?? index,
      };

      if (item.menuItemId == null) {
        return {
          ...shared,
          menuItemId: null,
          customItemName: (item.customItemName as string).trim(),
          unit: item.unit ?? 'NOS',
        };
      }

      const menuItem = byId.get(item.menuItemId);
      if (menuItem === undefined) throw new NotFoundError('Menu item', item.menuItemId);

      return {
        ...shared,
        menuItemId: item.menuItemId,
        customItemName: null,
        unit: item.unit ?? menuItem.unit,
        // Menu Master reference is optional — an order line may still name a plain catalogued
        // dish with no menu/variant context. When present, insertItems freezes the variant's
        // current name/price into the line; nothing here is ever recomputed afterwards.
        menuId: item.menuId ?? null,
        variantId: item.variantId ?? null,
        discountAmount: item.discountAmount ?? 0,
      };
    });
  }

  private async writeSystemMessage(
    db: PoolConnection,
    boardId: string,
    orderId: string,
    event: SystemEvent,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await threadRepository.insert(db, {
      id: newId(),
      boardId,
      orderId,
      parentMessageId: null,
      authorId: null,
      messageType: MessageType.SYSTEM,
      body: null,
      mentionedUserIds: [],
      systemEvent: event,
      systemMeta: meta,
    });
  }

  private async notifyBoard(
    db: PoolConnection,
    order: OrderRow,
    actor: OrderActor,
    payload: { type: NotificationType; title: string; body: string | null },
  ) {
    const members = await boardRepository.listMembers(db, order.board_id);
    return notificationService.notify(db, {
      userIds: members.map((member) => member.user_id),
      type: payload.type,
      title: payload.title,
      body: payload.body,
      boardId: order.board_id,
      orderId: order.id,
      actorId: actor.userId,
      data: { orderNumber: order.order_number, status: order.status },
    });
  }
}

function collectMentions(items: readonly OrderItemInput[]): string[] {
  return [...new Set(items.flatMap((item) => item.mentionedUserIds))];
}

function humanStatus(status: OrderStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

export const orderService = new OrderService();
export type { AttachmentOwnerType };
