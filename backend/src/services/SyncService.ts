import {
  ERROR_CODES,
  LIMITS,
  OrderStatus,
  PUSHABLE_ENTITIES,
  SYNC_ENTITIES,
  SyncDirection,
  SyncOp,
  SyncResultStatus,
  UserRole,
  Capability,
  emptyChangeSet,
  type PushableEntity,
  type SyncChangeSet,
  type SyncEntity,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncPushItem,
  type SyncPushItemResult,
  type CreateOrderItemRequest,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { currentSyncSeq } from '../db/syncSeq';
import { retryOnLockContention } from '../db/transaction';
import type { Db } from '../db/types';
import {
  mapAcknowledgement,
  mapActivityType,
  mapAlertSetting,
  mapAttachment,
  mapBoard,
  mapBoardMember,
  mapIngredient,
  mapMenuCategory,
  mapMenuItem,
  mapNotification,
  mapOrder,
  mapOrderItem,
  mapRecipe,
  mapRecipeIngredient,
  mapRecipeStep,
  mapShoppingList,
  mapShoppingListItem,
  mapStation,
  mapThreadMessage,
  mapUser,
} from '../models/mappers';
import { acknowledgementRepository } from '../repositories/AcknowledgementRepository';
import { alertRepository } from '../repositories/AlertRepository';
import { attachmentRepository } from '../repositories/AttachmentRepository';
import { boardRepository } from '../repositories/BoardRepository';
import { ingredientRepository } from '../repositories/IngredientRepository';
import {
  activityTypeRepository,
  menuCategoryRepository,
  menuItemRepository,
  stationRepository,
} from '../repositories/MasterRepository';
import { notificationRepository } from '../repositories/NotificationRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { recipeRepository } from '../repositories/RecipeRepository';
import { shoppingListRepository } from '../repositories/ShoppingListRepository';
import { syncLogRepository } from '../repositories/SyncLogRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import { userRepository } from '../repositories/UserRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { ForbiddenError, isAppError } from '../utils/errors';
import { newId } from '../utils/ids';
import { parseIdArray } from '../utils/json';
import { logger } from '../utils/logger';
import type { AuditActor } from './AuditService';
import { acknowledgementService } from './AcknowledgementService';
import { boardService } from './BoardService';
import { orderService } from './OrderService';
import { permissionsCacheService } from './PermissionsCacheService';
import { threadService } from './ThreadService';

export interface SyncActor extends AuditActor {
  userId: string;
  role: UserRole;
}

/**
 * Offline-first synchronisation. Full contract in docs/SYNC.md.
 *
 * **Idempotency.** Every entity id is a client-generated UUID, so a push is idempotent by
 * construction: replaying an insert collides on the primary key and is reported DUPLICATE,
 * replaying an update converges on the same content, and replaying a delete is a no-op. No
 * server-side operation ledger is needed, which is why one was not added.
 *
 * **Isolation.** Each item is applied independently. One malformed or unauthorised item must not
 * fail the rest of a batch a device has been holding for hours, so every item produces its own
 * result and the loop continues.
 *
 * **Transactions.** This layer opens none. Each domain service is already atomic internally, and
 * wrapping those calls in an outer transaction would deadlock against itself: the inner
 * transaction runs on a different pooled connection and would block on locks — notably the
 * sync_counter row — that the outer one still holds. Where atomic check-then-act is genuinely
 * required, the guarantee is obtained from the service instead: `expectedRevision` makes the
 * optimistic-concurrency check happen inside the service's own transaction.
 */
export class SyncService {
  /* ------------------------------------------------------------------- push */

  async push(request: SyncPushRequest, actor: SyncActor): Promise<SyncPushResponse> {
    const startedAt = new Date();
    const items = request.items.slice(0, LIMITS.SYNC_PUSH_BATCH_MAX);
    const results: SyncPushItemResult[] = [];
    const touchedBoards = new Set<string>();

    for (const item of items) {
      // Order matters: a device queues an order before its thread messages, so items are
      // applied strictly in the sequence the device recorded them.
      const outcome = await this.applyItem(item, actor);
      results.push(outcome.result);
      if (outcome.boardId !== null) touchedBoards.add(outcome.boardId);
    }

    const pool = getPool();
    const cursor = await currentSyncSeq(pool);

    for (const boardId of touchedBoards) {
      realtime.emitBoardChange(boardId, ['orders', 'thread_messages', 'acknowledgements'], cursor);
    }

    const applied = results.filter((r) => r.status === SyncResultStatus.APPLIED).length;
    const conflicts = results.filter((r) => r.status === SyncResultStatus.SUPERSEDED).length;
    const failed = results.filter(
      (r) => r.status === SyncResultStatus.FAILED || r.status === SyncResultStatus.REJECTED,
    ).length;

    // Logged outside the item transactions so a diagnostics failure cannot undo applied data.
    await this.log({
      actor,
      deviceId: request.deviceId,
      direction: SyncDirection.PUSH,
      cursorFrom: null,
      cursorTo: cursor,
      pushedCount: items.length,
      appliedCount: applied,
      conflictCount: conflicts,
      failedCount: failed,
      startedAt,
      entityCounts: countByEntity(items),
    });

    return { results, cursor, serverTime: new Date().toISOString() };
  }

  private async applyItem(
    item: SyncPushItem,
    actor: SyncActor,
  ): Promise<{ result: SyncPushItemResult; boardId: string | null }> {
    const base = { clientOpId: item.clientOpId, entity: item.entity, entityId: item.entityId };

    if (!(PUSHABLE_ENTITIES as readonly string[]).includes(item.entity)) {
      return {
        result: {
          ...base,
          status: SyncResultStatus.REJECTED,
          errorCode: 'ENTITY_NOT_PUSHABLE',
          errorMessage: `${item.entity} is server-authored and cannot be pushed from a device`,
        },
        boardId: null,
      };
    }

    try {
      return await retryOnLockContention(() => this.dispatch(getPool(), item, actor, base));
    } catch (error) {
      // A stale write is not a failure: the server copy simply won, and the device should adopt
      // it rather than retry.
      if (isAppError(error) && error.code === ERROR_CODES.STALE_WRITE) {
        return {
          result: {
            ...base,
            status: SyncResultStatus.SUPERSEDED,
            errorCode: error.code,
            errorMessage: error.message,
          },
          boardId: null,
        };
      }

      // Client faults are terminal — retrying a validation or permission failure loops forever.
      // Everything else is transient and stays queued.
      const terminal =
        isAppError(error) && error.statusCode >= 400 && error.statusCode < 500 &&
        error.statusCode !== 429;

      if (!terminal) {
        logger.error(
          'Sync push item failed transiently',
          { entity: item.entity, entityId: item.entityId, userId: actor.userId },
          error,
        );
      }

      return {
        result: {
          ...base,
          status: terminal ? SyncResultStatus.REJECTED : SyncResultStatus.FAILED,
          errorCode: isAppError(error) ? error.code : 'INTERNAL_ERROR',
          errorMessage: isAppError(error) ? error.message : 'The change could not be applied',
        },
        boardId: null,
      };
    }
  }

  private async dispatch(
    db: Db,
    item: SyncPushItem,
    actor: SyncActor,
    base: Pick<SyncPushItemResult, 'clientOpId' | 'entity' | 'entityId'>,
  ): Promise<{ result: SyncPushItemResult; boardId: string | null }> {
    switch (item.entity) {
      case 'boards':
        return this.pushBoard(db, item, actor, base);
      case 'orders':
        return this.pushOrder(db, item, actor, base);
      case 'order_items':
        return this.pushOrderItems(db, item, actor, base);
      case 'thread_messages':
        return this.pushThreadMessage(db, item, actor, base);
      case 'acknowledgements':
        return this.pushAcknowledgement(db, item, actor, base);
      case 'attachments':
        return this.pushAttachment(db, item, actor, base);
      default:
        return {
          result: {
            ...base,
            status: SyncResultStatus.REJECTED,
            errorCode: 'ENTITY_NOT_PUSHABLE',
            errorMessage: `Unsupported entity ${String(item.entity)}`,
          },
          boardId: null,
        };
    }
  }

  private async pushBoard(
    db: Db,
    item: SyncPushItem,
    actor: SyncActor,
    base: Pick<SyncPushItemResult, 'clientOpId' | 'entity' | 'entityId'>,
  ) {
    const existing = await boardRepository.findById(db, item.entityId, {
      includeDeleted: true,
    });

    if (item.op === SyncOp.DELETE) {
      if (existing === null) return { result: { ...base, status: SyncResultStatus.DUPLICATE }, boardId: null };
      await boardService.archive(item.entityId, actor);
      return { result: { ...base, status: SyncResultStatus.APPLIED }, boardId: item.entityId };
    }

    const payload = item.payload ?? {};

    if (existing === null) {
      const stationId = payload.stationId;
      if (typeof stationId !== 'string' || stationId === '') {
        return {
          result: {
            ...base,
            status: SyncResultStatus.REJECTED,
            errorCode: 'VALIDATION_FAILED',
            errorMessage: 'A board must include stationId when created offline',
          },
          boardId: null,
        };
      }

      const board = await boardService.create(
        {
          id: item.entityId,
          stationId,
          name: String(payload.name ?? '').trim(),
          description: (payload.description as string | null) ?? null,
        },
        actor,
      );
      return {
        result: { ...base, status: SyncResultStatus.APPLIED, serverEntity: board },
        boardId: board.id,
      };
    }

    const resolution = this.resolveConflict(item, Number(existing.revision), existing.updated_at);
    if (resolution === 'server-wins') {
      return {
        result: {
          ...base,
          status: SyncResultStatus.SUPERSEDED,
          serverEntity: mapBoard(existing),
        },
        boardId: existing.id,
      };
    }

    const board = await boardService.update(
      item.entityId,
      {
        ...(typeof payload.stationId === 'string' ? { stationId: payload.stationId } : {}),
        ...(payload.name !== undefined ? { name: String(payload.name) } : {}),
        ...(payload.description !== undefined
          ? { description: payload.description as string | null }
          : {}),
      },
      actor,
    );
    return {
      result: { ...base, status: SyncResultStatus.APPLIED, serverEntity: board },
      boardId: board.id,
    };
  }

  private async pushOrder(
    db: Db,
    item: SyncPushItem,
    actor: SyncActor,
    base: Pick<SyncPushItemResult, 'clientOpId' | 'entity' | 'entityId'>,
  ) {
    const existing = await orderRepository.findById(db, item.entityId, { includeDeleted: true });

    if (item.op === SyncOp.DELETE) {
      if (existing === null || existing.deleted_at !== null) {
        return { result: { ...base, status: SyncResultStatus.DUPLICATE }, boardId: null };
      }
      await this.assertBoardCapability(
        db,
        existing.board_id,
        actor,
        Capability.ORDER_CANCEL,
      );
      // A device "deleting" an order means cancelling it: the row must survive so the
      // cancellation replicates and history stays intact.
      await orderService.updateStatus(
        item.entityId,
        { status: OrderStatus.CANCELLED },
        actor,
      );
      return {
        result: { ...base, status: SyncResultStatus.APPLIED },
        boardId: existing.board_id,
      };
    }

    const payload = (item.payload ?? {}) as Record<string, unknown>;

    if (existing === null) {
      const boardId = String(payload.boardId ?? '');
      await this.assertBoardCapability(db, boardId, actor, Capability.ORDER_CREATE);

      const order = await orderService.create(
        {
          id: item.entityId,
          ...(payload.orderNumber !== undefined
            ? { orderNumber: String(payload.orderNumber) }
            : {}),
          boardId,
          activityTypeId: (payload.activityTypeId as string | null) ?? null,
          customActivity: (payload.customActivity as string | null) ?? null,
          venue: String(payload.venue ?? ''),
          pax: Number(payload.pax ?? 0),
          requiredDate: String(payload.requiredDate ?? ''),
          requiredTime: String(payload.requiredTime ?? ''),
          ...(payload.priority !== undefined
            ? { priority: payload.priority as never }
            : {}),
          items: Array.isArray(payload.items) ? (payload.items as never[]) : [],
          ...(Array.isArray(payload.attachmentIds)
            ? { attachmentIds: payload.attachmentIds as string[] }
            : {}),
        },
        actor,
      );
      return {
        result: { ...base, status: SyncResultStatus.APPLIED, serverEntity: order },
        boardId: order.boardId,
      };
    }

    await this.assertBoardCapability(
      db,
      existing.board_id,
      actor,
      Capability.ORDER_UPDATE,
    );

    const resolution = this.resolveConflict(item, Number(existing.revision), existing.updated_at);
    if (resolution === 'server-wins') {
      return {
        result: {
          ...base,
          status: SyncResultStatus.SUPERSEDED,
          serverEntity: mapOrder(existing),
        },
        boardId: existing.board_id,
      };
    }

    // Status changes travel through the status endpoint's transition rules rather than being
    // written as a field, so an offline device cannot skip a state.
    if (
      typeof payload.status === 'string' &&
      payload.status !== existing.status
    ) {
      await orderService.updateStatus(
        item.entityId,
        { status: payload.status as OrderStatus },
        actor,
      );
    }

    // Assignment likewise goes through its own service call, so the capability check and the
    // "assignee must be on this board" rule apply to an offline handover exactly as they do
    // to an online one.
    if (
      'assignedTo' in payload &&
      (payload.assignedTo === null || typeof payload.assignedTo === 'string') &&
      payload.assignedTo !== existing.assigned_to
    ) {
      await orderService.assign(item.entityId, { assignedTo: payload.assignedTo }, actor);
    }

    const order = await orderService.update(
      item.entityId,
      {
        ...(payload.activityTypeId !== undefined
          ? { activityTypeId: payload.activityTypeId as string | null }
          : {}),
        ...(payload.customActivity !== undefined
          ? { customActivity: payload.customActivity as string | null }
          : {}),
        ...(payload.venue !== undefined ? { venue: String(payload.venue) } : {}),
        ...(payload.pax !== undefined ? { pax: Number(payload.pax) } : {}),
        ...(payload.requiredDate !== undefined
          ? { requiredDate: String(payload.requiredDate) }
          : {}),
        ...(payload.requiredTime !== undefined
          ? { requiredTime: String(payload.requiredTime) }
          : {}),
        ...(payload.priority !== undefined ? { priority: payload.priority as never } : {}),
        ...(Array.isArray(payload.items) ? { items: payload.items as never[] } : {}),
        // Passed only when the device was editing the revision still current at the read above.
        // That turns the check-then-act into a real guarantee, enforced inside the service's own
        // transaction: a concurrent change between read and write raises STALE_WRITE, which
        // applyItem reports as SUPERSEDED.
        //
        // Omitted when the client won on timestamp despite a revision mismatch — that outcome is
        // a deliberate overwrite, so guarding it against the revision would contradict the
        // conflict decision just made.
        ...(item.baseRevision !== undefined && item.baseRevision === Number(existing.revision)
          ? { expectedRevision: item.baseRevision }
          : {}),
      },
      actor,
    );

    return {
      result: { ...base, status: SyncResultStatus.APPLIED, serverEntity: order },
      boardId: order.boardId,
    };
  }

  /**
   * Standalone item pushes are accepted, but the whole set is replaced through the order so the
   * order's revision and cursor move together with its lines.
   */
  private async pushOrderItems(
    db: Db,
    item: SyncPushItem,
    actor: SyncActor,
    base: Pick<SyncPushItemResult, 'clientOpId' | 'entity' | 'entityId'>,
  ) {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const orderId = String(payload.orderId ?? '');

    const order = await orderRepository.findById(db, orderId);
    if (order === null) {
      return {
        result: {
          ...base,
          status: SyncResultStatus.REJECTED,
          errorCode: 'NOT_FOUND',
          errorMessage: `Order ${orderId} does not exist`,
        },
        boardId: null,
      };
    }

    await this.assertBoardCapability(db, order.board_id, actor, Capability.ORDER_UPDATE);

    const items = await orderRepository.listItems(db, orderId);
    const nextItems: CreateOrderItemRequest[] = items
      .filter((row) => row.id !== item.entityId)
      .map((row) => ({
        id: row.id,
        menuItemId: row.menu_item_id,
        customItemName: row.custom_item_name,
        quantity: Number(row.quantity),
        unit: row.unit,
        notes: row.notes,
        mentionedUserIds: parseIdArray(row.mentioned_user_ids),
        sortOrder: Number(row.sort_order),
      }));

    if (item.op === SyncOp.UPSERT) {
      // A line names its dish one way or the other. Preferring an explicit customItemName
      // keeps an offline-created ad-hoc line ad-hoc instead of failing the dish-naming check.
      const customItemName =
        typeof payload.customItemName === 'string' && payload.customItemName.trim() !== ''
          ? payload.customItemName.trim()
          : null;
      const menuItemId =
        customItemName === null && typeof payload.menuItemId === 'string'
          ? payload.menuItemId
          : null;

      nextItems.push({
        id: item.entityId,
        menuItemId,
        customItemName,
        quantity: Number(payload.quantity ?? 0),
        unit: String(payload.unit ?? 'NOS'),
        notes: (payload.notes as string | null) ?? null,
        mentionedUserIds: Array.isArray(payload.mentionedUserIds)
          ? (payload.mentionedUserIds as string[])
          : [],
        sortOrder: Number(payload.sortOrder ?? nextItems.length),
      });
    }

    await orderService.update(orderId, { items: nextItems }, actor);
    return {
      result: { ...base, status: SyncResultStatus.APPLIED },
      boardId: order.board_id,
    };
  }

  private async pushThreadMessage(
    db: Db,
    item: SyncPushItem,
    actor: SyncActor,
    base: Pick<SyncPushItemResult, 'clientOpId' | 'entity' | 'entityId'>,
  ) {
    const existing = await threadRepository.findById(db, item.entityId, {
      includeDeleted: true,
    });

    if (item.op === SyncOp.DELETE) {
      if (existing === null || existing.deleted_at !== null) {
        return { result: { ...base, status: SyncResultStatus.DUPLICATE }, boardId: null };
      }
      const canDeleteAny = await this.hasBoardCapability(
        db,
        existing.board_id,
        actor,
        Capability.THREAD_DELETE_ANY,
      );
      await threadService.remove(item.entityId, actor, { canDeleteAny });
      return {
        result: { ...base, status: SyncResultStatus.APPLIED },
        boardId: existing.board_id,
      };
    }

    // Append-only: an id that already exists is a replay, never an edit.
    if (existing !== null) {
      return {
        result: {
          ...base,
          status: SyncResultStatus.DUPLICATE,
          serverEntity: mapThreadMessage(existing),
        },
        boardId: null,
      };
    }

    const payload = (item.payload ?? {}) as Record<string, unknown>;
    // A general board post carries no orderId; an order-scoped one inherits its order's board.
    const orderId = typeof payload.orderId === 'string' && payload.orderId !== ''
      ? payload.orderId
      : null;

    let boardId: string;
    if (orderId !== null) {
      const order = await orderRepository.findById(db, orderId);
      if (order === null) {
        return {
          result: {
            ...base,
            status: SyncResultStatus.REJECTED,
            errorCode: 'NOT_FOUND',
            errorMessage: `Order ${orderId} does not exist`,
          },
          boardId: null,
        };
      }
      boardId = order.board_id;
    } else {
      const payloadBoardId = typeof payload.boardId === 'string' ? payload.boardId : '';
      const board = await boardRepository.findById(db, payloadBoardId);
      if (board === null) {
        return {
          result: {
            ...base,
            status: SyncResultStatus.REJECTED,
            errorCode: 'NOT_FOUND',
            errorMessage: `Board ${payloadBoardId} does not exist`,
          },
          boardId: null,
        };
      }
      boardId = board.id;
    }

    await this.assertBoardCapability(db, boardId, actor, Capability.THREAD_POST);

    const message = await threadService.post(
      { boardId, orderId },
      {
        id: item.entityId,
        parentMessageId: (payload.parentMessageId as string | null) ?? null,
        body: (payload.body as string | null) ?? null,
        mentionedUserIds: Array.isArray(payload.mentionedUserIds)
          ? (payload.mentionedUserIds as string[])
          : [],
        ...(Array.isArray(payload.attachmentIds)
          ? { attachmentIds: payload.attachmentIds as string[] }
          : {}),
      },
      actor,
    );

    return {
      result: { ...base, status: SyncResultStatus.APPLIED, serverEntity: message },
      boardId,
    };
  }

  private async pushAcknowledgement(
    db: Db,
    item: SyncPushItem,
    actor: SyncActor,
    base: Pick<SyncPushItemResult, 'clientOpId' | 'entity' | 'entityId'>,
  ) {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const orderId = String(payload.orderId ?? '');

    const order = await orderRepository.findById(db, orderId);
    if (order === null) {
      return {
        result: {
          ...base,
          status: SyncResultStatus.REJECTED,
          errorCode: 'NOT_FOUND',
          errorMessage: `Order ${orderId} does not exist`,
        },
        boardId: null,
      };
    }

    if (item.op === SyncOp.DELETE) {
      await acknowledgementService.withdraw(orderId, actor);
      return {
        result: { ...base, status: SyncResultStatus.APPLIED },
        boardId: order.board_id,
      };
    }

    // Naturally idempotent by (order_id, user_id) — a replay simply returns the existing row.
    const existing = await acknowledgementRepository.find(db, orderId, actor.userId);
    if (existing !== null && existing.deleted_at === null) {
      return {
        result: {
          ...base,
          status: SyncResultStatus.DUPLICATE,
          serverEntity: mapAcknowledgement(existing),
        },
        boardId: order.board_id,
      };
    }

    const acknowledgement = await acknowledgementService.acknowledge(
      orderId,
      { id: item.entityId, note: (payload.note as string | null) ?? null },
      actor,
    );

    return {
      result: { ...base, status: SyncResultStatus.APPLIED, serverEntity: acknowledgement },
      boardId: order.board_id,
    };
  }

  /**
   * Only the owner binding is pushable. The bytes and the row itself are created by the upload
   * endpoint, because a device cannot push a file through the JSON sync channel.
   */
  private async pushAttachment(
    db: Db,
    item: SyncPushItem,
    actor: SyncActor,
    base: Pick<SyncPushItemResult, 'clientOpId' | 'entity' | 'entityId'>,
  ) {
    const existing = await attachmentRepository.findById(db, item.entityId, {
      includeDeleted: true,
    });

    if (existing === null) {
      return {
        result: {
          ...base,
          status: SyncResultStatus.FAILED,
          errorCode: 'UPLOAD_PENDING',
          errorMessage: 'Upload the file before pushing its attachment row',
        },
        boardId: null,
      };
    }

    if (item.op === SyncOp.DELETE) {
      if (existing.deleted_at !== null) {
        return { result: { ...base, status: SyncResultStatus.DUPLICATE }, boardId: null };
      }
      await attachmentRepository.softDelete(db, item.entityId);
      return { result: { ...base, status: SyncResultStatus.APPLIED }, boardId: null };
    }

    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const ownerId = payload.ownerId as string | null | undefined;

    if (ownerId) {
      await attachmentRepository.bindToOwner(
        db,
        [item.entityId],
        (payload.ownerType as never) ?? existing.owner_type,
        ownerId,
        actor.userId,
      );
    }

    const row = await attachmentRepository.findById(db, item.entityId);
    return {
      result: {
        ...base,
        status: SyncResultStatus.APPLIED,
        serverEntity: row === null ? null : mapAttachment(row),
      },
      boardId: null,
    };
  }

  /* ------------------------------------------------------------------- pull */

  async pull(request: SyncPullRequest, actor: SyncActor): Promise<SyncPullResponse> {
    const startedAt = new Date();
    const pool = getPool();

    const limit = Math.min(
      request.limit ?? LIMITS.SYNC_PULL_LIMIT_DEFAULT,
      LIMITS.SYNC_PULL_LIMIT_MAX,
    );
    const cursor = Math.max(0, Math.trunc(request.cursor));
    const requested = new Set<SyncEntity>(request.entities ?? SYNC_ENTITIES);

    const seesAllBoards = actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN;
    const boardIds = await boardRepository.listBoardIdsForUser(pool, actor.userId);
    // Administrators sync every board; everyone else only the boards they belong to.
    const scopeUserId = seesAllBoards ? null : actor.userId;
    const orderScope = seesAllBoards ? await this.allBoardIds(pool) : boardIds;

    const changes: SyncChangeSet = emptyChangeSet();

    if (requested.has('users')) {
      changes.users = (await userRepository.changedSince(pool, cursor, limit)).map(mapUser);
    }
    if (requested.has('boards')) {
      changes.boards = (
        await boardRepository.changedSince(pool, cursor, limit, scopeUserId)
      ).map(mapBoard);
    }
    if (requested.has('board_members')) {
      changes.board_members = (
        await boardRepository.membersChangedSince(pool, cursor, limit, scopeUserId)
      ).map(mapBoardMember);
    }
    if (requested.has('stations')) {
      changes.stations = (await stationRepository.changedSince(pool, cursor, limit)).map(
        mapStation,
      );
    }
    if (requested.has('activity_types')) {
      changes.activity_types = (
        await activityTypeRepository.changedSince(pool, cursor, limit)
      ).map(mapActivityType);
    }
    if (requested.has('menu_categories')) {
      changes.menu_categories = (
        await menuCategoryRepository.changedSince(pool, cursor, limit)
      ).map(mapMenuCategory);
    }
    if (requested.has('menu_items')) {
      changes.menu_items = (await menuItemRepository.changedSince(pool, cursor, limit)).map(
        mapMenuItem,
      );
    }
    // The ingredient master, recipes and their ingredients/steps all ride down with the
    // other master data so the long-press "view recipe" works in a kitchen with no signal.
    // Ingredients and steps are sent as bare rows; the device joins them locally.
    if (requested.has('ingredients')) {
      changes.ingredients = (await ingredientRepository.changedSince(pool, cursor, limit)).map(
        mapIngredient,
      );
    }
    if (requested.has('recipes')) {
      changes.recipes = (await recipeRepository.changedSince(pool, cursor, limit)).map((row) =>
        mapRecipe(row, [], []),
      );
    }
    if (requested.has('recipe_ingredients')) {
      changes.recipe_ingredients = (
        await recipeRepository.ingredientsChangedSince(pool, cursor, limit)
      ).map(mapRecipeIngredient);
    }
    if (requested.has('recipe_steps')) {
      changes.recipe_steps = (
        await recipeRepository.stepsChangedSince(pool, cursor, limit)
      ).map(mapRecipeStep);
    }
    if (requested.has('orders')) {
      changes.orders = (
        await orderRepository.changedSince(pool, cursor, limit, orderScope)
      ).map(mapOrder);
    }
    if (requested.has('order_items')) {
      changes.order_items = (
        await orderRepository.itemsChangedSince(pool, cursor, limit, orderScope)
      ).map(mapOrderItem);
    }
    if (requested.has('attachments')) {
      changes.attachments = (
        await attachmentRepository.changedSince(pool, cursor, limit, orderScope, actor.userId)
      ).map(mapAttachment);
    }
    if (requested.has('thread_messages')) {
      changes.thread_messages = (
        await threadRepository.changedSince(pool, cursor, limit, orderScope)
      ).map(mapThreadMessage);
    }
    if (requested.has('acknowledgements')) {
      changes.acknowledgements = (
        await acknowledgementRepository.changedSince(pool, cursor, limit, orderScope)
      ).map(mapAcknowledgement);
    }
    if (requested.has('shopping_lists')) {
      changes.shopping_lists = (
        await shoppingListRepository.changedSince(pool, cursor, limit, orderScope)
      ).map((row) => mapShoppingList(row, []));
    }
    if (requested.has('shopping_list_items')) {
      changes.shopping_list_items = (
        await shoppingListRepository.itemsChangedSince(pool, cursor, limit, orderScope)
      ).map(mapShoppingListItem);
    }
    // Organisation-wide and small; every device needs them to know how to buzz.
    if (requested.has('alert_settings')) {
      changes.alert_settings = (
        await alertRepository.settingsChangedSince(pool, cursor, limit)
      ).map(mapAlertSetting);
    }
    if (requested.has('notifications')) {
      changes.notifications = (
        await notificationRepository.changedSince(pool, cursor, limit, actor.userId)
      ).map(mapNotification);
    }

    // Each entity was paged independently, so the safe resume point is the lowest per-entity
    // high-water mark among the entities that filled their page. Taking the maximum would skip
    // rows in an entity that was truncated.
    const { nextCursor, hasMore } = this.resolveCursor(changes, cursor, limit);

    await this.log({
      actor,
      deviceId: request.deviceId,
      direction: SyncDirection.PULL,
      cursorFrom: cursor,
      cursorTo: nextCursor,
      pushedCount: 0,
      appliedCount: totalRows(changes),
      conflictCount: 0,
      failedCount: 0,
      startedAt,
      entityCounts: rowsByEntity(changes),
    });

    return { changes, cursor: nextCursor, hasMore, serverTime: new Date().toISOString() };
  }

  private resolveCursor(
    changes: SyncChangeSet,
    fromCursor: number,
    limit: number,
  ): { nextCursor: number; hasMore: boolean } {
    let truncatedMinimum = Number.POSITIVE_INFINITY;
    let overallMaximum = fromCursor;
    let anyTruncated = false;

    for (const entity of SYNC_ENTITIES) {
      const rows = changes[entity] as { syncSeq: number }[];
      if (rows.length === 0) continue;

      const highest = rows.reduce((max, row) => Math.max(max, row.syncSeq), 0);
      overallMaximum = Math.max(overallMaximum, highest);

      if (rows.length >= limit) {
        anyTruncated = true;
        truncatedMinimum = Math.min(truncatedMinimum, highest);
      }
    }

    if (!anyTruncated) {
      return { nextCursor: overallMaximum, hasMore: false };
    }
    return { nextCursor: truncatedMinimum, hasMore: true };
  }

  private async allBoardIds(pool: ReturnType<typeof getPool>): Promise<string[]> {
    const { rows } = await boardRepository.list(pool, { limit: 10_000, offset: 0 });
    return rows.map((row) => row.id);
  }

  /**
   * Last-write-wins with a revision guard. Field-level merging is deliberately not attempted:
   * merging two edits of the same order silently produces an order nobody authored.
   */
  private resolveConflict(
    item: SyncPushItem,
    serverRevision: number,
    serverUpdatedAt: string,
  ): 'client-wins' | 'server-wins' {
    if (item.baseRevision === undefined || item.baseRevision === serverRevision) {
      return 'client-wins';
    }

    const clientTime = Date.parse(item.clientTimestamp);
    const serverTime = Date.parse(`${serverUpdatedAt.replace(' ', 'T')}Z`);

    if (!Number.isFinite(clientTime) || !Number.isFinite(serverTime)) {
      // An unparseable client clock cannot be trusted to win a tie-break.
      return 'server-wins';
    }
    return clientTime > serverTime ? 'client-wins' : 'server-wins';
  }

  private async assertBoardCapability(
    db: Db,
    boardId: string,
    actor: SyncActor,
    capability: Capability,
  ): Promise<void> {
    const permitted = await this.hasBoardCapability(db, boardId, actor, capability);
    if (!permitted) {
      throw new ForbiddenError('You do not have permission to change this board');
    }
  }

  private async hasBoardCapability(
    db: Db,
    boardId: string,
    actor: SyncActor,
    capability: Capability,
  ): Promise<boolean> {
    if (actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN) return true;
    const boardRole = await boardRepository.findActiveRole(db, boardId, actor.userId);
    return boardRole !== null && permissionsCacheService.boardRoleHasCapability(boardRole, capability);
  }

  private async log(input: {
    actor: SyncActor;
    deviceId: string;
    direction: SyncDirection;
    cursorFrom: number | null;
    cursorTo: number | null;
    pushedCount: number;
    appliedCount: number;
    conflictCount: number;
    failedCount: number;
    startedAt: Date;
    entityCounts: Record<string, number>;
  }): Promise<void> {
    try {
      await syncLogRepository.insert(getPool(), {
        id: newId(),
        userId: input.actor.userId,
        deviceId: input.deviceId,
        direction: input.direction,
        cursorFrom: input.cursorFrom,
        cursorTo: input.cursorTo,
        entityCounts: input.entityCounts,
        pushedCount: input.pushedCount,
        appliedCount: input.appliedCount,
        conflictCount: input.conflictCount,
        failedCount: input.failedCount,
        status:
          input.failedCount > 0
            ? 'PARTIAL'
            : 'OK',
        error: null,
        startedAt: input.startedAt,
      });
    } catch (error) {
      logger.warn('Failed to write sync log', { userId: input.actor.userId }, error);
    }
  }
}

function countByEntity(items: readonly SyncPushItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.entity] = (counts[item.entity] ?? 0) + 1;
  }
  return counts;
}

function rowsByEntity(changes: SyncChangeSet): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entity of SYNC_ENTITIES) {
    const rows = changes[entity] as unknown[];
    if (rows.length > 0) counts[entity] = rows.length;
  }
  return counts;
}

function totalRows(changes: SyncChangeSet): number {
  return SYNC_ENTITIES.reduce(
    (sum, entity) => sum + (changes[entity] as unknown[]).length,
    0,
  );
}

export const syncService = new SyncService();
export type { PushableEntity };
