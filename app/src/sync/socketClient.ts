import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@menuboard/shared';
import { getApiBaseUrl, performRefresh } from '../api/client';
import { secureTokenStore } from '../utils/secureTokenStore';
import { useSyncStatusStore } from '../state/syncStatusStore';
import { useTypingStore } from '../state/typingStore';

// Read at connect time, not at module load: `discoverApiBaseUrl` may have moved the REST
// client onto a different host by then, and a socket left on the old one would silently
// never deliver a hint.
function socketUrl(): string {
  return getApiBaseUrl().replace('/api/v1', '');
}

let socket: Socket | null = null;
let onPullRequest: (() => void) | null = null;

export function setSocketPullHandler(handler: () => void): void {
  onPullRequest = handler;
}

export function connectSocket(): void {
  if (socket?.connected) return;

  const token = secureTokenStore.getAccessToken();
  if (!token) return;

  socket = io(socketUrl(), {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    useSyncStatusStore.getState().setSocketConnected(true);
  });

  socket.on('disconnect', () => {
    useSyncStatusStore.getState().setSocketConnected(false);
  });

  socket.on('connect_error', async (error: Error) => {
    const message = error.message ?? '';
    if (
      message.includes('UNAUTHENTICATED') ||
      message.includes('TOKEN_EXPIRED') ||
      message.includes('TOKEN_INVALID')
    ) {
      try {
        const tokens = await performRefresh();
        if (socket) {
          socket.auth = { token: tokens.accessToken };
          socket.connect();
        }
      } catch {
        // Refresh failed; the REST interceptor will sign the user out.
        socket?.disconnect();
      }
    }
  });

  // Every server event is a hint only: it never writes entity bodies. It triggers a pull.
  const hintEvents = [
    SOCKET_EVENTS.ENTITY_CHANGED,
    SOCKET_EVENTS.ORDER_CHANGED,
    SOCKET_EVENTS.THREAD_MESSAGE_CREATED,
    SOCKET_EVENTS.ACKNOWLEDGEMENT_CREATED,
    SOCKET_EVENTS.NOTIFICATION_CREATED,
    SOCKET_EVENTS.BOARD_MEMBERSHIP_CHANGED,
    SOCKET_EVENTS.MASTER_CHANGED,
    SOCKET_EVENTS.SYNC_HINT,
  ];
  for (const event of hintEvents) {
    socket.on(event, () => {
      onPullRequest?.();
    });
  }

  // Presence, not data: applied straight to the typing store rather than triggering a pull.
  socket.on(SOCKET_EVENTS.TYPING, (payload: { boardId?: string; userId?: string; typing?: boolean }) => {
    if (typeof payload?.boardId !== 'string' || typeof payload?.userId !== 'string') return;
    useTypingStore.getState().setTyping(payload.boardId, payload.userId, payload.typing === true);
  });
}

/** Announces (or withdraws) the signed-in user's typing state on a board. */
export function emitTyping(boardId: string, typing: boolean): void {
  socket?.emit(SOCKET_EVENTS.TYPING_SET, { boardId, typing });
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
