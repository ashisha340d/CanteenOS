import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { SOCKET_EVENTS, SOCKET_ROOMS, UserStatus } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { boardRepository } from '../repositories/BoardRepository';
import { userRepository } from '../repositories/UserRepository';
import { tokenService } from '../services/TokenService';
import { logger } from '../utils/logger';
import { isAllowedCorsOrigin } from '../utils/originAllowlist';
import { realtime } from './RealtimeGateway';

interface SocketAuth {
  userId: string;
  deviceId: string;
}

/**
 * Socket.IO server.
 *
 * The same access token authenticates the socket as the REST API, and room membership mirrors
 * board membership. Because broadcasts are hints rather than data, a socket that misses an event
 * simply syncs slightly later — there is no state to reconcile.
 */
export function createSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      // Mirrors the Express CORS decision exactly — previously this was the bare
      // `config.corsOrigins` list, so the Expo web client (e.g. localhost:8081) could call
      // the REST API but was refused the realtime socket.
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    },
    // Long enough to survive a mobile network hiccup without treating it as a disconnect.
    pingTimeout: 25_000,
    pingInterval: 20_000,
    maxHttpBufferSize: 1e5,
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        extractBearer(socket.handshake.headers.authorization);

      if (token === undefined || token === '') {
        next(new Error('UNAUTHENTICATED'));
        return;
      }

      const claims = tokenService.verifyAccessToken(token);

      // Status is checked here too: a suspended user must not keep a live socket open just
      // because their token has not expired yet.
      const user = await userRepository.findById(getPool(), claims.sub);
      if (user === null || user.status !== UserStatus.ACTIVE) {
        next(new Error('ACCOUNT_INACTIVE'));
        return;
      }

      (socket.data as SocketAuth) = { userId: user.id, deviceId: claims.did };
      next();
    } catch (error) {
      logger.debug('Socket authentication rejected', {
        socketId: socket.id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    // A rejection here would be an unhandled rejection on the process, not a failed request:
    // socket handlers have no error boundary above them, so each one catches its own.
    onConnection(socket).catch((error: unknown) => {
      logger.warn('Socket connection setup failed', { socketId: socket.id }, error);
    });
  });

  realtime.attach(io);
  logger.debug('Socket.IO server attached');
  return io;
}

async function onConnection(socket: Socket): Promise<void> {
  const auth = socket.data as SocketAuth;

  // Personal room for notifications and sync hints, plus the global masters room.
  await socket.join(SOCKET_ROOMS.user(auth.userId));
  await socket.join(SOCKET_ROOMS.masters());

  // Auto-join every board the user belongs to, so a client does not have to enumerate them
  // before it can receive board activity.
  try {
    const boardIds = await boardRepository.listBoardIdsForUser(getPool(), auth.userId);
    await Promise.all(boardIds.map((boardId) => socket.join(SOCKET_ROOMS.board(boardId))));

    logger.debug('Socket connected', {
      socketId: socket.id,
      userId: auth.userId,
      deviceId: auth.deviceId,
      boards: boardIds.length,
    });
  } catch (error) {
    logger.warn('Failed to join board rooms', { userId: auth.userId }, error);
  }

  // Explicit join, for a board added during the session.
  socket.on(SOCKET_EVENTS.JOIN_BOARD, (payload: unknown) => {
    joinBoard(socket, auth, payload).catch((error: unknown) => {
      logger.warn('Socket board room join failed', { userId: auth.userId }, error);
    });
  });

  socket.on(SOCKET_EVENTS.LEAVE_BOARD, (payload: unknown) => {
    const boardId = readBoardId(payload);
    if (boardId === null) return;
    // `leave` returns void or a promise depending on the adapter, so normalise before catching.
    Promise.resolve(socket.leave(SOCKET_ROOMS.board(boardId))).catch((error: unknown) => {
      logger.warn('Socket board room leave failed', { userId: auth.userId, boardId }, error);
    });
  });

  /**
   * Typing presence. Relayed to the rest of the board room and never written anywhere — the
   * room membership established above is the authorisation, so a socket can only announce
   * itself on a board it already belongs to.
   */
  socket.on(SOCKET_EVENTS.TYPING_SET, (payload: unknown) => {
    const boardId = readBoardId(payload);
    if (boardId === null) return;
    if (!socket.rooms.has(SOCKET_ROOMS.board(boardId))) return;

    const typing =
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { typing?: unknown }).typing === true;

    socket.to(SOCKET_ROOMS.board(boardId)).emit(SOCKET_EVENTS.TYPING, {
      boardId,
      userId: auth.userId,
      typing,
    });
  });

  socket.on('disconnect', (reason) => {
    logger.debug('Socket disconnected', { socketId: socket.id, userId: auth.userId, reason });
  });
}

async function joinBoard(socket: Socket, auth: SocketAuth, payload: unknown): Promise<void> {
  const boardId = readBoardId(payload);
  if (boardId === null) return;

  // Membership is re-verified: a client asking to join a room it has no claim to must not be
  // able to eavesdrop on another board's activity.
  const boardRole = await boardRepository.findActiveRole(getPool(), boardId, auth.userId);
  if (boardRole === null) {
    logger.warn('Socket denied board room join', { userId: auth.userId, boardId });
    return;
  }

  await socket.join(SOCKET_ROOMS.board(boardId));
}

function readBoardId(payload: unknown): string | null {
  if (typeof payload === 'string') return payload;
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { boardId?: unknown }).boardId === 'string'
  ) {
    return (payload as { boardId: string }).boardId;
  }
  return null;
}

function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined || !header.toLowerCase().startsWith('bearer ')) return undefined;
  return header.slice(7).trim();
}
