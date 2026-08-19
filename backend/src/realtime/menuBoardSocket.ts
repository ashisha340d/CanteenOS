import type { Server as SocketServer } from 'socket.io';
import { MENU_BOARD_CHANGED_EVENT, MENU_BOARD_SOCKET_NAMESPACE } from '@menuboard/shared';
import { logger } from '../utils/logger';

/**
 * The public realtime channel a Digital Menu Board holds open.
 *
 * Everything else in this app's realtime layer (`RealtimeGateway`) assumes a signed-in user: it
 * broadcasts to per-board and per-user rooms that only an authenticated socket can join. A menu
 * board has neither — it is a browser on a wall with no session — so it gets its own Socket.IO
 * *namespace* rather than a room on the default one. Namespaces carry independent middleware
 * stacks in Socket.IO, which is exactly the property needed here: `io.use(...)` in
 * `socketServer.ts` authenticates the default namespace and never runs against this one.
 *
 * There is no per-screen targeting. A change anywhere in Menu Master could be the one thing a
 * given screen's menu depends on, and re-deriving that dependency server-side (which categories,
 * which items, which media, transitively) would need to duplicate the resolution logic that
 * already lives in `MenuMasterService.getMenuTree`. Broadcasting to every connected board and
 * letting each one ask "did *my* revision move?" is simpler, and cheap: a hall runs a handful of
 * screens, not thousands.
 */
export class MenuBoardRealtime {
  private io: SocketServer | null = null;

  attach(io: SocketServer): void {
    const namespace = io.of(MENU_BOARD_SOCKET_NAMESPACE);
    namespace.on('connection', (socket) => {
      logger.debug('Menu board socket connected', {
        socketId: socket.id,
        screen: socket.handshake.query.screen,
      });
      socket.on('disconnect', (reason) => {
        logger.debug('Menu board socket disconnected', { socketId: socket.id, reason });
      });
    });
    this.io = io;
  }

  detach(): void {
    this.io = null;
  }

  /**
   * Tells every connected board "go check whether anything you render has changed". Called
   * after any write that could move a board's revision — see the call sites for what that
   * covers: `MenuMasterService.announce`, `MediaService`'s assignment mutations, and
   * `MenuBoardService`'s own screen writes.
   */
  announceChange(reason: string): void {
    if (this.io === null) return;
    try {
      this.io.of(MENU_BOARD_SOCKET_NAMESPACE).emit(MENU_BOARD_CHANGED_EVENT, { reason });
    } catch (error) {
      // A broadcast failure must never fail the write that triggered it — a board that misses
      // this simply catches up on its next reconnect, which happens automatically.
      logger.warn('Menu board realtime emit failed', { reason }, error);
    }
  }
}

export const menuBoardRealtime = new MenuBoardRealtime();
