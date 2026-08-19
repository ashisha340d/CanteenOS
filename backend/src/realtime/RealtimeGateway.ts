import type { Server as SocketServer } from 'socket.io';
import {
  KDS_SOCKET_EVENTS,
  SOCKET_EVENTS,
  SOCKET_ROOMS,
  type CdsBillDto,
  type CdsLiveDto,
  type SyncEntity,
} from '@menuboard/shared';
import { logger } from '../utils/logger';

/**
 * Kitchen/customer display rooms. Not in shared's SOCKET_ROOMS because the KDS display is a
 * first-class client of these rooms alone — the sync clients never join them.
 */
export const KDS_REALTIME_ROOMS = {
  kdsCounter: (counterId: string): string => `kds:counter:${counterId}`,
  kdsKitchen: (printingGroupId: string): string => `kds:kitchen:${printingGroupId}`,
  cdsCounter: (counterId: string): string => `cds:counter:${counterId}`,
} as const;

/**
 * Socket.IO emission façade.
 *
 * Broadcasts are **hints, not data**. A payload never carries the changed entity — only
 * enough to tell a device that something in a given scope moved, after which the device
 * pulls through the normal cursor path. That keeps one code path for applying changes, so a
 * dropped socket event degrades to a slightly later sync instead of a divergent local
 * database (docs/SYNC.md).
 *
 * The gateway is a no-op until `attach` is called, so CLI tools and tests can exercise
 * services without a running socket server.
 */
export class RealtimeGateway {
  private io: SocketServer | null = null;

  attach(io: SocketServer): void {
    this.io = io;
  }

  detach(): void {
    this.io = null;
  }

  get isAttached(): boolean {
    return this.io !== null;
  }

  /** Tells everyone watching a board that entities changed above `cursor`. */
  emitBoardChange(boardId: string, entities: SyncEntity[], cursor: number): void {
    this.emit(SOCKET_ROOMS.board(boardId), SOCKET_EVENTS.ENTITY_CHANGED, {
      boardId,
      entities,
      cursor,
    });
  }

  emitOrderChange(boardId: string, orderId: string, cursor: number): void {
    this.emit(SOCKET_ROOMS.board(boardId), SOCKET_EVENTS.ORDER_CHANGED, {
      boardId,
      orderId,
      cursor,
    });
  }

  emitThreadMessage(
    boardId: string,
    orderId: string | null,
    messageId: string,
    cursor: number,
  ): void {
    this.emit(SOCKET_ROOMS.board(boardId), SOCKET_EVENTS.THREAD_MESSAGE_CREATED, {
      boardId,
      orderId,
      messageId,
      cursor,
    });
  }

  emitAcknowledgement(boardId: string, orderId: string, userId: string, cursor: number): void {
    this.emit(SOCKET_ROOMS.board(boardId), SOCKET_EVENTS.ACKNOWLEDGEMENT_CREATED, {
      boardId,
      orderId,
      userId,
      cursor,
    });
  }

  /** Per-user room, so a notification reaches every device that user is signed in on. */
  emitNotification(userId: string, notificationId: string, cursor: number): void {
    this.emit(SOCKET_ROOMS.user(userId), SOCKET_EVENTS.NOTIFICATION_CREATED, {
      notificationId,
      cursor,
    });
  }

  emitMembershipChange(boardId: string, userIds: string[], cursor: number): void {
    this.emit(SOCKET_ROOMS.board(boardId), SOCKET_EVENTS.BOARD_MEMBERSHIP_CHANGED, {
      boardId,
      cursor,
    });
    // A user who was just removed is no longer in the board room, so they are also told
    // directly — otherwise their device would never learn to drop the board.
    for (const userId of userIds) {
      this.emit(SOCKET_ROOMS.user(userId), SOCKET_EVENTS.BOARD_MEMBERSHIP_CHANGED, {
        boardId,
        cursor,
      });
    }
  }

  /** Master data is global; every authenticated socket joins the `masters` room. */
  emitMasterChange(entity: SyncEntity, cursor: number): void {
    this.emit(SOCKET_ROOMS.masters(), SOCKET_EVENTS.MASTER_CHANGED, { entity, cursor });
  }

  /** Nudges a specific device to sync, e.g. after its own push was applied. */
  emitSyncHint(userId: string, cursor: number): void {
    this.emit(SOCKET_ROOMS.user(userId), SOCKET_EVENTS.SYNC_HINT, { cursor });
  }

  /**
   * Same hint discipline as the board rooms: the payload names the scope and nothing more,
   * the display refetches its own queue.
   */
  emitKdsChanged(scope: { counterId?: string; printingGroupId?: string }): void {
    if (scope.counterId !== undefined) {
      this.emit(KDS_REALTIME_ROOMS.kdsCounter(scope.counterId), KDS_SOCKET_EVENTS.KDS_CHANGED, {
        counterId: scope.counterId,
      });
    }
    if (scope.printingGroupId !== undefined) {
      this.emit(
        KDS_REALTIME_ROOMS.kdsKitchen(scope.printingGroupId),
        KDS_SOCKET_EVENTS.KDS_CHANGED,
        { printingGroupId: scope.printingGroupId },
      );
    }
  }

  /**
   * The customer display is the one channel whose payload IS the data: a pre-printed QR has
   * no refetch trigger of its own, so the bill itself goes out with the event. Null clears
   * the screen — the counter has no open ticket.
   */
  emitCdsBill(counterId: string, bill: CdsBillDto | null): void {
    this.emit(KDS_REALTIME_ROOMS.cdsCounter(counterId), KDS_SOCKET_EVENTS.CDS_BILL, bill);
  }

  /**
   * The till's unsaved cart, relayed verbatim from the POS socket (after the server's own
   * validation and QR enrichment in socketServer). Nothing is stored — a display that joins
   * late simply waits for the next keystroke. Null clears the live view.
   */
  emitCdsLive(counterId: string, live: CdsLiveDto | null): void {
    this.emit(KDS_REALTIME_ROOMS.cdsCounter(counterId), KDS_SOCKET_EVENTS.CDS_LIVE, live);
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (this.io === null) return;
    try {
      this.io.to(room).emit(event, payload);
    } catch (error) {
      // A broadcast failure must never fail the HTTP request that triggered it — the client
      // will still converge on its next scheduled pull.
      logger.warn('Realtime emit failed', { room, event }, error);
    }
  }
}

export const realtime = new RealtimeGateway();
