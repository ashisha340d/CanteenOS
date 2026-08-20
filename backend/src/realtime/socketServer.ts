import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import {
  Capability,
  CHAT_SOCKET_EVENTS,
  ClientType,
  CounterMessageDirection,
  KDS_SOCKET_EVENTS,
  PosPaymentMethod,
  SOCKET_EVENTS,
  SOCKET_ROOMS,
  UserStatus,
  type CdsLiveDto,
  type CdsLiveLineDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { boardRepository } from '../repositories/BoardRepository';
import { userRepository } from '../repositories/UserRepository';
import { tokenService } from '../services/TokenService';
import { logger } from '../utils/logger';
import { isAllowedCorsOrigin } from '../utils/originAllowlist';
import { menuBoardRealtime } from './menuBoardSocket';
import { KDS_REALTIME_ROOMS, realtime } from './RealtimeGateway';

interface SocketAuth {
  userId: string;
  deviceId: string;
  /** Which app this socket is: decides which side of the counter chat it speaks as. */
  clientType: ClientType;
  capabilities: Capability[];
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

      (socket.data as SocketAuth) = {
        userId: user.id,
        deviceId: claims.did,
        clientType: claims.ct,
        capabilities: tokenService.capabilitiesFor(user.role, claims.ct),
      };
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

  // A namespace of the same server, not a second one — `io.of(...)` shares the underlying
  // HTTP upgrade handling and CORS config, but its own middleware stack, which is what lets
  // this stay unauthenticated while the default namespace above requires a bearer token.
  menuBoardRealtime.attach(io);

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

  // Kitchen and customer displays. Unlike board rooms these are gated by capability, not
  // membership: a display scope is a counter, and any till operator may stand at any counter.
  socket.on(KDS_SOCKET_EVENTS.KDS_SUBSCRIBE, (payload: unknown) => {
    joinKdsScope(socket, auth, payload).catch((error: unknown) => {
      logger.warn('Socket KDS room join failed', { userId: auth.userId }, error);
    });
  });

  socket.on(KDS_SOCKET_EVENTS.CDS_SUBSCRIBE, (payload: unknown) => {
    joinCdsScope(socket, auth, payload).catch((error: unknown) => {
      logger.warn('Socket CDS room join failed', { userId: auth.userId }, error);
    });
  });

  socket.on(KDS_SOCKET_EVENTS.CDS_LIVE, (payload: unknown) => {
    try {
      relayCdsLive(auth, payload);
    } catch (error) {
      logger.warn('Socket CDS live relay failed', { userId: auth.userId }, error);
    }
  });

  /* The office↔counter chat. Its own room rather than the KDS one it shadows, so a message
     does not wake every board listener into a queue refetch. Admin sockets have no other way
     into a counter-scoped room — they join only user/board/masters rooms above — so this
     handler is the single door, and it is capability-gated like the display scopes. */
  socket.on(CHAT_SOCKET_EVENTS.CHAT_SUBSCRIBE, (payload: unknown) => {
    joinChatScope(socket, auth, payload).catch((error: unknown) => {
      logger.warn('Socket chat room join failed', { userId: auth.userId }, error);
    });
  });

  socket.on(CHAT_SOCKET_EVENTS.CHAT_UNSUBSCRIBE, (payload: unknown) => {
    const counterId = readScopeId(payload, 'counterId');
    if (counterId === null) return;
    Promise.resolve(socket.leave(KDS_REALTIME_ROOMS.chatCounter(counterId))).catch(
      (error: unknown) => {
        logger.warn('Socket chat room leave failed', { userId: auth.userId, counterId }, error);
      },
    );
  });

  /* Typing presence, relayed and never stored — same discipline as the board's. Membership of
     the room is the authorisation: a socket can only announce itself on a channel it already
     joined, and the side it speaks as comes from its token, not from the payload. */
  socket.on(CHAT_SOCKET_EVENTS.CHAT_TYPING_SET, (payload: unknown) => {
    const counterId = readScopeId(payload, 'counterId');
    if (counterId === null) return;
    const room = KDS_REALTIME_ROOMS.chatCounter(counterId);
    if (!socket.rooms.has(room)) return;

    const typing =
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { typing?: unknown }).typing === true;

    socket.to(room).emit(CHAT_SOCKET_EVENTS.CHAT_TYPING, {
      counterId,
      direction: sideFor(auth.clientType),
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

/**
 * A display names its scope — `{counterId}` for a counter screen, `{printingGroupId}` for a
 * kitchen screen. Re-verified against the socket's capabilities on every join, mirroring the
 * membership re-check in `joinBoard`: holding a socket must not grant a scope on its own.
 */
async function joinKdsScope(socket: Socket, auth: SocketAuth, payload: unknown): Promise<void> {
  if (!auth.capabilities.includes(Capability.POS_READ)) {
    logger.warn('Socket denied KDS room join', { userId: auth.userId });
    return;
  }

  const counterId = readScopeId(payload, 'counterId');
  if (counterId !== null) {
    await socket.join(KDS_REALTIME_ROOMS.kdsCounter(counterId));
    return;
  }
  const printingGroupId = readScopeId(payload, 'printingGroupId');
  if (printingGroupId !== null) {
    await socket.join(KDS_REALTIME_ROOMS.kdsKitchen(printingGroupId));
  }
}

async function joinCdsScope(socket: Socket, auth: SocketAuth, payload: unknown): Promise<void> {
  if (!auth.capabilities.includes(Capability.POS_READ)) {
    logger.warn('Socket denied CDS room join', { userId: auth.userId });
    return;
  }

  const counterId = readScopeId(payload, 'counterId');
  if (counterId !== null) {
    await socket.join(KDS_REALTIME_ROOMS.cdsCounter(counterId));
  }
}

/**
 * A chat channel is a counter, gated on POS_READ exactly like the display scopes: whoever may
 * watch a counter's board may talk to it. Re-verified on every join rather than trusted from
 * the handshake, mirroring `joinKdsScope`.
 */
async function joinChatScope(socket: Socket, auth: SocketAuth, payload: unknown): Promise<void> {
  if (!auth.capabilities.includes(Capability.POS_READ)) {
    logger.warn('Socket denied chat room join', { userId: auth.userId });
    return;
  }
  const counterId = readScopeId(payload, 'counterId');
  if (counterId !== null) {
    await socket.join(KDS_REALTIME_ROOMS.chatCounter(counterId));
  }
}

/**
 * Which side of the channel this socket speaks as. Read from the client type in the token, so a
 * wall display cannot announce itself as the office.
 */
function sideFor(clientType: ClientType): CounterMessageDirection {
  return clientType === ClientType.KDS
    ? CounterMessageDirection.TO_ADMIN
    : CounterMessageDirection.TO_COUNTER;
}

/**
 * Stand-in VPA until payments configuration exists — the QR demonstrates the customer-facing
 * flow and is not a real collectable address.
 */
const CDS_DEMO_UPI_ID = 'demo@upi';

/**
 * Relays a till's live cart to its counter's customer display. Gated by POS_OPERATE like any
 * till action; the payload is rebuilt field by field so a malformed client cannot push
 * arbitrary shapes onto a customer-facing screen, and the QR link is built here because a
 * till must never be the source of a payment address.
 */
function relayCdsLive(auth: SocketAuth, payload: unknown): void {
  if (!auth.capabilities.includes(Capability.POS_OPERATE)) {
    logger.warn('Socket denied CDS live publish', { userId: auth.userId });
    return;
  }
  if (typeof payload !== 'object' || payload === null) return;
  const body = payload as Record<string, unknown>;
  const counterId =
    typeof body.counterId === 'string' && body.counterId !== '' ? body.counterId : null;
  if (counterId === null) return;

  if (body.clear === true) {
    realtime.emitCdsLive(counterId, null);
    return;
  }

  const lines: CdsLiveLineDto[] = [];
  if (Array.isArray(body.lines)) {
    for (const raw of body.lines.slice(0, 200)) {
      if (typeof raw !== 'object' || raw === null) continue;
      const line = raw as Record<string, unknown>;
      if (typeof line.itemName !== 'string' || line.itemName === '') continue;
      lines.push({
        itemName: line.itemName,
        variantName: typeof line.variantName === 'string' ? line.variantName : null,
        quantity: toFiniteNumber(line.quantity),
        unitPrice: toFiniteNumber(line.unitPrice),
        lineTotal: toFiniteNumber(line.lineTotal),
      });
    }
  }

  const paymentMethods = (Array.isArray(body.paymentMethods) ? body.paymentMethods : []).filter(
    (method): method is PosPaymentMethod =>
      typeof method === 'string' &&
      (Object.values(PosPaymentMethod) as string[]).includes(method),
  );

  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber : null;
  const totalAmount = toFiniteNumber(body.totalAmount);
  const upiLink = paymentMethods.includes(PosPaymentMethod.UPI)
    ? `upi://pay?pa=${CDS_DEMO_UPI_ID}&am=${totalAmount.toFixed(2)}&cu=INR` +
    `&tn=${encodeURIComponent(orderNumber ?? 'POS')}`
    : null;

  const live: CdsLiveDto = {
    counterId,
    orderNumber,
    lines,
    subtotalAmount: toFiniteNumber(body.subtotalAmount),
    discountAmount: toFiniteNumber(body.discountAmount),
    totalAmount,
    paymentMethods,
    upiLink,
  };
  realtime.emitCdsLive(counterId, live);
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readScopeId(payload: unknown, key: 'counterId' | 'printingGroupId'): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined || !header.toLowerCase().startsWith('bearer ')) return undefined;
  return header.slice(7).trim();
}
