import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@menuboard/shared';
import { API_BASE_URL, performRefresh } from '../api/client';
import { secureTokenStore } from '../utils/secureTokenStore';
import { useSyncStatusStore } from '../state/syncStatusStore';

// Derived from the same platform-resolved API_BASE_URL the REST client uses, so the socket
// host follows apiBaseUrlWeb on web instead of always falling back to the Android emulator alias.
const SOCKET_URL: string = API_BASE_URL.replace('/api/v1', '');

let socket: Socket | null = null;
let onPullRequest: (() => void) | null = null;

export function setSocketPullHandler(handler: () => void): void {
  onPullRequest = handler;
}

export function connectSocket(): void {
  if (socket?.connected) return;

  const token = secureTokenStore.getAccessToken();
  if (!token) return;

  socket = io(SOCKET_URL, {
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
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
